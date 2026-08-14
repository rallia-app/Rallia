-- The 12 h deadline reminder named neither its window nor the opponent, so a
-- tester who received it could not tell it apart from the 48 h one and reported
-- it as missing. Both stamps were set and both notices had in fact been sent;
-- only the copy was unidentifiable. It now mirrors the 48 h shape: the hours
-- left, who the game is against, and what happens if no time is agreed.
--
-- The audience rule is unchanged: only players with no time vote on the game
-- get it, which is what makes it a last call rather than a second reminder.

CREATE OR REPLACE FUNCTION public.lt_send_tournament_deadline_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec  record;
    v_rows jsonb;
    v_sent integer := 0;
    v_eff  timestamptz;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress')
           AND tm.match_id IS NULL
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND (tm.deadline_nudge48_at IS NULL OR tm.deadline_nudge12_at IS NULL)
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff <= now();

        IF v_rec.deadline_nudge12_at IS NULL AND v_eff <= now() + interval '12 hours' THEN
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', u.uid,
                'type', 'tournament_round_deadline_soon',
                'target_id', v_rec.tournament_id,
                'title', CASE WHEN public.lt_user_is_fr(u.uid)
                           THEN 'Dernière chance : 12 h pour jouer'
                           ELSE 'Last chance: 12h left to play' END,
                'body', CASE WHEN public.lt_user_is_fr(u.uid)
                          THEN v_rec.t_name || ' : il reste 12 h pour jouer ta partie contre ' || u.opp || '. Sans moment convenu, elle sera déclarée forfait à l''échéance.'
                          ELSE v_rec.t_name || ': 12h left to play your game vs ' || u.opp || '. With no time agreed, it will be forfeited at the deadline.'
                        END,
                'payload', jsonb_build_object(
                    'tournamentId', v_rec.tournament_id,
                    'tournamentMatchId', v_rec.id,
                    'tier', '12h',
                    'deadlineAt', v_eff
                ),
                'priority', 'high'
            ))
            INTO v_rows
            FROM (
                SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)) AS uid,
                       public.lt_registration_display_name(v_rec.player2_registration_id) AS opp
                UNION ALL
                SELECT unnest(public.lt_registration_users(v_rec.player2_registration_id)),
                       public.lt_registration_display_name(v_rec.player1_registration_id)
            ) u
            WHERE NOT EXISTS (
                SELECT 1 FROM match_time_vote v
                  JOIN message m      ON m.id = v.message_id
                  JOIN conversation c ON c.id = m.conversation_id
                 WHERE c.tournament_match_id = v_rec.id
                   AND v.player_id = u.uid);

            IF v_rows IS NOT NULL THEN
                PERFORM insert_notifications(v_rows);
                v_sent := v_sent + jsonb_array_length(v_rows);
            END IF;
            UPDATE tournament_matches
               SET deadline_nudge12_at = now(),
                   deadline_nudge48_at = COALESCE(deadline_nudge48_at, now())
             WHERE id = v_rec.id;

        ELSIF v_rec.deadline_nudge48_at IS NULL AND v_eff <= now() + interval '48 hours' THEN
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', u.uid,
                'type', 'tournament_round_deadline_soon',
                'target_id', v_rec.tournament_id,
                'title', CASE WHEN public.lt_user_is_fr(u.uid)
                           THEN '48 h pour jouer ta partie' ELSE '48h left to play your game' END,
                'body', CASE WHEN public.lt_user_is_fr(u.uid)
                          THEN v_rec.t_name || ' : il reste 48 h pour organiser et jouer ta partie contre ' || u.opp || '.'
                          ELSE v_rec.t_name || ': 48h left to organize and play your game vs ' || u.opp || '.'
                        END,
                'payload', jsonb_build_object(
                    'tournamentId', v_rec.tournament_id,
                    'tournamentMatchId', v_rec.id,
                    'tier', '48h',
                    'deadlineAt', v_eff
                ),
                'priority', 'normal'
            ))
            INTO v_rows
            FROM (
                SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)) AS uid,
                       public.lt_registration_display_name(v_rec.player2_registration_id) AS opp
                UNION ALL
                SELECT unnest(public.lt_registration_users(v_rec.player2_registration_id)),
                       public.lt_registration_display_name(v_rec.player1_registration_id)
            ) u;

            IF v_rows IS NOT NULL THEN
                PERFORM insert_notifications(v_rows);
                v_sent := v_sent + jsonb_array_length(v_rows);
            END IF;
            UPDATE tournament_matches
               SET deadline_nudge48_at = now()
             WHERE id = v_rec.id;
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

-- CREATE OR REPLACE keeps the existing ACL; restated so a fresh apply cannot
-- leave the cron-only function callable by clients.
REVOKE ALL ON FUNCTION public.lt_send_tournament_deadline_nudges() FROM PUBLIC, anon, authenticated;

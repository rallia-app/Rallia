-- ============================================================================
-- Telling a player WHY the ladder decided their game.
-- ============================================================================
-- The audit has recorded the exact rung since 20260810234100, but the player
-- got one of three generic sentences, and in two cases got nothing at all:
--
--   * a double forfeit stopped notifying anyone in the v2 ladder
--     (20260831130000 dropped the call the previous ladder made);
--   * a stalemate cancellation has never notified anyone.
--
-- Someone who just lost a game they never played is the person most owed a
-- reason, so the rule now travels to the notification. lt_notify_tournament_
-- walkover takes it as a fourth argument, defaulted so the older callers that
-- still pass three keep working and fall back to the generic copy.
--
-- Spec: unplayed-match-resolution.md § 6 (the rungs) and § 8 (what the player
-- is told).
-- ============================================================================

-- ------------------------------------------------- walkover, now with a reason
DROP FUNCTION IF EXISTS public.lt_notify_tournament_walkover(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.lt_notify_tournament_walkover(
    p_tm_id  uuid,
    p_winner uuid,
    p_double boolean,
    p_rule   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm   tournament_matches;
    v_t    tournaments;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_match_walkover',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Partie réglée par forfait' ELSE 'Game settled by walkover' END,
        'body', v_t.name || CASE
          -- Nobody advances.
          WHEN p_double AND public.lt_user_is_fr(u.uid) THEN
            CASE WHEN p_rule = 'no_effort'
              THEN ' : ni toi ni ton adversaire n''avez donné suite avant l''échéance. Personne n''avance.'
              ELSE ' : la partie n''a pas été jouée avant l''échéance. Personne n''avance.' END
          WHEN p_double THEN
            CASE WHEN p_rule = 'no_effort'
              THEN ': neither you nor your opponent followed up before the deadline. Nobody advances.'
              ELSE ': the game was not played before the deadline. Nobody advances.' END

          -- The side that advances.
          WHEN u.won AND public.lt_user_is_fr(u.uid) THEN
            CASE p_rule
              WHEN 'no_show' THEN ' : ton adversaire ne s''est pas présenté à la partie convenue. Tu gagnes par forfait.'
              WHEN 'cancel_forfeit' THEN ' : ton adversaire a annulé la partie convenue et elle n''a pas été reprise. Tu gagnes par forfait.'
              WHEN 'one_sided' THEN ' : tu as donné tes dispos, ton adversaire n''a rien fait avant l''échéance. Tu avances par forfait.'
              WHEN 'gap_rule' THEN ' : vous avez essayé tous les deux, mais tu en as fait plus pour organiser la partie. Tu avances par forfait.'
              ELSE ' : ton adversaire n''a pas donné suite avant l''échéance. Tu avances par forfait.' END
          WHEN u.won THEN
            CASE p_rule
              WHEN 'no_show' THEN ': your opponent did not show up for the agreed game. You win by walkover.'
              WHEN 'cancel_forfeit' THEN ': your opponent cancelled the agreed game and it was not rescheduled. You win by walkover.'
              WHEN 'one_sided' THEN ': you gave your availability, your opponent did nothing before the deadline. You advance by walkover.'
              WHEN 'gap_rule' THEN ': you both tried, but you did more to get the game organized. You advance by walkover.'
              ELSE ': your opponent did not respond before the deadline. You advance by walkover.' END

          -- The side the walkover goes against. No pronoun for the opponent:
          -- we do not know how they refer to themselves.
          WHEN public.lt_user_is_fr(u.uid) THEN
            CASE p_rule
              WHEN 'no_show' THEN ' : tu n''as pas fait ton check-in à la partie convenue. Ton adversaire gagne par forfait.'
              WHEN 'cancel_forfeit' THEN ' : tu as annulé la partie convenue et elle n''a pas été reprise avant l''échéance. Ton adversaire gagne par forfait.'
              WHEN 'one_sided' THEN ' : tu n''as pas donné tes dispos avant l''échéance. Ton adversaire avance par forfait.'
              WHEN 'gap_rule' THEN ' : vous avez essayé tous les deux, mais ton adversaire en a fait plus pour organiser la partie. Le forfait va de ton côté.'
              ELSE ' : la partie a été déclarée forfait à l''échéance parce qu''aucun moment n''a été convenu de ton côté.' END
          ELSE
            CASE p_rule
              WHEN 'no_show' THEN ': you did not check in for the agreed game. Your opponent wins by walkover.'
              WHEN 'cancel_forfeit' THEN ': you cancelled the agreed game and it was not rescheduled before the deadline. Your opponent wins by walkover.'
              WHEN 'one_sided' THEN ': you did not give your availability before the deadline. Your opponent advances by walkover.'
              WHEN 'gap_rule' THEN ': you both tried, but your opponent did more to get the game organized. The walkover goes against you.'
              ELSE ': the game was forfeited at the deadline because no time was agreed on your side.' END
        END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentMatchId', v_tm.id,
            'double', p_double,
            'rule', p_rule
        ),
        'priority', 'high'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(public.lt_registration_users(v_tm.player1_registration_id)) AS uid,
               (v_tm.player1_registration_id = p_winner) AS won
        UNION ALL
        SELECT unnest(public.lt_registration_users(v_tm.player2_registration_id)),
               (v_tm.player2_registration_id = p_winner)
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_notify_tournament_walkover(uuid, uuid, boolean, text) IS
'Tells both sides a pairing was settled without being played, naming the rung
that decided it (no_show, cancel_forfeit, one_sided, gap_rule, no_effort).
p_rule is optional: older callers pass three arguments and get the generic
copy. Spec: unplayed-match-resolution.md § 8.';

REVOKE ALL ON FUNCTION public.lt_notify_tournament_walkover(uuid, uuid, boolean, text)
    FROM PUBLIC, anon, authenticated;

-- --------------------------------------------- cancelled, which named nobody
CREATE OR REPLACE FUNCTION public.lt_notify_tournament_cancelled(
    p_tm_id uuid,
    p_rule  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm   tournament_matches;
    v_t    tournaments;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_match_cancelled',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Partie annulée' ELSE 'Game cancelled' END,
        'body', v_t.name || CASE
          WHEN public.lt_user_is_fr(u.uid) THEN
            CASE p_rule
              WHEN 'unrecorded' THEN ' : vous vous étiez entendus sur un moment mais aucun résultat n''a été inscrit avant l''échéance. La partie est annulée et ne compte pas au classement.'
              WHEN 'mutual_cancel' THEN ' : vous aviez annulé la partie d''un commun accord et elle n''a pas été reprise avant l''échéance. Elle est annulée, sans faute de personne.'
              ELSE ' : vous avez fait votre part tous les deux et ça n''a pas adonné. La partie est annulée, sans faute de personne, et elle ne compte pas au classement.' END
          ELSE
            CASE p_rule
              WHEN 'unrecorded' THEN ': you had agreed on a time but no result was recorded before the deadline. The game is cancelled and does not count in the standings.'
              WHEN 'mutual_cancel' THEN ': you had cancelled the game by mutual agreement and it was not rescheduled before the deadline. It is cancelled, nobody is at fault.'
              ELSE ': you both did your part and it did not work out. The game is cancelled, nobody is at fault, and it does not count in the standings.' END
        END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentMatchId', v_tm.id,
            'rule', p_rule
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(public.lt_registration_users(v_tm.player1_registration_id)) AS uid
        UNION ALL
        SELECT unnest(public.lt_registration_users(v_tm.player2_registration_id))
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_notify_tournament_cancelled(uuid, text) IS
'Tells both sides their pairing was cancelled rather than forfeited: the R4
stalemate, and the two fall-throughs that reach it (unrecorded, mutual_cancel).
Nobody is named a loser, which is the whole point of the rung. Spec:
unplayed-match-resolution.md § 6.';

REVOKE ALL ON FUNCTION public.lt_notify_tournament_cancelled(uuid, text)
    FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------- the ladder, passing it
CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec      record;
    v_eff      timestamptz;
    v_sig1     jsonb;
    v_sig2     jsonb;
    v_st1      text;
    v_st2      text;
    v_s1       int;
    v_s2       int;
    v_gap      int;
    v_winner   uuid;
    v_loser    uuid;
    v_acted    integer := 0;
    v_apply    boolean;
    v_prefix   text;
    v_rows     jsonb;
    v_uid      uuid;
    v_proto    boolean;
    v_rule     text;
    v_origin   text;
    v_ci1      int;
    v_ci2      int;
    v_cancel   record;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.organizer_id AS t_org,
               t.match_format AS t_format, t.games_per_set AS t_gps,
               t.points_per_game AS t_ppg,
               COALESCE(t.scheduling_funnel_enabled, false) AS t_funnel
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
         FOR UPDATE OF tm SKIP LOCKED
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff > now();

        -- Act only where the funnel produced the evidence this reads.
        v_apply  := (NOT p_dry_run) AND v_rec.t_funnel;
        v_prefix := CASE WHEN v_apply THEN '' ELSE 'dryrun_' END;

        -- R0: a contested result is never decided by the machine.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        v_proto := v_rec.deadline_nudge48_at IS NOT NULL
               AND v_rec.deadline_nudge12_at IS NOT NULL;

        v_sig1 := public.lt_side_signals(v_rec.id, v_rec.player1_registration_id);
        v_sig2 := public.lt_side_signals(v_rec.id, v_rec.player2_registration_id);
        v_s1   := COALESCE((v_sig1->>'s')::int, 0);
        v_s2   := COALESCE((v_sig2->>'s')::int, 0);
        v_st1  := COALESCE(v_sig1->>'state', 'U');
        v_st2  := COALESCE(v_sig2->>'state', 'U');

        -- R3: a game was agreed and no result was declared.
        IF v_rec.match_id IS NOT NULL THEN
            SELECT count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player1_registration_id))
                                      AND mp.checked_in_at IS NOT NULL),
                   count(*) FILTER (WHERE mp.player_id = ANY (public.lt_registration_users(v_rec.player2_registration_id))
                                      AND mp.checked_in_at IS NOT NULL)
              INTO v_ci1, v_ci2
              FROM match_participant mp WHERE mp.match_id = v_rec.match_id;

            IF v_ci1 > 0 AND v_ci2 = 0 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
                v_rule   := 'no_show';
            ELSIF v_ci2 > 0 AND v_ci1 = 0 THEN
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
                v_rule   := 'no_show';
            ELSE
                -- Nobody, or both: an agreement is the strongest scheduling act
                -- there is, so both sides are deemed E and fall to the gap rule.
                v_st1 := 'E'; v_st2 := 'E';
                v_s1  := GREATEST(v_s1, 2); v_s2 := GREATEST(v_s2, 2);
                v_rule := 'unrecorded'; v_origin := 'unrecorded';
            END IF;
        ELSE
            -- R3': the linked game was cancelled and the trigger detached it.
            SELECT m.mutually_cancelled, a.actor_id INTO v_cancel
              FROM leagues_tournaments_audit a
              JOIN match m ON m.id = (a.payload_after->>'match_id')::uuid
             WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
               AND a.action = 'detach_cancelled_match'
             ORDER BY a.occurred_at DESC LIMIT 1;

            IF v_cancel IS NOT NULL AND v_cancel.mutually_cancelled IS NOT TRUE THEN
                -- Cancelling after agreeing is a forfeit on the canceller.
                IF v_cancel.actor_id = ANY (public.lt_registration_users(v_rec.player1_registration_id)) THEN
                    v_winner := v_rec.player2_registration_id;
                    v_loser  := v_rec.player1_registration_id;
                ELSE
                    v_winner := v_rec.player1_registration_id;
                    v_loser  := v_rec.player2_registration_id;
                END IF;
                v_rule := 'cancel_forfeit';
            ELSIF v_cancel IS NOT NULL THEN
                v_st1 := 'E'; v_st2 := 'E';
                v_s1  := GREATEST(v_s1, 2); v_s2 := GREATEST(v_s2, 2);
                v_rule := 'mutual_cancel'; v_origin := 'mutual_cancel';
            END IF;
        END IF;

        -- R4 / R5 / R6 on the states, when no conclusive event decided it.
        IF v_rule IS NULL OR v_rule IN ('unrecorded', 'mutual_cancel') THEN
            v_gap := CASE WHEN v_rec.bracket_side = 'pool' THEN 2 ELSE 1 END;

            IF v_st1 = 'E' AND v_st2 = 'E' THEN
                IF abs(v_s1 - v_s2) >= v_gap THEN
                    v_winner := CASE WHEN v_s1 > v_s2 THEN v_rec.player1_registration_id
                                     ELSE v_rec.player2_registration_id END;
                    v_loser  := CASE WHEN v_s1 > v_s2 THEN v_rec.player2_registration_id
                                     ELSE v_rec.player1_registration_id END;
                    v_rule   := 'gap_rule';
                ELSE
                    v_winner := NULL; v_loser := NULL; v_rule := 'stalemate';
                END IF;
            ELSIF v_st1 = 'E' THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
                v_rule   := 'one_sided';
            ELSIF v_st2 = 'E' THEN
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
                v_rule   := 'one_sided';
            ELSE
                v_winner := NULL; v_loser := NULL; v_rule := 'no_effort';
            END IF;
        END IF;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('tournament_match', v_rec.id,
                v_prefix || CASE WHEN v_rule = 'stalemate' THEN 'auto_cancel'
                                 WHEN v_winner IS NULL THEN 'auto_double_forfeit'
                                 ELSE 'auto_walkover' END,
                v_rec.t_org,
                jsonb_build_object('tournament_id', v_rec.tournament_id,
                                   'rule', v_rule,
                                   'winner_registration_id', v_winner,
                                   'signals_p1', v_sig1, 'signals_p2', v_sig2,
                                   'protocol_complete', v_proto,
                                   'funnel', v_rec.t_funnel));

        IF v_apply THEN
            IF v_rule = 'stalemate' THEN
                -- Neither side is at fault: the game leaves the denominator.
                UPDATE tournament_matches
                   SET status = 'cancelled', winner_registration_id = NULL, score = NULL,
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_notify_tournament_cancelled(
                            v_rec.id, COALESCE(v_origin, 'stalemate'));
            ELSIF v_winner IS NULL THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true, v_rule);
            ELSE
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = public.lt_forfeit_score(
                                   v_rec.t_format, v_rec.t_gps, v_rec.t_ppg,
                                   v_winner = v_rec.player1_registration_id),
                       played_at = now(), version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false, v_rule);
            END IF;

            -- Personal consequences need proof they knew, and the prompts.
            IF v_proto THEN
                IF v_rule = 'no_show' AND v_loser IS NOT NULL THEN
                    FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                        INSERT INTO reputation_event
                            (player_id, event_type, base_impact, metadata, event_occurred_at)
                        VALUES (v_uid, 'match_no_show',
                                COALESCE((SELECT default_impact FROM reputation_config
                                           WHERE event_type = 'match_no_show' AND is_active), -50),
                                jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                   'tournamentMatchId', v_rec.id), now());
                    END LOOP;
                ELSIF v_rule IN ('one_sided', 'no_effort') THEN
                    -- Only a side that was aware and did nothing: never a U.
                    IF v_rule = 'one_sided' AND (
                         CASE WHEN v_loser = v_rec.player1_registration_id THEN v_st1 ELSE v_st2 END) = 'P' THEN
                        FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                            INSERT INTO reputation_event
                                (player_id, event_type, base_impact, metadata, event_occurred_at)
                            VALUES (v_uid, 'tournament_unresponsive', -15,
                                    jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                       'tournamentMatchId', v_rec.id), now());
                        END LOOP;
                    ELSIF v_rule = 'no_effort' THEN
                        IF v_st1 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_registration_users(v_rec.player1_registration_id) LOOP
                                INSERT INTO reputation_event
                                    (player_id, event_type, base_impact, metadata, event_occurred_at)
                                VALUES (v_uid, 'tournament_unresponsive', -15,
                                        jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                           'tournamentMatchId', v_rec.id), now());
                            END LOOP;
                        END IF;
                        IF v_st2 = 'P' THEN
                            FOREACH v_uid IN ARRAY public.lt_registration_users(v_rec.player2_registration_id) LOOP
                                INSERT INTO reputation_event
                                    (player_id, event_type, base_impact, metadata, event_occurred_at)
                                VALUES (v_uid, 'tournament_unresponsive', -15,
                                        jsonb_build_object('tournamentId', v_rec.tournament_id,
                                                           'tournamentMatchId', v_rec.id), now());
                            END LOOP;
                        END IF;
                    END IF;
                END IF;
            END IF;
        END IF;

        v_rule := NULL; v_origin := NULL; v_winner := NULL;
        v_loser := NULL; v_cancel := NULL;
        v_acted := v_acted + 1;
    END LOOP;

    RETURN v_acted;
END;
$$;
COMMENT ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) IS
'The deadline ladder, R0..R6 of unplayed-match-resolution.md § 6, reading
lt_side_signals rather than chat. ACTS only on scheduling-funnel events, since
an event without gate answers would score every side U and double-forfeit the
draw; every other event is audited with the dryrun_ prefix. Walkovers carry the
format forfeit score; a stalemate between two engaged sides is cancelled;
reputation follows § 4.4 (loser, P not U, both prompts delivered). Every
outcome notifies both sides with the rung that produced it.';

REVOKE ALL ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_resolve_due_tournament_matches(boolean) TO service_role;

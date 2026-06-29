-- ============================================
-- Notify both players when their next bracket match becomes playable
-- ============================================
-- Adds lt_notify_tournament_match_ready(p_tm_id) and calls it from
-- lt_advance_tournament_winner the moment a next-round match gets both real
-- opponents. Each member of both entries gets a localized "your next match is
-- set vs <opponent>" notification. Round 1 is covered by
-- tournament_bracket_published; this fills rounds 2+.
--
-- Base body is verbatim from 20260510170010 (user-driven attach: matches are
-- created by players, not auto-generated) with the notify call added.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_notify_tournament_match_ready(p_tm_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm     tournament_matches;
    v_t      tournaments;
    v_p1     text;
    v_p2     text;
    v_rows   jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    -- Only when both sides are real, determinate players.
    IF v_tm.id IS NULL
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL
       OR v_tm.player1_is_bye
       OR v_tm.player2_is_bye THEN
        RETURN;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_p1 := public.lt_registration_display_name(v_tm.player1_registration_id);
    v_p2 := public.lt_registration_display_name(v_tm.player2_registration_id);

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', mb.uid,
        'type', 'tournament_match_ready',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(mb.uid)
                   THEN 'Ton prochain match est prêt' ELSE 'Your next match is set' END,
        'body', CASE WHEN public.lt_user_is_fr(mb.uid)
                  THEN v_t.name || ' : tour ' || v_tm.round_number || ' contre ' || mb.opp_name || '.'
                  ELSE v_t.name || ': round ' || v_tm.round_number || ' vs ' || mb.opp_name || '.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'round', v_tm.round_number,
            'tournamentMatchId', v_tm.id
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p2 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player1_registration_id
        UNION ALL
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p1 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player2_registration_id
    ) mb;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.lt_advance_tournament_winner(
    p_tournament_match_id  uuid,
    p_winner_registration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_curr        tournament_matches;
    v_next        tournament_matches;
    v_curr_winner uuid := p_winner_registration_id;
    v_other_bye   boolean;
    v_other_reg   uuid;
    v_tournament  tournaments;
BEGIN
    SELECT * INTO v_curr FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_curr.id IS NULL THEN
        RETURN;
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_curr.tournament_id;

    IF v_tournament.bracket_locked_at IS NULL THEN
        UPDATE tournaments
           SET bracket_locked_at = now(),
               updated_at        = now()
         WHERE id = v_tournament.id;
    END IF;

    WHILE v_curr.next_match_id IS NOT NULL LOOP
        SELECT * INTO v_next FROM tournament_matches
         WHERE id = v_curr.next_match_id FOR UPDATE;

        IF v_curr.next_match_slot = 1 THEN
            UPDATE tournament_matches
               SET player1_registration_id = v_curr_winner,
                   player1_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        ELSE
            UPDATE tournament_matches
               SET player2_registration_id = v_curr_winner,
                   player2_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        END IF;

        SELECT * INTO v_next FROM tournament_matches WHERE id = v_next.id;

        IF v_curr.next_match_slot = 1 THEN
            v_other_bye := v_next.player2_is_bye;
            v_other_reg := v_next.player2_registration_id;
        ELSE
            v_other_bye := v_next.player1_is_bye;
            v_other_reg := v_next.player1_registration_id;
        END IF;

        IF v_other_bye AND v_other_reg IS NULL THEN
            UPDATE tournament_matches
               SET winner_registration_id = v_curr_winner,
                   status                 = 'completed',
                   version                = version + 1,
                   updated_at             = now()
             WHERE id = v_next.id
            RETURNING * INTO v_next;
            v_curr := v_next;
        ELSE
            -- The next match's resolved slots are filled. If both are real
            -- players now, it's playable → tell both sides (helper no-ops if a
            -- slot is still TBD or a bye).
            PERFORM public.lt_notify_tournament_match_ready(v_next.id);
            EXIT;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM tournament_matches m
         WHERE m.tournament_id = v_tournament.id
           AND m.next_match_id IS NULL
           AND m.bracket_side = 'main'
           AND m.status = 'completed'
           AND m.winner_registration_id IS NOT NULL
    ) THEN
        UPDATE tournaments
           SET status     = 'completed',
               version    = version + 1,
               updated_at = now()
         WHERE id = v_tournament.id
           AND status = 'in_progress';
    END IF;
END;
$$;

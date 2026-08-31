-- ============================================
-- Restoring a decision, and a score that stands on entry
-- ============================================
-- Covers 20260831150000 and 20260831160000.
--
--   lt_restore_tournament_match
--     * nothing automated to undo   -> NOTHING_TO_RESTORE
--     * a walkover inside the window -> pairing back to pending, the advance
--                                       unwound, the reputation events the
--                                       decision wrote DELETED, misfire audited
--     * outside the window           -> RESTORE_WINDOW_CLOSED
--
--   one-way score registration
--     * a submitted score is verified AT ONCE, with a 48 h contest window
--     * confirming an already-standing score is a harmless no-op
--     * the declarer cannot contest their own score
--     * the opponent's contest disputes it, and on a tournament pairing flips
--       the row to disputed, which is R0
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_restore_and_one_way_score_test.sql
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

DO $$
DECLARE
    v_t      tournaments;
    v_tm     tournament_matches;
    v_row    tournament_matches;
    v_u1     uuid[];
    v_u2     uuid[];
    v_err    text;
    v_cnt    int;
    v_match  uuid;
    v_mr     match_result;
BEGIN
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
     WHERE tm.bracket_side = 'pool' AND tm.status = 'pending'
       AND t.status = 'in_progress'
       AND tm.player1_registration_id IS NOT NULL AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     ORDER BY tm.id LIMIT 1;
    IF v_tm.id IS NULL THEN RAISE EXCEPTION 'fixture: no pending pool pairing'; END IF;
    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_u1 := public.lt_registration_users(v_tm.player1_registration_id);
    v_u2 := public.lt_registration_users(v_tm.player2_registration_id);

    PERFORM pg_temp.as_user((SELECT organizer_id FROM tournaments WHERE id = v_t.id));

    -- 1. There is nothing automated to undo yet.
    BEGIN
        PERFORM public.lt_restore_tournament_match(v_tm.id);
        RAISE EXCEPTION 'restore with no automated outcome should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'NOTHING_TO_RESTORE' THEN RAISE EXCEPTION 'expected NOTHING_TO_RESTORE, got %', v_err; END IF;
    END;

    -- A decision, with the reputation event it would have written.
    UPDATE tournament_matches
       SET status = 'walkover', winner_registration_id = player1_registration_id,
           score = '6-0 6-0', played_at = now()
     WHERE id = v_tm.id;
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', v_tm.id, 'auto_walkover', v_t.organizer_id,
            jsonb_build_object('tournament_id', v_t.id, 'rule', 'one_sided'));
    INSERT INTO reputation_event (player_id, event_type, base_impact, metadata, event_occurred_at)
    SELECT u, 'tournament_unresponsive', -15,
           jsonb_build_object('tournamentId', v_t.id, 'tournamentMatchId', v_tm.id), now()
      FROM unnest(v_u2) u;

    -- 2. Inside the window it comes all the way back.
    v_row := public.lt_restore_tournament_match(v_tm.id);
    IF v_row.status <> 'pending' OR v_row.winner_registration_id IS NOT NULL
       OR v_row.score IS NOT NULL THEN
        RAISE EXCEPTION 'restore left the pairing decided: % / %', v_row.status, v_row.score;
    END IF;
    SELECT count(*) INTO v_cnt FROM reputation_event
     WHERE (metadata->>'tournamentMatchId')::uuid = v_tm.id;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'restore left % reputation events behind', v_cnt;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM leagues_tournaments_audit
         WHERE entity_id = v_tm.id AND action = 'restore'
           AND (payload_after->>'misfire')::boolean
    ) THEN
        RAISE EXCEPTION 'the restore was not counted as a misfire';
    END IF;

    -- 3. Once the phase is consumed the bracket has moved on.
    UPDATE tournament_matches
       SET status = 'walkover', winner_registration_id = player1_registration_id
     WHERE id = v_tm.id;
    IF public.lt_restore_window_open(v_tm.id) IS NOT TRUE THEN
        RAISE EXCEPTION 'fixture: window should still be open';
    END IF;
    INSERT INTO tournament_matches
        (tournament_id, bracket_side, round_number, match_position, status)
    VALUES (v_t.id, 'main', 1, 1, 'pending');
    IF public.lt_restore_window_open(v_tm.id) IS NOT FALSE THEN
        RAISE EXCEPTION 'the window must close once the knockout exists';
    END IF;
    BEGIN
        PERFORM public.lt_restore_tournament_match(v_tm.id);
        RAISE EXCEPTION 'a restore past the window should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'RESTORE_WINDOW_CLOSED' THEN RAISE EXCEPTION 'expected RESTORE_WINDOW_CLOSED, got %', v_err; END IF;
    END;

    -- ------------------------------------------------ one-way registration
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time)
    VALUES (v_t.sport_id, v_u1[1], current_date, '08:00', '09:30')
    RETURNING id INTO v_match;
    -- The host is added by trigger, so only the opponent is inserted here.
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_match, v_u1[1], 1, 'joined'), (v_match, v_u2[1], 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET team_number = EXCLUDED.team_number, status = 'joined';

    PERFORM pg_temp.as_user(v_u1[1]);
    PERFORM public.submit_match_result_for_match(
        v_match, v_u1[1], 1,
        '[{"team1_score":6,"team2_score":3},{"team1_score":6,"team2_score":4}]'::jsonb, NULL);

    SELECT * INTO v_mr FROM match_result WHERE match_id = v_match;
    -- 4. It stands the moment it is entered.
    IF NOT v_mr.is_verified THEN
        RAISE EXCEPTION 'a declared score must stand on entry';
    END IF;
    IF v_mr.confirmation_deadline < now() + interval '47 hours' THEN
        RAISE EXCEPTION 'expected a 48 h contest window, got %', v_mr.confirmation_deadline;
    END IF;

    -- 5. Confirming what already stands is harmless.
    PERFORM pg_temp.as_user(v_u2[1]);
    IF public.confirm_match_score(v_mr.id, v_u2[1]) IS NOT TRUE THEN
        RAISE EXCEPTION 'confirming a standing score should be a harmless no-op';
    END IF;

    -- 6. The declarer cannot contest their own account of it.
    PERFORM pg_temp.as_user(v_u1[1]);
    BEGIN
        PERFORM public.contest_match_result(v_match);
        RAISE EXCEPTION 'the declarer should not be able to contest';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'DECLARER_CANNOT_CONTEST' THEN RAISE EXCEPTION 'expected DECLARER_CANNOT_CONTEST, got %', v_err; END IF;
    END;

    -- 7. The opponent's contest disputes it.
    PERFORM pg_temp.as_user(v_u2[1]);
    v_mr := public.contest_match_result(v_match);
    IF NOT v_mr.disputed THEN
        RAISE EXCEPTION 'the contest did not dispute the result';
    END IF;

    RAISE NOTICE 'lt_restore_and_one_way_score_test: ALL PASS';
END;
$$;

ROLLBACK;

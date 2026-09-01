-- ============================================
-- Scheduling funnel — the phase availability gate
-- ============================================
-- Covers 20260826200000. The gate is the funnel's foundation: its answer is
-- both the acknowledgement the resolution ladder reads and the volume signal
-- it scores, so the properties below are the ones later slices rest on.
--
--   Hour expansion (lt_hours_in_window)
--     * a weekly grid EXPANDS across the window: the same two cells are worth
--       2 hours over two days and 4 over two weeks. Counting cells once would
--       make a sixteen-day pool phase look like a two-day knockout round.
--     * an empty grid is 0, not null
--     * the timezone shifts the cell, so a grid declared locally is counted
--       locally
--
--   The gate (tournament_submit_phase_availability)
--     * refuses before the organizer has set the phase deadline
--     * refuses a non-participant
--     * accepts a participant, normalising 'pool' to round 0
--     * a skip is an ANSWER with zero hours and an emptied grid
--     * the upsert keeps one row per phase and refreshes responded_at
--     * refuses once the window has closed
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_phase_availability_gate_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_h smallint;
BEGIN
    -- Monday 2026-08-31 through Wednesday: two days, two matching cells.
    v_h := public.lt_hours_in_window(
        '[{"day":"monday","hour":18},{"day":"tuesday","hour":18}]'::jsonb,
        '2026-08-31 00:00:00+00'::timestamptz, '2026-09-02 00:00:00+00'::timestamptz, 'UTC');
    ASSERT v_h = 2, 'two-day window, two cells: expected 2, got ' || v_h;

    -- The same grid over two weeks is worth twice as much.
    v_h := public.lt_hours_in_window(
        '[{"day":"monday","hour":18},{"day":"tuesday","hour":18}]'::jsonb,
        '2026-08-31 00:00:00+00'::timestamptz, '2026-09-14 00:00:00+00'::timestamptz, 'UTC');
    ASSERT v_h = 4, 'two-week window, two cells: expected 4, got ' || v_h;

    v_h := public.lt_hours_in_window('[]'::jsonb,
        '2026-08-31 00:00:00+00'::timestamptz, '2026-09-14 00:00:00+00'::timestamptz, 'UTC');
    ASSERT v_h = 0, 'empty grid: expected 0, got ' || coalesce(v_h::text, '<null>');

    -- 18:00 in Montreal is 22:00 UTC: reading the same window in the player's
    -- zone must still find their evening cell.
    v_h := public.lt_hours_in_window('[{"day":"monday","hour":18}]'::jsonb,
        '2026-08-31 00:00:00+00'::timestamptz, '2026-09-01 00:00:00+00'::timestamptz, 'America/Montreal');
    ASSERT v_h = 1, 'Montreal evening cell: expected 1, got ' || v_h;

    RAISE NOTICE 'hour expansion: ok';
END $$;

DO $$
DECLARE
    v_t      tournaments;
    v_player uuid;
    v_other  uuid;
    v_row    tournament_phase_availability;
    v_msg    text;
    v_first  timestamptz;
BEGIN
    -- Fixtures are mandatory: a skip must not read as a pass.
    SELECT t.* INTO v_t FROM tournaments t
     WHERE t.status IN ('registration_closed', 'in_progress')
       AND EXISTS (SELECT 1 FROM tournament_registrations r
                    WHERE r.tournament_id = t.id AND r.status = 'registered')
     ORDER BY t.created_at DESC LIMIT 1;
    IF v_t.id IS NULL THEN RAISE EXCEPTION 'fixture: no live tournament with registrations'; END IF;

    SELECT r.user_id INTO v_player FROM tournament_registrations r
     WHERE r.tournament_id = v_t.id AND r.status = 'registered' AND r.user_id IS NOT NULL LIMIT 1;
    IF v_player IS NULL THEN RAISE EXCEPTION 'fixture: no registered player'; END IF;

    SELECT u.id INTO v_other FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM tournament_registrations r
                        WHERE r.tournament_id = v_t.id
                          AND (r.user_id = u.id OR r.partner_user_id = u.id)) LIMIT 1;
    IF v_other IS NULL THEN RAISE EXCEPTION 'fixture: no outsider'; END IF;

    DELETE FROM tournament_round_deadlines WHERE tournament_id = v_t.id AND bracket_side = 'pool';

    -- 1. the gate cannot open before the organizer has set a deadline
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player::text)::text, true);
    BEGIN
        v_row := public.tournament_submit_phase_availability(v_t.id, 'pool', 0::smallint, 'confirmed');
        RAISE EXCEPTION 'expected a refusal with no phase deadline';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'PHASE_DEADLINE_NOT_SET', 'no deadline: got ' || v_msg;
    END;

    INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
    VALUES (v_t.id, 'pool', 0, now() + interval '14 days');

    -- 2. the gate belongs to the people playing the phase
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
    BEGIN
        v_row := public.tournament_submit_phase_availability(v_t.id, 'pool', 0::smallint, 'confirmed');
        RAISE EXCEPTION 'expected a refusal for a non-participant';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'NOT_A_PARTICIPANT', 'outsider: got ' || v_msg;
    END;

    -- 3. a participant answers; the grid is expanded, the phase key normalised
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_player::text)::text, true);
    v_row := public.tournament_submit_phase_availability(
        v_t.id, 'pool', 0::smallint, 'confirmed',
        '[{"day":"monday","hour":18},{"day":"wednesday","hour":19}]'::jsonb, 'UTC');
    ASSERT v_row.outcome = 'confirmed', 'submit: outcome is ' || v_row.outcome;
    ASSERT v_row.round_number = 0, 'submit: pool must normalise to round 0';
    ASSERT v_row.hours_in_window BETWEEN 3 AND 5,
        'submit: two weekly cells over 14 days should be about 4, got ' || v_row.hours_in_window;
    v_first := v_row.responded_at;

    -- 4. a skip is an answer, not silence: zero hours, grid emptied
    v_row := public.tournament_submit_phase_availability(
        v_t.id, 'pool', 0::smallint, 'skipped',
        '[{"day":"monday","hour":18}]'::jsonb, 'UTC');
    ASSERT v_row.outcome = 'skipped', 'skip: outcome is ' || v_row.outcome;
    ASSERT v_row.hours_in_window = 0, 'skip: expected 0 hours, got ' || v_row.hours_in_window;
    ASSERT v_row.grid_snapshot = '[]'::jsonb, 'skip: the grid should be emptied';
    ASSERT v_row.responded_at >= v_first, 'upsert: responded_at should refresh';
    ASSERT (SELECT count(*) FROM tournament_phase_availability
             WHERE tournament_id = v_t.id AND player_id = v_player) = 1,
        'upsert: expected exactly one row for the phase';

    -- 5. past the deadline the phase is being decided, not planned
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    BEGIN
        v_row := public.tournament_submit_phase_availability(v_t.id, 'pool', 0::smallint, 'confirmed');
        RAISE EXCEPTION 'expected a refusal past the deadline';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'PHASE_WINDOW_CLOSED', 'closed window: got ' || v_msg;
    END;

    RAISE NOTICE 'lt_phase_availability_gate_test: all assertions passed';
END $$;

ROLLBACK;

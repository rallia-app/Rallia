-- ============================================
-- Scheduling funnel — options come from the phase snapshots
-- ============================================
-- Covers 20260829180000. The property under test is the one the arbitration
-- model rests on: an option the app offers must be a slot both sides declared
-- themselves free for INSIDE the phase, so it can never be built from a live
-- grid the player may edit afterwards.
--
--   lt_phase_grid_avail
--     * funnel off                  -> NULL (the live grid stays the source)
--     * funnel on, one side missing -> NULL (never overlap against a side
--                                      that declared nothing)
--     * every participant answered  -> the snapshot cells, per player
--     * a skipped answer            -> counts as answered, contributes no cell
--
--   match_organizer_options
--     * with an override, the mutual hours are the snapshot's, NOT the live
--       grid's: the live grid is mutated to a disjoint set and the overlap
--       does not move.
--
-- Run against a fresh local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_funnel_options_from_snapshots_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_tm      tournament_matches;
    v_t       tournaments;
    v_users   uuid[];
    v_uid     uuid;
    v_round   smallint;
    v_grid    jsonb;
    v_cells   int;
    v_hours   int[];
    v_before  int[];
BEGIN
    -- A pool pairing on a pool_knockout event, both slots real.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournaments t ON t.id = tm.tournament_id
     WHERE tm.bracket_side = 'pool'
       AND tm.player1_registration_id IS NOT NULL
       AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     ORDER BY tm.id LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'fixture: no pool pairing found';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_round := CASE WHEN v_tm.bracket_side = 'pool' THEN 0 ELSE v_tm.round_number END;

    SELECT array_agg(DISTINCT u.uid) INTO v_users
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);

    -- 1. Funnel off: no override, whatever the gate rows say.
    UPDATE tournaments SET scheduling_funnel_enabled = false WHERE id = v_t.id;
    IF public.lt_phase_grid_avail(v_tm.id) IS NOT NULL THEN
        RAISE EXCEPTION 'funnel off must not override the live grid';
    END IF;

    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    DELETE FROM tournament_phase_availability
     WHERE tournament_id = v_t.id AND bracket_side = v_tm.bracket_side
       AND round_number = v_round;

    -- 2. Nobody answered yet.
    IF public.lt_phase_grid_avail(v_tm.id) IS NOT NULL THEN
        RAISE EXCEPTION 'no answers must not produce an override';
    END IF;

    -- 3. One side only: still no override. Overlapping against a side that
    --    declared nothing would invent agreement out of silence.
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome,
         hours_in_window, grid_snapshot)
    VALUES (v_t.id, v_tm.bracket_side, v_round, v_users[1], 'edited', 4,
            '[{"day":"monday","hour":18},{"day":"tuesday","hour":19}]'::jsonb);
    IF public.lt_phase_grid_avail(v_tm.id) IS NOT NULL THEN
        RAISE EXCEPTION 'a single answer must not produce an override';
    END IF;

    -- 4. Everyone answered: the override is the union of the snapshots.
    FOR i IN 2..array_length(v_users, 1) LOOP
        INSERT INTO tournament_phase_availability
            (tournament_id, bracket_side, round_number, player_id, outcome,
             hours_in_window, grid_snapshot)
        VALUES (v_t.id, v_tm.bracket_side, v_round, v_users[i], 'edited', 4,
                '[{"day":"monday","hour":18},{"day":"wednesday","hour":20}]'::jsonb);
    END LOOP;

    v_grid := public.lt_phase_grid_avail(v_tm.id);
    IF v_grid IS NULL THEN
        RAISE EXCEPTION 'every participant answered, expected an override';
    END IF;
    SELECT count(*) INTO v_cells FROM jsonb_array_elements(v_grid);
    IF v_cells <> 2 * array_length(v_users, 1) THEN
        RAISE EXCEPTION 'expected % cells, got %', 2 * array_length(v_users, 1), v_cells;
    END IF;
    -- Monday 18h is the only hour every side declared: the mutual slot.
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_grid) c
         WHERE c ->> 'day' = 'monday' AND (c ->> 'hour')::int = 18
           AND (c ->> 'player_id')::uuid = v_users[1]
    ) THEN
        RAISE EXCEPTION 'the override lost a declared cell';
    END IF;

    -- 5. The engine reads the override, not the live grid. Move the live grid
    --    somewhere disjoint; the mutual hour must not follow it.
    SELECT array_agg(DISTINCT o.hour_of_day ORDER BY o.hour_of_day) INTO v_before
      FROM public.match_organizer_options(v_users, v_t.sport_id, 14, 10, v_grid) o
     WHERE o.free_count = array_length(v_users, 1);

    DELETE FROM player_availability WHERE player_id = ANY (v_users);
    FOREACH v_uid IN ARRAY v_users LOOP
        INSERT INTO player_availability (player_id, day, hour_of_day, is_active)
        VALUES (v_uid, 'friday', 7, true)
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT array_agg(DISTINCT o.hour_of_day ORDER BY o.hour_of_day) INTO v_hours
      FROM public.match_organizer_options(v_users, v_t.sport_id, 14, 10, v_grid) o
     WHERE o.free_count = array_length(v_users, 1);

    IF v_hours IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'the override followed the live grid: % then %', v_before, v_hours;
    END IF;
    IF v_hours IS NOT NULL AND 7 = ANY (v_hours) THEN
        RAISE EXCEPTION 'a live-grid-only hour leaked into the snapshot options';
    END IF;

    -- 6. Without the override the SAME call sees the live grid, which proves
    --    the two sources are really distinct and the engine still works.
    SELECT array_agg(DISTINCT o.hour_of_day ORDER BY o.hour_of_day) INTO v_hours
      FROM public.match_organizer_options(v_users, v_t.sport_id, 14, 10) o
     WHERE o.free_count = array_length(v_users, 1);
    IF v_hours IS NOT NULL AND NOT (7 = ANY (v_hours)) THEN
        RAISE EXCEPTION 'live-grid path lost its own hour: %', v_hours;
    END IF;

    -- 7. A skip is an answer with no cells: the pairing gets an override that
    --    simply carries fewer hours, never a NULL that would fall back.
    UPDATE tournament_phase_availability
       SET outcome = 'skipped', hours_in_window = 0, grid_snapshot = '[]'::jsonb
     WHERE tournament_id = v_t.id AND bracket_side = v_tm.bracket_side
       AND round_number = v_round AND player_id = v_users[1];
    v_grid := public.lt_phase_grid_avail(v_tm.id);
    IF v_grid IS NULL THEN
        RAISE EXCEPTION 'a skip is still an answer; expected an override';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_grid) c
         WHERE (c ->> 'player_id')::uuid = v_users[1]
    ) THEN
        RAISE EXCEPTION 'a skipped side must contribute no cell';
    END IF;

    RAISE NOTICE 'lt_funnel_options_from_snapshots_test: ALL PASS';
END;
$$;

ROLLBACK;

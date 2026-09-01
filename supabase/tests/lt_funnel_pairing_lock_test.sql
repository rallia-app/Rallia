-- ============================================
-- Scheduling funnel — the pairing room waits for both gate answers
-- ============================================
-- Covers 20260826210000. Two things are asserted, and the second matters as
-- much as the first:
--
--   lt_pairing_gate_ready
--     * no answers                       -> not ready
--     * ONE side answered                -> still not ready (the strict lock)
--     * every participant answered       -> ready
--     * answers on a different phase     -> do not satisfy this one
--     * a 'forfeited' answer             -> counts, the gate answer is the ack
--
--   The flag
--     * scheduling_funnel_enabled defaults FALSE on every existing tournament,
--       so a live event keeps posting cards at publish exactly as before. The
--       funnel is opt-in per tournament, because a tournament running without
--       a gate screen would otherwise get no rooms at all.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_funnel_pairing_lock_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_tm    tournament_matches;
    v_users uuid[];
    v_uid   uuid;
    v_round smallint;
    v_ready boolean;
    v_on    integer;
BEGIN
    -- The safety property first: nothing that exists today is opted in.
    SELECT count(*) INTO v_on FROM tournaments WHERE scheduling_funnel_enabled;
    ASSERT v_on = 0,
        'the funnel must be opt-in; found ' || v_on || ' tournaments already on';

    SELECT tm.* INTO v_tm FROM tournament_matches tm
     WHERE tm.player1_registration_id IS NOT NULL
       AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     ORDER BY tm.created_at DESC LIMIT 1;
    IF v_tm.id IS NULL THEN RAISE EXCEPTION 'fixture: no determinate pairing'; END IF;

    v_round := CASE WHEN v_tm.bracket_side = 'pool' THEN 0 ELSE v_tm.round_number END;

    SELECT array_agg(u) INTO v_users FROM (
      SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u
        FROM tournament_registrations r
       WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)) t;
    IF coalesce(array_length(v_users, 1), 0) < 2 THEN
        RAISE EXCEPTION 'fixture: expected at least two participants';
    END IF;

    DELETE FROM tournament_phase_availability WHERE tournament_id = v_tm.tournament_id;

    -- 1. silence is not readiness
    ASSERT public.lt_pairing_gate_ready(v_tm.id) = false,
        'no answers should not open the room';

    -- 2. one side is not readiness either: this IS the strict lock
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
    VALUES (v_tm.tournament_id, v_tm.bracket_side, v_round, v_users[1], 'confirmed', 4, '[]'::jsonb);
    ASSERT public.lt_pairing_gate_ready(v_tm.id) = false,
        'one answer should not open the room';

    -- 3. everyone answered
    FOREACH v_uid IN ARRAY v_users LOOP
        INSERT INTO tournament_phase_availability
            (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
        VALUES (v_tm.tournament_id, v_tm.bracket_side, v_round, v_uid, 'confirmed', 4, '[]'::jsonb)
        ON CONFLICT DO NOTHING;
    END LOOP;
    ASSERT public.lt_pairing_gate_ready(v_tm.id) = true,
        'every participant answered: the room should open';

    -- 4. a knockout round is a fresh slate; last phase's answers earn nothing
    DELETE FROM tournament_phase_availability WHERE tournament_id = v_tm.tournament_id;
    FOREACH v_uid IN ARRAY v_users LOOP
        INSERT INTO tournament_phase_availability
            (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
        VALUES (v_tm.tournament_id, v_tm.bracket_side, (v_round + 7)::smallint, v_uid,
                'confirmed', 4, '[]'::jsonb)
        ON CONFLICT DO NOTHING;
    END LOOP;
    ASSERT public.lt_pairing_gate_ready(v_tm.id) = false,
        'answers from another phase must not satisfy this one';

    -- 5. a forfeit is an answer: what it means for the result is the ladder's
    --    business, not the room's
    DELETE FROM tournament_phase_availability WHERE tournament_id = v_tm.tournament_id;
    FOREACH v_uid IN ARRAY v_users LOOP
        INSERT INTO tournament_phase_availability
            (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
        VALUES (v_tm.tournament_id, v_tm.bracket_side, v_round, v_uid, 'forfeited', 0, '[]'::jsonb)
        ON CONFLICT DO NOTHING;
    END LOOP;
    ASSERT public.lt_pairing_gate_ready(v_tm.id) = true,
        'a forfeit is still an acknowledgement of the phase';

    RAISE NOTICE 'lt_funnel_pairing_lock_test: all assertions passed';
END $$;

ROLLBACK;

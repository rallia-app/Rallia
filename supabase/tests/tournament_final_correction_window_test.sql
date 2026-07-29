-- ============================================
-- Tournaments — correcting the final inside the grace window (DB-level)
-- ============================================
-- Covers 20260729120000_lt_final_score_correction_window.
--
-- Before that migration, recording the final flipped the tournament to
-- 'completed', and tournament_override_score's `status <> 'in_progress'` guard
-- then refused every later call: the final (and with it the champion and the
-- ranking points already written by the award trigger) was frozen on the first
-- keystroke, with no organizer-side undo.
--
--   * correcting the final while completed, inside the window  -> succeeds
--   * the ranking ledger follows the corrected champion
--   * the ranking SEASON is resolved from the untouched completed_at
--   * past the window                                          -> CORRECTION_WINDOW_CLOSED
--   * a cancelled tournament                                   -> TOURNAMENT_NOT_IN_PROGRESS
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_final_correction_window_test.sql
--
-- One transaction, ROLLBACK at the end. Auth is simulated via the
-- request.jwt.claims GUC (what auth.uid() reads).
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helper: a 4-player singles tournament played all the way to a decided final.
-- Returns the organizer, the final match, and the final's two registrations.
-- The organizer is certified so the award function actually writes a ledger.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_finished_tournament(
    p_name text,
    OUT o_org uuid,
    OUT o_tid uuid,
    OUT o_final_id uuid,
    OUT o_reg_a uuid,
    OUT o_reg_b uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_t       tournaments;
    v_p       uuid;
    v_m       tournament_matches;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- Seed admins sort first and is_admin() voids the organizer gates, so the
    -- fixture deliberately picks non-admin players.
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(v_players, 1) = 5, 'need 5 active non-admin tennis players';
    o_org := v_players[1];

    UPDATE player SET is_certified_organizer = true WHERE id = o_org;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    o_tid := v_t.id;
    SELECT * INTO v_t FROM tournament_open_registration(o_tid, v_t.version);

    FOREACH v_p IN ARRAY v_players[2:5] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p::text)::text, true);
        PERFORM tournament_register(o_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(o_tid, v_t.version);
    PERFORM tournament_generate_bracket(o_tid, v_t.version);

    -- Play both semifinals: player1 of each takes it, so the final fills up.
    FOR v_m IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = o_tid AND round_number = 1
         ORDER BY match_position
    LOOP
        PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');
    END LOOP;

    SELECT * INTO v_m FROM tournament_matches
     WHERE tournament_id = o_tid AND next_match_id IS NULL AND bracket_side = 'main'
     LIMIT 1;
    o_final_id := v_m.id;
    o_reg_a    := v_m.player1_registration_id;
    o_reg_b    := v_m.player2_registration_id;
    ASSERT o_reg_a IS NOT NULL AND o_reg_b IS NOT NULL, 'final must have both slots filled';

    -- Decide the final -> tournament completes, award trigger fires.
    PERFORM tournament_override_score(o_final_id, o_reg_a, '6-4 6-4');
END $$;

-- --------------------------------------------------------------------------
-- 1. the final IS correctable while completed, inside the window
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_tid uuid; v_fid uuid; v_a uuid; v_b uuid;
    v_t tournaments; v_m tournament_matches;
BEGIN
    SELECT o_org, o_tid, o_final_id, o_reg_a, o_reg_b
      INTO v_org, v_tid, v_fid, v_a, v_b
      FROM pg_temp.mk_finished_tournament('Final correction — happy path');

    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'completed', 'deciding the final must complete the tournament';
    ASSERT v_t.completed_at IS NOT NULL, 'completed_at must be stamped';

    SELECT * INTO v_m FROM tournament_matches WHERE id = v_fid;
    ASSERT v_m.winner_registration_id = v_a, 'champion should start as registration A';

    -- The organizer mistyped: the other player actually won.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_override_score(v_fid, v_b, '4-6 4-6');

    SELECT * INTO v_m FROM tournament_matches WHERE id = v_fid;
    ASSERT v_m.winner_registration_id = v_b, 'the corrected champion must stick';
    ASSERT v_m.score = '4-6 4-6', 'the corrected score must stick';

    RAISE NOTICE 'PASS 1: the final is correctable inside the grace window';
END $$;

-- --------------------------------------------------------------------------
-- 2. ranking points follow the corrected champion, in the original season
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_tid uuid; v_fid uuid; v_a uuid; v_b uuid;
    v_t tournaments; v_season_before uuid; v_season_after uuid;
    v_champ_reg uuid; v_rows int;
BEGIN
    SELECT o_org, o_tid, o_final_id, o_reg_a, o_reg_b
      INTO v_org, v_tid, v_fid, v_a, v_b
      FROM pg_temp.mk_finished_tournament('Final correction — ranking follows');

    SELECT count(*) INTO v_rows FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_rows > 0, 'a certified organizer must have produced a ledger';

    SELECT registration_id, season_id INTO v_champ_reg, v_season_before
      FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_champ_reg = v_a, 'ledger should first credit registration A';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_override_score(v_fid, v_b, '4-6 4-6');

    SELECT registration_id, season_id INTO v_champ_reg, v_season_after
      FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_champ_reg = v_b, 'ledger must be recomputed onto the corrected champion';
    ASSERT v_season_after = v_season_before,
        'the correction must not move the result into another ranking season';

    -- The old champion must not keep a champion row.
    SELECT count(*) INTO v_rows
      FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_rows = 1, 'exactly one champion row after the correction';

    RAISE NOTICE 'PASS 2: ranking ledger recomputed onto the corrected champion, season stable';
END $$;

-- --------------------------------------------------------------------------
-- 3. past the window -> CORRECTION_WINDOW_CLOSED
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_tid uuid; v_fid uuid; v_a uuid; v_b uuid;
    v_m tournament_matches; v_ok boolean := false;
BEGIN
    SELECT o_org, o_tid, o_final_id, o_reg_a, o_reg_b
      INTO v_org, v_tid, v_fid, v_a, v_b
      FROM pg_temp.mk_finished_tournament('Final correction — window closed');

    -- Age the completion past the 24h window.
    UPDATE tournaments SET completed_at = now() - interval '25 hours' WHERE id = v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN
        PERFORM tournament_override_score(v_fid, v_b, '4-6 4-6');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'CORRECTION_WINDOW_CLOSED'); END;
    ASSERT v_ok, 'a correction past the window must raise CORRECTION_WINDOW_CLOSED';

    SELECT * INTO v_m FROM tournament_matches WHERE id = v_fid;
    ASSERT v_m.winner_registration_id = v_a, 'the champion must be untouched after a refused correction';

    RAISE NOTICE 'PASS 3: past the window the final is frozen (CORRECTION_WINDOW_CLOSED)';
END $$;

-- --------------------------------------------------------------------------
-- 4. a terminal (cancelled) tournament still reports the state, not the window
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_tid uuid; v_fid uuid; v_a uuid; v_b uuid;
    v_ok boolean := false;
BEGIN
    SELECT o_org, o_tid, o_final_id, o_reg_a, o_reg_b
      INTO v_org, v_tid, v_fid, v_a, v_b
      FROM pg_temp.mk_finished_tournament('Final correction — cancelled');

    UPDATE tournaments SET status = 'cancelled' WHERE id = v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN
        PERFORM tournament_override_score(v_fid, v_b, '4-6 4-6');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'TOURNAMENT_NOT_IN_PROGRESS'); END;
    ASSERT v_ok, 'a cancelled tournament must raise TOURNAMENT_NOT_IN_PROGRESS';

    RAISE NOTICE 'PASS 4: cancelled tournaments report state, not the correction window';
END $$;

ROLLBACK;

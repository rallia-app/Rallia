-- ============================================
-- Leagues — correcting a score after the session completes (DB-level)
-- ============================================
-- Covers 20260730170000_lt_session_score_correction_window.
--
-- session_record_score refused unless the session was 'published' or
-- 'in_progress', while the same function completes the session as soon as no
-- playable match remains. So the last score of a sheet froze EVERY score in it,
-- and the season ranking kept whatever it had computed. The league twin of the
-- tournament-final defect fixed in 20260729120000.
--
--   * a score can still be corrected while the session is completed, in-window
--   * the season ranking follows the corrected result
--   * completed_at does not drift, so corrections cannot extend the window
--   * past the window                    -> CORRECTION_WINDOW_CLOSED
--   * a cancelled session                -> SESSION_NOT_ACTIVE
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_score_correction_window_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- --------------------------------------------------------------------------
-- Helper: a league with a season and one fully-played 2-player session.
-- Returns the organizer, the session, and its single match.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_played_session(
    p_name      text,
    OUT o_org   uuid,
    OUT o_sid   uuid,
    OUT o_seaid uuid,
    OUT o_match_id uuid,
    OUT o_version int,
    OUT o_team_a uuid,
    OUT o_team_b uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_p     uuid[];
    v_l     leagues;
    v_sea   seasons;
    v_sess  sessions;
    v_m     session_matches;
    v_mem   league_members;
    v_i     int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- is_admin() bypasses the organizer gate, so the fixture avoids admins.
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 3) s;
    ASSERT array_length(v_p, 1) = 3, 'need 3 active non-admin tennis players';
    o_org := v_p[1];

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');

    -- Two members besides the organizer, so the sheet is a single pairing.
    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);
    o_seaid := v_sea.id;

    SELECT * INTO v_sess FROM session_create(v_sea.id, 'N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    o_sid := v_sess.id;

    SELECT * INTO v_m FROM session_matches WHERE session_id = v_sess.id LIMIT 1;
    ASSERT v_m.id IS NOT NULL, 'the sheet must hold a match';
    o_match_id := v_m.id;
    o_team_a   := v_m.team_a_user_ids[1];
    o_team_b   := v_m.team_b_user_ids[1];

    -- Score it: this is the last playable match, so the session completes.
    SELECT * INTO v_m FROM session_record_score(v_m.id, 'a', '6-4 6-2', 'completed', v_m.version);
    o_version := v_m.version;
END $$;

-- --------------------------------------------------------------------------
-- 1. the score is still correctable while the session is completed
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int; v_ta uuid; v_tb uuid;
    v_sess sessions; v_after session_matches; v_before session_matches;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_ta, v_tb
      FROM pg_temp.mk_played_session('Correction window — happy path');

    SELECT * INTO v_sess FROM sessions WHERE id = v_sid;
    ASSERT v_sess.status = 'completed', 'the last score must complete the session';
    ASSERT v_sess.completed_at IS NOT NULL, 'completed_at must be stamped';
    SELECT * INTO v_before FROM session_matches WHERE id = v_mid;
    ASSERT v_before.winner_team = 'a', 'team a should start as the winner';

    -- The organizer mistyped: team b actually won.
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_after FROM session_record_score(v_mid, 'b', '4-6 2-6', 'completed', v_ver);
    ASSERT v_after.winner_team = 'b', 'the corrected winner must stick';
    ASSERT v_after.score = '4-6 2-6', 'the corrected score must stick';

    RAISE NOTICE 'PASS 1: a completed session stays correctable inside the window';
END $$;

-- --------------------------------------------------------------------------
-- 2. the season ranking follows the correction, and completed_at holds still
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_winner_before uuid; v_winner_after uuid;
    v_completed_before timestamptz; v_completed_after timestamptz;
    v_team_a uuid; v_team_b uuid;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_team_a, v_team_b
      FROM pg_temp.mk_played_session('Correction window — ranking follows');

    SELECT completed_at INTO v_completed_before FROM sessions WHERE id = v_sid;

    -- Team a won, so team a leads the standings.
    SELECT user_id INTO v_winner_before
      FROM season_rankings WHERE season_id = v_seaid
     ORDER BY points DESC, user_id LIMIT 1;
    ASSERT v_winner_before = v_team_a,
        'team a should top the standings before the correction';

    PERFORM pg_temp.as_user(v_org);
    PERFORM session_record_score(v_mid, 'b', '4-6 2-6', 'completed', v_ver);

    SELECT user_id INTO v_winner_after
      FROM season_rankings WHERE season_id = v_seaid
     ORDER BY points DESC, user_id LIMIT 1;
    ASSERT v_winner_after = v_team_b,
        'the standings must follow the corrected result';

    SELECT completed_at INTO v_completed_after FROM sessions WHERE id = v_sid;
    ASSERT v_completed_after = v_completed_before,
        'completed_at must not drift, or corrections would extend their own window';

    RAISE NOTICE 'PASS 2: ranking recomputed, completed_at stable';
END $$;

-- --------------------------------------------------------------------------
-- 3. past the window -> CORRECTION_WINDOW_CLOSED
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int; v_ta uuid; v_tb uuid;
    v_ok boolean := false; v_still session_matches;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_ta, v_tb
      FROM pg_temp.mk_played_session('Correction window — closed');

    UPDATE sessions SET completed_at = now() - interval '25 hours' WHERE id = v_sid;

    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM session_record_score(v_mid, 'b', '4-6 2-6', 'completed', v_ver);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'CORRECTION_WINDOW_CLOSED'); END;
    ASSERT v_ok, 'a correction past the window must raise CORRECTION_WINDOW_CLOSED';

    SELECT * INTO v_still FROM session_matches WHERE id = v_mid;
    ASSERT v_still.winner_team = 'a', 'a refused correction must leave the result alone';

    RAISE NOTICE 'PASS 3: past the window the sheet is frozen';
END $$;

-- --------------------------------------------------------------------------
-- 4. a cancelled session reports its state, not the window
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int; v_ta uuid; v_tb uuid;
    v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_ta, v_tb
      FROM pg_temp.mk_played_session('Correction window — cancelled');

    UPDATE sessions SET status = 'cancelled' WHERE id = v_sid;

    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM session_record_score(v_mid, 'b', '4-6 2-6', 'completed', v_ver);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SESSION_NOT_ACTIVE'); END;
    ASSERT v_ok, 'a cancelled session must raise SESSION_NOT_ACTIVE';

    RAISE NOTICE 'PASS 4: cancelled sessions report state, not the window';
END $$;

ROLLBACK;

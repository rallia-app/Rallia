-- ============================================
-- L&T — cancelling the game releases the pairing that pointed at it
-- ============================================
-- Covers 20260825130000. A cancelled game used to leave its link behind on
-- tournament_matches / session_matches, which strands the pairing: re-linking
-- raises ALREADY_LINKED, and the deadline nudges select `match_id IS NULL`, so
-- the pair is never chased again.
--
--   * a PENDING tournament pairing is released, versioned and audited
--   * a SETTLED pairing keeps its link (there it is the provenance of a result)
--   * the league session side behaves the same way
--   * cancelling an already-cancelled row does nothing (the trigger is scoped
--     to the NULL -> NOT NULL transition)
--
-- The fixtures are looked up, not built: a fresh seeded stack carries matches,
-- a tournament and a session. Every lookup RAISEs when it comes up empty, so a
-- missing fixture fails the run instead of silently skipping the assertions.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_detach_cancelled_match_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_tm_id    uuid;
    v_sm_id    uuid;
    v_tm_done  uuid;
    v_free     uuid[];
    v_ver      integer;
    v_after    tournament_matches;
    v_sm_after session_matches;
    v_audit    integer;
BEGIN
    -- match_id is UNIQUE on both tables, so the fixtures have to be games no
    -- pairing already points at.
    SELECT array_agg(id) INTO v_free FROM (
      SELECT m.id FROM match m
       WHERE m.cancelled_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM tournament_matches x WHERE x.match_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM session_matches y WHERE y.match_id = m.id)
       ORDER BY m.created_at DESC LIMIT 3) t;
    IF coalesce(array_length(v_free, 1), 0) < 3 THEN
        RAISE EXCEPTION 'fixture: need three unlinked live matches';
    END IF;

    SELECT id INTO v_tm_id FROM tournament_matches
     WHERE status = 'pending' AND match_id IS NULL LIMIT 1;
    IF v_tm_id IS NULL THEN RAISE EXCEPTION 'fixture: no pending tournament pairing'; END IF;

    SELECT id INTO v_sm_id FROM session_matches
     WHERE status = 'pending' AND match_id IS NULL LIMIT 1;
    IF v_sm_id IS NULL THEN RAISE EXCEPTION 'fixture: no pending session row'; END IF;

    SELECT id INTO v_tm_done FROM tournament_matches
     WHERE status = 'completed' AND match_id IS NULL LIMIT 1;
    IF v_tm_done IS NULL THEN RAISE EXCEPTION 'fixture: no completed pairing'; END IF;

    -- ---------------------------------------------------------------------
    -- 1. a pending tournament pairing holding a link is released
    -- ---------------------------------------------------------------------
    UPDATE tournament_matches SET match_id = v_free[1] WHERE id = v_tm_id;
    SELECT version INTO v_ver FROM tournament_matches WHERE id = v_tm_id;

    UPDATE match SET cancelled_at = now() WHERE id = v_free[1];

    SELECT * INTO v_after FROM tournament_matches WHERE id = v_tm_id;
    ASSERT v_after.match_id IS NULL,
        'tournament: pairing still points at ' || v_after.match_id::text;
    ASSERT v_after.version = v_ver + 1,
        'tournament: version did not move, so no client will refetch it';

    SELECT count(*) INTO v_audit FROM leagues_tournaments_audit
     WHERE entity_id = v_tm_id AND action = 'detach_cancelled_match';
    ASSERT v_audit = 1, 'tournament: expected one audit row, got ' || v_audit;

    -- ---------------------------------------------------------------------
    -- 2. cancelling again changes nothing: the trigger watches the transition
    -- ---------------------------------------------------------------------
    UPDATE match SET cancelled_at = now() WHERE id = v_free[1];
    SELECT count(*) INTO v_audit FROM leagues_tournaments_audit
     WHERE entity_id = v_tm_id AND action = 'detach_cancelled_match';
    ASSERT v_audit = 1, 'tournament: a second cancel wrote another audit row';

    -- ---------------------------------------------------------------------
    -- 3. a settled pairing keeps its link: it is the provenance of a result
    -- ---------------------------------------------------------------------
    UPDATE tournament_matches SET match_id = v_free[2] WHERE id = v_tm_done;
    UPDATE match SET cancelled_at = now() WHERE id = v_free[2];
    SELECT * INTO v_after FROM tournament_matches WHERE id = v_tm_done;
    ASSERT v_after.match_id = v_free[2],
        'settled pairing lost the link its result came from';

    -- ---------------------------------------------------------------------
    -- 4. the league session side is released the same way
    -- ---------------------------------------------------------------------
    UPDATE session_matches SET match_id = v_free[3] WHERE id = v_sm_id;
    UPDATE match SET cancelled_at = now() WHERE id = v_free[3];
    SELECT * INTO v_sm_after FROM session_matches WHERE id = v_sm_id;
    ASSERT v_sm_after.match_id IS NULL, 'session: row still points at the cancelled game';

    SELECT count(*) INTO v_audit FROM leagues_tournaments_audit
     WHERE entity_id = v_sm_id AND action = 'detach_cancelled_match';
    ASSERT v_audit = 1, 'session: expected one audit row, got ' || v_audit;

    RAISE NOTICE 'lt_detach_cancelled_match_test: all assertions passed';
END $$;

ROLLBACK;

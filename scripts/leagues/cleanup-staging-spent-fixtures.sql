-- ============================================================================
-- Staging cleanup — spent league and tournament fixtures (2026-08-29)
-- ============================================================================
-- Removes three groups of fixtures that no longer back any open test:
--
--   [JDL v2]%              8 leagues, 9 Aug, superseded by the [JDL v3] set
--   Ligue Jdl test         hand-made, 1 member, no season
--   John Gold League       hand-made, 1 member, no season
--   [PAYE2E]%              3 tournaments + 1 league, 26 Jul
--   [SEED] Paid League%    4 leagues, 22 Jul - 2 Aug, never got a session
--   [PAYUI%                21 tournaments, the dual-persona paid-UI matrix
--
-- DELIBERATELY KEPT, and asserted at the end so a widened pattern cannot
-- quietly take them:
--
--   [JDL v3]%              7 leagues, Jean's current retest set
--   [JDL-PK]%             16 tournaments, the only live pool/knockout brackets
--   Série 2%               5 tournaments, mirror of the live prod event
--   [MOMENTUM]%            1 tournament, another session's work in flight
--
-- Every FK into leagues and tournaments is ON DELETE CASCADE, so members,
-- seasons, sessions, matches, registrations, conversations, invite links,
-- deadlines and payment rows all follow. notification does NOT have an FK
-- (target_id is a bare uuid), so its rows are swept explicitly first, before
-- the ids they point at stop existing.
--
-- Run through the Supabase MCP execute_sql as a single call, or:
--   psql "$STAGING_DB_URL" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/leagues/cleanup-staging-spent-fixtures.sql
-- ============================================================================

-- NO session_replication_role = replica here. It disables the SYSTEM triggers
-- that implement foreign keys, so every ON DELETE CASCADE below would silently
-- do nothing and leave the children orphaned. This script only deletes, so
-- there is no push wave to suppress anyway.

-- ---------------------------------------------------------------------------
-- The doomed sets, named once so the deletes and the assertions cannot drift
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE doomed_leagues ON COMMIT DROP AS
SELECT id, name FROM leagues
 WHERE name LIKE '[JDL v2]%'
    OR name LIKE '[SEED] Paid League%'
    OR name LIKE '[PAYE2E]%'
    OR name IN ('Ligue Jdl test', 'John Gold League');

CREATE TEMP TABLE doomed_tournaments ON COMMIT DROP AS
SELECT id, name FROM tournaments
 WHERE name LIKE '[PAYUI%'
    OR name LIKE '[PAYE2E]%';

-- Refuse to run if a pattern reached something it should not have, or if the
-- sets are not the size this cleanup was reviewed against.
DO $$
DECLARE v_bad text; v_l integer; v_t integer;
BEGIN
    SELECT string_agg(name, ', ') INTO v_bad FROM (
        SELECT name FROM doomed_leagues
         WHERE name LIKE '[JDL v3]%'
        UNION ALL
        SELECT name FROM doomed_tournaments
         WHERE name LIKE '[JDL-PK]%' OR name ILIKE 'Série 2%' OR name LIKE '[MOMENTUM]%'
    ) t;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'a pattern reached a kept fixture: %', v_bad;
    END IF;

    -- 8 [JDL v2] + 2 hand-made + 4 [SEED] Paid League + 1 [PAYE2E] = 15 leagues,
    -- 21 [PAYUI%] + 3 [PAYE2E] = 24 tournaments.
    SELECT count(*) INTO v_l FROM doomed_leagues;
    SELECT count(*) INTO v_t FROM doomed_tournaments;
    IF v_l <> 15 THEN RAISE EXCEPTION 'expected 15 doomed leagues, matched %', v_l; END IF;
    IF v_t <> 24 THEN RAISE EXCEPTION 'expected 24 doomed tournaments, matched %', v_t; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Notifications first: no FK, so these would outlive their targets
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM doomed_leagues)
    OR target_id IN (SELECT id FROM doomed_tournaments)
    OR target_id IN (SELECT se.id FROM seasons se
                      WHERE se.league_id IN (SELECT id FROM doomed_leagues))
    OR target_id IN (SELECT s.id FROM sessions s JOIN seasons se ON se.id = s.season_id
                      WHERE se.league_id IN (SELECT id FROM doomed_leagues))
    OR target_id IN (SELECT tm.id FROM tournament_matches tm
                      WHERE tm.tournament_id IN (SELECT id FROM doomed_tournaments));

DELETE FROM leagues     WHERE id IN (SELECT id FROM doomed_leagues);
DELETE FROM tournaments WHERE id IN (SELECT id FROM doomed_tournaments);

-- ---------------------------------------------------------------------------
-- Proof. An empty result is not proof, so each expectation RAISEs on its own.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM leagues
     WHERE name LIKE '[JDL v2]%' OR name LIKE '[SEED] Paid League%'
        OR name LIKE '[PAYE2E]%' OR name IN ('Ligue Jdl test', 'John Gold League');
    IF v_n <> 0 THEN RAISE EXCEPTION '% doomed leagues survived', v_n; END IF;

    SELECT count(*) INTO v_n FROM tournaments
     WHERE name LIKE '[PAYUI%' OR name LIKE '[PAYE2E]%';
    IF v_n <> 0 THEN RAISE EXCEPTION '% doomed tournaments survived', v_n; END IF;

    SELECT count(*) INTO v_n FROM leagues WHERE name LIKE '[JDL v3]%';
    IF v_n <> 7 THEN RAISE EXCEPTION '[JDL v3] should still be 7 leagues, found %', v_n; END IF;

    SELECT count(*) INTO v_n FROM tournaments WHERE name LIKE '[JDL-PK]%';
    IF v_n <> 16 THEN RAISE EXCEPTION '[JDL-PK] should still be 16, found %', v_n; END IF;

    SELECT count(*) INTO v_n FROM tournaments WHERE name ILIKE 'Série 2%';
    IF v_n <> 5 THEN RAISE EXCEPTION 'Série 2 should still be 5, found %', v_n; END IF;

    SELECT count(*) INTO v_n FROM tournaments WHERE name LIKE '[MOMENTUM]%';
    IF v_n <> 1 THEN RAISE EXCEPTION '[MOMENTUM] should still be 1, found %', v_n; END IF;

    -- Nothing may be left pointing at an id that no longer exists.
    SELECT count(*) INTO v_n FROM notification n
     WHERE n.target_id IN (SELECT id FROM doomed_leagues)
        OR n.target_id IN (SELECT id FROM doomed_tournaments);
    IF v_n <> 0 THEN RAISE EXCEPTION '% orphan notifications remain', v_n; END IF;

    RAISE NOTICE 'staging cleanup verified';
END $$;

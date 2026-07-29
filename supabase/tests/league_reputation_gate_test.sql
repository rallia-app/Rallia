-- ============================================
-- Leagues — the reputation gate reads the live store (DB-level)
-- ============================================
-- Covers 20260729110000_lt_league_reputation_gate_source.
--
-- The gate used to compare against player.reputation_score, a column added by
-- 20260206000000 with DEFAULT 0.00 NOT NULL that nothing has ever written. It
-- reads 0.00 for every player in staging and prod alike, so any league with
-- min_reputation set rejected everyone, including players the profile badge
-- shows as Platinum. The live store is player_reputation.reputation_score.
--
--   * a clean player (100) joins a min_reputation = 40 league
--   * player.reputation_score staying 0.00 does NOT block that join
--   * a genuinely low-reputation player is still refused
--   * a player with no player_reputation row joins (no events = clean record)
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_reputation_gate_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helper: an active, open league gated on reputation, owned by a non-admin.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_gated_league(
    p_name text,
    p_min_reputation smallint,
    OUT o_org uuid,
    OUT o_players uuid[],
    OUT o_lid uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_l     leagues;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- is_admin() short-circuits gates, so the fixture uses non-admin players.
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(o_players, 1) = 5, 'need 5 active non-admin tennis players';
    o_org := o_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    SELECT * INTO v_l FROM league_create(
        p_name              => p_name,
        p_sport_id          => v_sport,
        p_visibility        => 'public',
        p_join_mode         => 'open',
        p_min_reputation    => p_min_reputation);
    o_lid := v_l.id;
END $$;

-- --------------------------------------------------------------------------
-- 1. a clean player joins, even though player.reputation_score is 0.00
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_lid uuid;
    v_row league_members; v_legacy numeric; v_live numeric;
BEGIN
    SELECT o_org, o_players, o_lid INTO v_org, v_players, v_lid
      FROM pg_temp.mk_gated_league('Reputation gate — clean player', 40::smallint);

    -- Guarantee the two stores disagree the way production does.
    UPDATE player SET reputation_score = 0.00 WHERE id = v_players[2];
    INSERT INTO player_reputation (player_id, reputation_score)
    VALUES (v_players[2], 100)
    ON CONFLICT (player_id) DO UPDATE SET reputation_score = 100;

    SELECT reputation_score INTO v_legacy FROM player WHERE id = v_players[2];
    SELECT reputation_score INTO v_live FROM player_reputation WHERE player_id = v_players[2];
    ASSERT v_legacy = 0.00, 'fixture expects the dead column to read 0';
    ASSERT v_live = 100,    'fixture expects the live store to read 100';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'an open league join should land active';

    RAISE NOTICE 'PASS 1: a Platinum player joins a gated league despite player.reputation_score = 0';
END $$;

-- --------------------------------------------------------------------------
-- 2. a genuinely low-reputation player is still refused
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_lid uuid; v_ok boolean := false; v_n int;
BEGIN
    SELECT o_org, o_players, o_lid INTO v_org, v_players, v_lid
      FROM pg_temp.mk_gated_league('Reputation gate — low reputation', 40::smallint);

    INSERT INTO player_reputation (player_id, reputation_score)
    VALUES (v_players[3], 25)
    ON CONFLICT (player_id) DO UPDATE SET reputation_score = 25;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'REPUTATION_GATE_NOT_MET'); END;
    ASSERT v_ok, 'a player below the bar must still be refused';

    SELECT count(*) INTO v_n FROM league_members
     WHERE league_id = v_lid AND user_id = v_players[3];
    ASSERT v_n = 0, 'a refused join must not leave a membership row';

    RAISE NOTICE 'PASS 2: the gate still bites when reputation is genuinely low';
END $$;

-- --------------------------------------------------------------------------
-- 3. no player_reputation row = no events yet = clean record, not zero
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_lid uuid; v_row league_members; v_n int;
BEGIN
    SELECT o_org, o_players, o_lid INTO v_org, v_players, v_lid
      FROM pg_temp.mk_gated_league('Reputation gate — no rep row', 40::smallint);

    DELETE FROM player_reputation WHERE player_id = v_players[4];
    SELECT count(*) INTO v_n FROM player_reputation WHERE player_id = v_players[4];
    ASSERT v_n = 0, 'fixture expects no reputation row';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[4]::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'a player with no reputation history must not be locked out';

    RAISE NOTICE 'PASS 3: a missing reputation row reads as clean, not as zero';
END $$;

ROLLBACK;

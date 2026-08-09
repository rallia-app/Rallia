-- ============================================
-- Leagues — the organizer's own points system
-- ============================================
-- Covers 20260807280000: league_create's p_rules_override, league_update's
-- switch from replacing default_rules to merging it, and lt_assert_league_rules
-- refusing values the ranking math cannot use.
--
-- The season snapshot is asserted too: a rules edit must not reach a season that
-- already exists, because season_create copies the rules at creation and
-- season_open freezes them.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_rules_config_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

-- Admins bypass is_admin() gates and sort first in the seed, so every fixture
-- player here is deliberately a non-admin.
CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

DO $$
DECLARE
    v_players  uuid[];
    v_org      uuid;
    v_sport    uuid;
    v_league   leagues;
    v_after    leagues;
    v_season   seasons;
    v_rules    jsonb;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_players := pg_temp.tennis_players(1);
    v_org := v_players[1];
    PERFORM pg_temp.as_user(v_org);

    -- ---------------------------------------------------------------------
    -- 1. create with an override: the named keys win, the rest survive
    -- ---------------------------------------------------------------------
    -- The wizard cascades the walkover/retirement variants with win/loss;
    -- direct callers must do the same or be refused (asserted in step 2b).
    v_league := public.league_create(
        p_name           => 'Rules config test',
        p_sport_id       => v_sport,
        p_rules_override => '{"pointWin": 3, "pointLoss": 0, "pointBye": 2,
                              "pointRetirementWinner": 3, "pointWalkoverWinner": 3,
                              "pointRetirementLoser": 0, "pointWalkoverLoser": 0}'::jsonb
    );

    IF (v_league.default_rules ->> 'pointWin')::int <> 3
       OR (v_league.default_rules ->> 'pointLoss')::int <> 0
       OR (v_league.default_rules ->> 'pointBye')::int <> 2 THEN
        RAISE EXCEPTION 'override did not land: %', v_league.default_rules;
    END IF;
    IF NOT (v_league.default_rules ? 'tieBreakerOrder')
       OR NOT (v_league.default_rules ? 'matchFormat') THEN
        RAISE EXCEPTION 'override wiped the sport defaults: %', v_league.default_rules;
    END IF;
    RAISE NOTICE 'ok 1: create override merges over the sport defaults';

    -- ---------------------------------------------------------------------
    -- 2. create refuses rules the recalc could not sum
    -- ---------------------------------------------------------------------
    BEGIN
        PERFORM public.league_create(
            p_name           => 'Bad rules',
            p_sport_id       => v_sport,
            p_rules_override => '{"pointWin": "lots"}'::jsonb);
        RAISE EXCEPTION 'create accepted a non-numeric point value';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'INVALID_RULES:pointWin' THEN RAISE; END IF;
        RAISE NOTICE 'ok 2: create rejects a non-numeric point value';
    END;

    -- ---------------------------------------------------------------------
    -- 2b. lowering the win without its variants would make a walkover the
    --     better outcome; the validator refuses the paradox
    -- ---------------------------------------------------------------------
    BEGIN
        PERFORM public.league_create(
            p_name           => 'Forfeit paradox',
            p_sport_id       => v_sport,
            p_rules_override => '{"pointWin": 3}'::jsonb);
        RAISE EXCEPTION 'a walkover paying more than a win was accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM NOT LIKE 'INVALID_RULES:%' THEN RAISE; END IF;
        RAISE NOTICE 'ok 2b: a forfeit can never pay more than a played win (%)', SQLERRM;
    END;

    -- ---------------------------------------------------------------------
    -- 3. update MERGES: one key changes, the others stay
    -- ---------------------------------------------------------------------
    v_after := public.league_update(
        v_league.id, v_league.version,
        jsonb_build_object('default_rules', '{"pointWin": 12}'::jsonb));

    IF (v_after.default_rules ->> 'pointWin')::int <> 12 THEN
        RAISE EXCEPTION 'merge did not apply pointWin: %', v_after.default_rules;
    END IF;
    IF (v_after.default_rules ->> 'pointBye')::int <> 2
       OR NOT (v_after.default_rules ? 'tieBreakerOrder') THEN
        RAISE EXCEPTION 'merge dropped untouched keys: %', v_after.default_rules;
    END IF;
    RAISE NOTICE 'ok 3: update merges instead of replacing';

    -- ---------------------------------------------------------------------
    -- 4. update validates the MERGED result, not the patch alone
    -- ---------------------------------------------------------------------
    BEGIN
        PERFORM public.league_update(
            v_after.id, v_after.version,
            jsonb_build_object('default_rules', '{"gamesPerPlayer": 12}'::jsonb));
        RAISE EXCEPTION 'update accepted gamesPerPlayer 12';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'INVALID_RULES:gamesPerPlayer' THEN RAISE; END IF;
        RAISE NOTICE 'ok 4: update rejects a games-per-player the sheet cannot run';
    END;

    -- ---------------------------------------------------------------------
    -- 5. a season snapshots the rules; a later league edit leaves it alone
    -- ---------------------------------------------------------------------
    v_season := public.season_create(
        p_league_id      => v_after.id,
        p_name           => 'Season 1',
        p_start_date     => current_date,
        p_end_date       => current_date + 60,
        p_rules_override => '{"gamesPerPlayer": 2}'::jsonb);

    IF (v_season.rules ->> 'pointWin')::int <> 12 THEN
        RAISE EXCEPTION 'season did not inherit the league rules: %', v_season.rules;
    END IF;
    IF (v_season.rules ->> 'gamesPerPlayer')::int <> 2 THEN
        RAISE EXCEPTION 'season override did not land: %', v_season.rules;
    END IF;

    PERFORM public.league_update(
        v_after.id, v_after.version,
        jsonb_build_object('default_rules', '{"pointWin": 99}'::jsonb));

    SELECT rules INTO v_rules FROM seasons WHERE id = v_season.id;
    IF (v_rules ->> 'pointWin')::int <> 12 THEN
        RAISE EXCEPTION 'league edit leaked into an existing season: %', v_rules;
    END IF;
    RAISE NOTICE 'ok 5: season keeps its snapshot when the league rules change';
END $$;

ROLLBACK;

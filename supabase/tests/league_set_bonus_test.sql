-- ============================================
-- Leagues — the organizer's scoring formula: base, set bonus, game bonus
-- ============================================
-- Covers 20260819160000: the pointPerSetWon rules key beside pointPerGameWon,
-- and the validator that refuses a negative bonus. Four identical leagues play
-- the same 6-4 6-2; only the formula differs.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_set_bonus_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

-- Event creation went staff-only in 20260812150000. Staff is granted around the
-- create call only and dropped straight after: the fixture-picking helper
-- filters admins out, so a lingering row would shift which players a later
-- block picks, and the organizer must stay an ordinary player for the authz
-- assertions elsewhere in the suite to mean anything.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- One league, one season, one session, one 6-4 6-2 win. Returns both sides'
-- points, so the caller can compare formulas.
CREATE OR REPLACE FUNCTION pg_temp.play_one(
    p_org uuid, p_opponent uuid, p_name text, p_rules jsonb)
RETURNS TABLE (winner_points integer, loser_points integer)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport  uuid;
    v_league leagues;
    v_season seasons;
    v_sess   sessions;
    v_match  session_matches;
    v_winner uuid;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(p_org);
    PERFORM pg_temp.staff_on(p_org);
    v_league := public.league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_join_mode => 'open', p_rules_override => p_rules);
    PERFORM pg_temp.staff_off(p_org);

    PERFORM pg_temp.as_user(p_opponent);
    PERFORM public.league_join(v_league.id);

    PERFORM pg_temp.as_user(p_org);
    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'N1', now() + interval '3 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM pg_temp.as_user(p_org);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(p_opponent);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');

    PERFORM pg_temp.as_user(p_org);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    SELECT * INTO v_match FROM session_matches
     WHERE session_id = v_sess.id AND is_drill = false LIMIT 1;

    -- 6-4 6-2 from team A: 2 sets and 12 games for A, 0 sets and 6 games for B.
    PERFORM public.session_record_score(v_match.id, 'a', '6-4 6-2', 'completed', v_match.version);

    v_winner := v_match.team_a_user_ids[1];

    RETURN QUERY
    SELECT max(CASE WHEN sr.user_id = v_winner THEN sr.points END)::integer,
           max(CASE WHEN sr.user_id <> v_winner THEN sr.points END)::integer
      FROM season_rankings sr
     WHERE sr.season_id = v_season.id;
END;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_base    record;
    v_sets    record;
    v_both    record;
BEGIN
    v_players := pg_temp.tennis_players(8);

    -- No bonus: the result is the whole story, and the seeded zeroes from
    -- lt_league_default_rules must not change what a default league scores.
    SELECT * INTO v_base FROM pg_temp.play_one(
        v_players[1], v_players[2], 'Formula base', '{}'::jsonb);

    IF v_base.winner_points <> 10 OR v_base.loser_points <> 1 THEN
        RAISE EXCEPTION 'default scoring changed: winner=% loser=%',
            v_base.winner_points, v_base.loser_points;
    END IF;
    RAISE NOTICE 'ok 1: seeding the bonuses at 0 leaves default scoring alone';

    -- Sets only: winner 10 + 2x3, loser 1 + 0.
    SELECT * INTO v_sets FROM pg_temp.play_one(
        v_players[3], v_players[4], 'Formula sets', '{"pointPerSetWon": 3}'::jsonb);

    IF v_sets.winner_points <> 16 THEN
        RAISE EXCEPTION 'winner should have 10 + 2 sets x 3 = 16, got %', v_sets.winner_points;
    END IF;
    IF v_sets.loser_points <> 1 THEN
        RAISE EXCEPTION 'a straight-sets loser won no set and should stay at 1, got %',
            v_sets.loser_points;
    END IF;
    RAISE NOTICE 'ok 2: sets won are added on top of the result';

    -- Both bonuses stack: winner 10 + 2x3 + 12x1, loser 1 + 0 + 6x1.
    SELECT * INTO v_both FROM pg_temp.play_one(
        v_players[5], v_players[6], 'Formula both',
        '{"pointPerSetWon": 3, "pointPerGameWon": 1}'::jsonb);

    IF v_both.winner_points <> 28 THEN
        RAISE EXCEPTION 'winner should have 10 + 6 + 12 = 28, got %', v_both.winner_points;
    END IF;
    IF v_both.loser_points <> 7 THEN
        RAISE EXCEPTION 'loser should have 1 + 0 + 6 = 7, got %', v_both.loser_points;
    END IF;
    RAISE NOTICE 'ok 3: the two bonuses stack on the same result';
END $$;

-- A bonus that subtracts is not a formula anyone configures on purpose.
DO $$
DECLARE
    v_players uuid[];
    v_sport   uuid;
BEGIN
    v_players := pg_temp.tennis_players(8);
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_players[7]);
    PERFORM pg_temp.staff_on(v_players[7]);
    BEGIN
        PERFORM public.league_create(
            p_name => 'Formula negative', p_sport_id => v_sport,
            p_join_mode => 'open', p_rules_override => '{"pointPerSetWon": -2}'::jsonb);
        PERFORM pg_temp.staff_off(v_players[7]);
        RAISE EXCEPTION 'a negative set bonus must be refused';
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.staff_off(v_players[7]);
        IF SQLERRM NOT LIKE '%INVALID_RULES:pointPerSetWon%' THEN
            RAISE EXCEPTION 'expected INVALID_RULES:pointPerSetWon, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 4: a negative bonus is refused at creation';
END $$;

-- The formula is per season, snapshotted at season_create, so editing the
-- league afterwards must leave a running season's standings alone. That is the
-- forward-looking guarantee the organizer is promised in the wizard.
DO $$
DECLARE
    v_players uuid[];
    v_sport   uuid;
    v_league  leagues;
    v_season  seasons;
    v_before  jsonb;
BEGIN
    v_players := pg_temp.tennis_players(8);
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_players[8]);
    PERFORM pg_temp.staff_on(v_players[8]);
    v_league := public.league_create(
        p_name => 'Formula forward', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_players[8]);

    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_before := v_season.rules;

    v_league := public.league_update(
        v_league.id, v_league.version,
        jsonb_build_object('default_rules', jsonb_build_object('pointPerSetWon', 5)));

    IF (v_league.default_rules->>'pointPerSetWon')::int <> 5 THEN
        RAISE EXCEPTION 'the league should carry the new bonus, got %',
            v_league.default_rules->>'pointPerSetWon';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_season.id;
    IF v_season.rules IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'the open season''s rules must not move when the league is edited';
    END IF;
    RAISE NOTICE 'ok 5: a formula edit is forward-looking, the live season is untouched';
END $$;

ROLLBACK;

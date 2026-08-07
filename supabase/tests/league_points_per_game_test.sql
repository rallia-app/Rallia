-- ============================================
-- Leagues — counting games won in the standings
-- ============================================
-- Covers 20260807320000: the pointPerGameWon rules key. Two identical leagues
-- play the same score; only the one that counts games scores differently.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_points_per_game_test.sql
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

-- One league, one season, one session, one 6-4 6-2 win. Returns the winner's
-- and loser's points, so the caller can compare rule sets.
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
    v_league := public.league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_join_mode => 'open', p_rules_override => p_rules);

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

    -- 6-4 6-2 from team A: 12 games for A, 6 for B.
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
    v_plain   record;
    v_games   record;
BEGIN
    v_players := pg_temp.tennis_players(4);

    -- Default rules: the result is the whole story.
    SELECT * INTO v_plain FROM pg_temp.play_one(
        v_players[1], v_players[2], 'PPG off', '{}'::jsonb);

    IF v_plain.winner_points <> 10 OR v_plain.loser_points <> 1 THEN
        RAISE EXCEPTION 'default scoring changed: winner=% loser=%',
            v_plain.winner_points, v_plain.loser_points;
    END IF;
    RAISE NOTICE 'ok 1: without the key, a win is still 10 and a loss 1';

    -- Same score, same everything, but games now carry a point each.
    SELECT * INTO v_games FROM pg_temp.play_one(
        v_players[3], v_players[4], 'PPG on', '{"pointPerGameWon": 1}'::jsonb);

    IF v_games.winner_points <> 22 THEN
        RAISE EXCEPTION 'winner should have 10 + 12 games = 22, got %', v_games.winner_points;
    END IF;
    IF v_games.loser_points <> 7 THEN
        RAISE EXCEPTION 'loser should have 1 + 6 games = 7, got %', v_games.loser_points;
    END IF;
    RAISE NOTICE 'ok 2: games won are added on top of the result';

    IF v_games.loser_points <= v_plain.loser_points THEN
        RAISE EXCEPTION 'a competitive loss should be worth more, not less';
    END IF;
    RAISE NOTICE 'ok 3: the setting rewards games taken in defeat';
END $$;

ROLLBACK;

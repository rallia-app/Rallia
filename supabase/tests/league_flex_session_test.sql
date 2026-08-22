-- ============================================
-- Leagues — flex sessions carry a play window instead of an evening
-- ============================================
-- Covers 20260820200000: sessions.play_window_ends_at, the widened
-- session_create / session_create_series, and the sessionScheduling rules key.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_flex_session_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_sport   uuid;
    v_league  leagues;
    v_season  seasons;
    v_fixed   sessions;
    v_flex    sessions;
    v_start   timestamptz := now() + interval '3 days';
    v_n       integer;
    v_min     interval;
BEGIN
    v_players := pg_temp.tennis_players(2);
    v_org     := v_players[1];
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Flex sessions', p_sport_id => v_sport, p_join_mode => 'open',
        p_rules_override => '{"sessionScheduling": "flex"}'::jsonb);
    PERFORM pg_temp.staff_off(v_org);

    IF v_league.default_rules ->> 'sessionScheduling' <> 'flex' THEN
        RAISE EXCEPTION 'the league should run flex, got %',
            v_league.default_rules ->> 'sessionScheduling';
    END IF;
    RAISE NOTICE 'ok 1: a league can declare itself flex at creation';

    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 120);
    v_season := public.season_open(v_season.id, v_season.version);

    -- A session created the old way is still an evening.
    v_fixed := public.session_create(v_season.id, 'Fixed', v_start);
    IF v_fixed.play_window_ends_at IS NOT NULL THEN
        RAISE EXCEPTION 'a session without a window must stay fixed';
    END IF;
    RAISE NOTICE 'ok 2: omitting the window keeps the evening behaviour';

    -- A flex session spans days.
    v_flex := public.session_create(
        v_season.id, 'Flex', v_start,
        p_play_window_ends_at => v_start + interval '14 days');
    IF v_flex.play_window_ends_at IS NULL THEN
        RAISE EXCEPTION 'the play window was not stored';
    END IF;
    IF v_flex.play_window_ends_at <> v_start + interval '14 days' THEN
        RAISE EXCEPTION 'the play window moved: %', v_flex.play_window_ends_at;
    END IF;
    RAISE NOTICE 'ok 3: a flex session carries a multi-day play window';

    -- A window that closes before it opens is not a window.
    BEGIN
        PERFORM public.session_create(
            v_season.id, 'Backwards', v_start,
            p_play_window_ends_at => v_start - interval '1 day');
        RAISE EXCEPTION 'a backwards window was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'INVALID_PLAY_WINDOW' THEN
            RAISE EXCEPTION 'expected INVALID_PLAY_WINDOW, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 4: a window ending before it opens is refused';

    -- A series gives every occurrence its own window.
    SELECT count(*), min(play_window_ends_at - scheduled_at)
      INTO v_n, v_min
      FROM public.session_create_series(
             p_season_id => v_season.id,
             p_name => 'Flex series',
             p_first_at => v_start,
             p_repeat_every_days => 14,
             p_occurrences => 3,
             p_window_days => 14::smallint) s
     WHERE s.play_window_ends_at IS NOT NULL;

    IF v_n <> 3 THEN
        RAISE EXCEPTION 'expected 3 flex occurrences, got %', v_n;
    END IF;
    IF v_min <> interval '14 days' THEN
        RAISE EXCEPTION 'each occurrence should span its own 14 days, got %', v_min;
    END IF;
    RAISE NOTICE 'ok 5: a series gives every occurrence its own window';

    -- A window longer than the gap would have two sessions claiming the same days.
    BEGIN
        PERFORM public.session_create_series(
            p_season_id => v_season.id,
            p_name => 'Overlapping',
            p_first_at => v_start + interval '60 days',
            p_repeat_every_days => 7,
            p_occurrences => 2,
            p_window_days => 10::smallint);
        RAISE EXCEPTION 'overlapping windows were accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'INVALID_PLAY_WINDOW' THEN
            RAISE EXCEPTION 'expected INVALID_PLAY_WINDOW, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 6: a window longer than the gap between occurrences is refused';
END $$;

-- sessionScheduling only takes the two values the UI can render.
DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_sport   uuid;
BEGIN
    v_players := pg_temp.tennis_players(4);
    v_org     := v_players[3];
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    BEGIN
        PERFORM public.league_create(
            p_name => 'Bad scheduling', p_sport_id => v_sport, p_join_mode => 'open',
            p_rules_override => '{"sessionScheduling": "whenever"}'::jsonb);
        PERFORM pg_temp.staff_off(v_org);
        RAISE EXCEPTION 'an unknown scheduling mode was accepted';
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.staff_off(v_org);
        IF SQLERRM NOT LIKE '%INVALID_RULES:sessionScheduling%' THEN
            RAISE EXCEPTION 'expected INVALID_RULES:sessionScheduling, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 7: an unknown scheduling mode is refused';
END $$;

ROLLBACK;

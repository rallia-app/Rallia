-- ============================================
-- Leagues — recurring sessions
-- ============================================
-- Covers 20260807360000: session_create_series. A weekly run lands as drafts
-- spaced seven days apart, refuses to spill past the season, and publishes
-- nothing, because the review is explicit that publication stays manual.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_session_series_test.sql
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

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"). Staff is granted around the create calls only and
-- dropped straight after: the fixture-picking helpers filter admins out, so a
-- lingering row would shift which players a later block picks, and the
-- organizer has to stay an ordinary player for the authz assertions to mean
-- anything.
-- SECURITY DEFINER so the grant still works inside a block that has switched
-- to the authenticated role, where admin's RLS would refuse the insert.
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
    v_first   timestamptz;
    v_count   integer;
    v_gaps    integer;
    v_pub     integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_players := pg_temp.tennis_players(1);
    v_org := v_players[1];
    PERFORM pg_temp.as_user(v_org);

    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Series test', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_season := public.season_create(
        v_league.id, 'S', current_date, current_date + 90);
    v_season := public.season_open(v_season.id, v_season.version);

    v_first := date_trunc('day', now()) + interval '3 days 18 hours';

    -- ------------------------------------------------------------------
    -- 1. six weekly drafts, seven days apart
    -- ------------------------------------------------------------------
    PERFORM public.session_create_series(
        p_season_id => v_season.id,
        p_name => 'Mardi soir',
        p_first_at => v_first,
        p_repeat_every_days => 7,
        p_occurrences => 6);

    SELECT count(*) INTO v_count FROM sessions WHERE season_id = v_season.id;
    IF v_count <> 6 THEN
        RAISE EXCEPTION 'expected 6 sessions, got %', v_count;
    END IF;

    SELECT count(*) INTO v_gaps FROM (
        SELECT scheduled_at
             - lag(scheduled_at) OVER (ORDER BY scheduled_at) AS gap
          FROM sessions WHERE season_id = v_season.id) g
     WHERE gap IS NOT NULL AND gap <> interval '7 days';
    IF v_gaps <> 0 THEN
        RAISE EXCEPTION 'sessions are not evenly spaced a week apart';
    END IF;
    RAISE NOTICE 'ok 1: a weekly run lands six sessions, seven days apart';

    -- ------------------------------------------------------------------
    -- 2. nothing is published — that stays the organizer's call
    -- ------------------------------------------------------------------
    SELECT count(*) INTO v_pub
      FROM sessions WHERE season_id = v_season.id AND status <> 'draft';
    IF v_pub <> 0 THEN
        RAISE EXCEPTION 'the series published % session(s)', v_pub;
    END IF;
    RAISE NOTICE 'ok 2: every occurrence is a draft';

    -- ------------------------------------------------------------------
    -- 3. a run that outlives its season is refused whole
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.session_create_series(
            p_season_id => v_season.id,
            p_name => 'Too long',
            p_first_at => v_first,
            p_repeat_every_days => 28,
            p_occurrences => 6);
        RAISE EXCEPTION 'a series past the season end was accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'SERIES_EXCEEDS_SEASON' THEN RAISE; END IF;
        RAISE NOTICE 'ok 3: a run that would outlive the season is refused';
    END;

    SELECT count(*) INTO v_count FROM sessions WHERE season_id = v_season.id;
    IF v_count <> 6 THEN
        RAISE EXCEPTION 'the refused series left % sessions behind', v_count - 6;
    END IF;
    RAISE NOTICE 'ok 4: the refused run left nothing behind';

    -- ------------------------------------------------------------------
    -- 5. only the cadences the picker offers
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.session_create_series(
            v_season.id, 'Odd cadence', v_first, 3, 2);
        RAISE EXCEPTION 'an unsupported cadence was accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'INVALID_RECURRENCE' THEN RAISE; END IF;
        RAISE NOTICE 'ok 5: an unsupported cadence is refused';
    END;

    -- ------------------------------------------------------------------
    -- 6. a non-organizer cannot schedule a run
    -- ------------------------------------------------------------------
    v_players := pg_temp.tennis_players(2);
    PERFORM pg_temp.as_user(v_players[2]);
    BEGIN
        PERFORM public.session_create_series(
            v_season.id, 'Not mine', v_first, 7, 2);
        RAISE EXCEPTION 'a non-organizer created a series';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'NOT_ORGANIZER' THEN RAISE; END IF;
        RAISE NOTICE 'ok 6: only an organizer can schedule a run';
    END;

    -- ------------------------------------------------------------------
    -- 7. the wall-clock time survives DST
    -- ------------------------------------------------------------------
    -- 26 occurrences at 14 days span 350 days, which crosses at least one DST
    -- transition whenever the test runs (the longest gap between transitions
    -- is ~238 days). Every occurrence must land at the same local time on the
    -- same weekday; UTC stepping would drift an hour at each transition.
    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Series DST test', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_season := public.season_create(
        v_league.id, 'S', current_date, current_date + 360);
    v_season := public.season_open(v_season.id, v_season.version);

    v_first := ((current_date + 4)::timestamp + interval '19 hours')
               AT TIME ZONE 'America/Montreal';

    PERFORM public.session_create_series(
        p_season_id => v_season.id,
        p_name => 'Jeudi soir',
        p_first_at => v_first,
        p_repeat_every_days => 14,
        p_occurrences => 26,
        p_timezone => 'America/Montreal');

    SELECT count(DISTINCT (scheduled_at AT TIME ZONE 'America/Montreal')::time),
           count(DISTINCT extract(dow FROM scheduled_at AT TIME ZONE 'America/Montreal'))
      INTO v_count, v_gaps
      FROM sessions WHERE season_id = v_season.id;
    IF v_count <> 1 OR v_gaps <> 1 THEN
        RAISE EXCEPTION 'DST shifted the series: % local times, % weekdays', v_count, v_gaps;
    END IF;
    RAISE NOTICE 'ok 7: 26 occurrences keep one local time and one weekday across DST';
END $$;

ROLLBACK;

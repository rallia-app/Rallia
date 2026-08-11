-- ============================================
-- Tournaments — F4a: round deadlines DDL, RPCs, publish defaults
-- ============================================
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_round_deadlines_test.sql

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

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_se        tournaments;
    v_ver       integer;
    v_cnt       integer;
    v_pool_dl   timestamptz;
    v_tm        tournament_matches;
    v_reg       uuid;
    v_win       uuid;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[9];

    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Deadlines', (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '7 days', now() + interval '35 days',
        p_bracket_type => 'pool_knockout');
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- Publish default: one pool-phase deadline, inside the window.
    SELECT deadline_at INTO v_pool_dl FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;
    IF v_pool_dl IS NULL OR v_pool_dl <= v_t.start_date OR v_pool_dl >= v_t.end_date THEN
        RAISE EXCEPTION 'pool default deadline missing or out of window: %', v_pool_dl;
    END IF;

    -- Organizer moves it; validation rejects the past.
    BEGIN
        PERFORM public.tournament_set_round_deadlines(v_t.id,
            jsonb_build_array(jsonb_build_object(
                'bracket_side', 'pool', 'round_number', 0,
                'deadline_at', now() - interval '1 hour')));
        RAISE EXCEPTION 'expected DEADLINE_IN_PAST';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEADLINE_IN_PAST' THEN RAISE; END IF;
    END;
    PERFORM public.tournament_set_round_deadlines(v_t.id,
        jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', now() + interval '10 days')));

    -- Per-match extension.
    SELECT * INTO v_tm FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' LIMIT 1;
    PERFORM public.tournament_extend_match_deadline(
        v_tm.id, now() + interval '12 days', 'météo');
    IF (SELECT deadline_override_at FROM tournament_matches WHERE id = v_tm.id) IS NULL THEN
        RAISE EXCEPTION 'match override not stamped';
    END IF;

    -- Settle all pool matches, cut over, check knockout defaults.
    FOR v_tm IN SELECT * FROM tournament_matches
                 WHERE tournament_id = v_t.id AND bracket_side = 'pool'
    LOOP
        PERFORM public.tournament_override_score(v_tm.id, v_tm.player1_registration_id, '6-3 6-3');
    END LOOP;
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_knockout(v_t.id, v_ver);

    SELECT count(*) INTO v_cnt FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'main';
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'expected 2 main-round deadlines (draw of 4), got %', v_cnt;
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_round_deadlines a
          JOIN tournament_round_deadlines b
            ON b.tournament_id = a.tournament_id
           AND b.bracket_side = 'main' AND a.bracket_side = 'main'
           AND b.round_number = a.round_number + 1
         WHERE a.tournament_id = v_t.id AND b.deadline_at <= a.deadline_at
    ) THEN
        RAISE EXCEPTION 'main deadlines not increasing';
    END IF;

    -- Non-increasing organizer input rejected.
    BEGIN
        PERFORM public.tournament_set_round_deadlines(v_t.id, jsonb_build_array(
            jsonb_build_object('bracket_side', 'main', 'round_number', 1,
                               'deadline_at', now() + interval '20 days'),
            jsonb_build_object('bracket_side', 'main', 'round_number', 2,
                               'deadline_at', now() + interval '15 days')));
        RAISE EXCEPTION 'expected DEADLINES_NOT_INCREASING';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEADLINES_NOT_INCREASING' THEN RAISE; END IF;
    END;

    -- Single-elim publish seeds per-round defaults too (regression scope).
    SELECT * INTO v_se FROM public.tournament_create(
        '[TEST-PK] SE deadlines', (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '7 days', now() + interval '21 days');
    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    PERFORM public.tournament_open_registration(v_se.id, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_se.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    PERFORM public.tournament_close_registration(v_se.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    PERFORM public.tournament_generate_bracket(v_se.id, v_ver);
    SELECT count(*) INTO v_cnt FROM tournament_round_deadlines
     WHERE tournament_id = v_se.id AND bracket_side = 'main';
    IF v_cnt <> 3 THEN
        RAISE EXCEPTION 'single-elim seeded % deadlines, expected 3', v_cnt;
    END IF;

    RAISE NOTICE 'tournament_round_deadlines_test: ALL PASS';
END;
$$;

ROLLBACK;

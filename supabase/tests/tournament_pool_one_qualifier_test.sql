-- ============================================
-- Tournaments: pool_knockout with ONE qualifier per pool
-- ============================================
-- 16 players, 4 pools of 4, qualifiers_per_pool = 1 gives 4 qualifiers and an exact
-- 4-draw: two semi-finals and a final, no byes, no third round.
--
-- Why this exists. Every pool_knockout event shipped so far took 2 qualifiers
-- per pool, so the 1-qualifier branch of tournament_generate_knockout was
-- reachable but unexercised: the only test touching the value was a paid
-- registration security case that never generated a draw. Série 3 (Montréal,
-- September 2026) is its first live use, and its calendar depends on the
-- knockout being exactly two rounds: the event ends the day Montreal's
-- outdoor courts close, so a third round would have nowhere to go.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_one_qualifier_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.settle_all_pools(p_t uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_tm    tournament_matches;
    v_seeds uuid[];
    v_u1    uuid;
    v_u2    uuid;
    v_win   uuid;
BEGIN
    v_seeds := ARRAY(
        SELECT tr.user_id FROM tournament_registrations tr
         WHERE tr.tournament_id = p_t
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);
    FOR v_tm IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_t AND bracket_side = 'pool' AND status = 'pending'
         ORDER BY pool_number, round_number, match_position
    LOOP
        SELECT r.user_id INTO v_u1 FROM tournament_registrations r WHERE r.id = v_tm.player1_registration_id;
        SELECT r.user_id INTO v_u2 FROM tournament_registrations r WHERE r.id = v_tm.player2_registration_id;
        IF array_position(v_seeds, v_u1) <= array_position(v_seeds, v_u2) THEN
            v_win := v_tm.player1_registration_id;
        ELSE
            v_win := v_tm.player2_registration_id;
        END IF;
        PERFORM public.tournament_override_score(
            v_tm.id, v_win,
            CASE WHEN v_win = v_tm.player1_registration_id THEN '6-2 6-2' ELSE '2-6 2-6' END);
    END LOOP;
END;
$$;

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_cnt       integer;
    v_r1        integer;
    v_r2        integer;
    v_quals     integer;
    v_winners   integer;
BEGIN
    v_players := pg_temp.tennis_players(17);
    IF coalesce(array_length(v_players, 1), 0) < 17 THEN
        RAISE EXCEPTION 'need 17 non-admin tennis players locally, found %',
            coalesce(array_length(v_players, 1), 0);
    END IF;
    v_organizer := v_players[17];

    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-S3] One qualifier 16', (SELECT id FROM sport WHERE name = 'tennis'), 16::smallint,
        now() + interval '7 days', now() + interval '28 days',
        p_bracket_type => 'pool_knockout');

    -- tournament_create defaults qualifiers_per_pool to 2; Série 3 runs on 1.
    UPDATE tournaments SET pool_size = 4, qualifiers_per_pool = 1 WHERE id = v_t.id;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..16 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- 4 pools of 4 => 6 games each => 24 pool games.
    SELECT count(DISTINCT pool_number) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 4 THEN RAISE EXCEPTION 'expected 4 pools, got %', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 24 THEN RAISE EXCEPTION 'expected 24 pool games, got %', v_cnt; END IF;

    PERFORM pg_temp.settle_all_pools(v_t.id);

    -- Exactly 4 eligible qualifiers, all of them pool WINNERS.
    SELECT count(*) INTO v_quals FROM public.tournament_pool_standings(v_t.id)
     WHERE eligible AND pool_rank <= 1;
    IF v_quals <> 4 THEN RAISE EXCEPTION 'expected 4 qualifiers, got %', v_quals; END IF;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_knockout(v_t.id, v_ver);
    -- Bracket of 4 => 2 semis + 1 final = 3 rows, no byes.
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'knockout has % rows, expected 3', v_cnt; END IF;

    SELECT count(*) INTO v_r1 FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;
    SELECT count(*) INTO v_r2 FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 2;
    IF v_r1 <> 2 OR v_r2 <> 1 THEN
        RAISE EXCEPTION 'expected 2 semis + 1 final, got % + %', v_r1, v_r2;
    END IF;

    IF EXISTS (SELECT 1 FROM tournament_matches
                WHERE tournament_id = v_t.id AND bracket_side = 'main'
                  AND (player1_is_bye OR player2_is_bye)) THEN
        RAISE EXCEPTION 'unexpected byes: 4 qualifiers should fit a 4-draw exactly';
    END IF;

    -- No third round may exist: the calendar promises exactly two.
    IF EXISTS (SELECT 1 FROM tournament_matches
                WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number > 2) THEN
        RAISE EXCEPTION 'a third knockout round exists; calendar assumes two';
    END IF;

    -- Everyone in the knockout won their pool.
    SELECT count(*) INTO v_winners
      FROM tournament_matches tm
      JOIN public.tournament_pool_standings(v_t.id) ps
        ON ps.registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
     WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'main' AND tm.round_number = 1
       AND ps.pool_rank = 1;
    IF v_winners <> 4 THEN
        RAISE EXCEPTION 'knockout round 1 holds % pool winners, expected 4', v_winners;
    END IF;

    PERFORM pg_temp.staff_off(v_organizer);
    RAISE NOTICE 'tournament_pool_one_qualifier_test: ALL PASS (4 pools of 4, 4 winners, 2 semis + 1 final)';
END;
$$;

ROLLBACK;

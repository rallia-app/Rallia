-- ============================================
-- Tournaments: pool_knockout at a field of 32, two qualifiers per pool
-- ============================================
-- 32 players, pool_size 4, qualifiers_per_pool = 2 gives 8 pools of 4, 16
-- qualifiers and an exact 16-draw: 8 + 4 + 2 + 1 = 15 knockout rows over FOUR
-- rounds, no byes, and the two qualifiers of a pool land in opposite halves.
--
-- Written for Série 3 Intermédiaire, raised from 16 to 32 on 2026-09-14
-- (20260914223807). Every live pool_knockout event before it ran at 16, so a
-- fourth knockout round had never been generated outside unit fixtures. The
-- calendar in the rules promises exactly four rounds; this pins the shape.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_32_field_test.sql
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
    v_rounds    integer[];
    v_quals     integer;
    v_full_err  boolean := false;
BEGIN
    v_players := pg_temp.tennis_players(33);
    IF coalesce(array_length(v_players, 1), 0) < 33 THEN
        RAISE EXCEPTION 'need 33 non-admin tennis players locally, found %',
            coalesce(array_length(v_players, 1), 0);
    END IF;
    v_organizer := v_players[33];

    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-S3] Field of 32', (SELECT id FROM sport WHERE name = 'tennis'), 32::smallint,
        now() + interval '7 days', now() + interval '28 days',
        p_bracket_type => 'pool_knockout');

    -- Série 3 shape: pools of 4, 2 qualifiers, one seed per pool.
    UPDATE tournaments SET pool_size = 4, qualifiers_per_pool = 2, max_seeds = 8 WHERE id = v_t.id;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..32 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    -- The 33rd is refused: the ceiling is the ceiling.
    PERFORM pg_temp.as_user(v_players[33]);
    BEGIN
        PERFORM public.tournament_register(v_t.id, NULL);
    EXCEPTION WHEN OTHERS THEN
        v_full_err := SQLERRM = 'TOURNAMENT_FULL';
    END;
    IF NOT v_full_err THEN RAISE EXCEPTION 'expected TOURNAMENT_FULL for the 33rd player'; END IF;

    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- 8 pools of 4 => 6 games each => 48 pool games.
    SELECT count(DISTINCT pool_number) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 8 THEN RAISE EXCEPTION 'expected 8 pools, got %', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 48 THEN RAISE EXCEPTION 'expected 48 pool games, got %', v_cnt; END IF;

    PERFORM pg_temp.settle_all_pools(v_t.id);

    SELECT count(*) INTO v_quals FROM public.tournament_pool_standings(v_t.id)
     WHERE eligible AND pool_rank <= 2;
    IF v_quals <> 16 THEN RAISE EXCEPTION 'expected 16 qualifiers, got %', v_quals; END IF;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_knockout(v_t.id, v_ver);
    -- 16-draw => 8 + 4 + 2 + 1 = 15 rows.
    IF v_cnt <> 15 THEN RAISE EXCEPTION 'knockout has % rows, expected 15', v_cnt; END IF;

    SELECT array_agg(c ORDER BY r) INTO v_rounds
      FROM (SELECT round_number r, count(*) c FROM tournament_matches
             WHERE tournament_id = v_t.id AND bracket_side = 'main'
             GROUP BY round_number) x;
    IF v_rounds <> ARRAY[8, 4, 2, 1] THEN
        RAISE EXCEPTION 'expected rounds 8/4/2/1, got %', v_rounds;
    END IF;

    IF EXISTS (SELECT 1 FROM tournament_matches
                WHERE tournament_id = v_t.id AND bracket_side = 'main'
                  AND (player1_is_bye OR player2_is_bye)) THEN
        RAISE EXCEPTION 'unexpected byes: 16 qualifiers should fit a 16-draw exactly';
    END IF;

    -- Two qualifiers from one pool never meet before the final (spec §7):
    -- the round-1 slot halves must differ for every pool.
    IF EXISTS (
        SELECT 1
          FROM tournament_matches tm
          JOIN tournament_registrations r ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
          JOIN public.tournament_pool_standings(v_t.id) ps ON ps.registration_id = r.id
         WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'main' AND tm.round_number = 1
         GROUP BY ps.pool_number
        HAVING count(DISTINCT CASE WHEN tm.match_position <= 4 THEN 1 ELSE 2 END) < 2
    ) THEN
        RAISE EXCEPTION 'two qualifiers of one pool share a half of the draw';
    END IF;

    PERFORM pg_temp.staff_off(v_organizer);
    RAISE NOTICE 'tournament_pool_32_field_test: ALL PASS (8 pools of 4, 16 qualifiers, 16-draw over 4 rounds)';
END;
$$;

ROLLBACK;

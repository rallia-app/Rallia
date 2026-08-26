-- ============================================
-- Tournaments — pool_knockout F1: config, preview, pool generation
-- ============================================
-- Covers the new pool_knockout surface end to end at the SQL layer:
--   * create validation (pool config defaults, INVALID_POOL_CONFIG /
--     INVALID_FIELD_SIZE on both bracket types);
--   * serpentine preview (pool sizes, top seeds separated);
--   * pool generation (round-robin completeness, no next_match links,
--     status flip, idempotency guard);
--   * the single-elim path is refused for pool tournaments and vice versa,
--     and a plain single-elim tournament still generates identically.
--
-- Run against a fresh local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_generation_test.sql
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
-- during this phase"), so the create RPC now refuses a plain player. These
-- tests still drive everything AFTER creation as an ordinary organizer, so
-- staff is granted around the create calls and dropped again before the block
-- ends. It has to be dropped: pg_temp.tennis_players() filters admins out, so
-- a lingering row would shift every fixture picked by a later block.
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

CREATE OR REPLACE FUNCTION pg_temp.tennis_sport() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM sport WHERE name = 'tennis';
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'expected % but call succeeded: %', p_msg, p_sql;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM <> p_msg THEN
            RAISE EXCEPTION 'expected % but got %: %', p_msg, SQLERRM, p_sql;
        END IF;
END;
$$;

DO $$
DECLARE
    v_players    uuid[];
    v_organizer  uuid;
    v_organizer2 uuid;
    v_t          tournaments;
    v_se         tournaments;
    v_small      tournaments;
    v_ver        integer;
    v_cnt        integer;
    v_sizes      integer[];
    v_pool_of_seed1 integer;
    v_top_pools  integer;
BEGIN
    v_players    := pg_temp.tennis_players(16);
    IF coalesce(array_length(v_players, 1), 0) < 16 THEN
        RAISE EXCEPTION 'fixture shortfall: need 16 non-admin tennis players';
    END IF;
    v_organizer  := v_players[15];
    v_organizer2 := v_players[16];

    -- Both drive tournament_create below, including the invalid-config cases,
    -- so both need staff for the duration of this block.
    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.staff_on(v_organizer2);

    -- ---------------------------------------------------------------- create
    PERFORM pg_temp.as_user(v_organizer);

    -- Pool config on a single-elim tournament is rejected.
    PERFORM pg_temp.expect_error(
        format($sql$SELECT public.tournament_create(
            'PK bad config', %L::uuid, 16::smallint,
            now() + interval '7 days', now() + interval '21 days',
            p_pool_size => 4::smallint)$sql$, pg_temp.tennis_sport()),
        'INVALID_POOL_CONFIG');

    -- Non-power-of-two sizes stay invalid for single elimination.
    PERFORM pg_temp.expect_error(
        format($sql$SELECT public.tournament_create(
            'SE bad size', %L::uuid, 12::smallint,
            now() + interval '7 days', now() + interval '21 days')$sql$,
            pg_temp.tennis_sport()),
        'INVALID_FIELD_SIZE');

    -- Powers-of-two-only sizes stay invalid for pool_knockout when odd.
    PERFORM pg_temp.expect_error(
        format($sql$SELECT public.tournament_create(
            'PK bad size', %L::uuid, 64::smallint,
            now() + interval '7 days', now() + interval '21 days',
            p_bracket_type => 'pool_knockout')$sql$, pg_temp.tennis_sport()),
        'INVALID_FIELD_SIZE');

    -- Valid create: pool config defaults to 4 / 2 when omitted.
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Poules 16', pg_temp.tennis_sport(), 16::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_visibility    => 'public',
        p_bracket_type  => 'pool_knockout');
    IF v_t.pool_size <> 4 OR v_t.qualifiers_per_pool <> 2 THEN
        RAISE EXCEPTION 'pool defaults wrong: % / %', v_t.pool_size, v_t.qualifiers_per_pool;
    END IF;

    -- ---------------------------------------------------------------- register 14
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOR i IN 1..14 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);

    -- ---------------------------------------------------------------- preview
    -- The single-elim preview refuses pool tournaments.
    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_preview_bracket(%L::uuid)', v_t.id),
        'POOL_STAGE_REQUIRED');

    -- 14 players at pool size 4 → pools of 4,4,3,3; every player exactly once.
    SELECT count(*) INTO v_cnt FROM public.tournament_preview_pools(v_t.id);
    IF v_cnt <> 14 THEN
        RAISE EXCEPTION 'preview returned % rows, expected 14', v_cnt;
    END IF;

    SELECT array_agg(c ORDER BY c DESC) INTO v_sizes
      FROM (SELECT count(*) AS c FROM public.tournament_preview_pools(v_t.id)
             GROUP BY pool_number) s;
    IF v_sizes <> ARRAY[4, 4, 3, 3] THEN
        RAISE EXCEPTION 'pool sizes %, expected {4,4,3,3}', v_sizes;
    END IF;

    -- Serpentine: the 4 top seeds land in 4 distinct pools. Read the seed
    -- order from the same ladder the RPC reads (lt_tournament_seed_order).
    SELECT count(DISTINCT p.pool_number) INTO v_top_pools
      FROM public.tournament_preview_pools(v_t.id) p
     WHERE p.registration_id IN (
        SELECT o.registration_id FROM public.lt_tournament_seed_order(v_t.id) o
         ORDER BY o.suggested_seed
         LIMIT 4);
    IF v_top_pools <> 4 THEN
        RAISE EXCEPTION 'top seeds share a pool (% distinct)', v_top_pools;
    END IF;

    -- ---------------------------------------------------------------- generate
    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_generate_bracket(%L::uuid, (SELECT version FROM tournaments WHERE id = %L::uuid))',
               v_t.id, v_t.id),
        'POOL_STAGE_REQUIRED');

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_pools(v_t.id, v_ver);

    -- 2 pools of 4 (6 matches) + 2 pools of 3 (3 matches) = 18.
    IF v_cnt <> 18 THEN
        RAISE EXCEPTION 'generated % matches, expected 18', v_cnt;
    END IF;

    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id
       AND (bracket_side <> 'pool' OR pool_number IS NULL OR next_match_id IS NOT NULL);
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION '% rows violate pool-row shape', v_cnt;
    END IF;

    -- Round-robin completeness: within each pool every distinct pair meets
    -- exactly once → per player, matches = pool size - 1.
    SELECT count(*) INTO v_cnt FROM (
        SELECT tr.user_id,
               count(*) AS played,
               max(sz.pool_sz) AS pool_sz
          FROM tournament_matches tm
          JOIN tournament_registrations tr
            ON tr.id IN (tm.player1_registration_id, tm.player2_registration_id)
          JOIN (
              SELECT pool_number, count(DISTINCT reg) AS pool_sz FROM (
                  SELECT pool_number, player1_registration_id AS reg
                    FROM tournament_matches WHERE tournament_id = v_t.id AND bracket_side = 'pool'
                  UNION
                  SELECT pool_number, player2_registration_id
                    FROM tournament_matches WHERE tournament_id = v_t.id AND bracket_side = 'pool'
              ) m GROUP BY pool_number
          ) sz ON sz.pool_number = tm.pool_number
         WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'pool'
         GROUP BY tr.user_id
        HAVING count(*) <> max(sz.pool_sz) - 1
    ) bad;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION '% players have wrong match count in their pool', v_cnt;
    END IF;

    -- No duplicate pairing anywhere.
    SELECT count(*) INTO v_cnt FROM (
        SELECT least(player1_registration_id::text, player2_registration_id::text),
               greatest(player1_registration_id::text, player2_registration_id::text)
          FROM tournament_matches
         WHERE tournament_id = v_t.id AND bracket_side = 'pool'
         GROUP BY 1, 2 HAVING count(*) > 1
    ) dup;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION '% duplicate pairings', v_cnt;
    END IF;

    IF (SELECT status FROM tournaments WHERE id = v_t.id) <> 'in_progress' THEN
        RAISE EXCEPTION 'tournament not in_progress after pool generation';
    END IF;

    -- Idempotency: stale version → lock conflict; fresh version → already generated.
    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_generate_pools(%L::uuid, %s)', v_t.id, v_ver),
        'OPTIMISTIC_LOCK_CONFLICT');
    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_generate_pools(%L::uuid, (SELECT version FROM tournaments WHERE id = %L::uuid))',
               v_t.id, v_t.id),
        'POOLS_ALREADY_GENERATED');

    -- ---------------------------------------------------------------- too few
    PERFORM pg_temp.as_user(v_organizer2);
    SELECT * INTO v_small FROM public.tournament_create(
        '[TEST-PK] Poules 8 trop petit', pg_temp.tennis_sport(), 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout');
    SELECT version INTO v_ver FROM tournaments WHERE id = v_small.id;
    PERFORM public.tournament_open_registration(v_small.id, v_ver);
    FOR i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_small.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer2);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_small.id;
    PERFORM public.tournament_close_registration(v_small.id, v_ver);
    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_generate_pools(%L::uuid, (SELECT version FROM tournaments WHERE id = %L::uuid))',
               v_small.id, v_small.id),
        'INSUFFICIENT_PARTICIPANTS');

    -- ---------------------------------------------------------------- regression
    -- A plain single-elim tournament behaves exactly as before, and refuses
    -- the pool path.
    SELECT * INTO v_se FROM public.tournament_create(
        '[TEST-PK] Regression simple', pg_temp.tennis_sport(), 8::smallint,
        now() + interval '7 days', now() + interval '21 days');
    IF v_se.pool_size IS NOT NULL OR v_se.qualifiers_per_pool IS NOT NULL THEN
        RAISE EXCEPTION 'single elim picked up pool config';
    END IF;
    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    PERFORM public.tournament_open_registration(v_se.id, v_ver);
    FOR i IN 6..10 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_se.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer2);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    PERFORM public.tournament_close_registration(v_se.id, v_ver);

    PERFORM pg_temp.expect_error(
        format('SELECT count(*) FROM public.tournament_generate_pools(%L::uuid, (SELECT version FROM tournaments WHERE id = %L::uuid))',
               v_se.id, v_se.id),
        'NOT_POOL_TOURNAMENT');

    SELECT version INTO v_ver FROM tournaments WHERE id = v_se.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_bracket(v_se.id, v_ver);
    IF v_cnt <> 7 THEN
        RAISE EXCEPTION 'single-elim bracket has % rows, expected 7', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_se.id
       AND (bracket_side <> 'main' OR pool_number IS NOT NULL);
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'single-elim rows polluted by pool columns';
    END IF;

    PERFORM pg_temp.staff_off(v_organizer);
    PERFORM pg_temp.staff_off(v_organizer2);
    RAISE NOTICE 'tournament_pool_generation_test: ALL PASS';
END;
$$;

ROLLBACK;

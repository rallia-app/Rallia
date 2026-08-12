-- ============================================
-- Tournaments — pool_knockout: the runner-up draw at full field size
-- ============================================
-- A 32-player pool_knockout tournament (8 pools of 4, 2 qualifiers each →
-- 16 qualifiers, exact 16-draw) taken through the cut-over, asserting the
-- promise of formats/poules-puis-eliminatoires.md §7: two players out of the
-- same pool cannot meet again before the final.
--
-- Why this size specifically. The draw used to shuffle all runners-up and
-- retry up to 60 times until none shared a half with its own pool winner.
-- Only 4!·4!/8! ≈ 1.5% of shuffles satisfy that on a 16-draw, so the loop
-- exhausted its retries and silently relaxed the constraint on ~38% of
-- 32-player draws (measured). The 8-player case in the cutover test could
-- never catch it: there, ~50% of shuffles are valid. The draw is now
-- bucketed by the half each runner-up must take and shuffled inside the
-- bucket, so it is exact in one pass and 'half_constraint_relaxed' stays
-- false for every supported field size.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_knockout_draw_test.sql
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
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- Settle every pending pool game in seed order: the better-seeded side wins.
-- Deterministic, so pool ranks are exactly seed order and the qualifiers are
-- known without naming 48 pairings.
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
        SELECT r.user_id INTO v_u1 FROM tournament_registrations r
         WHERE r.id = v_tm.player1_registration_id;
        SELECT r.user_id INTO v_u2 FROM tournament_registrations r
         WHERE r.id = v_tm.player2_registration_id;
        IF array_position(v_seeds, v_u1) <= array_position(v_seeds, v_u2) THEN
            v_win := v_tm.player1_registration_id;
        ELSE
            v_win := v_tm.player2_registration_id;
        END IF;
        -- Player1-first score text (20260812210000): the winner is whichever
        -- side is better seeded, so write 6-2 6-2 from player1's point of view.
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
    v_relaxed   boolean;
    v_bad       integer;
    v_half_cut  integer;
BEGIN
    v_players   := pg_temp.tennis_players(33);
    IF coalesce(array_length(v_players, 1), 0) < 33 THEN
        RAISE EXCEPTION 'need 33 non-admin tennis players locally, found %',
            coalesce(array_length(v_players, 1), 0);
    END IF;
    v_organizer := v_players[33];

    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Draw 32', (SELECT id FROM sport WHERE name = 'tennis'), 32::smallint,
        now() + interval '7 days', now() + interval '28 days',
        p_bracket_type => 'pool_knockout');

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..32 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- 8 pools of 4 → 6 games each.
    SELECT count(DISTINCT pool_number) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 8 THEN
        RAISE EXCEPTION 'expected 8 pools, got %', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 48 THEN
        RAISE EXCEPTION 'expected 48 pool games, got %', v_cnt;
    END IF;

    PERFORM pg_temp.settle_all_pools(v_t.id);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_knockout(v_t.id, v_ver);
    -- 16 qualifiers → exact 16-draw: 8 + 4 + 2 + 1 = 15 rows, no byes.
    IF v_cnt <> 15 THEN
        RAISE EXCEPTION 'knockout has % rows, expected 15', v_cnt;
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = v_t.id AND bracket_side = 'main'
           AND (player1_is_bye OR player2_is_bye)
    ) THEN
        RAISE EXCEPTION 'unexpected byes in an exact-fit draw';
    END IF;

    -- The draw must not have fallen back to an unconstrained arrangement.
    SELECT (a.payload_after->>'half_constraint_relaxed')::boolean INTO v_relaxed
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament' AND a.entity_id = v_t.id
       AND a.action = 'generate_knockout'
     ORDER BY a.occurred_at DESC LIMIT 1;
    IF v_relaxed IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'draw relaxed the same-pool half constraint (relaxed=%)', v_relaxed;
    END IF;

    -- Round 1 of a 16-draw holds 8 games; positions 1-4 are the top half.
    v_half_cut := 4;

    -- Every pool's two qualifiers must sit in opposite halves, so they can
    -- only meet again in the final.
    SELECT count(*) INTO v_bad FROM (
        SELECT ps.pool_number
          FROM public.tournament_pool_standings(v_t.id) ps
          JOIN tournament_matches tm
            ON tm.tournament_id = v_t.id
           AND tm.bracket_side  = 'main'
           AND tm.round_number  = 1
           AND ps.registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE ps.eligible AND ps.pool_rank <= 2
         GROUP BY ps.pool_number
        HAVING count(DISTINCT CASE WHEN tm.match_position <= v_half_cut THEN 1 ELSE 2 END) <> 2
            OR count(*) <> 2
    ) z;
    IF v_bad <> 0 THEN
        RAISE EXCEPTION '% pool(s) had both qualifiers in one half of the draw', v_bad;
    END IF;

    PERFORM pg_temp.staff_off(v_organizer);
    RAISE NOTICE 'tournament_pool_knockout_draw_test: ALL PASS';
END;
$$;

ROLLBACK;

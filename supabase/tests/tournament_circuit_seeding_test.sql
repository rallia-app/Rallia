-- ============================================
-- Tournaments — Circuit Rallia seeding + organizer override test
-- ============================================
-- Covers 20260822120000_lt_circuit_seeding and 20260822140000_lt_seeding_modes:
--   lt_tournament_seed_order / tournament_seed_suggestions ladder
--   (seed_rank -> Circuit points -> rating -> FIFO), the previews and the
--   publish paths reading it, seed_rank stamped at publish when blank,
--   organizer override untouched, doubles partners summed, and the
--   selectable seeding_mode (circuit / rating / signup / manual) with its
--   clear-on-switch, freeze-on-manual and set_seeds-implies-manual rules.
--
-- Run against a seeded local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_circuit_seeding_test.sql
--
-- Whole script runs in one transaction and ROLLBACKs at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true);
$$;

-- Circuit points for a player, hung off the given tournament/registration so
-- the FKs hold. earned_at defaults to now() -> inside the rolling window;
-- tg_trp_set_board derives the board from the tournament's entry_format.
CREATE OR REPLACE FUNCTION pg_temp.give_points(p_tid uuid, p_reg uuid, p_user uuid, p_sport uuid, p_points int)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tournament_ranking_points
      (season_id, tournament_id, registration_id, user_id, sport_id,
       level_bucket, placement, multiplier, points)
  VALUES
      ((SELECT id FROM ranking_season WHERE now() >= starts_at AND now() < ends_at),
       p_tid, p_reg, p_user, p_sport, 'intermediate', 'champion', 1, p_points)
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET points = EXCLUDED.points;
$$;

-- Fixture pool picked ONCE: active non-admin tennis players with no Circuit
-- history, so the points handed out below are the only ones in play. Later
-- blocks reuse the same rows (block 1 gives some of them points on purpose).
CREATE TEMP TABLE _seed_players ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY ps.player_id)::int AS ord, ps.player_id
    FROM player_sport ps
    JOIN sport s ON s.id = ps.sport_id
   WHERE s.name = 'tennis' AND ps.is_active = true
     AND NOT public.is_admin(ps.player_id)
     AND NOT EXISTS (SELECT 1 FROM tournament_ranking_points trp WHERE trp.user_id = ps.player_id)
   ORDER BY ps.player_id
   LIMIT 30;


-- ============================================================
-- 1. Single elimination: ladder, preview, stamp at publish
-- ============================================================
DO $$
DECLARE
    v_sport    uuid;
    v_players  uuid[];
    v_org      uuid;
    v_t        tournaments;
    v_tid      uuid;
    v_ver      integer;
    v_reg_top  uuid;   -- player 7: v_top pts
    v_reg_2nd  uuid;   -- player 5: v_2nd pts
    v_base     int;    -- current singles-board maximum (other players' history)
    v_top      int;
    v_2nd      int;
    v_rows     int;
    v_ok       boolean;
    v_err      text;
    v_payload  jsonb;
    i          integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'seed missing tennis sport';

    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord <= 7;
    ASSERT array_length(v_players, 1) = 7, 'need 7 point-free active tennis players';
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => '[TEST] Circuit Seed Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;

    FOR i IN 2..7 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM tournament_register(v_tid);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;

    SELECT id INTO v_reg_top FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[7];
    SELECT id INTO v_reg_2nd FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[5];

    -- Nobody seeded by hand, nobody on the board yet.
    ASSERT (SELECT count(*) FROM tournament_registrations WHERE tournament_id = v_tid AND seed_rank IS NOT NULL) = 0,
        'precondition: no seed_rank set';

    -- Last to sign up gets the most points, so FIFO alone would never put
    -- them first. Scaled past the live board maximum so the leader is rank 1
    -- on the whole board, whatever history the environment carries.
    SELECT coalesce(max(b.points), 0) INTO v_base
      FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'singles') b;
    v_top := v_base * 10 + 1000;
    v_2nd := v_base * 5 + 500;
    PERFORM pg_temp.give_points(v_tid, v_reg_top, v_players[7], v_sport, v_top);
    PERFORM pg_temp.give_points(v_tid, v_reg_2nd, v_players[5], v_sport, v_2nd);

    -- ---- suggestions: points first, then rating, NULL rating last ----
    SELECT count(*) INTO v_rows FROM tournament_seed_suggestions(v_tid);
    ASSERT v_rows = 6, 'suggestions should list the 6 registered entries, got ' || v_rows;

    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_reg_top,
        'seed 1 should be the top-points entry';
    ASSERT (SELECT circuit_points FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_top,
        'seed 1 should report its Circuit points';
    ASSERT (SELECT circuit_rank FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = 1,
        'seed 1 should report board rank 1';
    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 2) = v_reg_2nd,
        'seed 2 should be the second-points entry';
    ASSERT (SELECT seed_rank FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) IS NULL,
        'suggestions must surface seed_rank as NULL before any override';

    -- The pointless four come out in non-increasing rating, NULLs last.
    SELECT bool_and(ok) INTO v_ok
      FROM (
        SELECT coalesce(rating, -1) <= coalesce(lag(rating) OVER (ORDER BY suggested_seed), 999) AS ok
          FROM tournament_seed_suggestions(v_tid)
         WHERE suggested_seed >= 3
      ) x;
    ASSERT v_ok, 'seeds 3..6 must be ordered by rating DESC NULLS LAST';
    RAISE NOTICE 'PASS 1: ladder = Circuit points, then rating, then FIFO';

    -- ---- preview reads the same ladder ----
    ASSERT (SELECT player1_registration_id FROM tournament_preview_bracket(v_tid)
             WHERE round_number = 1 AND match_position = 1) = v_reg_top,
        'preview R1M1 player1 should be the Circuit leader';
    RAISE NOTICE 'PASS 2: preview places the Circuit leader at R1M1';

    -- ---- non-organizer cannot read suggestions ----
    PERFORM pg_temp.as_user(v_players[2]);
    BEGIN
        PERFORM count(*) FROM tournament_seed_suggestions(v_tid);
        ASSERT false, 'non-organizer suggestions should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'unexpected: ' || v_err;
    END;
    PERFORM pg_temp.as_user(v_org);
    RAISE NOTICE 'PASS 3: suggestions are organizer-gated';

    -- ---- publish: same draw, seed_rank stamped 1..6 ----
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    ASSERT (SELECT player1_registration_id FROM tournament_matches
             WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1) = v_reg_top,
        'generated R1M1 player1 should be the Circuit leader';
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_reg_top) = 1,
        'Circuit leader should be stamped seed 1';
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_reg_2nd) = 2,
        'second on the board should be stamped seed 2';
    ASSERT (SELECT count(DISTINCT seed_rank) FROM tournament_registrations
             WHERE tournament_id = v_tid AND status = 'registered' AND seed_rank BETWEEN 1 AND 6) = 6,
        'all 6 entries should carry a distinct seed_rank 1..6';

    SELECT payload_after INTO v_payload FROM leagues_tournaments_audit
     WHERE scope = 'tournament' AND entity_id = v_tid AND action = 'generate_bracket'
     ORDER BY occurred_at DESC LIMIT 1;
    ASSERT (v_payload->>'auto_seeded')::boolean = true, 'audit should record auto_seeded = true';
    RAISE NOTICE 'PASS 4: publish honours the ladder and stamps seed_rank';
END $$;


-- ============================================================
-- 2. Organizer override wins over the board
-- ============================================================
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_regs    uuid[];
    v_reg_top uuid;
    v_payload jsonb;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord <= 7;
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => '[TEST] Circuit Seed Cup Override', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;
    FOR i IN 2..7 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM tournament_register(v_tid);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;

    -- Player 7 still holds block 1's points (same transaction, same board).
    SELECT id INTO v_reg_top FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[7];
    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_reg_top,
        'precondition: Circuit leader suggested first';

    -- Organizer pins the Circuit leader LAST.
    SELECT array_agg(id ORDER BY (id = v_reg_top), id) INTO v_regs
      FROM tournament_registrations WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT v_regs[6] = v_reg_top, 'override list should end with the Circuit leader';
    PERFORM tournament_set_seeds(v_tid, v_regs, v_ver);

    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_regs[1],
        'suggestions must follow seed_rank once set';
    ASSERT (SELECT suggested_seed FROM tournament_seed_suggestions(v_tid) WHERE registration_id = v_reg_top) = 6,
        'Circuit leader should now be suggested 6th';
    ASSERT (SELECT circuit_points FROM tournament_seed_suggestions(v_tid) WHERE registration_id = v_reg_top) > 0,
        'points still reported under an override';
    ASSERT (SELECT player1_registration_id FROM tournament_preview_bracket(v_tid)
             WHERE round_number = 1 AND match_position = 1) = v_regs[1],
        'preview must follow the organizer''s order';
    RAISE NOTICE 'PASS 5: seed_rank override beats the board in suggestions and preview';

    PERFORM tournament_generate_bracket(v_tid, v_ver);
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_reg_top) = 6,
        'publish must not re-stamp an organizer-ordered field';
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_regs[1]) = 1,
        'organizer''s seed 1 stays seed 1';
    ASSERT (SELECT player1_registration_id FROM tournament_matches
             WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1) = v_regs[1],
        'generated R1M1 player1 should be the organizer''s seed 1';

    SELECT payload_after INTO v_payload FROM leagues_tournaments_audit
     WHERE scope = 'tournament' AND entity_id = v_tid AND action = 'generate_bracket'
     ORDER BY occurred_at DESC LIMIT 1;
    ASSERT (v_payload->>'auto_seeded')::boolean = false, 'audit should record auto_seeded = false';
    RAISE NOTICE 'PASS 6: publish keeps the organizer''s seeds verbatim';
END $$;


-- ============================================================
-- 3. Pools: preview + publish read the ladder, stamp on publish
-- ============================================================
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_reg_top uuid;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord <= 9;
    ASSERT array_length(v_players, 1) = 9, 'need 9 point-free active tennis players';
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        '[TEST] Circuit Seed Pools', v_sport, 16::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_visibility   => 'public',
        p_bracket_type => 'pool_knockout');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    PERFORM tournament_open_registration(v_tid, v_ver);
    FOR i IN 2..9 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM tournament_register(v_tid, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    PERFORM tournament_close_registration(v_tid, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;

    -- Player 7 (block 1's leader) registered 6th of 8.
    SELECT id INTO v_reg_top FROM tournament_registrations WHERE tournament_id = v_tid AND user_id = v_players[7];

    ASSERT (SELECT registration_id FROM tournament_preview_pools(v_tid) WHERE pool_number = 1 AND slot = 1) = v_reg_top,
        'pool preview should put the Circuit leader at pool 1 slot 1';

    PERFORM tournament_generate_pools(v_tid, v_ver);
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_reg_top) = 1,
        'pool publish should stamp the Circuit leader seed 1';
    ASSERT (SELECT count(DISTINCT seed_rank) FROM tournament_registrations
             WHERE tournament_id = v_tid AND status = 'registered' AND seed_rank BETWEEN 1 AND 8) = 8,
        'pool publish should stamp all 8 entries 1..8';
    ASSERT (SELECT pool_number FROM tournament_matches
             WHERE tournament_id = v_tid AND bracket_side = 'pool'
               AND (player1_registration_id = v_reg_top OR player2_registration_id = v_reg_top)
             LIMIT 1) = 1,
        'Circuit leader should play in pool 1';
    RAISE NOTICE 'PASS 7: pools preview + publish read the ladder and stamp seeds';
END $$;


-- ============================================================
-- 4. Doubles: partners'' points are summed on the doubles board
-- ============================================================
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_reg_ab  uuid;   -- A+B: 120 + 100 = 220 (neither alone beats C)
    v_reg_cd  uuid;   -- C+D: 200 + 0
    v_reg_ef  uuid;   -- E+F: 0
    v_reg_gh  uuid;   -- G+H: 0
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- Fresh players (10..18): none touched by the singles blocks above.
    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord BETWEEN 10 AND 18;
    ASSERT array_length(v_players, 1) = 9, 'need 30 point-free active tennis players';
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => '[TEST] Circuit Seed Doubles', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'doubles');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;

    -- Register in an order that FIFO and single-player points would both get wrong.
    PERFORM pg_temp.as_user(v_players[6]); SELECT id INTO v_reg_ef FROM tournament_register(v_tid, v_players[7]);
    PERFORM pg_temp.as_user(v_players[4]); SELECT id INTO v_reg_cd FROM tournament_register(v_tid, v_players[5]);
    PERFORM pg_temp.as_user(v_players[8]); SELECT id INTO v_reg_gh FROM tournament_register(v_tid, v_players[9]);
    PERFORM pg_temp.as_user(v_players[2]); SELECT id INTO v_reg_ab FROM tournament_register(v_tid, v_players[3]);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;

    -- Doubles-board points (board derived from this tournament's entry_format).
    PERFORM pg_temp.give_points(v_tid, v_reg_ab, v_players[2], v_sport, 120);
    PERFORM pg_temp.give_points(v_tid, v_reg_ab, v_players[3], v_sport, 100);
    PERFORM pg_temp.give_points(v_tid, v_reg_cd, v_players[4], v_sport, 200);

    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_reg_ab,
        'pair with the higher combined points should be seed 1';
    ASSERT (SELECT circuit_points FROM tournament_seed_suggestions(v_tid) WHERE registration_id = v_reg_ab) = 220,
        'pair points should be the partners'' sum';
    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 2) = v_reg_cd,
        'single strong partner should seed 2';
    ASSERT (SELECT circuit_points FROM tournament_seed_suggestions(v_tid) WHERE registration_id = v_reg_cd) = 200,
        'pair with one scorer should report that scorer''s points';

    -- Singles-board points must not leak onto a doubles draw: give E a big
    -- singles result on a singles tournament from block 1 and re-check.
    PERFORM pg_temp.give_points(
        (SELECT id FROM tournaments WHERE name = '[TEST] Circuit Seed Cup' LIMIT 1),
        (SELECT id FROM tournament_registrations
          WHERE tournament_id = (SELECT id FROM tournaments WHERE name = '[TEST] Circuit Seed Cup' LIMIT 1)
          ORDER BY id LIMIT 1),
        v_players[6], v_sport, 900);
    ASSERT (SELECT circuit_points FROM tournament_seed_suggestions(v_tid) WHERE registration_id = v_reg_ef) = 0,
        'singles points must not count on the doubles board';
    RAISE NOTICE 'PASS 8: doubles seeding sums partners on the doubles board only';
END $$;


-- ============================================================
-- 5. Seeding modes: circuit / rating / signup / manual
-- ============================================================
DO $$
DECLARE
    v_sport      uuid;
    v_players    uuid[];
    v_org        uuid;
    v_t          tournaments;
    v_tid        uuid;
    v_ver        integer;
    v_low_reg    uuid;      -- lowest-rated registrant, handed the most points
    v_other_reg  uuid;
    v_first_reg  uuid;
    v_fifo       uuid[];
    v_frozen     uuid[];
    v_base       int;
    v_ok         boolean;
    v_top_rating double precision;
    i            integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord BETWEEN 19 AND 26;
    ASSERT array_length(v_players, 1) = 8, 'need 8 fresh point-free players';
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => '[TEST] Seeding Modes', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    ASSERT v_t.seeding_mode = 'circuit', 'new tournaments should default to circuit mode';

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;
    FOR i IN 2..8 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM tournament_register(v_tid);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;

    -- Sign-up order, the way the signup mode must reproduce it.
    SELECT array_agg(tr.id ORDER BY tr.registered_at ASC, tr.id ASC) INTO v_fifo
      FROM tournament_registrations tr
     WHERE tr.tournament_id = v_tid AND tr.status = 'registered';
    v_first_reg := v_fifo[1];

    -- The lowest-rated entry gets the biggest Circuit haul, so circuit mode
    -- and rating mode cannot agree on seed 1.
    SELECT o.registration_id INTO v_low_reg
      FROM public.lt_tournament_seed_order(v_tid) o
     ORDER BY o.rating ASC NULLS FIRST, o.registration_id LIMIT 1;
    SELECT max(o.rating) INTO v_top_rating FROM public.lt_tournament_seed_order(v_tid) o;

    SELECT coalesce(max(b.points), 0) INTO v_base
      FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'singles') b;
    PERFORM pg_temp.give_points(v_tid, v_low_reg,
        (SELECT user_id FROM tournament_registrations WHERE id = v_low_reg),
        v_sport, v_base * 10 + 1000);

    -- ---- circuit (default): points win ----
    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_low_reg,
        'circuit mode: the big-points entry should seed 1';
    RAISE NOTICE 'PASS 9: circuit mode seeds on Circuit points';

    -- ---- rating: rating wins, points only break ties ----
    PERFORM tournament_set_seeding_mode(v_tid, 'rating', v_ver);
    ASSERT (SELECT seeding_mode FROM tournaments WHERE id = v_tid) = 'rating', 'mode should be rating';
    ASSERT (SELECT version FROM tournaments WHERE id = v_tid) = v_ver,
        'set_seeding_mode must not bump tournament.version';

    SELECT bool_and(ok) INTO v_ok FROM (
        SELECT coalesce(rating, -1) <= coalesce(lag(rating) OVER (ORDER BY suggested_seed), 999) AS ok
          FROM tournament_seed_suggestions(v_tid)) x;
    ASSERT v_ok, 'rating mode: ratings must be non-increasing down the seeds';
    ASSERT (SELECT rating FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_top_rating,
        'rating mode: seed 1 should hold the top rating';
    RAISE NOTICE 'PASS 10: rating mode seeds on rating, points demoted to a tiebreak';

    -- ---- signup: neither points nor rating count ----
    PERFORM tournament_set_seeding_mode(v_tid, 'signup', v_ver);
    ASSERT (SELECT array_agg(registration_id ORDER BY suggested_seed) FROM tournament_seed_suggestions(v_tid)) = v_fifo,
        'signup mode: order should be exactly registration order';
    ASSERT (SELECT registration_id FROM tournament_seed_suggestions(v_tid) WHERE suggested_seed = 1) = v_first_reg,
        'signup mode: first to register should seed 1';
    RAISE NOTICE 'PASS 11: signup mode is pure FIFO';

    -- ---- switching modes clears any leftover manual order ----
    PERFORM tournament_set_seeding_mode(v_tid, 'circuit', v_ver);
    ASSERT (SELECT count(*) FROM tournament_registrations
             WHERE tournament_id = v_tid AND seed_rank IS NOT NULL) = 0,
        'switching to a computed mode must clear seed_rank';

    -- ---- manual freezes the order that was on screen ----
    SELECT array_agg(registration_id ORDER BY suggested_seed) INTO v_frozen
      FROM tournament_seed_suggestions(v_tid);
    PERFORM tournament_set_seeding_mode(v_tid, 'manual', v_ver);
    ASSERT (SELECT count(*) FROM tournament_registrations
             WHERE tournament_id = v_tid AND status = 'registered' AND seed_rank IS NOT NULL) = 7,
        'switching to manual must stamp every entry';
    ASSERT (SELECT array_agg(registration_id ORDER BY suggested_seed) FROM tournament_seed_suggestions(v_tid)) = v_frozen,
        'manual must freeze the order the previous mode produced';

    -- Frozen means frozen: a fresh mountain of points moves nobody.
    SELECT o.registration_id INTO v_other_reg
      FROM public.lt_tournament_seed_order(v_tid) o
     WHERE o.registration_id <> v_frozen[1]
     ORDER BY o.suggested_seed DESC LIMIT 1;
    PERFORM pg_temp.give_points(v_tid, v_other_reg,
        (SELECT user_id FROM tournament_registrations WHERE id = v_other_reg),
        v_sport, v_base * 100 + 100000);
    ASSERT (SELECT array_agg(registration_id ORDER BY suggested_seed) FROM tournament_seed_suggestions(v_tid)) = v_frozen,
        'manual order must not react to new Circuit points';
    RAISE NOTICE 'PASS 12: manual freezes the current order and stops recomputing';

    -- ---- re-picking the same mode is a no-op, seeds survive ----
    PERFORM tournament_set_seeding_mode(v_tid, 'manual', v_ver);
    ASSERT (SELECT array_agg(registration_id ORDER BY suggested_seed) FROM tournament_seed_suggestions(v_tid)) = v_frozen,
        're-picking the current mode must not clobber the seeds';
    RAISE NOTICE 'PASS 13: re-picking the active mode is a no-op';

    -- ---- hand-ordering implies manual ----
    PERFORM tournament_set_seeding_mode(v_tid, 'circuit', v_ver);
    ASSERT (SELECT seeding_mode FROM tournaments WHERE id = v_tid) = 'circuit', 'back to circuit';
    PERFORM tournament_set_seeds(v_tid, ARRAY(SELECT unnest(v_fifo) ORDER BY 1 DESC), v_ver);
    ASSERT (SELECT seeding_mode FROM tournaments WHERE id = v_tid) = 'manual',
        'tournament_set_seeds must flip the mode to manual';
    ASSERT (SELECT version FROM tournaments WHERE id = v_tid) = v_ver,
        'the mode flip must not bump tournament.version';
    RAISE NOTICE 'PASS 14: reordering by hand switches the tournament to manual';
END $$;


-- ============================================================
-- 6. Seeding-mode guards
-- ============================================================
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_err     text;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id ORDER BY ord) INTO v_players FROM _seed_players WHERE ord BETWEEN 19 AND 26;
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => '[TEST] Seeding Modes Guards', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;

    -- Unknown mode.
    BEGIN
        PERFORM tournament_set_seeding_mode(v_tid, 'elo', v_ver);
        ASSERT false, 'unknown mode should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'INVALID_SEEDING_MODE', 'unexpected: ' || v_err;
    END;

    -- Stale version.
    BEGIN
        PERFORM tournament_set_seeding_mode(v_tid, 'rating', v_ver + 99);
        ASSERT false, 'stale version should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'OPTIMISTIC_LOCK_CONFLICT', 'unexpected: ' || v_err;
    END;

    -- Settable while registration is still open (draft/open/closed all allowed).
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;
    PERFORM tournament_set_seeding_mode(v_tid, 'signup', v_ver);
    ASSERT (SELECT seeding_mode FROM tournaments WHERE id = v_tid) = 'signup',
        'mode should be settable before registration closes';

    -- Non-organizer.
    PERFORM pg_temp.as_user(v_players[3]);
    BEGIN
        PERFORM tournament_set_seeding_mode(v_tid, 'circuit', v_ver);
        ASSERT false, 'non-organizer should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'unexpected: ' || v_err;
    END;
    PERFORM pg_temp.as_user(v_org);

    -- Once the draw exists the mode is history, not a setting.
    FOR i IN 2..7 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM tournament_register(v_tid);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    BEGIN
        PERFORM tournament_set_seeding_mode(v_tid, 'circuit', v_ver);
        ASSERT false, 'mode change after publish should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'BRACKET_ALREADY_GENERATED', 'unexpected: ' || v_err;
    END;
    RAISE NOTICE 'PASS 15: seeding-mode guards (mode, version, organizer, post-publish)';
END $$;

ROLLBACK;

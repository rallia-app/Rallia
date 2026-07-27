-- ============================================
-- Tournaments — seeding + dry-run preview test
-- ============================================
-- Covers the bracket-setup slice added in 20260628120000:
--   tournament_set_seeds, tournament_preview_bracket, and that
--   tournament_generate_bracket honours the seed order set beforehand.
--
-- Run against a seeded local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_seeding_preview_test.sql
--
-- Whole script runs in one transaction and ROLLBACKs at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_regs    uuid[];
    v_count   integer;
    v_seed1   uuid;
    v_seed2   uuid;
    v_prev_p1 uuid;
    v_gen_p1  uuid;
    i         integer;
    v_err     text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'seed missing tennis sport';

    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 7
      ) s;
    ASSERT array_length(v_players, 1) = 7, 'need 7 active tennis players';
    v_org := v_players[1];

    -- Organizer creates + opens an 8-bracket tournament.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Seed Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open'
    );
    v_tid := v_t.id; v_ver := v_t.version;

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    -- 6 players register (8-bracket -> 2 byes).
    FOR i IN 2..7 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    ASSERT v_t.status = 'registration_closed', 'expected registration_closed';

    -- Ordered registration ids (deterministic) become our intended seed order.
    SELECT array_agg(id ORDER BY id) INTO v_regs
      FROM tournament_registrations
     WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT array_length(v_regs, 1) = 6, 'expected 6 registrations';

    -- ---- preview is read-only: returns a bracket, inserts nothing ----
    SELECT count(*) INTO v_count FROM tournament_preview_bracket(v_tid);
    ASSERT v_count = 7, 'preview should compute 7 matches (4+2+1), got ' || v_count;

    SELECT count(*) INTO v_count FROM tournament_matches WHERE tournament_id = v_tid;
    ASSERT v_count = 0, 'preview must NOT insert rows, found ' || v_count;
    SELECT status INTO v_t.status FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'registration_closed', 'preview must not change status';
    RAISE NOTICE 'PASS 1: preview returns bracket, inserts nothing, status unchanged';

    -- ---- set_seeds writes seed_rank 1..N, does NOT bump version ----
    PERFORM tournament_set_seeds(v_tid, v_regs, v_ver);
    SELECT count(*) INTO v_count
      FROM tournament_registrations
     WHERE tournament_id = v_tid AND status = 'registered'
       AND seed_rank IS NOT NULL;
    ASSERT v_count = 6, 'all 6 regs should have a seed_rank, got ' || v_count;

    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_regs[1]) = 1,
        'first ordered reg should be seed 1';
    ASSERT (SELECT version FROM tournaments WHERE id = v_tid) = v_ver,
        'set_seeds must not bump tournament.version';
    RAISE NOTICE 'PASS 2: set_seeds wrote seed_rank 1..6, version unchanged';

    -- ---- reseed over an already-seeded set must NOT hit the seed_rank
    --      exclusion constraint (regression: treg_seed_unique_per_tournament) ----
    PERFORM tournament_set_seeds(
        v_tid,
        (SELECT array_agg(id ORDER BY id DESC)
           FROM tournament_registrations
          WHERE tournament_id = v_tid AND status = 'registered'),
        v_ver);
    ASSERT (SELECT seed_rank FROM tournament_registrations WHERE id = v_regs[6]) = 1,
        'reseed: largest-id reg should now be seed 1';
    -- restore the canonical order for the preview/generate assertions below
    PERFORM tournament_set_seeds(v_tid, v_regs, v_ver);
    RAISE NOTICE 'PASS 2b: reseed over an already-seeded set succeeds';

    -- ---- preview honours seeds: seed 1 -> round1 match1 player1 ----
    v_seed1 := v_regs[1];
    SELECT player1_registration_id INTO v_prev_p1
      FROM tournament_preview_bracket(v_tid)
     WHERE round_number = 1 AND match_position = 1;
    ASSERT v_prev_p1 = v_seed1, 'seed 1 should land in R1M1 player1 in preview';
    RAISE NOTICE 'PASS 3: preview places seed 1 at R1M1 player1';

    -- ---- generate honours the same seeds and matches the preview ----
    PERFORM tournament_generate_bracket(v_tid, v_ver);
    SELECT status INTO v_t.status FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'in_progress', 'expected in_progress after publish';

    SELECT player1_registration_id INTO v_gen_p1
      FROM tournament_matches
     WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1;
    ASSERT v_gen_p1 = v_seed1, 'generated R1M1 player1 should equal seed 1';
    ASSERT v_gen_p1 = v_prev_p1, 'generate must match preview placement';

    SELECT count(*) INTO v_count FROM tournament_matches WHERE tournament_id = v_tid;
    ASSERT v_count = 7, 'expected 7 generated matches, got ' || v_count;
    RAISE NOTICE 'PASS 4: generate honours seeds and matches preview';

    -- ---- preview after generation is rejected ----
    BEGIN
        PERFORM count(*) FROM tournament_preview_bracket(v_tid);
        ASSERT false, 'preview should fail once bracket exists';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'BRACKET_ALREADY_GENERATED', 'unexpected: ' || v_err;
    END;
    RAISE NOTICE 'PASS 5: preview rejected after bracket generated';
END $$;


-- ---- negative: seed set must exactly equal the registered set ----
DO $$
DECLARE
    v_sport uuid;
    v_players uuid[];
    v_org uuid;
    v_t tournaments;
    v_tid uuid;
    v_ver integer;
    v_regs uuid[];
    v_err text;
    i integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
             ORDER BY player_id LIMIT 7) s;
    v_org := v_players[1];
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Seed Cup Neg', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;
    FOR i IN 2..7 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;
    SELECT array_agg(id ORDER BY id) INTO v_regs
      FROM tournament_registrations WHERE tournament_id = v_tid AND status = 'registered';

    -- incomplete list (5 of 6) -> SEED_SET_MISMATCH
    BEGIN
        PERFORM tournament_set_seeds(v_tid, v_regs[1:5], v_ver);
        ASSERT false, 'incomplete seed list should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'SEED_SET_MISMATCH', 'unexpected: ' || v_err;
    END;

    -- foreign id swapped in (count still 6) -> SEED_FOREIGN_ID
    BEGIN
        PERFORM tournament_set_seeds(
            v_tid,
            v_regs[1:5] || gen_random_uuid(),
            v_ver);
        ASSERT false, 'foreign seed id should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'SEED_FOREIGN_ID', 'unexpected: ' || v_err;
    END;

    -- non-organizer preview -> NOT_ORGANIZER
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    BEGIN
        PERFORM count(*) FROM tournament_preview_bracket(v_tid);
        ASSERT false, 'non-organizer preview should fail';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        ASSERT v_err = 'NOT_ORGANIZER', 'unexpected: ' || v_err;
    END;
    RAISE NOTICE 'PASS 6: seed-set validation + organizer gate enforced';
END $$;

ROLLBACK;

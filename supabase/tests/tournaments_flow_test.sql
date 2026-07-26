-- ============================================
-- Tournaments — DB-level integration test (V1–V5 + V4.x override)
-- ============================================
-- Exercises the real RPCs against a live database — the bracket generator
-- and advancement logic (the riskiest plpgsql in the feature) have no other
-- direct coverage; the Jest suite mocks Supabase entirely.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournaments_flow_test.sql
--
-- The whole script runs inside one transaction and ROLLBACKs at the end, so
-- it leaves the seeded database untouched and is safe to re-run. Any failed
-- ASSERT aborts the transaction; with ON_ERROR_STOP=1 psql exits non-zero.
--
-- Auth is simulated by setting the `request.jwt.claims` GUC (what auth.uid()
-- reads). RLS visibility is checked by switching to the `authenticated` role.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Full happy path: create → register → close → bracket → override → done
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_count   integer;
    v_match   tournament_matches;
    v_champ   uuid;
    v_guard   integer := 0;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'seed missing tennis sport';

    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 6
      ) s;
    ASSERT array_length(v_players, 1) = 6,
        'need 6 active tennis players, got ' || coalesce(array_length(v_players, 1), 0);
    v_org := v_players[1];

    -- Act as the organizer.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Audit Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open'
    );
    v_tid := v_t.id; v_ver := v_t.version;
    ASSERT v_t.status = 'draft', 'expected draft, got ' || v_t.status;

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;
    ASSERT v_t.status = 'registration_open', 'expected registration_open';

    -- 5 players register (into an 8-bracket → 3 byes).
    FOR i IN 2..6 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;
    SELECT count(*) INTO v_count
      FROM tournament_registrations WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT v_count = 5, 'expected 5 registered, got ' || v_count;

    -- Back to organizer.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    ASSERT v_t.status = 'registration_closed', 'expected registration_closed';

    PERFORM tournament_generate_bracket(v_tid, v_ver);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'in_progress', 'expected in_progress after generate';

    -- 8-bracket → 4 + 2 + 1 = 7 matches across 3 rounds.
    SELECT count(*) INTO v_count FROM tournament_matches WHERE tournament_id = v_tid;
    ASSERT v_count = 7, 'expected 7 matches, got ' || v_count;
    SELECT count(DISTINCT round_number) INTO v_count FROM tournament_matches WHERE tournament_id = v_tid;
    ASSERT v_count = 3, 'expected 3 rounds, got ' || v_count;

    -- The 3 round-1 BYE matches must be auto-completed.
    SELECT count(*) INTO v_count
      FROM tournament_matches
     WHERE tournament_id = v_tid AND round_number = 1
       AND (player1_is_bye OR player2_is_bye) AND status = 'completed';
    ASSERT v_count = 3, 'expected 3 completed R1 bye matches, got ' || v_count;

    -- Organizer plays the tournament out via score overrides: repeatedly
    -- resolve any pending real-vs-real match (player1 wins) until none remain.
    LOOP
        v_guard := v_guard + 1;
        ASSERT v_guard < 50, 'override loop did not converge';

        SELECT * INTO v_match FROM tournament_matches
         WHERE tournament_id = v_tid AND status = 'pending'
           AND player1_is_bye = false AND player2_is_bye = false
           AND player1_registration_id IS NOT NULL
           AND player2_registration_id IS NOT NULL
         ORDER BY round_number, match_position
         LIMIT 1;
        EXIT WHEN v_match.id IS NULL;

        PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
    END LOOP;

    -- Final resolved → tournament completed with a champion.
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'completed', 'expected completed, got ' || v_t.status;

    SELECT winner_registration_id INTO v_champ
      FROM tournament_matches
     WHERE tournament_id = v_tid AND bracket_side = 'main' AND next_match_id IS NULL;
    ASSERT v_champ IS NOT NULL, 'final has no winner';

    -- bracket_locked_at flips on first real completion.
    ASSERT (SELECT bracket_locked_at FROM tournaments WHERE id = v_tid) IS NOT NULL,
        'bracket_locked_at not set';

    RAISE NOTICE 'PASS 1: full flow create→register→close→bracket→override→complete';
END $$;

-- --------------------------------------------------------------------------
-- 2. Optimistic-lock conflict on a stale version
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid;
    v_org   uuid;
    v_t     tournaments;
    v_ok    boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT player_id INTO v_org FROM player_sport
      WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) ORDER BY player_id LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Lock Test', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days'
    );

    BEGIN
        -- version is 1; pass a stale value.
        PERFORM tournament_open_registration(v_t.id, v_t.version + 99);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'OPTIMISTIC_LOCK_CONFLICT');
    END;
    ASSERT v_ok, 'expected OPTIMISTIC_LOCK_CONFLICT on stale version';

    RAISE NOTICE 'PASS 2: optimistic-lock conflict raised on stale version';
END $$;

-- --------------------------------------------------------------------------
-- 3. Doubles tournaments can be created (full doubles lifecycle is covered
--    by tournaments_doubles_flow_test.sql)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid;
    v_org   uuid;
    v_t     tournaments;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT player_id INTO v_org FROM player_sport
      WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) ORDER BY player_id LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Doubles Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_entry_format => 'doubles'
    );
    ASSERT v_t.entry_format = 'doubles', 'expected doubles entry_format';

    RAISE NOTICE 'PASS 3: doubles tournament accepted at creation';
END $$;

-- --------------------------------------------------------------------------
-- 4. Capacity is enforced (registration past max_participants is blocked)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_ok      boolean := false;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 6
      ) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Capacity Cup', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_registration_mode => 'open'
    );
    PERFORM tournament_open_registration(v_t.id, v_t.version);

    -- Fill all 4 slots with players 2..5.
    FOR i IN 2..5 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_t.id);
    END LOOP;

    -- Player 6 is one too many.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[6]::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_t.id);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'TOURNAMENT_FULL');
    END;
    ASSERT v_ok, 'expected TOURNAMENT_FULL at capacity';

    RAISE NOTICE 'PASS 4: capacity enforced (TOURNAMENT_FULL past max_participants)';
END $$;

-- --------------------------------------------------------------------------
-- 5. RLS hides a private tournament from a non-participant
-- --------------------------------------------------------------------------
-- Runs last: it switches to the `authenticated` role (which can't switch
-- back), so nothing after it needs elevated privileges before the ROLLBACK.
DO $$
DECLARE
    v_sport    uuid;
    v_org      uuid;
    v_outsider uuid;
    v_t        tournaments;
    v_seen     integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT player_id INTO v_org FROM player_sport
      WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) ORDER BY player_id LIMIT 1;
    SELECT player_id INTO v_outsider FROM player_sport
      WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) AND player_id <> v_org
      ORDER BY player_id LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Private RLS', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'private'
    );

    -- Enforce RLS from here on.
    PERFORM set_config('role', 'authenticated', true);

    -- Organizer can see their own private tournament.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT count(*) INTO v_seen FROM tournaments WHERE id = v_t.id;
    ASSERT v_seen = 1, 'organizer should see own private tournament';

    -- A non-participant must not.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);
    SELECT count(*) INTO v_seen FROM tournaments WHERE id = v_t.id;
    ASSERT v_seen = 0, 'RLS leak: outsider can see private tournament';

    RAISE NOTICE 'PASS 5: RLS hides private tournament from non-participant';
END $$;

ROLLBACK;

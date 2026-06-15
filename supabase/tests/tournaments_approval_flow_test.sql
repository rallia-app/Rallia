-- ============================================
-- Tournaments — approval-mode register / approve / decline (DB-level)
-- ============================================
-- Covers tournament_approve_registration (20260615070000) and the
-- decline-via-remove path. The Jest suite mocks Supabase, so the plpgsql
-- approve/decline gates have no other direct coverage.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournaments_approval_flow_test.sql
--
-- One transaction, ROLLBACK at the end. Auth is simulated via the
-- request.jwt.claims GUC (what auth.uid() reads).
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. approval-mode register -> pending; organizer approves -> registered
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_reg     tournament_registrations;
    v_after   tournament_registrations;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(v_players, 1) = 4, 'need 4 active tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Approval Cup', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'approval');
    v_tid := v_t.id;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_t.version);

    -- Player 2 self-registers -> pending (approval mode, not privileged).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_tid);
    ASSERT v_reg.status = 'pending', 'approval register should be pending, got ' || v_reg.status;

    -- Organizer approves.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_after FROM tournament_approve_registration(v_reg.id, v_reg.version);
    ASSERT v_after.status = 'registered', 'expected registered, got ' || v_after.status;
    ASSERT v_after.approved_by = v_org, 'approved_by should be the organizer';
    ASSERT v_after.approved_at IS NOT NULL, 'approved_at should be set';
    ASSERT EXISTS (
        SELECT 1 FROM leagues_tournaments_audit
         WHERE scope = 'registration' AND entity_id = v_reg.id AND action = 'approve_registration'
    ), 'approve audit row missing';

    RAISE NOTICE 'PASS 1: approval register->pending, approve->registered (audited)';
END $$;

-- --------------------------------------------------------------------------
-- 2. approve by a non-organizer -> NOT_ORGANIZER
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid; v_outsider uuid;
    v_t tournaments; v_reg tournament_registrations; v_ok boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 4) s;
    v_org := v_players[1]; v_outsider := v_players[3];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Approval Auth', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'approval');
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_t.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);
    BEGIN
        PERFORM tournament_approve_registration(v_reg.id, v_reg.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'expected NOT_ORGANIZER for non-organizer approve';

    RAISE NOTICE 'PASS 2: non-organizer approve rejected';
END $$;

-- --------------------------------------------------------------------------
-- 3. approving a non-pending row errors
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid;
    v_t tournaments; v_reg tournament_registrations; v_after tournament_registrations;
    v_ok boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 4) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Approval Double', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'approval');
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_t.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_after FROM tournament_approve_registration(v_reg.id, v_reg.version);

    -- Second approve on the now-registered (version-bumped) row.
    BEGIN
        PERFORM tournament_approve_registration(v_after.id, v_after.version);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM IN ('REGISTRATION_NOT_FOUND', 'OPTIMISTIC_LOCK_CONFLICT'));
    END;
    ASSERT v_ok, 'expected error approving a non-pending row, got success';

    RAISE NOTICE 'PASS 3: approving a non-pending row rejected';
END $$;

-- --------------------------------------------------------------------------
-- 4. decline = remove a pending row -> disqualified (terminal)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid;
    v_t tournaments; v_reg tournament_registrations; v_after tournament_registrations;
    v_ok boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 4) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Approval Decline', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'approval');
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_t.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_after FROM tournament_remove_registration(v_reg.id, v_reg.version);
    ASSERT v_after.status = 'disqualified', 'decline should set disqualified, got ' || v_after.status;

    -- Terminal: the declined player cannot re-register.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_t.id);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'REGISTRATION_REMOVED'); END;
    ASSERT v_ok, 'declined player should be blocked from re-registering';

    RAISE NOTICE 'PASS 4: decline (remove) -> disqualified, terminal';
END $$;

ROLLBACK;

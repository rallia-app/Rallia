-- ============================================
-- RPC caller guards, sweep 3 — test
-- ============================================
-- Player-scoped RPCs refuse another player's id (42501) and accept the
-- caller's own; admin RPCs refuse non-admins and admin impersonation;
-- get_or_create_group_invite_code is members-only; session_create_series
-- refuses non-organizers with P0001 NOT_ORGANIZER; internal / edge-only /
-- unused functions are no longer directly executable; no-JWT (server) calls
-- pass the guards; search_path is pinned everywhere.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/rpc_caller_guards_sweep3_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p1 uuid;
    v_p2 uuid;
    v_p3 uuid;
    v_sport uuid;
    v_season uuid;
    v_net_member uuid;
    v_net_other uuid;
    v_fn text;
    v_n int;
    v_code text;
    v_state text;
    v_msg text;
    v_regen text[] := ARRAY[
        'get_broadcast_recipients','get_player_reports','get_match_analytics','get_sport_growth_trends',
        'get_rating_distribution','get_sport_facility_data','review_player_report','log_admin_action',
        'register_admin_device','unregister_admin_device','accept_rebuttal_score','confirm_match_score',
        'dispute_rebuttal_score','propose_rebuttal_score','get_pending_score_confirmations','attribute_referral',
        'join_group_by_invite_code','get_or_create_player_referral_code','get_player_referral_stats',
        'get_my_contest_rank','disable_all_email_notifications','validate_and_create_match_from_email_invite',
        'get_just_for_you','get_upcoming_matches_scored','get_match_suggestions_scored','search_players_nearby',
        'get_player_matches','reset_group_invite_code','get_or_create_group_invite_code','session_create_series'];
    v_revoked text[] := ARRAY[
        'award_tournament_ranking_points','lt_advance_tournament_winner','lt_notify_knockout_published',
        'lt_notify_pools_published','lt_notify_tournament_deadline_changed','lt_post_system_match_organizer_card',
        'lt_propagate_match_result_to_bracket','lt_propagate_match_result_to_session','recalc_season_ranking',
        'reevaluate_certification_for_player_rating','log_active_rating_change','send_admin_broadcast_push',
        'get_morning_digest_suggestions','get_opponents_for_notification','mark_check_in_reminder_sent',
        'mark_feedback_reminders_sent','mark_initial_feedback_notifications_sent','mark_match_starting_soon_sent',
        'resolve_facility_providers','snapshot_record_refresh_error','snapshot_try_lock_facility',
        'snapshot_replace_facility_rows','update_registration_paid_amount','get_active_player_ban','is_player_banned',
        'get_compatible_players','get_group_activity','get_players_by_play_attributes','get_players_by_play_style',
        'get_user_created_match_ids','get_user_participating_match_ids','get_proof_endorsement_counts'];
BEGIN
    SELECT id INTO v_p1 FROM player WHERE NOT public.is_admin(id) ORDER BY id LIMIT 1;
    SELECT id INTO v_p2 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 1 LIMIT 1;
    SELECT id INTO v_p3 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 2 LIMIT 1;
    ASSERT v_p1 IS NOT NULL AND v_p2 IS NOT NULL AND v_p3 IS NOT NULL, 'need three seeded non-admin players';
    INSERT INTO admin (id, role) VALUES (v_p3, 'support') ON CONFLICT (id) DO NOTHING;
    BEGIN EXECUTE 'SELECT id FROM sport ORDER BY id LIMIT 1' INTO v_sport; EXCEPTION WHEN undefined_table THEN v_sport := NULL; END;
    BEGIN EXECUTE 'SELECT id FROM seasons ORDER BY id LIMIT 1' INTO v_season; EXCEPTION WHEN undefined_table THEN v_season := NULL; END;
    SELECT nm.network_id INTO v_net_member FROM network_member nm WHERE nm.player_id = v_p1 AND nm.status = 'active' LIMIT 1;
    SELECT n.id INTO v_net_other FROM network n WHERE NOT EXISTS (SELECT 1 FROM network_member m WHERE m.network_id = n.id AND m.player_id = v_p1) LIMIT 1;

    -- ── 0. Grants + search_path on regenerated fns; revoked set not executable
    FOREACH v_fn IN ARRAY v_regen LOOP
        ASSERT (SELECT bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': anon cannot execute';
        ASSERT (SELECT bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': authenticated can execute';
        ASSERT (SELECT bool_and(EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': search_path pinned';
        ASSERT (SELECT bool_and(prosrc ~ 'auth\.uid|is_league_organizer') FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': guard present';
    END LOOP;
    FOREACH v_fn IN ARRAY v_revoked LOOP
        ASSERT (SELECT count(*) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace) > 0, v_fn || ': exists';
        ASSERT (SELECT bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': not directly executable';
        ASSERT (SELECT bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) FROM pg_proc WHERE proname = v_fn AND pronamespace = 'public'::regnamespace), v_fn || ': service_role keeps execute';
    END LOOP;
    ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = 'lt_match_result_propagation_tg'), 'propagation trigger fn is SECURITY DEFINER';

    -- ── 1. Player-scoped: other id refused, own id passes the guard ──────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);

    BEGIN PERFORM public.confirm_match_score(gen_random_uuid(), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'confirm_match_score: other player refused (' || v_state || ')';
    BEGIN PERFORM public.confirm_match_score(gen_random_uuid(), v_p1); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state <> '42501', 'confirm_match_score: own id passes the guard';

    BEGIN PERFORM public.accept_rebuttal_score(gen_random_uuid(), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'accept_rebuttal_score: other player refused';
    BEGIN PERFORM public.dispute_rebuttal_score(gen_random_uuid(), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'dispute_rebuttal_score: other player refused';
    BEGIN PERFORM public.propose_rebuttal_score(gen_random_uuid(), v_p2, 1, '[]'::jsonb); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'propose_rebuttal_score: other player refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_pending_score_confirmations(v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_pending_score_confirmations: other player refused';
    SELECT count(*) INTO v_n FROM public.get_pending_score_confirmations(v_p1);

    BEGIN PERFORM public.attribute_referral('NOPE', v_p2, NULL, NULL, NULL); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'attribute_referral: other player refused';
    BEGIN PERFORM public.join_group_by_invite_code('NOPE', v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'join_group_by_invite_code: other player refused';
    BEGIN PERFORM public.get_or_create_player_referral_code(v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_or_create_player_referral_code: other player refused';
    ASSERT public.get_or_create_player_referral_code(v_p1) IS NOT NULL, 'get_or_create_player_referral_code: own works';
    BEGIN PERFORM public.get_player_referral_stats(v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_player_referral_stats: other player refused';
    BEGIN PERFORM public.get_my_contest_rank(gen_random_uuid(), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_my_contest_rank: other player refused';
    BEGIN PERFORM public.disable_all_email_notifications(v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'disable_all_email_notifications: other player refused';
    PERFORM public.disable_all_email_notifications(v_p1);
    BEGIN SELECT count(*) INTO v_n FROM public.get_player_matches(v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_player_matches: other player refused';
    SELECT count(*) INTO v_n FROM public.get_player_matches(v_p1);
    BEGIN PERFORM public.validate_and_create_match_from_email_invite(v_p2, v_p1, v_sport, NULL, current_date + 1, '10:00', '11:00', 'America/Toronto'); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'validate_and_create_match_from_email_invite: other caller refused';
    BEGIN PERFORM public.reset_group_invite_code(COALESCE(v_net_other, gen_random_uuid()), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'reset_group_invite_code: other moderator id refused';

    -- personalization RPCs: explicit foreign id refused, NULL and own pass
    IF v_sport IS NOT NULL THEN
        BEGIN SELECT count(*) INTO v_n FROM public.search_players_nearby(p_sport_id => v_sport, p_current_user_id => v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
        ASSERT v_state = '42501', 'search_players_nearby: foreign current user refused';
        SELECT count(*) INTO v_n FROM public.search_players_nearby(p_sport_id => v_sport, p_current_user_id => v_p1);
        SELECT count(*) INTO v_n FROM public.search_players_nearby(p_sport_id => v_sport, p_current_user_id => NULL);
        BEGIN SELECT count(*) INTO v_n FROM public.get_match_suggestions_scored(v_p2, v_sport, 5, NULL, NULL); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
        ASSERT v_state = '42501', 'get_match_suggestions_scored: foreign player refused';
    END IF;

    -- members-only invite code
    IF v_net_other IS NOT NULL THEN
        BEGIN PERFORM public.get_or_create_group_invite_code(v_net_other); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
        ASSERT v_state = '42501', 'get_or_create_group_invite_code: non-member refused';
    END IF;
    IF v_net_member IS NOT NULL THEN
        ASSERT public.get_or_create_group_invite_code(v_net_member) IS NOT NULL, 'get_or_create_group_invite_code: member gets a code';
    END IF;

    -- ── 2. Admin-scoped: non-admin refused, impersonation refused, admin ok ──
    BEGIN SELECT count(*) INTO v_n FROM public.get_broadcast_recipients(); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_broadcast_recipients: non-admin refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_player_reports(); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_player_reports: non-admin refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_match_analytics(current_date - 30, current_date, NULL); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_match_analytics: non-admin refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_sport_growth_trends(); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_sport_growth_trends: non-admin refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_rating_distribution(); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_rating_distribution: non-admin refused';
    BEGIN SELECT count(*) INTO v_n FROM public.get_sport_facility_data(); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'get_sport_facility_data: non-admin refused';
    BEGIN PERFORM public.review_player_report(gen_random_uuid(), v_p1, NULL, NULL, NULL, NULL); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'review_player_report: non-admin refused';
    BEGIN PERFORM public.log_admin_action(v_p1, 'x'::text, 'y'::text, NULL::uuid, NULL::text, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::text); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'log_admin_action: non-admin refused';
    BEGIN PERFORM public.register_admin_device(v_p1, 'tok', 'ios', 'dev'); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'register_admin_device: non-admin refused';
    BEGIN PERFORM public.unregister_admin_device(v_p1, 'tok'); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'unregister_admin_device: non-admin refused';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3::text)::text, true);
    BEGIN PERFORM public.register_admin_device(v_p1, 'tok', 'ios', 'dev'); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'register_admin_device: admin impersonating another id refused';
    BEGIN PERFORM public.log_admin_action(v_p1, 'x'::text, 'y'::text, NULL::uuid, NULL::text, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::text); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501', 'log_admin_action: admin impersonating another id refused';
    SELECT count(*) INTO v_n FROM public.get_broadcast_recipients();
    SELECT count(*) INTO v_n FROM public.get_player_reports();
    SELECT count(*) INTO v_n FROM public.get_match_analytics(current_date - 30, current_date, NULL);
    SELECT count(*) INTO v_n FROM public.get_sport_growth_trends();
    SELECT count(*) INTO v_n FROM public.get_rating_distribution();
    SELECT count(*) INTO v_n FROM public.get_sport_facility_data();
    PERFORM public.register_admin_device(v_p3, 'tok', 'ios', 'dev');
    PERFORM public.unregister_admin_device(v_p3, 'tok');
    BEGIN PERFORM public.log_admin_action(v_p3, 'test_action'::text, 'test_entity'::text, NULL::uuid, NULL::text, NULL::jsonb, NULL::jsonb, NULL::jsonb, 'info'::text); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state <> '42501', 'log_admin_action: admin self passes the guard';
    BEGIN PERFORM public.review_player_report(gen_random_uuid(), v_p3, NULL, NULL, NULL, NULL); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state <> '42501', 'review_player_report: admin self passes the guard';

    -- ── 3. Organizer-scoped: session_create_series ───────────────────────────
    IF v_season IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
        BEGIN
            PERFORM public.session_create_series(v_season, 'guard test'::text, now() + interval '1 day', 7, 2, 'America/Toronto'::text, 90::smallint, NULL::uuid, NULL::text, 8::smallint, 1::smallint, (SELECT (enum_range(NULL::pairing_mode))[1]), NULL::smallint);
            v_state := '00000'; v_msg := '';
        EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
        END;
        ASSERT v_state = 'P0001' AND v_msg = 'NOT_ORGANIZER', 'session_create_series: non-organizer refused (' || v_state || ' ' || v_msg || ')';
    END IF;

    -- ── 4. No JWT (server / definer-internal context) passes the guards ──────
    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN PERFORM public.confirm_match_score(gen_random_uuid(), v_p2); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state <> '42501', 'server context passes player guard';
    SELECT count(*) INTO v_n FROM public.get_broadcast_recipients();
    BEGIN PERFORM public.log_admin_action(v_p1, 'x'::text, 'y'::text, NULL::uuid, NULL::text, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::text); v_state := '00000'; EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state <> '42501', 'server context passes admin guard';

    RAISE NOTICE 'PASS: sweep 3 guards (sport=%, season=%, member-net=%, other-net=%)', v_sport IS NOT NULL, v_season IS NOT NULL, v_net_member IS NOT NULL, v_net_other IS NOT NULL;
END $$;

ROLLBACK;

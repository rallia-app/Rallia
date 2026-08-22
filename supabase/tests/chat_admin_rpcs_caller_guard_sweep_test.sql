-- ============================================
-- Chat + admin RPCs — caller guard sweep test
-- ============================================
-- mark_messages_as_read / mark_messages_as_delivered only act for the caller,
-- find_direct_conversation only answers one of the two players, the chat
-- analytics RPCs and the admin-alert family require an admin (and the admin's
-- own id), the debug helper is gone, and the two tournament-chat helpers are
-- no longer directly executable.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/chat_admin_rpcs_caller_guard_sweep_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p1 uuid;
    v_p2 uuid;
    v_p3 uuid;
    v_conv uuid;
    v_fn text;
    v_cfg text[];
    v_n int;
    v_id uuid;
    v_raised boolean;
    v_last_read timestamptz;
BEGIN
    SELECT id INTO v_p1 FROM player WHERE NOT public.is_admin(id) ORDER BY id LIMIT 1;
    SELECT id INTO v_p2 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 1 LIMIT 1;
    SELECT id INTO v_p3 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 2 LIMIT 1;
    ASSERT v_p1 IS NOT NULL AND v_p2 IS NOT NULL AND v_p3 IS NOT NULL, 'need three seeded non-admin players';
    -- p3 becomes staff for the admin cases (rolled back with the transaction)
    INSERT INTO admin (id, role) VALUES (v_p3, 'support') ON CONFLICT (id) DO NOTHING;

    -- ── 0. Definition hardening ──────────────────────────────────────────────
    FOREACH v_fn IN ARRAY ARRAY[
        'public.mark_messages_as_read(uuid,uuid)',
        'public.mark_messages_as_delivered(uuid,uuid)',
        'public.find_direct_conversation(uuid,uuid)',
        'public.get_conversation_health()',
        'public.get_match_chat_adoption(date,date)',
        'public.get_message_volume(date,date)',
        'public.get_admin_alerts(uuid,integer,boolean)',
        'public.get_alert_counts(uuid)',
        'public.mark_alert_read(uuid,uuid)',
        'public.mark_all_alerts_read(uuid)',
        'public.dismiss_alert(uuid,uuid)',
        'public.get_admin_audit_log(integer,integer,uuid,text,text,text,timestamptz,timestamptz)'
    ] LOOP
        ASSERT NOT has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon cannot execute';
        ASSERT has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated can execute';
        SELECT proconfig INTO v_cfg FROM pg_proc WHERE oid = v_fn::regprocedure;
        ASSERT v_cfg @> ARRAY['search_path=public'], v_fn || ': search_path pinned';
    END LOOP;
    ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'debug_check_conversation_participant'),
        'debug helper dropped';
    FOREACH v_fn IN ARRAY ARRAY[
        'public.lt_notify_tournament_match_ready(uuid)',
        'public.lt_get_or_create_tournament_chat(uuid)'
    ] LOOP
        ASSERT NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': internal only (authenticated)';
        ASSERT NOT has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': internal only (anon)';
    END LOOP;

    -- ── 1. Fixture: a direct conversation p1<->p2 with two messages from p2 ──
    INSERT INTO conversation (conversation_type, created_by) VALUES ('direct', v_p1) RETURNING id INTO v_conv;
    INSERT INTO conversation_participant (conversation_id, player_id) VALUES (v_conv, v_p1), (v_conv, v_p2);
    INSERT INTO message (conversation_id, sender_id, content) VALUES (v_conv, v_p2, 'one'), (v_conv, v_p2, 'two');

    -- ── 2. mark_messages_as_read / delivered: own id works, other id refused ─
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    PERFORM public.mark_messages_as_delivered(v_conv, v_p1);
    ASSERT (SELECT count(*) FROM message WHERE conversation_id = v_conv AND status = 'delivered') = 2, 'delivered for self';
    PERFORM public.mark_messages_as_read(v_conv, v_p1);
    SELECT last_read_at INTO v_last_read FROM conversation_participant WHERE conversation_id = v_conv AND player_id = v_p1;
    ASSERT v_last_read IS NOT NULL, 'read for self';
    ASSERT (SELECT count(*) FROM message WHERE conversation_id = v_conv AND status = 'read') = 2, 'messages marked read';

    v_raised := false;
    BEGIN PERFORM public.mark_messages_as_read(v_conv, v_p2); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'read: other participant refused';
    ASSERT (SELECT last_read_at FROM conversation_participant WHERE conversation_id = v_conv AND player_id = v_p2) IS NULL,
        'p2 last_read_at untouched';
    v_raised := false;
    BEGIN PERFORM public.mark_messages_as_delivered(v_conv, v_p2); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'delivered: other participant refused';

    PERFORM set_config('request.jwt.claims', '', true);
    v_raised := false;
    BEGIN PERFORM public.mark_messages_as_read(v_conv, v_p1); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'read: no JWT refused';

    -- ── 3. find_direct_conversation: only one of the two players ─────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    ASSERT public.find_direct_conversation(v_p1, v_p2) = v_conv, 'find: p1 asks (p1,p2)';
    ASSERT public.find_direct_conversation(v_p2, v_p1) = v_conv, 'find: p1 asks (p2,p1)';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3::text)::text, true);
    v_raised := false;
    BEGIN v_id := public.find_direct_conversation(v_p1, v_p2); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'find: third party refused';

    -- ── 4. Analytics: non-admin refused, admin works ─────────────────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_conversation_health(); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'conversation_health: non-admin refused';
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_match_chat_adoption(current_date - 30, current_date); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'match_chat_adoption: non-admin refused';
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_message_volume(current_date - 30, current_date); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'message_volume: non-admin refused';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3::text)::text, true);
    SELECT count(*) INTO v_n FROM public.get_conversation_health();
    SELECT count(*) INTO v_n FROM public.get_match_chat_adoption(current_date - 30, current_date);
    SELECT count(*) INTO v_n FROM public.get_message_volume(current_date - 30, current_date);
    ASSERT v_n >= 0, 'analytics: admin works';

    -- ── 5. Admin alerts: non-admin refused, impersonation refused, admin works
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_admin_alerts(v_p1, 10, false); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'get_admin_alerts: non-admin refused';
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_alert_counts(v_p1); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'get_alert_counts: non-admin refused';
    v_raised := false;
    BEGIN PERFORM public.mark_alert_read(gen_random_uuid(), v_p1); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'mark_alert_read: non-admin refused';
    v_raised := false;
    BEGIN PERFORM public.mark_all_alerts_read(v_p1); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'mark_all_alerts_read: non-admin refused';
    v_raised := false;
    BEGIN PERFORM public.dismiss_alert(gen_random_uuid(), v_p1); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'dismiss_alert: non-admin refused';
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_admin_audit_log(10, 0, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'get_admin_audit_log: non-admin refused';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p3::text)::text, true);
    v_raised := false;
    BEGIN SELECT count(*) INTO v_n FROM public.get_admin_alerts(v_p1, 10, false); EXCEPTION WHEN insufficient_privilege THEN v_raised := true; END;
    ASSERT v_raised, 'get_admin_alerts: admin impersonating another id refused';
    SELECT count(*) INTO v_n FROM public.get_admin_alerts(v_p3, 10, false);
    SELECT count(*) INTO v_n FROM public.get_alert_counts(v_p3);
    PERFORM public.mark_alert_read(gen_random_uuid(), v_p3);
    PERFORM public.mark_all_alerts_read(v_p3);
    PERFORM public.dismiss_alert(gen_random_uuid(), v_p3);
    SELECT count(*) INTO v_n FROM public.get_admin_audit_log(10, 0, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz);
    ASSERT v_n >= 0, 'admin alerts + audit log: admin works';

    RAISE NOTICE 'PASS: chat + admin RPCs only act for the calling user / admin';
END $$;

ROLLBACK;

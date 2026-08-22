-- ============================================
-- Conversation-list RPCs — caller guard test
-- ============================================
-- get_player_conversations_optimized / get_player_conversations_filtered /
-- get_unread_conversations_count are SECURITY DEFINER and take p_player_id.
-- Asserts: anon cannot execute, search_path is pinned, the caller's own id
-- works on every filter / search / sport branch, and another player's id or
-- a missing JWT raises 42501.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/conversation_rpcs_caller_guard_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p1 uuid;
    v_p2 uuid;
    v_sport uuid;
    v_fn text;
    v_filter text;
    v_cfg text[];
    v_n int;
    v_raised boolean;
BEGIN
    SELECT id INTO v_p1 FROM player WHERE NOT public.is_admin(id) ORDER BY id LIMIT 1;
    SELECT id INTO v_p2 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 1 LIMIT 1;
    ASSERT v_p1 IS NOT NULL AND v_p2 IS NOT NULL, 'need two seeded non-admin players';
    BEGIN
        EXECUTE 'SELECT id FROM sport ORDER BY id LIMIT 1' INTO v_sport;
    EXCEPTION WHEN undefined_table THEN
        v_sport := NULL;
    END;

    -- ── 0. Definition hardening ──────────────────────────────────────────────
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_player_conversations_optimized(uuid,uuid)',
        'public.get_player_conversations_filtered(uuid,text,text,int,int,uuid)',
        'public.get_unread_conversations_count(uuid)'
    ] LOOP
        ASSERT NOT has_function_privilege('anon', v_fn, 'EXECUTE'), v_fn || ': anon cannot execute';
        ASSERT has_function_privilege('authenticated', v_fn, 'EXECUTE'), v_fn || ': authenticated can execute';
        SELECT proconfig INTO v_cfg FROM pg_proc WHERE oid = v_fn::regprocedure;
        ASSERT v_cfg @> ARRAY['search_path=public'], v_fn || ': search_path pinned to public';
    END LOOP;

    -- ── 1. Own id works on every branch ──────────────────────────────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);

    SELECT count(*) INTO v_n FROM public.get_player_conversations_optimized(v_p1, NULL::uuid);
    ASSERT v_n >= 0, 'optimized: own id';
    IF v_sport IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.get_player_conversations_optimized(v_p1, v_sport);
    END IF;

    FOREACH v_filter IN ARRAY ARRAY['all', 'unread', 'direct', 'group_chat', 'community', 'match', 'tournament'] LOOP
        SELECT count(*) INTO v_n
        FROM public.get_player_conversations_filtered(v_p1, v_filter, '', 20, 0, NULL::uuid);
        ASSERT v_n >= 0, 'filtered: own id, filter ' || v_filter;
    END LOOP;
    SELECT count(*) INTO v_n
    FROM public.get_player_conversations_filtered(v_p1, 'all', 'a', 20, 0, v_sport);
    ASSERT v_n >= 0, 'filtered: own id, search + sport';

    v_n := public.get_unread_conversations_count(v_p1);
    ASSERT v_n >= 0, 'unread count: own id';

    -- ── 2. Another player's id raises 42501 ──────────────────────────────────
    v_raised := false;
    BEGIN
        SELECT count(*) INTO v_n FROM public.get_player_conversations_optimized(v_p2, NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'optimized: other player refused';

    v_raised := false;
    BEGIN
        SELECT count(*) INTO v_n FROM public.get_player_conversations_filtered(v_p2, 'all', '', 20, 0, NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'filtered: other player refused';

    v_raised := false;
    BEGIN
        v_n := public.get_unread_conversations_count(v_p2);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'unread count: other player refused';

    -- ── 3. No JWT at all raises too ──────────────────────────────────────────
    PERFORM set_config('request.jwt.claims', '', true);

    v_raised := false;
    BEGIN
        SELECT count(*) INTO v_n FROM public.get_player_conversations_optimized(v_p1, NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'optimized: no JWT refused';

    v_raised := false;
    BEGIN
        SELECT count(*) INTO v_n FROM public.get_player_conversations_filtered(v_p1, 'all', '', 20, 0, NULL::uuid);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'filtered: no JWT refused';

    v_raised := false;
    BEGIN
        v_n := public.get_unread_conversations_count(v_p1);
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    ASSERT v_raised, 'unread count: no JWT refused';

    RAISE NOTICE 'PASS: conversation-list RPCs only answer for the calling user (sport fixture: %)', v_sport IS NOT NULL;
END $$;

ROLLBACK;

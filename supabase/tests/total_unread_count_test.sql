-- ============================================
-- get_total_unread_count — chat tab badge test
-- ============================================
-- Asserts the RPC equals SUM(unread_count) of get_player_conversations_optimized
-- over non-archived conversations: own and soft-deleted messages don't count,
-- mark_messages_as_read zeroes a conversation, a later message counts again,
-- archiving hides a conversation, and a caller only ever gets their own count.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/total_unread_count_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p1 uuid;
    v_p2 uuid;
    v_base1 int;
    v_base2 int;
    v_conv1 uuid;
    v_conv2 uuid;
    v_count int;
    v_list_sum int;
BEGIN
    SELECT id INTO v_p1 FROM player WHERE NOT public.is_admin(id) ORDER BY id LIMIT 1;
    SELECT id INTO v_p2 FROM player WHERE NOT public.is_admin(id) ORDER BY id OFFSET 1 LIMIT 1;
    ASSERT v_p1 IS NOT NULL AND v_p2 IS NOT NULL, 'need two seeded non-admin players';

    -- ── 0. Grants ────────────────────────────────────────────────────────────
    ASSERT has_function_privilege('authenticated', 'public.get_total_unread_count(uuid)', 'EXECUTE'),
        'authenticated can execute';
    ASSERT NOT has_function_privilege('anon', 'public.get_total_unread_count(uuid)', 'EXECUTE'),
        'anon cannot execute';

    -- ── 1. Baselines (seeded data) mirror the list RPC ───────────────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    v_base2 := public.get_total_unread_count(v_p2);
    SELECT COALESCE(SUM(unread_count), 0)::int INTO v_list_sum
    FROM public.get_player_conversations_optimized(v_p2, NULL::uuid) WHERE NOT is_archived;
    ASSERT v_base2 = v_list_sum, format('p2 baseline mirrors list RPC (%s vs %s)', v_base2, v_list_sum);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    v_base1 := public.get_total_unread_count(v_p1);
    SELECT COALESCE(SUM(unread_count), 0)::int INTO v_list_sum
    FROM public.get_player_conversations_optimized(v_p1, NULL::uuid) WHERE NOT is_archived;
    ASSERT v_base1 = v_list_sum, format('baseline mirrors list RPC (%s vs %s)', v_base1, v_list_sum);

    -- ── 2. Fixtures: two direct conversations between p1 and p2 ──────────────
    INSERT INTO conversation (conversation_type, created_by) VALUES ('direct', v_p1) RETURNING id INTO v_conv1;
    INSERT INTO conversation (conversation_type, created_by) VALUES ('direct', v_p2) RETURNING id INTO v_conv2;
    INSERT INTO conversation_participant (conversation_id, player_id)
    VALUES (v_conv1, v_p1), (v_conv1, v_p2), (v_conv2, v_p1), (v_conv2, v_p2);

    -- 3 unread from p2 in conv1, 2 in conv2; p1's own message and a soft-deleted one don't count
    INSERT INTO message (conversation_id, sender_id, content) VALUES
      (v_conv1, v_p2, 'c1 m1'), (v_conv1, v_p2, 'c1 m2'), (v_conv1, v_p2, 'c1 m3'),
      (v_conv2, v_p2, 'c2 m1'), (v_conv2, v_p2, 'c2 m2'),
      (v_conv1, v_p1, 'own message');
    INSERT INTO message (conversation_id, sender_id, content, deleted_at)
    VALUES (v_conv2, v_p2, 'soft deleted', now());

    v_count := public.get_total_unread_count(v_p1);
    ASSERT v_count = v_base1 + 5, format('5 unread across two conversations (got %s, base %s)', v_count, v_base1);
    SELECT COALESCE(SUM(unread_count), 0)::int INTO v_list_sum
    FROM public.get_player_conversations_optimized(v_p1, NULL::uuid) WHERE NOT is_archived;
    ASSERT v_count = v_list_sum, format('mirrors list RPC after fixtures (%s vs %s)', v_count, v_list_sum);

    -- ── 3. Reading conv1 drops its 3 ─────────────────────────────────────────
    PERFORM public.mark_messages_as_read(v_conv1, v_p1);
    v_count := public.get_total_unread_count(v_p1);
    ASSERT v_count = v_base1 + 2, format('conv1 read: 2 left (got %s, base %s)', v_count, v_base1);

    -- ── 4. A message after the read counts again ─────────────────────────────
    INSERT INTO message (conversation_id, sender_id, content, created_at)
    VALUES (v_conv1, v_p2, 'after read', clock_timestamp());
    v_count := public.get_total_unread_count(v_p1);
    ASSERT v_count = v_base1 + 3, format('post-read message counts (got %s, base %s)', v_count, v_base1);

    -- ── 5. Archiving conv2 hides its 2, still mirrors the list RPC ───────────
    UPDATE conversation_participant SET is_archived = true
    WHERE conversation_id = v_conv2 AND player_id = v_p1;
    v_count := public.get_total_unread_count(v_p1);
    ASSERT v_count = v_base1 + 1, format('archived conv excluded (got %s, base %s)', v_count, v_base1);
    SELECT COALESCE(SUM(unread_count), 0)::int INTO v_list_sum
    FROM public.get_player_conversations_optimized(v_p1, NULL::uuid) WHERE NOT is_archived;
    ASSERT v_count = v_list_sum, format('mirrors list RPC after archive (%s vs %s)', v_count, v_list_sum);

    -- ── 6. Only your own count ───────────────────────────────────────────────
    ASSERT public.get_total_unread_count(v_p2) = 0, 'another player''s count is not exposed';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p2::text)::text, true);
    v_count := public.get_total_unread_count(v_p2);
    ASSERT v_count = v_base2 + 1, format('p2 sees p1''s one message (got %s, base %s)', v_count, v_base2);
    ASSERT public.get_total_unread_count(v_p1) = 0, 'p2 cannot read p1''s count';

    RAISE NOTICE 'PASS: get_total_unread_count mirrors the list RPC (base p1=%, p2=%)', v_base1, v_base2;
END $$;

ROLLBACK;

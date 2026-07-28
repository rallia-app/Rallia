-- ============================================
-- Global announcement — deferred fan-out test
-- ============================================
-- Asserts post_global_announcement no longer fans out notifications inside
-- the request transaction: it enqueues one announcement_fanout_job, and
-- process_announcement_fanout() drains it in keyset batches with the same
-- recipient filters and notification shape as before. Also asserts regular
-- (non-announcement) messages still notify synchronously and enqueue nothing.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/announcement_fanout_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    c_channel constant uuid := 'a11a0002-0000-4000-8000-000000000001';
    c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
    v_admin uuid;
    v_content text;
    v_message_id uuid;
    v_job announcement_fanout_job;
    v_expected int;
    v_before int;
    v_after int;
    v_batch int;
    v_total int := 0;
    v_runs int := 0;
    v_notif notification;
    v_conv uuid;
    v_sender uuid;
BEGIN
    SELECT id INTO v_admin FROM admin LIMIT 1;
    ASSERT v_admin IS NOT NULL, 'need a seeded admin';

    -- >178 chars so the push preview truncation path is exercised too.
    v_content := 'Fanout test ' || repeat('x', 200);

    SELECT count(*) INTO v_before FROM notification WHERE target_id = c_channel;

    -- ── 1. Posting enqueues a job instead of fanning out ─────────────────────
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
    SELECT post_global_announcement(v_content) INTO v_message_id;
    ASSERT v_message_id IS NOT NULL, 'RPC should return the message id';

    SELECT count(*) INTO v_after FROM notification WHERE target_id = c_channel;
    ASSERT v_after = v_before, 'no notifications inside the posting transaction';

    SELECT * INTO v_job FROM announcement_fanout_job WHERE message_id = v_message_id;
    ASSERT v_job.status = 'pending', 'one pending job enqueued';
    ASSERT v_job.conversation_id = c_channel AND v_job.sender_id = c_system_sender,
        'job carries channel + system sender';

    -- ── 2. The worker drains it in batches ───────────────────────────────────
    SELECT count(*) INTO v_expected
    FROM conversation_participant cp
    LEFT JOIN active_conversation ac ON ac.player_id = cp.player_id
    WHERE cp.conversation_id = c_channel
      AND cp.player_id != c_system_sender
      AND cp.is_muted = false
      AND (ac.player_id IS NULL
           OR ac.conversation_id IS DISTINCT FROM c_channel
           OR ac.active_at <= now() - interval '60 seconds');
    ASSERT v_expected > 20, 'seed should give a multi-batch fan-out';

    WHILE v_runs < 100 LOOP
        v_runs := v_runs + 1;
        SELECT process_announcement_fanout(10) INTO v_batch;
        v_total := v_total + v_batch;
        SELECT * INTO v_job FROM announcement_fanout_job WHERE message_id = v_message_id;
        EXIT WHEN v_job.status <> 'pending';
    END LOOP;

    ASSERT v_job.status = 'done', format('job done, got %s (%s)', v_job.status, v_job.last_error);
    ASSERT v_total = v_expected, format('notified %s of %s expected', v_total, v_expected);
    ASSERT v_job.notified_count = v_expected, 'job counter matches';
    ASSERT v_runs = ceil(v_expected / 10.0) + CASE WHEN v_expected % 10 = 0 THEN 1 ELSE 0 END,
        format('batches of 10: %s runs for %s recipients', v_runs, v_expected);

    SELECT count(*) INTO v_after FROM notification WHERE target_id = c_channel;
    ASSERT v_after = v_before + v_expected, 'every recipient notified exactly once';

    -- Shape: title, truncated preview, read_at stamped (push-only semantics).
    SELECT n.* INTO v_notif FROM notification n
    WHERE n.target_id = c_channel AND n.created_at >= v_job.created_at
    ORDER BY n.created_at DESC LIMIT 1;
    ASSERT v_notif.title = '📣 Rallia', 'announcement push title';
    ASSERT v_notif.body = rtrim(left(v_content, 178), E' \t\n\r') || '…', 'preview truncated at 178';
    ASSERT v_notif.read_at IS NOT NULL, 'announcement notifications are pre-read';
    ASSERT (v_notif.payload->>'conversationId')::uuid = c_channel, 'payload conversationId';

    -- Idle worker is a no-op.
    SELECT process_announcement_fanout(10) INTO v_batch;
    ASSERT v_batch = 0, 'empty queue returns 0';

    -- Players cannot invoke the worker directly.
    ASSERT NOT has_function_privilege('authenticated', 'public.process_announcement_fanout(int)', 'EXECUTE'),
        'authenticated cannot execute the worker';

    -- ── 3. Regular messages still fan out synchronously ──────────────────────
    SELECT c.id INTO v_conv
    FROM conversation c
    JOIN conversation_participant cp ON cp.conversation_id = c.id
    WHERE c.conversation_type <> 'announcement'
    GROUP BY c.id HAVING count(*) >= 2 LIMIT 1;
    ASSERT v_conv IS NOT NULL, 'need a seeded non-announcement conversation';

    SELECT cp.player_id INTO v_sender
    FROM conversation_participant cp WHERE cp.conversation_id = v_conv LIMIT 1;

    SELECT count(*) INTO v_before FROM notification WHERE target_id = v_conv;
    INSERT INTO message (conversation_id, sender_id, content, message_type)
    VALUES (v_conv, v_sender, 'regular message fan-out check', 'text');

    SELECT count(*) INTO v_after FROM notification WHERE target_id = v_conv;
    ASSERT v_after > v_before, 'regular messages notify in-transaction';
    ASSERT NOT EXISTS (SELECT 1 FROM announcement_fanout_job WHERE conversation_id = v_conv),
        'regular messages never enqueue fan-out jobs';

    RAISE NOTICE 'PASS: announcement fan-out deferred (% recipients in % batches), regular messages unchanged',
        v_expected, v_runs;
END $$;

ROLLBACK;

-- ============================================
-- Pending invite reminder
-- ============================================
-- Covers 20260831200000_pending_invite_reminder.
--
-- A pending invitee used to receive exactly one notification ever: in August
-- 2026, 755 match_invitation pushes and 1 match_updated between all of them.
-- 61% of invites were never answered, while the people who did answer took a
-- median of 36 minutes. send_pending_invite_reminders adds one nudge when the
-- game is 2-6 hours out.
--
-- Asserts it fires once, dedups on payload.isReminder, and leaves invites that
-- are outside the window or already resolved alone.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/pending_invite_reminder_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_sport   uuid;
    v_host    uuid;
    v_invitee uuid;
    v_far     uuid;
    v_match   uuid := gen_random_uuid();
    v_match2  uuid := gen_random_uuid();
    v_target  timestamp;
    v_sent    int;
    v_again   int;
    v_payload jsonb;
    v_prio    text;
BEGIN
    SELECT id INTO v_sport FROM sport ORDER BY id LIMIT 1;
    SELECT id INTO v_host    FROM player ORDER BY id LIMIT 1;
    SELECT id INTO v_invitee FROM player WHERE id <> v_host ORDER BY id LIMIT 1;
    SELECT id INTO v_far     FROM player WHERE id NOT IN (v_host, v_invitee) ORDER BY id LIMIT 1;
    ASSERT v_far IS NOT NULL, 'need three seeded players';

    -- A game 4 hours out, inside the 2-6 hour window.
    v_target := (now() AT TIME ZONE 'America/Toronto') + interval '4 hours';

    INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by,
                       visibility, timezone, facility_id)
    VALUES (v_match, v_sport, v_target::date, v_target::time, (v_target + interval '1 hour')::time,
            v_host, 'public', 'America/Toronto', NULL);

    -- A second game 20 hours out, outside the window, as the control.
    INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by,
                       visibility, timezone, facility_id)
    VALUES (v_match2, v_sport,
            ((now() AT TIME ZONE 'America/Toronto') + interval '20 hours')::date,
            ((now() AT TIME ZONE 'America/Toronto') + interval '20 hours')::time,
            ((now() AT TIME ZONE 'America/Toronto') + interval '21 hours')::time,
            v_host, 'public', 'America/Toronto', NULL);

    INSERT INTO match_participant (match_id, player_id, status, is_host)
    VALUES (v_match,  v_invitee, 'pending', false),
           (v_match2, v_far,     'pending', false);

    -- The guard skips invites younger than an hour, so backdate both.
    UPDATE match_participant
       SET created_at = now() - interval '3 hours'
     WHERE match_id IN (v_match, v_match2);

    SELECT public.send_pending_invite_reminders() INTO v_sent;
    ASSERT v_sent = 1,
      format('exactly the in-window invite should be reminded, got %s', v_sent);

    SELECT n.payload, n.priority::text INTO v_payload, v_prio
      FROM notification n
     WHERE n.target_id = v_match
       AND n.user_id = v_invitee
       AND n.payload->>'isReminder' = 'true';

    ASSERT v_payload IS NOT NULL, 'reminder must be flagged payload.isReminder';
    ASSERT v_prio = 'high',
      format('a reminder 2-6 hours out must be high priority, got %s', v_prio);

    ASSERT NOT EXISTS (
        SELECT 1 FROM notification n
         WHERE n.target_id = v_match2 AND n.user_id = v_far
           AND n.payload->>'isReminder' = 'true'
    ), 'an invite 20 hours out is outside the window and must not be reminded';

    RAISE NOTICE 'ok 1 - reminds only the in-window pending invite';

    -- Dedup: a second sweep in the same window must not send again.
    SELECT public.send_pending_invite_reminders() INTO v_again;
    ASSERT v_again = 0,
      format('one reminder ever per invite, second sweep sent %s', v_again);
    RAISE NOTICE 'ok 2 - dedups on a second sweep';

    -- Resolving the invite clears both the invite and its reminder, via
    -- clear_stale_match_invitation_notification (20260625130000).
    UPDATE match_participant SET status = 'joined'
     WHERE match_id = v_match AND player_id = v_invitee;

    ASSERT NOT EXISTS (
        SELECT 1 FROM notification n
         WHERE n.type = 'match_invitation'
           AND n.target_id = v_match AND n.user_id = v_invitee
    ), 'accepting the invite must clear the reminder too';
    RAISE NOTICE 'ok 3 - accepting clears the reminder';
END $$;

ROLLBACK;

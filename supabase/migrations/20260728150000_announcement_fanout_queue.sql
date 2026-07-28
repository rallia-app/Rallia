-- =============================================================================
-- Move the global-announcement notification fan-out off the request transaction
--
-- 2026-07-25 incident: post_global_announcement runs as `authenticated`
-- (8s statement_timeout) and notify_new_message fanned out ~718 notification
-- rows synchronously — each firing a vault read + net.http_post via
-- on_notification_insert. Idle cost ~1.4s; under the load wave the FIRST
-- broadcast itself creates (~109 concurrent users within a minute on a
-- 60-connection instance), a second broadcast sent minutes later times out
-- and the whole transaction rolls back with no trace.
--
-- Fix: for announcement conversations, notify_new_message now enqueues ONE
-- job row instead of inserting notifications. A pg_cron worker drains jobs
-- in keyset batches every 30s, which both frees the request path (RPC
-- returns in ms) and spreads the push wave — smoothing the very stampede
-- that killed the second send. Non-announcement messages are unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The queue
-- -----------------------------------------------------------------------------

CREATE TABLE public.announcement_fanout_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES public.message(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
  -- Keyset cursor: participants are processed in player_id order, batch by batch.
  last_player_id uuid,
  notified_count int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_announcement_fanout_job_pending
  ON public.announcement_fanout_job (created_at)
  WHERE status = 'pending';

-- Internal table: no API access. RLS on with no policies blocks everything
-- even if grants drift; service_role keeps access for ops/debug.
ALTER TABLE public.announcement_fanout_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_fanout_job FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_fanout_job TO service_role;

COMMENT ON TABLE public.announcement_fanout_job IS
  'One row per announcement message awaiting notification fan-out. Drained in batches by process_announcement_fanout() (pg_cron), so the admin RPC does not pay for ~700 notification inserts inside its own transaction.';

-- -----------------------------------------------------------------------------
-- 2. notify_new_message: enqueue-and-return for announcements
--
-- Identical to 20260724230000 except the announcement branch, which now
-- writes one job row instead of the full notification fan-out.
-- -----------------------------------------------------------------------------

create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
  v_is_announcement boolean;
  v_max_len     constant int := 178;
begin
  select c.conversation_type = 'announcement'
    into v_is_announcement
    from conversation c where c.id = NEW.conversation_id;

  -- Announcements fan out to every player; defer to the cron worker.
  if v_is_announcement then
    insert into announcement_fanout_job (message_id, conversation_id, sender_id)
    values (NEW.id, NEW.conversation_id, NEW.sender_id)
    on conflict (message_id) do nothing;
    return NEW;
  end if;

  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  v_preview := CASE
    WHEN char_length(NEW.content) > v_max_len
      THEN rtrim(left(NEW.content, v_max_len), E' \t\n\r') || '…'
    ELSE NEW.content
  END;

  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    CASE
      WHEN public.lt_user_is_fr(cp.player_id)
        THEN 'Message de ' || v_sender_name
      ELSE 'Message from ' || v_sender_name
    END,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview,
      'messageType', NEW.message_type,
      'facilityName', NEW.metadata->>'facility_name',
      'courtLabel', NEW.metadata->>'court_label'
    ),
    'normal'::notification_priority_enum,
    now()
  from conversation_participant cp
  left join active_conversation ac on ac.player_id = cp.player_id
  where cp.conversation_id = NEW.conversation_id
    and cp.player_id != NEW.sender_id
    and cp.player_id is distinct from (NEW.metadata->>'suppress_notification_for')::uuid
    and cp.is_muted = false
    and (
      ac.player_id is null
      or ac.conversation_id is distinct from NEW.conversation_id
      or ac.active_at <= now() - interval '60 seconds'
    );

  return NEW;
end;
$$ language plpgsql security definer;

-- -----------------------------------------------------------------------------
-- 3. The worker
--
-- Drains ONE job per invocation, one keyset batch at a time. Recipient
-- filters and notification shape mirror the old announcement branch of
-- notify_new_message exactly (sender/suppressed/muted excluded, actively
-- viewing within 60s excluded, title '📣 Rallia', read_at stamped). Each
-- notification insert still fires on_notification_insert → push dispatch;
-- pg_net queues those asynchronously.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_announcement_fanout(p_batch_size int DEFAULT 250)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_attempts constant int := 5;
  v_max_len constant int := 178;
  v_job announcement_fanout_job;
  v_message message;
  v_sender_name text;
  v_preview text;
  v_players uuid[];
  v_batch int;
BEGIN
  -- One drainer at a time; skip silently if another run holds the lock.
  IF NOT pg_try_advisory_xact_lock(hashtext('announcement_fanout')) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_job
  FROM announcement_fanout_job
  WHERE status = 'pending'
  ORDER BY created_at
  LIMIT 1;

  IF v_job.id IS NULL THEN
    RETURN 0;
  END IF;

  BEGIN
    SELECT * INTO v_message FROM message WHERE id = v_job.message_id;
    IF v_message.id IS NULL THEN
      UPDATE announcement_fanout_job
      SET status = 'error', last_error = 'message no longer exists', processed_at = now()
      WHERE id = v_job.id;
      RETURN 0;
    END IF;

    SELECT coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Rallia')
      INTO v_sender_name
      FROM profile p WHERE p.id = v_job.sender_id;

    v_preview := CASE
      WHEN char_length(v_message.content) > v_max_len
        THEN rtrim(left(v_message.content, v_max_len), E' \t\n\r') || '…'
      ELSE v_message.content
    END;

    SELECT array_agg(player_id ORDER BY player_id) INTO v_players
    FROM (
      SELECT cp.player_id
      FROM conversation_participant cp
      LEFT JOIN active_conversation ac ON ac.player_id = cp.player_id
      WHERE cp.conversation_id = v_job.conversation_id
        AND cp.player_id != v_job.sender_id
        AND cp.player_id IS DISTINCT FROM (v_message.metadata->>'suppress_notification_for')::uuid
        AND cp.is_muted = false
        AND (v_job.last_player_id IS NULL OR cp.player_id > v_job.last_player_id)
        AND (
          ac.player_id IS NULL
          OR ac.conversation_id IS DISTINCT FROM v_job.conversation_id
          OR ac.active_at <= now() - interval '60 seconds'
        )
      ORDER BY cp.player_id
      LIMIT p_batch_size
    ) batch;

    v_batch := coalesce(cardinality(v_players), 0);

    IF v_batch > 0 THEN
      INSERT INTO notification (user_id, type, target_id, title, body, payload, priority, read_at)
      SELECT
        u.player_id,
        'new_message'::notification_type_enum,
        v_job.conversation_id,
        '📣 Rallia',
        v_preview,
        jsonb_build_object(
          'conversationId', v_job.conversation_id,
          'senderName', v_sender_name,
          'messagePreview', v_preview,
          'messageType', v_message.message_type,
          'facilityName', v_message.metadata->>'facility_name',
          'courtLabel', v_message.metadata->>'court_label'
        ),
        'normal'::notification_priority_enum,
        now()
      FROM unnest(v_players) AS u(player_id);
    END IF;

    UPDATE announcement_fanout_job
    SET notified_count = notified_count + v_batch,
        last_player_id = CASE WHEN v_batch > 0 THEN v_players[v_batch] ELSE last_player_id END,
        -- A short batch means the participant list is exhausted.
        status = CASE WHEN v_batch < p_batch_size THEN 'done' ELSE status END,
        processed_at = CASE WHEN v_batch < p_batch_size THEN now() ELSE processed_at END
    WHERE id = v_job.id;

    RETURN v_batch;
  EXCEPTION WHEN OTHERS THEN
    -- The failed batch rolled back to the block entry; record the failure so
    -- a poisoned job can't wedge the queue forever.
    UPDATE announcement_fanout_job
    SET attempts = attempts + 1,
        last_error = SQLERRM,
        status = CASE WHEN attempts + 1 >= c_max_attempts THEN 'error' ELSE status END,
        processed_at = CASE WHEN attempts + 1 >= c_max_attempts THEN now() ELSE processed_at END
    WHERE id = v_job.id;
    RETURN 0;
  END;
END;
$$;

-- Worker is for cron (runs as postgres) and ops via service_role only.
REVOKE EXECUTE ON FUNCTION public.process_announcement_fanout(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_announcement_fanout(int) TO service_role;

COMMENT ON FUNCTION public.process_announcement_fanout IS
  'Drains one pending announcement_fanout_job in keyset batches (default 250 recipients per run). Scheduled every 30s via pg_cron; a full ~700-player fan-out completes in ~90s while spreading the push-notification load wave.';

-- -----------------------------------------------------------------------------
-- 4. Schedule the worker (pg_cron 1.6 supports second-granularity schedules)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('process-announcement-fanout');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job did not exist yet
END $$;

SELECT cron.schedule(
  'process-announcement-fanout',
  '30 seconds',
  $$ SELECT public.process_announcement_fanout(); $$
);

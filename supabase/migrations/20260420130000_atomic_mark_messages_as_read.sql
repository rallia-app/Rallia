-- Migration: Atomic mark_messages_as_read + conversation_participant realtime
-- Fixes: stale unread chat count caused by a race between the message UPDATE
--        realtime event and the second (non-atomic) UPDATE of last_read_at,
--        and propagates read state across devices.

-- =============================================================================
-- 1. Make mark_messages_as_read atomic (one transaction, both writes)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_conversation_id uuid,
  p_reader_id uuid
)
RETURNS void AS $$
DECLARE
  v_last_read_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
      AND player_id = p_reader_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  SELECT last_read_at INTO v_last_read_at
  FROM public.conversation_participant
  WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id;

  UPDATE public.message
  SET status = 'read'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_reader_id
    AND status IN ('sent', 'delivered')
    AND (v_last_read_at IS NULL OR created_at > v_last_read_at);

  UPDATE public.conversation_participant
  SET last_read_at = NOW()
  WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Publish conversation_participant so other devices see read state changes
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_participant'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participant;
  END IF;
END $$;

ALTER TABLE public.conversation_participant REPLICA IDENTITY FULL;

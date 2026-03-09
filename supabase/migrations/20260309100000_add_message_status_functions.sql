-- Migration: Add functions for updating message delivery status
-- Description: Creates SECURITY DEFINER functions to update message status
-- (bypasses RLS that only allows sender to update their own messages)

-- Function to mark messages as 'read' for a conversation participant
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_conversation_id uuid,
  p_reader_id uuid
)
RETURNS void AS $$
BEGIN
  -- Verify the reader is a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
    AND player_id = p_reader_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Update messages to 'read' where:
  -- 1. Message is in the specified conversation
  -- 2. Message was sent by someone other than the reader
  -- 3. Message is not already 'read' or 'failed'
  UPDATE public.message
  SET status = 'read'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_reader_id
    AND status IN ('sent', 'delivered');
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark messages as 'delivered' for a conversation participant
CREATE OR REPLACE FUNCTION public.mark_messages_as_delivered(
  p_conversation_id uuid,
  p_recipient_id uuid
)
RETURNS void AS $$
BEGIN
  -- Verify the recipient is a participant in this conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participant
    WHERE conversation_id = p_conversation_id
    AND player_id = p_recipient_id
  ) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Update messages to 'delivered' where:
  -- 1. Message is in the specified conversation
  -- 2. Message was sent by someone other than the recipient
  -- 3. Message is still 'sent' (not yet delivered or read)
  UPDATE public.message
  SET status = 'delivered'
  WHERE conversation_id = p_conversation_id
    AND sender_id != p_recipient_id
    AND status = 'sent';
    
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark a single message as 'delivered'
CREATE OR REPLACE FUNCTION public.mark_message_as_delivered(
  p_message_id uuid
)
RETURNS void AS $$
BEGIN
  -- Update the message to 'delivered' if it's still 'sent'
  UPDATE public.message
  SET status = 'delivered'
  WHERE id = p_message_id
    AND status = 'sent';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_delivered(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_as_delivered(uuid) TO authenticated;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Message status functions created successfully';
END $$;

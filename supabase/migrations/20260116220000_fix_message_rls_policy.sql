-- Migration: Fix message RLS policy for group chats
-- Description: Updates the message insert policy to properly check conversation participation

-- Drop the existing policy
DROP POLICY IF EXISTS "Participants can send messages" ON public.message;

-- Create a more permissive insert policy
-- The sender_id must match the auth user AND the user must be a participant
CREATE POLICY "Participants can send messages"
    ON public.message FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND EXISTS (
            SELECT 1 FROM public.conversation_participant cp
            WHERE cp.conversation_id = message.conversation_id
            AND cp.player_id = auth.uid()
        )
    );

-- Also add an update policy for message status updates
DROP POLICY IF EXISTS "Senders can update own messages" ON public.message;
CREATE POLICY "Senders can update own messages"
    ON public.message FOR UPDATE
    USING (auth.uid() = sender_id);

-- Add delete policy for own messages
DROP POLICY IF EXISTS "Senders can delete own messages" ON public.message;
CREATE POLICY "Senders can delete own messages"
    ON public.message FOR DELETE
    USING (auth.uid() = sender_id);

-- Debug: Also create a function to check conversation participant status
CREATE OR REPLACE FUNCTION debug_check_conversation_participant(
  p_conversation_id UUID,
  p_player_id UUID
)
RETURNS TABLE (
  is_participant BOOLEAN,
  participant_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    EXISTS (
      SELECT 1 FROM conversation_participant cp
      WHERE cp.conversation_id = p_conversation_id
      AND cp.player_id = p_player_id
    ) as is_participant,
    (SELECT COUNT(*) FROM conversation_participant WHERE conversation_id = p_conversation_id) as participant_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure existing group members have conversation_participant entries
-- This fixes any groups where members weren't added to the conversation
-- Only run if conversation_id column exists on network table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'network' 
    AND column_name = 'conversation_id'
  ) THEN
    EXECUTE $sync$
      INSERT INTO public.conversation_participant (conversation_id, player_id)
      SELECT n.conversation_id, nm.player_id
      FROM public.network n
      JOIN public.network_member nm ON nm.network_id = n.id
      WHERE n.conversation_id IS NOT NULL
        AND nm.status = 'active'
      ON CONFLICT DO NOTHING;
    $sync$;
    RAISE NOTICE 'Synced conversation participants from network members';
  ELSE
    RAISE NOTICE 'network.conversation_id does not exist yet - skipping participant sync';
  END IF;
END $$;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Message RLS policies updated and conversation participants synced';
END $$;

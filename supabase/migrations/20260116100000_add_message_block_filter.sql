-- Migration: Add message filtering for blocked users
-- Description: Updates RLS policy so blocked users' messages don't appear to the blocker
-- The blocked user can still send messages, but they won't be visible to the person who blocked them

-- Drop existing message SELECT policy if it exists
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON message;

-- Create new policy that filters out messages from blocked users
-- Only create if it doesn't already exist (may have been created by earlier migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'message' 
    AND policyname LIKE 'Users can view messages in their conversations (with block filt%'
  ) THEN
    -- A user can view a message if:
    -- 1. They are a participant in the conversation
    -- 2. The message sender is NOT blocked by them
    EXECUTE $policy$
    CREATE POLICY "Users can view messages in their conversations (with block filter)"
      ON message
      FOR SELECT
      USING (
        -- User must be a participant in the conversation
        EXISTS (
          SELECT 1 FROM conversation_participant cp
          WHERE cp.conversation_id = message.conversation_id
          AND cp.player_id = auth.uid()
        )
        -- AND the sender must NOT be blocked by the current user
        AND NOT EXISTS (
          SELECT 1 FROM player_block pb
          WHERE pb.player_id = auth.uid()
          AND pb.blocked_player_id = message.sender_id
        )
      );
    $policy$;
  ELSE
    RAISE NOTICE 'Message block filter policy already exists - skipping';
  END IF;
END $$;

-- Note: The blocked user can still INSERT messages (existing INSERT policy remains unchanged)
-- Their messages simply won't be visible to the user who blocked them

-- Add comment explaining the policy
COMMENT ON POLICY "Users can view messages in their conversations (with block filter)" ON message IS 
  'Allows users to view messages in conversations they participate in, but filters out messages from users they have blocked. This ensures blocked users cannot communicate with the blocker while allowing them to continue using the app normally (unaware they are blocked).';

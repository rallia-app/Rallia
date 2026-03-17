-- Migration: Enable Realtime for Chat Tables
-- Description: Adds message, conversation, and message_reaction tables to
--              supabase_realtime publication so clients receive postgres_changes events.

-- message: needed for live messages inside a conversation (subscribeToMessages)
ALTER PUBLICATION supabase_realtime ADD TABLE public.message;

-- conversation: needed for inbox updates when a new message updates conversation.updated_at
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation;

-- message_reaction: needed for live reaction updates (subscribeToReactions)
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reaction;

-- Set replica identity to FULL so UPDATE and DELETE events include all columns
-- (required for realtime to deliver the full row payload, not just the PK)
ALTER TABLE public.message REPLICA IDENTITY FULL;
ALTER TABLE public.conversation REPLICA IDENTITY FULL;
ALTER TABLE public.message_reaction REPLICA IDENTITY FULL;

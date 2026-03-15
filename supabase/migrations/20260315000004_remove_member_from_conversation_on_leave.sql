-- Migration: Remove member from conversation when they leave a network (group/community)
-- When network_member.status changes to 'removed', delete the corresponding conversation_participant

-- =============================================================================
-- FUNCTION: Remove network member from conversation
-- =============================================================================
CREATE OR REPLACE FUNCTION remove_network_member_from_conversation()
RETURNS TRIGGER AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Only act when status changes TO 'removed' (leaving)
  IF NEW.status = 'removed' AND (OLD.status IS NULL OR OLD.status != 'removed') THEN
    -- Get the network's conversation_id
    SELECT conversation_id INTO v_conversation_id
    FROM public.network
    WHERE id = NEW.network_id;
    
    -- If network has a conversation, remove the member as a participant
    IF v_conversation_id IS NOT NULL THEN
      DELETE FROM public.conversation_participant
      WHERE conversation_id = v_conversation_id
        AND player_id = NEW.player_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- TRIGGER: Fire on network_member status update
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_remove_network_member_from_conversation ON public.network_member;
CREATE TRIGGER trigger_remove_network_member_from_conversation
  AFTER UPDATE OF status ON public.network_member
  FOR EACH ROW
  WHEN (NEW.status = 'removed')
  EXECUTE FUNCTION remove_network_member_from_conversation();

-- =============================================================================
-- CLEANUP: Remove conversation_participant records for already-removed members
-- This fixes any existing cases where members left but are still in conversations
-- =============================================================================
DELETE FROM public.conversation_participant cp
WHERE EXISTS (
  SELECT 1
  FROM public.network n
  JOIN public.network_member nm ON nm.network_id = n.id
  WHERE n.conversation_id = cp.conversation_id
    AND nm.player_id = cp.player_id
    AND nm.status = 'removed'
);

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON FUNCTION remove_network_member_from_conversation() IS 
  'Removes a player from conversation_participant when their network_member status changes to removed (leaving a group/community)';

DO $$
BEGIN
  RAISE NOTICE 'Migration completed: Members will be removed from group/community chats when they leave';
END $$;

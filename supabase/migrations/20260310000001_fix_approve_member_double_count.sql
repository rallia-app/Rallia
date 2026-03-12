-- Migration: Fix double-counting bug when approving community members
-- Problem: approve_community_member function increments member_count manually,
-- but the update_network_member_count trigger ALREADY increments it when status
-- changes from 'pending' to 'active'. This causes count to increase by 2 per approval.
-- Fix: Remove the redundant manual increment from approve_community_member.

-- =============================================================================
-- FUNCTION: Approve pending membership request (FIXED - no double count)
-- =============================================================================
CREATE OR REPLACE FUNCTION approve_community_member(
  p_community_id UUID,
  p_member_id UUID,
  p_approver_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_approver_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
  v_community_name TEXT;
BEGIN
  -- Use provided approver_id or get from auth
  v_approver_id := COALESCE(p_approver_id, auth.uid());
  
  IF v_approver_id IS NULL THEN
    RAISE EXCEPTION 'Approver ID is required';
  END IF;
  
  -- Verify the approver is a moderator
  SELECT is_network_moderator(p_community_id, v_approver_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can approve members';
  END IF;
  
  -- Get target player ID
  SELECT player_id INTO v_target_player_id
  FROM public.network_member
  WHERE id = p_member_id AND network_id = p_community_id AND status = 'pending';
  
  IF v_target_player_id IS NULL THEN
    RAISE EXCEPTION 'Pending membership not found';
  END IF;
  
  -- Get community name
  SELECT name INTO v_community_name
  FROM public.network
  WHERE id = p_community_id;
  
  -- Approve the membership
  -- NOTE: The update_network_member_count trigger automatically increments
  -- member_count when status changes from 'pending' to 'active', so we
  -- do NOT need to manually update member_count here (that was causing double-count)
  UPDATE public.network_member
  SET status = 'active', joined_at = NOW()
  WHERE id = p_member_id;
  
  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_approver_id,
    v_target_player_id,
    jsonb_build_object('status', 'approved', 'approved_by', v_approver_id)
  );
  
  -- Send notification to the requester
  INSERT INTO public.notification (
    user_id,
    type,
    target_id,
    title,
    body,
    payload,
    priority
  ) VALUES (
    v_target_player_id,
    'community_join_accepted'::notification_type_enum,
    p_community_id,
    'Request Approved!',
    'You are now a member of ' || v_community_name,
    jsonb_build_object(
      'communityId', p_community_id,
      'communityName', v_community_name
    ),
    'normal'::notification_priority_enum
  );
  
  RETURN true;
END;
$$;

-- =============================================================================
-- Fix existing communities with incorrect member_count
-- Recalculate based on actual active members
-- =============================================================================
UPDATE public.network n
SET member_count = (
  SELECT COUNT(*) 
  FROM public.network_member nm 
  WHERE nm.network_id = n.id AND nm.status = 'active'
)
WHERE EXISTS (
  SELECT 1 FROM public.network_type nt 
  WHERE nt.id = n.network_type_id AND nt.name = 'community'
);

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE 'Fixed approve_community_member double-counting bug and recalculated member counts';
END $$;

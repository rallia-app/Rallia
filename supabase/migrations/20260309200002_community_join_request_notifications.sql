-- Migration: Add community join request notifications
-- Sends notifications to moderators when someone requests to join their community
-- Sends notifications to requesters when their request is approved/rejected

-- Add new notification types to the enum
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'community_join_request';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'community_join_accepted';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'community_join_rejected';

-- =============================================================================
-- FUNCTION: Request to join a public community (with moderator notifications)
-- =============================================================================
CREATE OR REPLACE FUNCTION request_to_join_community(
  p_community_id UUID,
  p_player_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_id UUID;
  v_network_type TEXT;
  v_is_private BOOLEAN;
  v_existing_member UUID;
  v_member_id UUID;
  v_community_name TEXT;
  v_requester_name TEXT;
  v_moderator RECORD;
BEGIN
  -- Use provided player_id or get from auth
  v_player_id := COALESCE(p_player_id, auth.uid());
  
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Player ID is required';
  END IF;
  
  -- Verify this is a public community and get its name
  SELECT nt.name, n.is_private, n.name INTO v_network_type, v_is_private, v_community_name
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  WHERE n.id = p_community_id;
  
  IF v_network_type IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;
  
  IF v_network_type != 'community' THEN
    RAISE EXCEPTION 'This is not a community';
  END IF;
  
  IF v_is_private = true THEN
    RAISE EXCEPTION 'Cannot request to join a private community';
  END IF;
  
  -- Check if already a member or has pending request
  SELECT id INTO v_existing_member
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = v_player_id;
  
  IF v_existing_member IS NOT NULL THEN
    RAISE EXCEPTION 'Already a member or have a pending request';
  END IF;
  
  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'Someone')
  INTO v_requester_name
  FROM public.profile
  WHERE id = v_player_id;
  
  -- Create pending membership request
  INSERT INTO public.network_member (
    network_id, 
    player_id, 
    status, 
    role, 
    request_type,
    added_by
  )
  VALUES (
    p_community_id, 
    v_player_id, 
    'pending', 
    'member', 
    'join_request',
    v_player_id  -- Self-requested
  )
  RETURNING id INTO v_member_id;
  
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
    v_player_id,
    v_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'join_request')
  );
  
  -- Send notification to all moderators
  FOR v_moderator IN
    SELECT nm.player_id
    FROM public.network_member nm
    WHERE nm.network_id = p_community_id
      AND nm.role = 'moderator'
      AND nm.status = 'active'
  LOOP
    INSERT INTO public.notification (
      user_id,
      type,
      target_id,
      title,
      body,
      payload,
      priority
    ) VALUES (
      v_moderator.player_id,
      'community_join_request'::notification_type_enum,
      p_community_id,
      'New Join Request',
      v_requester_name || ' wants to join ' || v_community_name,
      jsonb_build_object(
        'communityId', p_community_id,
        'communityName', v_community_name,
        'requesterId', v_player_id,
        'requesterName', v_requester_name,
        'memberId', v_member_id
      ),
      'normal'::notification_priority_enum
    );
  END LOOP;
  
  RETURN v_member_id;
END;
$$;

-- =============================================================================
-- FUNCTION: Approve pending membership request (with requester notification)
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
  UPDATE public.network_member
  SET status = 'active', joined_at = NOW()
  WHERE id = p_member_id;
  
  -- Update member count
  UPDATE public.network
  SET member_count = member_count + 1
  WHERE id = p_community_id;
  
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
-- FUNCTION: Reject pending membership request (with requester notification)
-- =============================================================================
CREATE OR REPLACE FUNCTION reject_community_member(
  p_community_id UUID,
  p_member_id UUID,
  p_rejector_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rejector_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
  v_community_name TEXT;
BEGIN
  -- Use provided rejector_id or get from auth
  v_rejector_id := COALESCE(p_rejector_id, auth.uid());
  
  IF v_rejector_id IS NULL THEN
    RAISE EXCEPTION 'Rejector ID is required';
  END IF;
  
  -- Verify the rejector is a moderator
  SELECT is_network_moderator(p_community_id, v_rejector_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can reject members';
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
  
  -- Delete the membership request
  DELETE FROM public.network_member
  WHERE id = p_member_id;
  
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
    'community_join_rejected'::notification_type_enum,
    p_community_id,
    'Request Not Approved',
    'Your request to join ' || v_community_name || ' was not approved',
    jsonb_build_object(
      'communityId', p_community_id,
      'communityName', v_community_name
    ),
    'normal'::notification_priority_enum
  );
  
  RETURN true;
END;
$$;

-- Add comments
COMMENT ON FUNCTION request_to_join_community IS 'Creates a pending join request for a public community and notifies moderators';
COMMENT ON FUNCTION approve_community_member IS 'Moderators approve pending membership requests and notify the requester';
COMMENT ON FUNCTION reject_community_member IS 'Moderators reject pending membership requests and notify the requester';

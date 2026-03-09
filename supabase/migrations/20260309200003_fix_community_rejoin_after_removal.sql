-- Migration: Fix community rejoin after removal
-- Problem: Users who were removed from a community cannot request to join again
-- because the check finds their old record with status 'removed'
-- Fix: Only reject if status is 'active' or 'pending', allow rejoin if 'removed'

-- =============================================================================
-- FUNCTION: Request to join a public community (fixed to allow rejoin)
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
  v_existing_member_id UUID;
  v_existing_status network_member_status;
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
  
  -- Check existing membership status
  SELECT id, status INTO v_existing_member_id, v_existing_status
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = v_player_id;
  
  -- Handle based on existing status
  IF v_existing_member_id IS NOT NULL THEN
    IF v_existing_status = 'active' THEN
      RAISE EXCEPTION 'Already a member of this community';
    ELSIF v_existing_status = 'pending' THEN
      RAISE EXCEPTION 'Already have a pending request for this community';
    ELSIF v_existing_status = 'blocked' THEN
      RAISE EXCEPTION 'You are blocked from this community';
    ELSIF v_existing_status = 'removed' THEN
      -- User was previously removed - allow rejoin by updating existing record
      UPDATE public.network_member
      SET status = 'pending',
          request_type = 'join_request',
          added_by = v_player_id,
          joined_at = NULL,
          updated_at = NOW()
      WHERE id = v_existing_member_id
      RETURNING id INTO v_member_id;
    END IF;
  ELSE
    -- No existing record - create new pending membership request
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
  END IF;
  
  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'Someone')
  INTO v_requester_name
  FROM public.profile
  WHERE id = v_player_id;
  
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

-- Add comment
COMMENT ON FUNCTION request_to_join_community IS 'Creates a pending join request for a public community. Allows users who were previously removed to request again.';

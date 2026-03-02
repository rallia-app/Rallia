-- =============================================================================
-- Migration: Add Community Support
-- Description: Extends network system to support public communities with
--              unlimited members, join requests, and public visibility
-- =============================================================================

-- =============================================================================
-- ENUM: Add request_type to track how members are added
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'network_member_request_type') THEN
        CREATE TYPE network_member_request_type AS ENUM (
            'direct_add',       -- Moderator added directly
            'join_request',     -- User requested to join (public communities)
            'member_referral',  -- Member referred another player (needs approval)
            'invite_code'       -- Joined via invite code
        );
    END IF;
END
$$;

-- =============================================================================
-- INSERT: Add 'community' network type if not exists
-- =============================================================================
INSERT INTO public.network_type (name, display_name, description, is_active)
VALUES ('community', 'Community', 'Public or private communities for players with shared interests', true)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- ALTER TABLE: network_member
-- Add request_type column to track how members were added
-- =============================================================================
ALTER TABLE public.network_member 
ADD COLUMN IF NOT EXISTS request_type network_member_request_type DEFAULT 'direct_add';

-- Add comment
COMMENT ON COLUMN public.network_member.request_type IS 'How the member was added: direct_add (moderator), join_request (self), member_referral (by another member), invite_code';

-- =============================================================================
-- FUNCTION: Update create_network_conversation for communities
-- Extends trigger to also create conversations for communities
-- =============================================================================
CREATE OR REPLACE FUNCTION create_network_conversation()
RETURNS TRIGGER AS $$
DECLARE
  new_conversation_id UUID;
  group_type_id UUID;
  community_type_id UUID;
BEGIN
  -- Get type IDs for player_group and community
  SELECT id INTO group_type_id FROM public.network_type WHERE name = 'player_group';
  SELECT id INTO community_type_id FROM public.network_type WHERE name = 'community';
  
  -- Create conversation for player groups OR communities
  IF (NEW.network_type_id = group_type_id OR NEW.network_type_id = community_type_id) 
     AND NEW.conversation_id IS NULL THEN
    -- Create the group/community conversation
    INSERT INTO public.conversation (conversation_type, title, created_by)
    VALUES ('group', NEW.name, NEW.created_by)
    RETURNING id INTO new_conversation_id;
    
    -- Update the network with the conversation id
    NEW.conversation_id := new_conversation_id;
    
    -- Add the creator as a participant
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (new_conversation_id, NEW.created_by);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Skip max_members enforcement for communities (unlimited)
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_network_max_members()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_allowed INTEGER;
  network_type_name TEXT;
BEGIN
  -- Only check on insert or when status changes to active
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active') THEN
    -- Get network info including type
    SELECT n.member_count, n.max_members, nt.name 
    INTO current_count, max_allowed, network_type_name
    FROM public.network n
    JOIN public.network_type nt ON n.network_type_id = nt.id
    WHERE n.id = NEW.network_id;
    
    -- Skip limit check for communities (unlimited members)
    IF network_type_name = 'community' THEN
      RETURN NEW;
    END IF;
    
    -- Enforce limit for other network types (like player_group)
    IF max_allowed IS NOT NULL AND current_count >= max_allowed THEN
      RAISE EXCEPTION 'Cannot add member: group has reached maximum capacity of % members', max_allowed;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- RLS POLICIES: Update for public community visibility
-- =============================================================================

-- First, ensure is_network_member function exists (it may have been skipped by earlier migrations)
CREATE OR REPLACE FUNCTION is_network_member(network_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = network_id_param
    AND player_id = user_id_param
    AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION is_network_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_network_member(UUID, UUID) TO anon;

-- Drop existing network SELECT policy and recreate with community support
DROP POLICY IF EXISTS "network_select_policy" ON public.network;
DROP POLICY IF EXISTS "Users can view networks they are members of" ON public.network;
DROP POLICY IF EXISTS "Users can view their own networks" ON public.network;

-- New policy: Users can view networks they are members of OR public communities
CREATE POLICY "network_select_policy" ON public.network
FOR SELECT
USING (
  -- User is a member of the network
  is_network_member(id, auth.uid())
  OR
  -- OR it's a public community (is_private = false AND network_type is community)
  (
    is_private = false 
    AND network_type_id = (SELECT id FROM public.network_type WHERE name = 'community')
  )
  OR
  -- OR user created it
  created_by = auth.uid()
);

-- =============================================================================
-- INDEX: Add index for faster public community queries
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_network_is_private ON public.network(is_private) WHERE is_private = false;
CREATE INDEX IF NOT EXISTS idx_network_type_private ON public.network(network_type_id, is_private);

-- =============================================================================
-- FUNCTION: Get public communities for discovery
-- Returns all public communities with member status for current user
-- =============================================================================
CREATE OR REPLACE FUNCTION get_public_communities(p_player_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.member_count,
    n.created_by,
    n.created_at,
    CASE WHEN nm.id IS NOT NULL THEN true ELSE false END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = COALESCE(p_player_id, auth.uid())
  WHERE nt.name = 'community'
    AND n.is_private = false
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

-- =============================================================================
-- FUNCTION: Get player's communities (both public and private they're member of)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_player_communities(p_player_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_private BOOLEAN,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  membership_status TEXT,
  membership_role TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.is_private,
    n.member_count,
    n.created_by,
    n.created_at,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
  ORDER BY n.name ASC;
END;
$$;

-- =============================================================================
-- FUNCTION: Request to join a public community
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
BEGIN
  -- Use provided player_id or get from auth
  v_player_id := COALESCE(p_player_id, auth.uid());
  
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Player ID is required';
  END IF;
  
  -- Verify this is a public community
  SELECT nt.name, n.is_private INTO v_network_type, v_is_private
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
  
  RETURN v_member_id;
END;
$$;

-- =============================================================================
-- FUNCTION: Refer a player to join a community (member referral)
-- =============================================================================
CREATE OR REPLACE FUNCTION refer_player_to_community(
  p_community_id UUID,
  p_referred_player_id UUID,
  p_referrer_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id UUID;
  v_is_referrer_member BOOLEAN;
  v_existing_member UUID;
  v_member_id UUID;
BEGIN
  -- Use provided referrer_id or get from auth
  v_referrer_id := COALESCE(p_referrer_id, auth.uid());
  
  IF v_referrer_id IS NULL THEN
    RAISE EXCEPTION 'Referrer ID is required';
  END IF;
  
  -- Verify the referrer is an active member
  SELECT EXISTS(
    SELECT 1 FROM public.network_member
    WHERE network_id = p_community_id 
      AND player_id = v_referrer_id 
      AND status = 'active'
  ) INTO v_is_referrer_member;
  
  IF NOT v_is_referrer_member THEN
    RAISE EXCEPTION 'Only active members can refer other players';
  END IF;
  
  -- Check if player is already a member or has pending request
  SELECT id INTO v_existing_member
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = p_referred_player_id;
  
  IF v_existing_member IS NOT NULL THEN
    RAISE EXCEPTION 'Player is already a member or has a pending request';
  END IF;
  
  -- Create pending membership referral
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
    p_referred_player_id, 
    'pending', 
    'member', 
    'member_referral',
    v_referrer_id
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
    v_referrer_id,
    p_referred_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'member_referral')
  );
  
  RETURN v_member_id;
END;
$$;

-- =============================================================================
-- FUNCTION: Approve pending membership request (moderators only)
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
  
  -- Approve the membership
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
  
  RETURN true;
END;
$$;

-- =============================================================================
-- FUNCTION: Reject pending membership request (moderators only)
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
  
  -- Delete the membership request
  DELETE FROM public.network_member
  WHERE id = p_member_id;
  
  RETURN true;
END;
$$;

-- =============================================================================
-- FUNCTION: Get pending membership requests for a community (moderators only)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_pending_community_members(
  p_community_id UUID,
  p_moderator_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  request_type network_member_request_type,
  added_by UUID,
  created_at TIMESTAMPTZ,
  player_name TEXT,
  player_profile_picture TEXT,
  referrer_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_moderator_id UUID;
  v_is_moderator BOOLEAN;
BEGIN
  -- Use provided moderator_id or get from auth
  v_moderator_id := COALESCE(p_moderator_id, auth.uid());
  
  IF v_moderator_id IS NULL THEN
    RAISE EXCEPTION 'Moderator ID is required';
  END IF;
  
  -- Verify the user is a moderator
  SELECT is_network_moderator(p_community_id, v_moderator_id) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can view pending members';
  END IF;
  
  RETURN QUERY
  SELECT 
    nm.id,
    nm.player_id,
    nm.request_type,
    nm.added_by,
    nm.created_at,
    COALESCE(p.display_name, p.first_name || ' ' || COALESCE(p.last_name, '')) as player_name,
    p.profile_picture_url as player_profile_picture,
    COALESCE(r.display_name, r.first_name || ' ' || COALESCE(r.last_name, '')) as referrer_name
  FROM public.network_member nm
  JOIN public.profile p ON p.id = nm.player_id
  LEFT JOIN public.profile r ON r.id = nm.added_by AND nm.request_type = 'member_referral'
  WHERE nm.network_id = p_community_id
    AND nm.status = 'pending'
  ORDER BY nm.created_at ASC;
END;
$$;

COMMENT ON FUNCTION get_public_communities IS 'Returns all public communities with membership status for discovery';
COMMENT ON FUNCTION get_player_communities IS 'Returns all communities a player is a member of';
COMMENT ON FUNCTION request_to_join_community IS 'Creates a pending join request for a public community';
COMMENT ON FUNCTION refer_player_to_community IS 'Allows active members to refer other players (needs approval)';
COMMENT ON FUNCTION approve_community_member IS 'Moderators approve pending membership requests';
COMMENT ON FUNCTION reject_community_member IS 'Moderators reject pending membership requests';
COMMENT ON FUNCTION get_pending_community_members IS 'Get all pending membership requests for a community';

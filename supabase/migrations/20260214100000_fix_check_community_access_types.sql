-- Migration: Fix check_community_access function return types
-- The membership_status and membership_role columns were returning enum types
-- instead of TEXT, causing type mismatch errors

CREATE OR REPLACE FUNCTION check_community_access(
  p_community_id UUID,
  p_player_id UUID DEFAULT NULL
)
RETURNS TABLE (
  can_access BOOLEAN,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT,
  is_public BOOLEAN,
  has_active_moderator BOOLEAN,
  access_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_community_exists BOOLEAN;
  v_is_public BOOLEAN;
  v_is_archived BOOLEAN;
  v_created_by UUID;
  v_membership_status TEXT;
  v_membership_role TEXT;
  v_has_moderator BOOLEAN;
BEGIN
  -- Check if community exists and get basic info
  SELECT 
    TRUE,
    NOT n.is_private,
    n.archived_at IS NOT NULL,
    n.created_by
  INTO 
    v_community_exists,
    v_is_public,
    v_is_archived,
    v_created_by
  FROM public.network n
  JOIN public.network_type nt ON nt.id = n.network_type_id
  WHERE n.id = p_community_id
    AND nt.name = 'community';
  
  -- If community doesn't exist, return no access
  IF NOT v_community_exists THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      FALSE,
      'Community not found'::TEXT;
    RETURN;
  END IF;
  
  -- If archived, return no access
  IF v_is_archived THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      v_is_public,
      FALSE,
      'Community is archived'::TEXT;
    RETURN;
  END IF;
  
  -- Check if there's an active moderator
  SELECT EXISTS (
    SELECT 1 FROM public.network_member
    WHERE network_id = p_community_id
      AND role = 'moderator'
      AND status = 'active'
  ) INTO v_has_moderator;
  
  -- If no player_id provided, return public info only
  IF p_player_id IS NULL THEN
    RETURN QUERY SELECT 
      v_is_public,
      FALSE,
      NULL::TEXT,
      NULL::TEXT,
      v_is_public,
      v_has_moderator,
      CASE 
        WHEN v_is_public THEN 'Public community - view access'
        ELSE 'Login required for access'
      END::TEXT;
    RETURN;
  END IF;
  
  -- Get membership info (cast to TEXT to avoid type mismatch)
  SELECT 
    nm.status::TEXT,
    nm.role::TEXT
  INTO v_membership_status, v_membership_role
  FROM public.network_member nm
  WHERE nm.network_id = p_community_id AND nm.player_id = p_player_id;
  
  -- Check if player is the creator (always has access)
  IF p_player_id = v_created_by THEN
    RETURN QUERY SELECT 
      TRUE,
      COALESCE(v_membership_status = 'active', FALSE),
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Creator has full access'::TEXT;
    RETURN;
  END IF;
  
  -- If player is an active member, grant access
  IF v_membership_status = 'active' THEN
    RETURN QUERY SELECT 
      TRUE,
      TRUE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Active member'::TEXT;
    RETURN;
  END IF;
  
  -- If player has a pending request
  IF v_membership_status = 'pending' THEN
    RETURN QUERY SELECT 
      FALSE,
      FALSE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      'Membership request pending'::TEXT;
    RETURN;
  END IF;
  
  -- Player is not a member
  RETURN QUERY SELECT 
    FALSE,
    FALSE,
    NULL::TEXT,
    NULL::TEXT,
    v_is_public,
    v_has_moderator,
    CASE 
      WHEN NOT v_has_moderator THEN 'Community has no active moderator'
      ELSE 'Membership required'
    END::TEXT;
  RETURN;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE 'check_community_access function fixed with proper TEXT type casting';
END $$;

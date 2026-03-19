-- Migration: Fix community access for authenticated non-members
-- Issue: Signed-in users had less access than signed-out users to public communities
-- Root cause: check_community_access returned can_access=FALSE for authenticated non-members
--             even when the community was public
-- Fix: Return can_access=v_is_public for non-members (same as for null player_id)

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
      v_is_public,  -- FIXED: Allow view access to public communities even with pending request
      FALSE,
      v_membership_status,
      v_membership_role,
      v_is_public,
      v_has_moderator,
      CASE
        WHEN v_is_public THEN 'Membership request pending - view access'
        ELSE 'Membership request pending'
      END::TEXT;
    RETURN;
  END IF;

  -- Player is not a member - FIXED: Allow view access to public communities
  RETURN QUERY SELECT
    v_is_public,  -- FIXED: was FALSE, now respects public status like unauthenticated users
    FALSE,
    NULL::TEXT,
    NULL::TEXT,
    v_is_public,
    v_has_moderator,
    CASE
      WHEN v_is_public THEN 'Public community - view access'
      WHEN NOT v_has_moderator THEN 'Community has no active moderator'
      ELSE 'Membership required'
    END::TEXT;
  RETURN;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_community_access(UUID, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION check_community_access IS
'Checks if a player can access a community. Returns access status, membership info, and reason.
Authenticated users have the same view access to public communities as unauthenticated users.
Uses TEXT type casting for enum columns to avoid type mismatch errors.';

DO $$
BEGIN
  RAISE NOTICE 'Fixed check_community_access: authenticated users now have same access as unauthenticated for public communities';
END $$;

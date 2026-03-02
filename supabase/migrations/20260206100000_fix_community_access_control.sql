-- =============================================================================
-- Migration: Fix Community Access Control Issues
-- Description: 
--   1. Filter out 0-member communities from public discovery
--   2. Add RPC to check community access eligibility
-- Created: 2026-02-06
-- =============================================================================

-- =============================================================================
-- FIX 1: Update get_public_communities to exclude 0-member communities
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
    AND n.member_count > 0  -- ADDED: Exclude communities with 0 members
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

-- =============================================================================
-- FIX 2: Add RPC to check if user can access community features
-- Returns access status and reason
-- =============================================================================

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
  v_player_id UUID;
  v_is_community BOOLEAN;
  v_is_private BOOLEAN;
  v_member_count INTEGER;
  v_has_moderator BOOLEAN;
BEGIN
  -- Get player ID (from param or auth context)
  v_player_id := COALESCE(p_player_id, auth.uid());
  
  -- Check if the network is a community and get its properties
  SELECT 
    nt.name = 'community',
    n.is_private,
    n.member_count
  INTO v_is_community, v_is_private, v_member_count
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  WHERE n.id = p_community_id;
  
  -- Not a community or doesn't exist
  IF NOT FOUND OR NOT v_is_community THEN
    RETURN QUERY SELECT 
      false, false, NULL::TEXT, NULL::TEXT, false, false, 
      'Community not found'::TEXT;
    RETURN;
  END IF;
  
  -- Check if community has any moderators
  SELECT EXISTS(
    SELECT 1 FROM public.network_member 
    WHERE network_id = p_community_id 
    AND role = 'moderator' 
    AND status = 'active'
  ) INTO v_has_moderator;
  
  -- Get membership info for current user
  RETURN QUERY
  SELECT 
    -- Can access if: is a member with active status
    (nm.id IS NOT NULL AND nm.status = 'active') as can_access,
    (nm.id IS NOT NULL AND nm.status = 'active') as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role,
    NOT v_is_private as is_public,
    v_has_moderator as has_active_moderator,
    CASE
      WHEN nm.id IS NOT NULL AND nm.status = 'active' THEN 'Member'
      WHEN nm.id IS NOT NULL AND nm.status = 'pending' THEN 'Pending approval'
      WHEN v_member_count = 0 THEN 'Community has no members'
      WHEN NOT v_has_moderator THEN 'Community has no moderator'
      ELSE 'Not a member'
    END as access_reason
  FROM public.network n
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = v_player_id
  WHERE n.id = p_community_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_community_access(UUID, UUID) TO authenticated;

-- =============================================================================
-- FIX 3: Optional - Auto-archive orphaned communities (0 members)
-- This creates a trigger to mark communities as private when they have 0 members
-- Prevents them from appearing in discovery
-- =============================================================================

-- Add archived_at column to network if not exists
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Function to auto-archive communities with 0 members
CREATE OR REPLACE FUNCTION handle_orphaned_community()
RETURNS TRIGGER AS $$
BEGIN
  -- If member_count goes to 0, mark as archived
  IF NEW.member_count = 0 AND (OLD.member_count IS NULL OR OLD.member_count > 0) THEN
    NEW.archived_at := NOW();
  END IF;
  
  -- If member_count increases from 0, unarchive
  IF NEW.member_count > 0 AND OLD.member_count = 0 AND OLD.archived_at IS NOT NULL THEN
    NEW.archived_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (only if member_count column exists)
DROP TRIGGER IF EXISTS trigger_handle_orphaned_community ON public.network;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'network' 
    AND column_name = 'member_count'
  ) THEN
    CREATE TRIGGER trigger_handle_orphaned_community
    BEFORE UPDATE OF member_count ON public.network
    FOR EACH ROW
    EXECUTE FUNCTION handle_orphaned_community();
  ELSE
    RAISE NOTICE 'member_count column does not exist on network - skipping trigger creation';
  END IF;
END $$;

-- =============================================================================
-- FIX 4: Update get_public_communities to also exclude archived communities
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
    AND n.member_count > 0
    AND n.archived_at IS NULL  -- Exclude archived communities
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON FUNCTION check_community_access IS 
'Checks if a player can access community features. Returns access status and reason.';

COMMENT ON COLUMN network.archived_at IS 
'Timestamp when the community was archived (e.g., when it became orphaned with 0 members)';

-- =============================================================================
-- COMPLETION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Community access control fixes applied successfully';
END $$;

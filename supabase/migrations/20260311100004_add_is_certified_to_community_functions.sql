-- Migration: Add is_certified to community list functions
-- Date: 2026-03-11
-- Description: Updates get_public_communities and get_player_communities to return is_certified field

-- ============================================================================
-- STEP 1: Update get_public_communities to include is_certified
-- ============================================================================

DROP FUNCTION IF EXISTS get_public_communities(UUID, UUID);

CREATE OR REPLACE FUNCTION get_public_communities(
  p_player_id UUID DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_private BOOLEAN,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT,
  sport_id UUID,
  is_certified BOOLEAN
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
    CASE WHEN nm.id IS NOT NULL THEN TRUE ELSE FALSE END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role,
    n.sport_id,
    COALESCE(n.is_certified, FALSE) as is_certified
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
    AND n.is_private = FALSE
    AND n.member_count > 0
    AND n.archived_at IS NULL
    AND (
      p_sport_id IS NULL 
      OR n.sport_id IS NULL 
      OR n.sport_id = p_sport_id
    )
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

COMMENT ON FUNCTION get_public_communities IS 'Returns all public communities with membership status and certification for discovery, optionally filtered by sport';

-- ============================================================================
-- STEP 2: Update get_player_communities to include is_certified
-- ============================================================================

DROP FUNCTION IF EXISTS get_player_communities(UUID, UUID);

CREATE OR REPLACE FUNCTION get_player_communities(
  p_player_id UUID,
  p_sport_id UUID DEFAULT NULL
)
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
  membership_role TEXT,
  sport_id UUID,
  is_certified BOOLEAN
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
    nm.role::TEXT as membership_role,
    n.sport_id,
    COALESCE(n.is_certified, FALSE) as is_certified
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
    AND nm.status = 'active'
    AND (
      p_sport_id IS NULL 
      OR n.sport_id IS NULL 
      OR n.sport_id = p_sport_id
    )
  ORDER BY n.name ASC;
END;
$$;

COMMENT ON FUNCTION get_player_communities IS 'Returns all communities a player is a member of with certification status, optionally filtered by sport';

-- Migration: Add sport association to networks (groups and communities)
-- Description: Adds optional sport_id column to network table
-- NULL means the network is for both sports, non-NULL means sport-specific

-- ============================================================================
-- STEP 1: Add sport_id column to network table
-- ============================================================================

ALTER TABLE public.network 
ADD COLUMN IF NOT EXISTS sport_id UUID REFERENCES public.sport(id);

-- Add comment explaining the field
COMMENT ON COLUMN public.network.sport_id IS 'Optional sport association. NULL = both sports (visible in all interfaces), non-NULL = sport-specific network';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_network_sport_id ON public.network(sport_id);

-- ============================================================================
-- STEP 2: Update get_public_communities to accept sport filter
-- ============================================================================

-- Drop old function versions to avoid overload conflicts
DROP FUNCTION IF EXISTS get_public_communities();
DROP FUNCTION IF EXISTS get_public_communities(UUID);
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
  sport_id UUID
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
    n.sport_id
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id 
    AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
    AND n.is_private = FALSE
    AND n.member_count > 0
    AND n.archived_at IS NULL
    -- Sport filter: if p_sport_id is provided, show networks that match OR have no sport (both sports)
    AND (
      p_sport_id IS NULL 
      OR n.sport_id IS NULL 
      OR n.sport_id = p_sport_id
    )
  ORDER BY n.member_count DESC, n.created_at DESC;
END;
$$;

COMMENT ON FUNCTION get_public_communities IS 'Returns all public communities with membership status for discovery, optionally filtered by sport';

-- ============================================================================
-- STEP 3: Update get_player_communities to accept sport filter and return sport_id
-- ============================================================================

-- Drop old function versions to avoid overload conflicts
DROP FUNCTION IF EXISTS get_player_communities(UUID);
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
  sport_id UUID
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
    n.sport_id
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'community'
    AND nm.status = 'active'
    -- Sport filter: if p_sport_id is provided, show networks that match OR have no sport (both sports)
    AND (
      p_sport_id IS NULL 
      OR n.sport_id IS NULL 
      OR n.sport_id = p_sport_id
    )
  ORDER BY n.name ASC;
END;
$$;

COMMENT ON FUNCTION get_player_communities IS 'Returns all communities a player is a member of, optionally filtered by sport';

-- ============================================================================
-- STEP 4: Create get_player_groups function with sport filter
-- ============================================================================

-- Drop old function versions to avoid overload conflicts
DROP FUNCTION IF EXISTS get_player_groups(UUID);
DROP FUNCTION IF EXISTS get_player_groups(UUID, UUID);

CREATE OR REPLACE FUNCTION get_player_groups(
  p_player_id UUID,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_private BOOLEAN,
  max_members INTEGER,
  member_count INTEGER,
  conversation_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  sport_id UUID
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
    n.max_members,
    n.member_count,
    n.conversation_id,
    n.created_by,
    n.created_at,
    n.updated_at,
    n.sport_id
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  WHERE nt.name = 'player_group'
    AND nm.status = 'active'
    -- Sport filter: if p_sport_id is provided, show networks that match OR have no sport (both sports)
    AND (
      p_sport_id IS NULL 
      OR n.sport_id IS NULL 
      OR n.sport_id = p_sport_id
    )
  ORDER BY n.name ASC;
END;
$$;

COMMENT ON FUNCTION get_player_groups IS 'Returns all groups a player is a member of, optionally filtered by sport';

-- ============================================================================
-- DONE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration complete: Added sport_id to network table and updated RPC functions';
END $$;

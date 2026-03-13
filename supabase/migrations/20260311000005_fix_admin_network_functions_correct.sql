-- Fix admin network RPC functions with CORRECT parameter names and return types
-- Issue: Previous fix changed p_search to p_search_query AND changed RETURNS TABLE to RETURNS JSONB
-- This migration restores the correct interface expected by adminNetworkService.ts
--
-- Database schema notes:
--   - network.network_type_id -> network_type (FK relationship)
--   - profile.profile_picture_url (NOT avatar_url)
--   - network_member.player_id -> player.id -> profile.id

-- =============================================================================
-- PART 1: Drop ALL existing versions of get_admin_networks
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.get_admin_networks CASCADE;

-- =============================================================================
-- PART 2: Recreate get_admin_networks with CORRECT signature
-- Service calls: p_search, p_network_type, p_is_certified, p_limit, p_offset
-- Returns: TABLE (array of rows with total_count in each row)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_networks(
  p_search TEXT DEFAULT NULL,
  p_network_type TEXT DEFAULT NULL,
  p_is_certified BOOLEAN DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  network_type TEXT,
  network_type_display TEXT,
  is_private BOOLEAN,
  is_certified BOOLEAN,
  certified_at TIMESTAMPTZ,
  member_count INTEGER,
  max_members INTEGER,
  cover_image_url TEXT,
  sport_id UUID,
  sport_name TEXT,
  created_by UUID,
  creator_name TEXT,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM admin a 
    WHERE a.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only admins can access this function';
  END IF;
  
  -- Get total count first
  -- FIXED: Join network_type table via network_type_id
  SELECT COUNT(*) INTO v_total
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE 
    (p_search IS NULL OR n.name ILIKE '%' || p_search || '%')
    AND (p_network_type IS NULL OR nt.name = p_network_type)
    AND (p_is_certified IS NULL OR COALESCE(n.is_certified, FALSE) = p_is_certified)
    AND n.archived_at IS NULL;
  
  RETURN QUERY
  SELECT 
    n.id,
    n.name,
    n.description,
    nt.name AS network_type,
    nt.display_name AS network_type_display,
    n.is_private,
    COALESCE(n.is_certified, FALSE) AS is_certified,
    n.certified_at,
    COALESCE(n.member_count, 0) AS member_count,
    n.max_members,
    n.cover_image_url,
    n.sport_id,
    s.name AS sport_name,
    n.created_by,
    COALESCE(p.display_name, CONCAT(p.first_name, ' ', p.last_name)) AS creator_name,
    n.created_at,
    v_total AS total_count
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  LEFT JOIN sport s ON s.id = n.sport_id
  LEFT JOIN profile p ON p.id = n.created_by
  WHERE 
    (p_search IS NULL OR n.name ILIKE '%' || p_search || '%')
    AND (p_network_type IS NULL OR nt.name = p_network_type)
    AND (p_is_certified IS NULL OR COALESCE(n.is_certified, FALSE) = p_is_certified)
    AND n.archived_at IS NULL
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_admin_networks(text, text, boolean, integer, integer) 
  IS 'Get all networks for admin panel - FIXED: uses network_type_id join';

-- =============================================================================
-- PART 3: Drop and recreate get_admin_network_detail
-- FIXED: profile.profile_picture_url (NOT avatar_url)
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_admin_network_detail(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_admin_network_detail(p_network_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM admin a 
    WHERE a.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only admins can access this function';
  END IF;
  
  SELECT jsonb_build_object(
    'id', n.id,
    'name', n.name,
    'description', n.description,
    'network_type', nt.name,
    'network_type_display', nt.display_name,
    'is_private', n.is_private,
    'is_certified', COALESCE(n.is_certified, FALSE),
    'certified_at', n.certified_at,
    'certified_by', n.certified_by,
    'certification_notes', n.certification_notes,
    'certified_by_name', (
      SELECT COALESCE(cp.display_name, CONCAT(cp.first_name, ' ', cp.last_name))
      FROM profile cp
      WHERE cp.id = n.certified_by
    ),
    'member_count', COALESCE(n.member_count, 0),
    'max_members', n.max_members,
    'cover_image_url', n.cover_image_url,
    'sport_id', n.sport_id,
    'sport_name', s.name,
    'invite_code', n.invite_code,
    'created_by', n.created_by,
    'creator_name', (
      SELECT COALESCE(cp.display_name, CONCAT(cp.first_name, ' ', cp.last_name))
      FROM profile cp
      WHERE cp.id = n.created_by
    ),
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'archived_at', n.archived_at,
    'members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', nm.id,
        'player_id', nm.player_id,
        'player_name', COALESCE(mp.display_name, CONCAT(mp.first_name, ' ', mp.last_name)),
        'player_avatar', mp.profile_picture_url,  -- FIXED: was avatar_url
        'role', nm.role,
        'status', nm.status,
        'joined_at', nm.joined_at
      ) ORDER BY nm.joined_at), '[]'::jsonb)
      FROM network_member nm
      JOIN profile mp ON mp.id = nm.player_id
      WHERE nm.network_id = n.id
        AND nm.status = 'active'
    ),
    'favorite_facilities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'address', f.address
      )), '[]'::jsonb)
      FROM network_favorite_facility nff
      JOIN facility f ON f.id = nff.facility_id
      WHERE nff.network_id = n.id
    )
  ) INTO v_result
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  LEFT JOIN sport s ON s.id = n.sport_id
  WHERE n.id = p_network_id;
  
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Network not found';
  END IF;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_network_detail(uuid) 
  IS 'Get detailed network info for admin - FIXED: uses profile_picture_url and network_type_id join';

-- =============================================================================
-- PART 4: Drop and recreate admin_certify_network
-- FIXED: uses network_type_id join
-- =============================================================================
DROP FUNCTION IF EXISTS public.admin_certify_network(uuid, boolean, text) CASCADE;

CREATE OR REPLACE FUNCTION public.admin_certify_network(
  p_network_id UUID,
  p_is_certified BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_network_type TEXT;
BEGIN
  -- Get calling user's admin ID
  SELECT a.id INTO v_admin_id
  FROM admin a
  WHERE a.id = auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Not authorized');
  END IF;
  
  -- Check network exists and get its type via JOIN
  SELECT nt.name INTO v_network_type
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE n.id = p_network_id;
  
  IF v_network_type IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Network not found');
  END IF;
  
  -- Only communities can be certified
  IF v_network_type != 'community' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Only communities can be certified');
  END IF;
  
  -- Update certification status
  UPDATE network
  SET 
    is_certified = p_is_certified,
    certified_at = CASE WHEN p_is_certified THEN NOW() ELSE NULL END,
    certified_by = CASE WHEN p_is_certified THEN v_admin_id ELSE NULL END,
    certification_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_network_id;
  
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

COMMENT ON FUNCTION public.admin_certify_network(uuid, boolean, text) 
  IS 'Certify or uncertify a community - FIXED: uses network_type_id join';

-- =============================================================================
-- PART 5: Re-grant execute permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.get_admin_networks(text, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_network_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_certify_network(uuid, boolean, text) TO authenticated;

-- Add sport filter support to get_admin_networks RPC
-- 
-- Sport filter logic:
--   - p_sport_id = NULL -> show all networks
--   - p_sport_id = <uuid> -> show networks for that sport OR networks with sport_id = NULL (both sports)
--
-- Also add privacy filter support

-- =============================================================================
-- STEP 1: Drop existing function
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, integer, integer) CASCADE;

-- =============================================================================
-- STEP 2: Create new function with sport_id and privacy filters
-- =============================================================================
CREATE FUNCTION public.get_admin_networks(
  p_search TEXT DEFAULT NULL,
  p_network_type TEXT DEFAULT NULL,
  p_is_certified BOOLEAN DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL,
  p_is_private BOOLEAN DEFAULT NULL,
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
  -- Sport filter logic: if p_sport_id is provided, include networks with that sport OR with NULL (both sports)
  SELECT COUNT(*) INTO v_total
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE 
    (p_search IS NULL OR n.name ILIKE '%' || p_search || '%')
    AND (p_network_type IS NULL OR nt.name = p_network_type)
    AND (p_is_certified IS NULL OR COALESCE(n.is_certified, FALSE) = p_is_certified)
    AND (p_sport_id IS NULL OR n.sport_id = p_sport_id OR n.sport_id IS NULL)
    AND (p_is_private IS NULL OR n.is_private = p_is_private)
    AND n.archived_at IS NULL;
  
  RETURN QUERY
  SELECT 
    n.id,
    n.name::TEXT,
    n.description::TEXT,
    nt.name::TEXT AS network_type,
    nt.display_name::TEXT AS network_type_display,
    n.is_private,
    COALESCE(n.is_certified, FALSE) AS is_certified,
    n.certified_at,
    COALESCE(n.member_count, 0)::INTEGER AS member_count,
    n.max_members::INTEGER,
    n.cover_image_url::TEXT,
    n.sport_id,
    COALESCE(s.name, 'Both Sports')::TEXT AS sport_name,
    n.created_by,
    COALESCE(p.display_name, CONCAT(p.first_name, ' ', p.last_name))::TEXT AS creator_name,
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
    AND (p_sport_id IS NULL OR n.sport_id = p_sport_id OR n.sport_id IS NULL)
    AND (p_is_private IS NULL OR n.is_private = p_is_private)
    AND n.archived_at IS NULL
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_admin_networks(text, text, boolean, uuid, boolean, integer, integer) 
  IS 'Get all networks for admin panel with sport and privacy filters. Sport filter shows networks for the specified sport OR networks with NULL sport_id (both sports).';

-- Grant permission
GRANT EXECUTE ON FUNCTION public.get_admin_networks(text, text, boolean, uuid, boolean, integer, integer) TO authenticated;

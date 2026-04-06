-- ============================================================================
-- Add pagination to get_public_communities RPC
--
-- Adds p_offset and p_limit parameters with backward-compatible defaults.
-- Existing callers that omit these params get all results (limit 1000).
-- New paginated callers pass them explicitly.
-- ============================================================================

DROP FUNCTION IF EXISTS get_public_communities(UUID, UUID);

CREATE OR REPLACE FUNCTION get_public_communities(
  p_player_id UUID DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 1000
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
    AND (p_sport_id IS NULL OR n.sport_id = p_sport_id)
  ORDER BY n.member_count DESC, n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION get_public_communities IS 'Returns public communities with membership status for discovery, with pagination support. Optionally filtered by sport.';

GRANT EXECUTE ON FUNCTION get_public_communities(UUID, UUID, INT, INT) TO authenticated;

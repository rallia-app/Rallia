-- Fix get_admin_network_detail function to use correct column name
-- profile_picture_url instead of avatar_url

CREATE OR REPLACE FUNCTION public.get_admin_network_detail(p_network_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_network_type text;
  v_members jsonb;
  v_facilities jsonb;
BEGIN
  -- Get network type first
  SELECT n.network_type INTO v_network_type
  FROM network n
  WHERE n.id = p_network_id;
  
  IF v_network_type IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get members with their info
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', nm.id,
      'player_id', nm.player_id,
      'player_name', COALESCE(mp.display_name, mp.first_name || ' ' || mp.last_name),
      'player_avatar', mp.profile_picture_url,
      'role', nm.role,
      'status', nm.status,
      'joined_at', nm.joined_at
    ) ORDER BY nm.joined_at DESC
  ), '[]'::jsonb)
  INTO v_members
  FROM network_member nm
  JOIN profile mp ON mp.id = nm.player_id
  WHERE nm.network_id = p_network_id
  AND nm.status = 'active';
  
  -- Get favorite facilities
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'address', f.address
    )
  ), '[]'::jsonb)
  INTO v_facilities
  FROM network_favorite_facility nff
  JOIN facility f ON f.id = nff.facility_id
  WHERE nff.network_id = p_network_id;
  
  -- Build the full result
  SELECT jsonb_build_object(
    'id', n.id,
    'name', n.name,
    'description', n.description,
    'network_type', n.network_type,
    'network_type_display', CASE 
      WHEN n.network_type = 'player_group' THEN 'Group'
      WHEN n.network_type = 'community' THEN 'Community'
      ELSE n.network_type
    END,
    'is_private', n.is_private,
    'is_certified', COALESCE(n.is_certified, false),
    'certified_at', n.certified_at,
    'certified_by', n.certified_by,
    'certified_by_name', (
      SELECT COALESCE(cp.display_name, cp.first_name || ' ' || cp.last_name)
      FROM profile cp WHERE cp.id = n.certified_by
    ),
    'certification_notes', n.certification_notes,
    'member_count', (SELECT COUNT(*) FROM network_member WHERE network_id = n.id AND status = 'active'),
    'max_members', n.max_members,
    'cover_image_url', n.cover_image_url,
    'sport_id', n.sport_id,
    'sport_name', s.name,
    'invite_code', n.invite_code,
    'created_by', n.created_by,
    'creator_name', COALESCE(p.display_name, p.first_name || ' ' || p.last_name),
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'archived_at', n.archived_at,
    'members', v_members,
    'favorite_facilities', v_facilities
  )
  INTO v_result
  FROM network n
  LEFT JOIN sport s ON s.id = n.sport_id
  LEFT JOIN profile p ON p.id = n.created_by
  WHERE n.id = p_network_id;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_network_detail IS 'Get detailed network info for admin view - FIXED: uses profile_picture_url';

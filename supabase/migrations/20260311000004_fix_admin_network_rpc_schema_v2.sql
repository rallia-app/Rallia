-- Fix admin network RPC functions to use correct schema
-- network.network_type_id -> network_type.name
-- profile.profile_picture_url (not avatar_url)

-- Drop all versions of get_admin_networks function
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_admin_networks(text, text, boolean, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.get_admin_networks;

CREATE OR REPLACE FUNCTION public.get_admin_networks(
  p_network_type text DEFAULT 'all',
  p_search_query text DEFAULT NULL,
  p_is_certified boolean DEFAULT NULL,
  p_sport_id text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_networks jsonb;
  v_total_count integer;
BEGIN
  -- Get total count
  SELECT COUNT(*)
  INTO v_total_count
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE n.archived_at IS NULL
    AND (p_network_type = 'all' OR nt.name = p_network_type)
    AND (p_search_query IS NULL OR n.name ILIKE '%' || p_search_query || '%')
    AND (p_is_certified IS NULL OR COALESCE(n.is_certified, false) = p_is_certified)
    AND (p_sport_id IS NULL OR n.sport_id::text = p_sport_id);

  -- Get networks
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'name', n.name,
      'description', n.description,
      'network_type', nt.name,
      'network_type_display', nt.display_name,
      'is_private', n.is_private,
      'is_certified', COALESCE(n.is_certified, false),
      'certified_at', n.certified_at,
      'member_count', COALESCE(n.member_count, 0),
      'max_members', n.max_members,
      'cover_image_url', n.cover_image_url,
      'sport_id', n.sport_id,
      'sport_name', s.name,
      'created_by', n.created_by,
      'creator_name', COALESCE(p.display_name, p.first_name || ' ' || p.last_name),
      'created_at', n.created_at
    ) ORDER BY n.created_at DESC
  ), '[]'::jsonb)
  INTO v_networks
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  LEFT JOIN sport s ON s.id = n.sport_id
  LEFT JOIN profile p ON p.id = n.created_by
  WHERE n.archived_at IS NULL
    AND (p_network_type = 'all' OR nt.name = p_network_type)
    AND (p_search_query IS NULL OR n.name ILIKE '%' || p_search_query || '%')
    AND (p_is_certified IS NULL OR COALESCE(n.is_certified, false) = p_is_certified)
    AND (p_sport_id IS NULL OR n.sport_id::text = p_sport_id)
  LIMIT p_limit
  OFFSET p_offset;

  RETURN jsonb_build_object(
    'networks', v_networks,
    'total_count', v_total_count,
    'has_more', (p_offset + p_limit) < v_total_count,
    'next_offset', CASE WHEN (p_offset + p_limit) < v_total_count THEN p_offset + p_limit ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.get_admin_networks(text, text, boolean, text, integer, integer) IS 'Get paginated admin networks with filters - FIXED: uses network_type_id join';

-- Drop and recreate get_admin_network_detail
DROP FUNCTION IF EXISTS public.get_admin_network_detail(uuid);

CREATE OR REPLACE FUNCTION public.get_admin_network_detail(p_network_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_members jsonb;
  v_facilities jsonb;
BEGIN
  -- Check if network exists
  IF NOT EXISTS (SELECT 1 FROM network WHERE id = p_network_id) THEN
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
    'network_type', nt.name,
    'network_type_display', nt.display_name,
    'is_private', n.is_private,
    'is_certified', COALESCE(n.is_certified, false),
    'certified_at', n.certified_at,
    'certified_by', n.certified_by,
    'certified_by_name', (
      SELECT COALESCE(cp.display_name, cp.first_name || ' ' || cp.last_name)
      FROM profile cp WHERE cp.id = n.certified_by
    ),
    'certification_notes', n.certification_notes,
    'member_count', COALESCE(n.member_count, 0),
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
  JOIN network_type nt ON nt.id = n.network_type_id
  LEFT JOIN sport s ON s.id = n.sport_id
  LEFT JOIN profile p ON p.id = n.created_by
  WHERE n.id = p_network_id;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_network_detail(uuid) IS 'Get detailed network info for admin view - FIXED: uses network_type_id join and profile_picture_url';

-- Also fix admin_certify_network to use correct join
DROP FUNCTION IF EXISTS public.admin_certify_network(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_certify_network(
  p_network_id uuid,
  p_is_certified boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_network_type text;
BEGIN
  -- Get calling user's admin ID
  SELECT id INTO v_admin_id
  FROM admin
  WHERE id = auth.uid();
  
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Get network type
  SELECT nt.name INTO v_network_type
  FROM network n
  JOIN network_type nt ON nt.id = n.network_type_id
  WHERE n.id = p_network_id;
  
  IF v_network_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Network not found');
  END IF;
  
  -- Only communities can be certified
  IF v_network_type != 'community' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only communities can be certified');
  END IF;
  
  -- Update certification
  UPDATE network
  SET 
    is_certified = p_is_certified,
    certified_at = CASE WHEN p_is_certified THEN now() ELSE NULL END,
    certified_by = CASE WHEN p_is_certified THEN v_admin_id ELSE NULL END,
    certification_notes = p_notes,
    updated_at = now()
  WHERE id = p_network_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'is_certified', p_is_certified,
    'certified_at', CASE WHEN p_is_certified THEN now() ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.admin_certify_network(uuid, boolean, text) IS 'Certify or revoke certification for a community - FIXED: uses network_type_id join';

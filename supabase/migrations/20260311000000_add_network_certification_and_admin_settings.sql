-- =============================================================================
-- Migration: Add Network Certification & Admin Settings
-- Date: 2026-03-11
-- Description: Adds certification columns to network table and creates
--              admin_settings table for configurable system settings
-- =============================================================================

-- =============================================================================
-- PART 1: Add certification columns to network table
-- =============================================================================

-- Add is_certified column (only applicable to communities)
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS is_certified BOOLEAN DEFAULT FALSE;

-- Add certified_at timestamp
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS certified_at TIMESTAMPTZ;

-- Add certified_by reference to admin who certified
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS certified_by UUID REFERENCES public.profile(id) ON DELETE SET NULL;

-- Add certification_notes for admin notes
ALTER TABLE public.network ADD COLUMN IF NOT EXISTS certification_notes TEXT;

-- Add index for certified networks
CREATE INDEX IF NOT EXISTS idx_network_is_certified ON public.network(is_certified) WHERE is_certified = TRUE;

-- Add comments
COMMENT ON COLUMN public.network.is_certified IS 'Whether the community is certified/verified by admin';
COMMENT ON COLUMN public.network.certified_at IS 'Timestamp when the community was certified';
COMMENT ON COLUMN public.network.certified_by IS 'Admin who certified the community';
COMMENT ON COLUMN public.network.certification_notes IS 'Admin notes about the certification';

-- =============================================================================
-- PART 2: Create admin_settings table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.profile(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can view settings
CREATE POLICY "admin_settings_select_policy" ON public.admin_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.admin a 
      WHERE a.id = auth.uid()
    )
  );

-- RLS Policy: Only super_admins can modify settings
CREATE POLICY "admin_settings_modify_policy" ON public.admin_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin a 
      WHERE a.id = auth.uid() 
      AND a.role = 'super_admin'
    )
  );

-- Add comment
COMMENT ON TABLE public.admin_settings IS 'System-wide admin configurable settings';

-- =============================================================================
-- PART 3: Insert default settings
-- =============================================================================

INSERT INTO public.admin_settings (key, value, description)
VALUES (
  'network_limits',
  '{"max_group_members": 20, "max_community_members": null}'::jsonb,
  'Maximum member limits for groups and communities. null means unlimited.'
)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- PART 4: Create function to certify/uncertify a network
-- =============================================================================

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
  v_result JSONB;
BEGIN
  -- Get the current user
  v_admin_id := auth.uid();
  
  -- Verify caller is an admin
  IF NOT EXISTS (
    SELECT 1 FROM admin a 
    WHERE a.id = v_admin_id
  ) THEN
    RAISE EXCEPTION 'Only admins can certify networks';
  END IF;
  
  -- Get network type
  SELECT nt.name INTO v_network_type
  FROM network n
  JOIN network_type nt ON n.network_type_id = nt.id
  WHERE n.id = p_network_id;
  
  IF v_network_type IS NULL THEN
    RAISE EXCEPTION 'Network not found';
  END IF;
  
  -- Only communities can be certified
  IF v_network_type != 'community' THEN
    RAISE EXCEPTION 'Only communities can be certified, not groups';
  END IF;
  
  -- Update the network
  UPDATE network
  SET 
    is_certified = p_is_certified,
    certified_at = CASE WHEN p_is_certified THEN NOW() ELSE NULL END,
    certified_by = CASE WHEN p_is_certified THEN v_admin_id ELSE NULL END,
    certification_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_network_id;
  
  -- Return result
  SELECT jsonb_build_object(
    'success', true,
    'network_id', p_network_id,
    'is_certified', p_is_certified,
    'certified_at', CASE WHEN p_is_certified THEN NOW() ELSE NULL END,
    'certified_by', CASE WHEN p_is_certified THEN v_admin_id ELSE NULL END
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_certify_network IS 'Admin function to certify or uncertify a community';

-- =============================================================================
-- PART 5: Create function to get admin settings
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_setting(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT value INTO v_value
  FROM admin_settings
  WHERE key = p_key;
  
  RETURN v_value;
END;
$$;

COMMENT ON FUNCTION public.get_admin_setting IS 'Get a specific admin setting by key';

-- =============================================================================
-- PART 6: Create function to update admin settings
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_admin_setting(
  p_key TEXT,
  p_value JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  
  -- Verify caller is a super_admin
  IF NOT EXISTS (
    SELECT 1 FROM admin a 
    WHERE a.id = v_admin_id 
    AND a.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can modify settings';
  END IF;
  
  -- Update the setting
  UPDATE admin_settings
  SET 
    value = p_value,
    updated_at = NOW(),
    updated_by = v_admin_id
  WHERE key = p_key;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Setting not found: %', p_key;
  END IF;
  
  RETURN jsonb_build_object('success', true, 'key', p_key, 'value', p_value);
END;
$$;

COMMENT ON FUNCTION public.update_admin_setting IS 'Update an admin setting (super_admin only)';

-- =============================================================================
-- PART 7: Create RPC to get all networks for admin
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
  SELECT COUNT(*) INTO v_total
  FROM network n
  JOIN network_type nt ON n.network_type_id = nt.id
  WHERE 
    (p_search IS NULL OR n.name ILIKE '%' || p_search || '%')
    AND (p_network_type IS NULL OR nt.name = p_network_type)
    AND (p_is_certified IS NULL OR n.is_certified = p_is_certified)
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
    CONCAT(p.first_name, ' ', p.last_name) AS creator_name,
    n.created_at,
    v_total AS total_count
  FROM network n
  JOIN network_type nt ON n.network_type_id = nt.id
  LEFT JOIN sport s ON n.sport_id = s.id
  LEFT JOIN profile p ON n.created_by = p.id
  WHERE 
    (p_search IS NULL OR n.name ILIKE '%' || p_search || '%')
    AND (p_network_type IS NULL OR nt.name = p_network_type)
    AND (p_is_certified IS NULL OR n.is_certified = p_is_certified)
    AND n.archived_at IS NULL
  ORDER BY n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_admin_networks IS 'Get all networks for admin panel with search and filters';

-- =============================================================================
-- PART 8: Create RPC to get network detail for admin
-- =============================================================================

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
      SELECT CONCAT(p.first_name, ' ', p.last_name)
      FROM profile p
      WHERE p.id = n.certified_by
    ),
    'member_count', COALESCE(n.member_count, 0),
    'max_members', n.max_members,
    'cover_image_url', n.cover_image_url,
    'sport_id', n.sport_id,
    'sport_name', s.name,
    'invite_code', n.invite_code,
    'created_by', n.created_by,
    'creator_name', (
      SELECT CONCAT(p.first_name, ' ', p.last_name)
      FROM profile p
      WHERE p.id = n.created_by
    ),
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'archived_at', n.archived_at,
    'members', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', nm.id,
        'player_id', nm.player_id,
        'player_name', CONCAT(mp.first_name, ' ', mp.last_name),
        'player_avatar', mp.avatar_url,
        'role', nm.role,
        'status', nm.status,
        'joined_at', nm.joined_at
      ) ORDER BY nm.joined_at)
      FROM network_member nm
      JOIN profile mp ON nm.player_id = mp.id
      WHERE nm.network_id = n.id
    ),
    'favorite_facilities', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'address', f.address
      ))
      FROM network_favorite_facility nff
      JOIN facility f ON nff.facility_id = f.id
      WHERE nff.network_id = n.id
    )
  ) INTO v_result
  FROM network n
  JOIN network_type nt ON n.network_type_id = nt.id
  LEFT JOIN sport s ON n.sport_id = s.id
  WHERE n.id = p_network_id;
  
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Network not found';
  END IF;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_network_detail IS 'Get detailed network information for admin panel';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.admin_certify_network TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_setting TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_networks TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_network_detail TO authenticated;

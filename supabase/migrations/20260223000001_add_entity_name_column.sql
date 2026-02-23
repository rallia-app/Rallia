-- Migration: Add entity_name column to admin_audit_log
-- This column was referenced by RPC functions but missing from the table

-- Add entity_name column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'admin_audit_log' 
    AND column_name = 'entity_name'
  ) THEN
    ALTER TABLE public.admin_audit_log ADD COLUMN entity_name text;
    COMMENT ON COLUMN public.admin_audit_log.entity_name IS 'Human-readable name for quick display';
  END IF;
END $$;

-- Drop and recreate the get_admin_audit_log function
DROP FUNCTION IF EXISTS public.get_admin_audit_log(integer, integer, uuid, text, text, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_admin_audit_log(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_admin_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  admin_email text,
  admin_name text,
  action_type text,
  entity_type text,
  entity_id uuid,
  entity_name text,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  severity text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id,
    l.admin_id,
    p.email as admin_email,
    COALESCE(p.display_name, p.first_name || ' ' || p.last_name, p.email) as admin_name,
    l.action_type::text,
    l.entity_type::text,
    l.entity_id,
    l.entity_name,
    l.old_data,
    l.new_data,
    l.ip_address,
    l.user_agent,
    l.metadata,
    l.severity,
    l.created_at
  FROM public.admin_audit_log l
  LEFT JOIN public.admin a ON a.id = l.admin_id
  LEFT JOIN public.profile p ON p.id = a.id
  WHERE 
    (p_admin_id IS NULL OR l.admin_id = p_admin_id)
    AND (p_action_type IS NULL OR l.action_type::text = p_action_type)
    AND (p_entity_type IS NULL OR l.entity_type::text = p_entity_type)
    AND (p_severity IS NULL OR l.severity = p_severity)
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  ORDER BY l.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

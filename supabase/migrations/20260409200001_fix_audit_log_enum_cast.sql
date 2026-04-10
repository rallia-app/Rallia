-- Fix get_admin_audit_log: action_type and entity_type are enums,
-- but the function parameters are text. Add explicit casts.

CREATE OR REPLACE FUNCTION public.get_admin_audit_log(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_admin_id uuid DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_start_date timestamp with time zone DEFAULT NULL,
  p_end_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  admin_role text,
  action_type text,
  entity_type text,
  entity_id uuid,
  entity_name text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb,
  severity text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.admin_id,
    COALESCE(p.first_name || ' ' || p.last_name, p.display_name, 'Unknown Admin') as admin_name,
    p.email as admin_email,
    adm.role::text as admin_role,
    l.action_type::text,
    l.entity_type::text,
    l.entity_id,
    l.entity_name,
    l.old_data,
    l.new_data,
    l.metadata,
    l.severity,
    l.created_at
  FROM public.admin_audit_log l
  LEFT JOIN public.admin adm ON adm.id = l.admin_id
  LEFT JOIN public.profile p ON p.id = l.admin_id
  WHERE
    (p_admin_id IS NULL OR l.admin_id = p_admin_id)
    AND (p_action_type IS NULL OR l.action_type = p_action_type::admin_action_type_enum)
    AND (p_entity_type IS NULL OR l.entity_type = p_entity_type::admin_entity_type_enum)
    AND (p_severity IS NULL OR l.severity = p_severity)
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  ORDER BY l.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

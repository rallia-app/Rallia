-- Fix ambiguous column reference "id" in get_admin_alerts and related functions.
-- The RETURNS TABLE defines output columns (id, etc.) that conflict with table columns
-- in the function body. Prefix all table references with aliases.

-- =============================================================================
-- FIX: get_admin_alerts — alias admin table to avoid conflict with RETURNS TABLE id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_alerts(
  p_admin_id uuid,
  p_limit int DEFAULT 20,
  p_include_read boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  alert_type text,
  title text,
  message text,
  severity text,
  source_type text,
  source_id uuid,
  action_url text,
  metadata jsonb,
  is_read boolean,
  read_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_role text;
BEGIN
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  RETURN QUERY
  SELECT
    a.id,
    a.alert_type,
    a.title,
    a.message,
    a.severity,
    a.source_type,
    a.source_id,
    a.action_url,
    a.metadata,
    a.is_read,
    a.read_at,
    a.created_at
  FROM public.admin_alert a
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_dismissed = false
    AND (a.expires_at IS NULL OR a.expires_at > now())
    AND (p_include_read = true OR a.is_read = false)
  ORDER BY
    CASE a.severity
      WHEN 'critical' THEN 1
      WHEN 'warning' THEN 2
      ELSE 3
    END,
    a.created_at DESC
  LIMIT p_limit;
END;
$$;

-- =============================================================================
-- FIX: get_alert_counts — alias admin table to avoid ambiguity
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_alert_counts(
  p_admin_id uuid
)
RETURNS TABLE (
  total bigint,
  critical bigint,
  warning bigint,
  info bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_role text;
BEGIN
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  RETURN QUERY
  SELECT
    count(*) as total,
    count(*) FILTER (WHERE a.severity = 'critical') as critical,
    count(*) FILTER (WHERE a.severity = 'warning') as warning,
    count(*) FILTER (WHERE a.severity = 'info') as info
  FROM public.admin_alert a
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_dismissed = false
    AND a.is_read = false
    AND (a.expires_at IS NULL OR a.expires_at > now());
END;
$$;

-- =============================================================================
-- FIX: mark_alert_read — qualify id reference
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_alert_read(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_alert a
  SET
    is_read = true,
    read_by = p_admin_id,
    read_at = now()
  WHERE a.id = p_alert_id
    AND a.is_read = false;

  RETURN FOUND;
END;
$$;

-- =============================================================================
-- FIX: mark_all_alerts_read — alias admin table
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_all_alerts_read(
  p_admin_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_role text;
  v_count int;
BEGIN
  SELECT adm.role INTO v_admin_role FROM public.admin adm WHERE adm.id = p_admin_id;

  UPDATE public.admin_alert a
  SET
    is_read = true,
    read_by = p_admin_id,
    read_at = now()
  WHERE
    v_admin_role = ANY(a.target_roles)
    AND a.is_read = false
    AND a.is_dismissed = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =============================================================================
-- FIX: dismiss_alert — qualify id reference
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dismiss_alert(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_alert a
  SET
    is_dismissed = true,
    dismissed_by = p_admin_id,
    dismissed_at = now()
  WHERE a.id = p_alert_id
    AND a.is_dismissed = false;

  RETURN FOUND;
END;
$$;

-- ============================================================
-- FIX RPC COLUMN REFERENCES
-- Migration: 20260225000000_fix_rpc_column_references.sql
-- Purpose: Fix incorrect column references in RPC functions
-- 
-- Issues fixed:
-- 1. get_player_reports: rp.avatar_url -> rp.profile_picture_url
-- 2. get_admin_audit_log: a.name, a.email -> p.first_name, p.last_name, p.email (via profile join)
-- 3. get_audit_log_stats: a.name -> use profile display_name
-- ============================================================

-- ============================================================
-- FIX: get_player_reports function
-- profile.avatar_url does not exist, should be profile_picture_url
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_player_reports(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_status report_status_enum DEFAULT NULL,
  p_report_type report_type_enum DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_reported_player_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  reporter_id UUID,
  reporter_name TEXT,
  reporter_avatar TEXT,
  reported_player_id UUID,
  reported_player_name TEXT,
  reported_player_avatar TEXT,
  report_type report_type_enum,
  description TEXT,
  evidence_urls TEXT[],
  related_match_id UUID,
  status report_status_enum,
  priority TEXT,
  reviewed_by UUID,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT,
  admin_notes TEXT,
  resulting_ban_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.id,
    pr.reporter_id,
    COALESCE(rp.first_name || ' ' || rp.last_name, rp.display_name, 'Unknown') AS reporter_name,
    rp.profile_picture_url AS reporter_avatar,
    pr.reported_player_id,
    COALESCE(rep.first_name || ' ' || rep.last_name, rep.display_name, 'Unknown') AS reported_player_name,
    rep.profile_picture_url AS reported_player_avatar,
    pr.report_type,
    pr.description,
    pr.evidence_urls,
    pr.related_match_id,
    pr.status,
    pr.priority,
    pr.reviewed_by,
    COALESCE(ap.first_name || ' ' || ap.last_name, ap.display_name, 'System') AS reviewer_name,
    pr.reviewed_at,
    pr.action_taken,
    pr.admin_notes,
    pr.resulting_ban_id,
    pr.created_at,
    pr.updated_at
  FROM public.player_report pr
  LEFT JOIN public.profile rp ON pr.reporter_id = rp.id
  LEFT JOIN public.profile rep ON pr.reported_player_id = rep.id
  LEFT JOIN public.profile ap ON pr.reviewed_by = ap.id
  WHERE
    (p_status IS NULL OR pr.status = p_status)
    AND (p_report_type IS NULL OR pr.report_type = p_report_type)
    AND (p_priority IS NULL OR pr.priority = p_priority)
    AND (p_reported_player_id IS NULL OR pr.reported_player_id = p_reported_player_id)
  ORDER BY
    CASE pr.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    pr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================================
-- FIX: get_admin_audit_log function
-- admin table doesn't have 'name' or 'email' columns
-- Need to join with profile table to get admin name/email
-- ============================================================
-- Drop old function first (return type changed)
DROP FUNCTION IF EXISTS public.get_admin_audit_log(int, int, uuid, text, text, text, timestamp with time zone, timestamp with time zone);

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
    a.role::text as admin_role,
    l.action_type,
    l.entity_type,
    l.entity_id,
    l.entity_name,
    l.old_data,
    l.new_data,
    l.metadata,
    l.severity,
    l.created_at
  FROM public.admin_audit_log l
  LEFT JOIN public.admin a ON a.id = l.admin_id
  LEFT JOIN public.profile p ON p.id = l.admin_id
  WHERE 
    (p_admin_id IS NULL OR l.admin_id = p_admin_id)
    AND (p_action_type IS NULL OR l.action_type = p_action_type)
    AND (p_entity_type IS NULL OR l.entity_type = p_entity_type)
    AND (p_severity IS NULL OR l.severity = p_severity)
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  ORDER BY l.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================================
-- FIX: get_audit_log_stats function
-- admin table doesn't have 'name' column
-- Need to join with profile table to get admin display name
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_log_stats(
  p_days int DEFAULT 7
)
RETURNS TABLE (
  total_actions bigint,
  actions_by_type jsonb,
  actions_by_admin jsonb,
  actions_by_severity jsonb,
  daily_counts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH date_range AS (
    SELECT now() - (p_days || ' days')::interval as start_date
  ),
  logs AS (
    SELECT * FROM public.admin_audit_log
    WHERE created_at >= (SELECT start_date FROM date_range)
  ),
  by_type AS (
    SELECT jsonb_object_agg(action_type, cnt) as data
    FROM (
      SELECT action_type, count(*) as cnt
      FROM logs
      GROUP BY action_type
    ) t
  ),
  by_admin AS (
    SELECT jsonb_object_agg(
      COALESCE(p.first_name || ' ' || p.last_name, p.display_name, l.admin_id::text), 
      cnt
    ) as data
    FROM (
      SELECT admin_id, count(*) as cnt
      FROM logs
      GROUP BY admin_id
    ) l
    LEFT JOIN public.profile p ON p.id = l.admin_id
  ),
  by_severity AS (
    SELECT jsonb_object_agg(severity, cnt) as data
    FROM (
      SELECT severity, count(*) as cnt
      FROM logs
      GROUP BY severity
    ) t
  ),
  daily AS (
    SELECT jsonb_agg(
      jsonb_build_object('date', d, 'count', cnt)
      ORDER BY d
    ) as data
    FROM (
      SELECT date_trunc('day', created_at)::date as d, count(*) as cnt
      FROM logs
      GROUP BY date_trunc('day', created_at)::date
    ) t
  )
  SELECT 
    (SELECT count(*) FROM logs),
    COALESCE((SELECT data FROM by_type), '{}'::jsonb),
    COALESCE((SELECT data FROM by_admin), '{}'::jsonb),
    COALESCE((SELECT data FROM by_severity), '{}'::jsonb),
    COALESCE((SELECT data FROM daily), '[]'::jsonb);
END;
$$;

-- ============================================================
-- GRANTS (ensure functions are accessible)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_player_reports(INT, INT, report_status_enum, report_type_enum, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(int, int, uuid, text, text, text, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_log_stats(int) TO authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON FUNCTION public.get_player_reports IS 'Get paginated and filtered player reports - FIXED: uses profile_picture_url instead of avatar_url';
COMMENT ON FUNCTION public.get_admin_audit_log IS 'Get audit log with filters - FIXED: joins profile table for admin name/email';
COMMENT ON FUNCTION public.get_audit_log_stats IS 'Get audit log statistics - FIXED: joins profile table for admin names';

-- ============================================================
-- FIX: get_match_statistics function
-- match table doesn't have a 'status' column
-- Need to derive status from closed_at and cancelled_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_match_statistics(
  p_sport_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS TABLE(
  total_matches bigint,
  scheduled_matches bigint,
  completed_matches bigint,
  cancelled_matches bigint,
  avg_participants numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_matches,
    -- Scheduled: not closed and not cancelled
    COUNT(*) FILTER (WHERE m.closed_at IS NULL AND m.cancelled_at IS NULL)::bigint as scheduled_matches,
    -- Completed: has closed_at and not cancelled
    COUNT(*) FILTER (WHERE m.closed_at IS NOT NULL AND m.cancelled_at IS NULL)::bigint as completed_matches,
    -- Cancelled: has cancelled_at
    COUNT(*) FILTER (WHERE m.cancelled_at IS NOT NULL)::bigint as cancelled_matches,
    COALESCE(AVG(
      (SELECT COUNT(*) FROM match_participant mp WHERE mp.match_id = m.id)
    ), 0)::numeric as avg_participants
  FROM match m
  WHERE 
    (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND m.created_at >= CURRENT_DATE - p_days;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_match_statistics(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_match_statistics IS 'Get match statistics - FIXED: derives status from closed_at/cancelled_at instead of non-existent status column';

-- ============================================================
-- ADMIN AUDIT LOG SYSTEM
-- Migration: 20260222000002_add_audit_log_tables.sql
-- Purpose: Track all admin actions for accountability and compliance
-- ============================================================

-- ============================================================
-- ADMIN AUDIT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admin(id) ON DELETE SET NULL,
  action_type text NOT NULL, -- 'view', 'create', 'update', 'delete', 'ban', 'unban', 'export', 'login', 'logout'
  entity_type text NOT NULL, -- 'player', 'match', 'report', 'admin', 'analytics', 'settings', 'system'
  entity_id uuid,
  entity_name text, -- Human-readable name for quick display
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  user_agent text,
  session_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_log_action_type_check CHECK (action_type IN ('view', 'create', 'update', 'delete', 'ban', 'unban', 'export', 'login', 'logout', 'search', 'config_change')),
  CONSTRAINT admin_audit_log_severity_check CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Add severity column if it doesn't exist (for repair)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'admin_audit_log' 
    AND column_name = 'severity'
  ) THEN
    ALTER TABLE public.admin_audit_log ADD COLUMN severity text NOT NULL DEFAULT 'info';
    ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_severity_check CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END $$;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id ON public.admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity ON public.admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON public.admin_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_severity ON public.admin_audit_log(severity) WHERE severity IN ('warning', 'critical');

-- ============================================================
-- ADMIN ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_alert (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  alert_type text NOT NULL, -- 'security', 'system', 'user_activity', 'threshold', 'error'
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
  source_type text, -- 'audit_log', 'system', 'cron', 'manual'
  source_id uuid, -- Reference to audit log or other source
  target_roles text[] DEFAULT ARRAY['super_admin']::text[], -- Which admin roles should see this
  is_read boolean NOT NULL DEFAULT false,
  read_by uuid REFERENCES public.admin(id),
  read_at timestamp with time zone,
  is_dismissed boolean NOT NULL DEFAULT false,
  dismissed_by uuid REFERENCES public.admin(id),
  dismissed_at timestamp with time zone,
  action_url text, -- Deep link to relevant screen
  metadata jsonb DEFAULT '{}'::jsonb,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_alert_pkey PRIMARY KEY (id),
  CONSTRAINT admin_alert_type_check CHECK (alert_type IN ('security', 'system', 'user_activity', 'threshold', 'error')),
  CONSTRAINT admin_alert_severity_check CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_admin_alert_created_at ON public.admin_alert(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_alert_unread ON public.admin_alert(is_read, is_dismissed) WHERE is_read = false AND is_dismissed = false;
CREATE INDEX IF NOT EXISTS idx_admin_alert_severity ON public.admin_alert(severity) WHERE severity IN ('warning', 'critical');
CREATE INDEX IF NOT EXISTS idx_admin_alert_type ON public.admin_alert(alert_type);

-- ============================================================
-- ALERT PREFERENCES TABLE (per-admin notification settings)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_alert_preference (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admin(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  in_app_enabled boolean NOT NULL DEFAULT true,
  min_severity text NOT NULL DEFAULT 'info', -- Only notify for this severity or higher
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_alert_preference_pkey PRIMARY KEY (id),
  CONSTRAINT admin_alert_preference_unique UNIQUE (admin_id, alert_type),
  CONSTRAINT admin_alert_preference_severity_check CHECK (min_severity IN ('info', 'warning', 'critical'))
);

-- ============================================================
-- FUNCTION: Log admin action
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_entity_name text DEFAULT NULL,
  p_old_data jsonb DEFAULT NULL,
  p_new_data jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_severity text DEFAULT 'info'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO public.admin_audit_log (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    old_data,
    new_data,
    metadata,
    severity
  ) VALUES (
    p_admin_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_old_data,
    p_new_data,
    p_metadata,
    p_severity
  )
  RETURNING id INTO v_log_id;
  
  -- Auto-create alert for critical actions
  IF p_severity = 'critical' OR p_action_type IN ('ban', 'delete', 'config_change') THEN
    INSERT INTO public.admin_alert (
      alert_type,
      title,
      message,
      severity,
      source_type,
      source_id,
      target_roles,
      metadata
    ) VALUES (
      CASE 
        WHEN p_action_type = 'ban' THEN 'user_activity'
        WHEN p_action_type = 'delete' THEN 'system'
        WHEN p_action_type = 'config_change' THEN 'system'
        ELSE 'security'
      END,
      CASE 
        WHEN p_action_type = 'ban' THEN 'User Banned'
        WHEN p_action_type = 'delete' THEN 'Data Deleted'
        WHEN p_action_type = 'config_change' THEN 'Configuration Changed'
        ELSE 'Critical Action Performed'
      END,
      format('%s action on %s: %s', p_action_type, p_entity_type, COALESCE(p_entity_name, p_entity_id::text, 'unknown')),
      COALESCE(p_severity, 'warning'),
      'audit_log',
      v_log_id,
      ARRAY['super_admin']::text[],
      jsonb_build_object('admin_id', p_admin_id, 'action_type', p_action_type)
    );
  END IF;
  
  RETURN v_log_id;
END;
$$;

-- ============================================================
-- FUNCTION: Get audit log with filters
-- ============================================================
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
    a.name as admin_name,
    a.email as admin_email,
    a.role as admin_role,
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
-- FUNCTION: Get audit log statistics
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
    SELECT jsonb_object_agg(COALESCE(a.name, l.admin_id::text), cnt) as data
    FROM (
      SELECT admin_id, count(*) as cnt
      FROM logs
      GROUP BY admin_id
    ) l
    LEFT JOIN public.admin a ON a.id = l.admin_id
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
-- FUNCTION: Get unread alerts for admin
-- ============================================================
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
  -- Get admin role
  SELECT role INTO v_admin_role FROM public.admin WHERE id = p_admin_id;
  
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

-- ============================================================
-- FUNCTION: Mark alert as read
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_alert_read(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_alert
  SET 
    is_read = true,
    read_by = p_admin_id,
    read_at = now()
  WHERE id = p_alert_id AND is_read = false;
  
  RETURN FOUND;
END;
$$;

-- ============================================================
-- FUNCTION: Dismiss alert
-- ============================================================
CREATE OR REPLACE FUNCTION public.dismiss_alert(
  p_alert_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.admin_alert
  SET 
    is_dismissed = true,
    dismissed_by = p_admin_id,
    dismissed_at = now()
  WHERE id = p_alert_id AND is_dismissed = false;
  
  RETURN FOUND;
END;
$$;

-- ============================================================
-- FUNCTION: Get alert counts by severity
-- ============================================================
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
  SELECT role INTO v_admin_role FROM public.admin WHERE id = p_admin_id;
  
  RETURN QUERY
  SELECT 
    count(*) as total,
    count(*) FILTER (WHERE severity = 'critical') as critical,
    count(*) FILTER (WHERE severity = 'warning') as warning,
    count(*) FILTER (WHERE severity = 'info') as info
  FROM public.admin_alert
  WHERE 
    v_admin_role = ANY(target_roles)
    AND is_dismissed = false
    AND is_read = false
    AND (expires_at IS NULL OR expires_at > now());
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_alert_preference ENABLE ROW LEVEL SECURITY;

-- Audit log policies (admins can read, system writes)
-- Drop existing policy if it exists (for repair)
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_log;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- Alert policies
DROP POLICY IF EXISTS "Admins can view their alerts" ON public.admin_alert;
CREATE POLICY "Admins can view their alerts"
  ON public.admin_alert
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
      AND admin.role::text = ANY(admin_alert.target_roles)
    )
  );

DROP POLICY IF EXISTS "Admins can update their alerts" ON public.admin_alert;
CREATE POLICY "Admins can update their alerts"
  ON public.admin_alert
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
      AND admin.role::text = ANY(admin_alert.target_roles)
    )
  );

-- Alert preferences policies
DROP POLICY IF EXISTS "Admins can manage their preferences" ON public.admin_alert_preference;
CREATE POLICY "Admins can manage their preferences"
  ON public.admin_alert_preference
  FOR ALL
  TO authenticated
  USING (
    admin_id IN (
      SELECT id FROM public.admin
      WHERE id = auth.uid()
    )
  );

-- ============================================================
-- GRANTS
-- ============================================================
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT SELECT, UPDATE ON public.admin_alert TO authenticated;
GRANT ALL ON public.admin_alert_preference TO authenticated;

-- Grant execute on functions (with correct signatures)
GRANT EXECUTE ON FUNCTION public.log_admin_action(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_log(int, int, uuid, text, text, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_log_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_alerts(uuid, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_alert_read(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_alert(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_counts(uuid) TO authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE public.admin_audit_log IS 'Tracks all admin actions for accountability and compliance';
COMMENT ON TABLE public.admin_alert IS 'Admin notifications for critical events and system alerts';
COMMENT ON TABLE public.admin_alert_preference IS 'Per-admin notification preferences';
COMMENT ON FUNCTION public.log_admin_action(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, text) IS 'Records an admin action and auto-creates alerts for critical actions';
COMMENT ON FUNCTION public.get_admin_audit_log(int, int, uuid, text, text, text, timestamptz, timestamptz) IS 'Retrieves paginated and filtered audit log entries';
COMMENT ON FUNCTION public.get_audit_log_stats(integer) IS 'Returns audit log statistics for dashboard';
COMMENT ON FUNCTION public.get_admin_alerts(uuid, int, boolean) IS 'Retrieves alerts for a specific admin based on role';

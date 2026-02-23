-- ============================================================
-- PLAYER REPORTS SYSTEM
-- Migration: 20260223000000_add_player_reports.sql
-- Purpose: Allow players to report other players for violations
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================

-- Report type enum (create only if not exists)
DO $$ BEGIN
  CREATE TYPE report_type_enum AS ENUM (
    'harassment',
    'cheating',
    'inappropriate_content',
    'spam',
    'impersonation',
    'no_show',
    'unsportsmanlike',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Report status enum (create only if not exists)
DO $$ BEGIN
  CREATE TYPE report_status_enum AS ENUM (
    'pending',
    'under_review',
    'dismissed',
    'action_taken',
    'escalated'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PLAYER REPORT TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.player_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reporter and reported
  reporter_id UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  reported_player_id UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  
  -- Report details
  report_type report_type_enum NOT NULL,
  description TEXT,
  evidence_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Match context (optional - if report is related to a specific match)
  related_match_id UUID REFERENCES public.match(id) ON DELETE SET NULL,
  
  -- Status tracking
  status report_status_enum NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Admin review
  reviewed_by UUID REFERENCES public.admin(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT,
  admin_notes TEXT,
  
  -- Related ban (if action was taken)
  resulting_ban_id UUID REFERENCES public.player_ban(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Prevent self-reporting
  CONSTRAINT no_self_report CHECK (reporter_id != reported_player_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_player_report_status ON public.player_report(status);
CREATE INDEX idx_player_report_reported ON public.player_report(reported_player_id);
CREATE INDEX idx_player_report_reporter ON public.player_report(reporter_id);
CREATE INDEX idx_player_report_created ON public.player_report(created_at DESC);
CREATE INDEX idx_player_report_priority ON public.player_report(priority) WHERE status = 'pending';
CREATE INDEX idx_player_report_type ON public.player_report(report_type);

-- Composite index for admin queries
CREATE INDEX idx_player_report_admin_queue ON public.player_report(status, priority DESC, created_at ASC)
  WHERE status IN ('pending', 'under_review');

-- ============================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_player_report_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_player_report_updated_at
  BEFORE UPDATE ON public.player_report
  FOR EACH ROW
  EXECUTE FUNCTION update_player_report_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.player_report ENABLE ROW LEVEL SECURITY;

-- Players can create reports
CREATE POLICY "Players can create reports"
  ON public.player_report
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Players can view their own submitted reports
CREATE POLICY "Players can view own reports"
  ON public.player_report
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Admins can view all reports
CREATE POLICY "Admins can view all reports"
  ON public.player_report
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- Admins can update reports (review, dismiss, etc.)
CREATE POLICY "Admins can update reports"
  ON public.player_report
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function to get pending reports count
CREATE OR REPLACE FUNCTION public.get_pending_reports_count()
RETURNS TABLE (
  total BIGINT,
  pending BIGINT,
  under_review BIGINT,
  high_priority BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE pr.status = 'pending')::BIGINT AS pending,
    COUNT(*) FILTER (WHERE pr.status = 'under_review')::BIGINT AS under_review,
    COUNT(*) FILTER (WHERE pr.priority IN ('high', 'urgent') AND pr.status = 'pending')::BIGINT AS high_priority
  FROM public.player_report pr
  WHERE pr.status IN ('pending', 'under_review');
END;
$$;

-- Function to get reports with pagination and filters
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
    rp.avatar_url AS reporter_avatar,
    pr.reported_player_id,
    COALESCE(rep.first_name || ' ' || rep.last_name, rep.display_name, 'Unknown') AS reported_player_name,
    rep.avatar_url AS reported_player_avatar,
    pr.report_type,
    pr.description,
    pr.evidence_urls,
    pr.related_match_id,
    pr.status,
    pr.priority,
    pr.reviewed_by,
    COALESCE(ap.first_name || ' ' || ap.last_name, 'System') AS reviewer_name,
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

-- Function to review a report
CREATE OR REPLACE FUNCTION public.review_player_report(
  p_report_id UUID,
  p_admin_id UUID,
  p_status report_status_enum,
  p_action_taken TEXT DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL,
  p_ban_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.player_report
  SET
    status = p_status,
    reviewed_by = p_admin_id,
    reviewed_at = NOW(),
    action_taken = COALESCE(p_action_taken, action_taken),
    admin_notes = COALESCE(p_admin_notes, admin_notes),
    resulting_ban_id = COALESCE(p_ban_id, resulting_ban_id)
  WHERE id = p_report_id;
  
  RETURN FOUND;
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT ON public.player_report TO authenticated;
GRANT INSERT ON public.player_report TO authenticated;
GRANT UPDATE ON public.player_report TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_pending_reports_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_reports(INT, INT, report_status_enum, report_type_enum, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_player_report(UUID, UUID, report_status_enum, TEXT, TEXT, UUID) TO authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE public.player_report IS 'Player reports for violations and misconduct';
COMMENT ON COLUMN public.player_report.report_type IS 'Type of violation being reported';
COMMENT ON COLUMN public.player_report.priority IS 'Admin-assigned priority for triage';
COMMENT ON COLUMN public.player_report.resulting_ban_id IS 'Link to ban if report resulted in action';
COMMENT ON FUNCTION public.get_pending_reports_count() IS 'Get counts of pending reports for admin dashboard';
COMMENT ON FUNCTION public.get_player_reports IS 'Get paginated and filtered player reports';
COMMENT ON FUNCTION public.review_player_report IS 'Admin function to review and action a report';

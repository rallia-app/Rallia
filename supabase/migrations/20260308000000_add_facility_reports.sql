-- ============================================================
-- FACILITY REPORTS SYSTEM
-- Migration: 20260308000000_add_facility_reports.sql
-- Purpose: Allow players to report inaccurate facility information
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================

-- Facility report reason enum
DO $$ BEGIN
  CREATE TYPE facility_report_reason_enum AS ENUM (
    'wrong_address',
    'incorrect_hours',
    'wrong_court_count',
    'wrong_surface_types',
    'outdated_contact_info',
    'wrong_amenities',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- FACILITY REPORT TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.facility_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reporter and facility
  reporter_id UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES public.facility(id) ON DELETE CASCADE,

  -- Report details
  reason facility_report_reason_enum NOT NULL,
  description TEXT,

  -- Status tracking (reuse existing report_status_enum)
  status report_status_enum NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),

  -- Admin review
  reviewed_by UUID REFERENCES public.admin(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_facility_report_facility ON public.facility_report(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_report_status ON public.facility_report(status);
CREATE INDEX IF NOT EXISTS idx_facility_report_created ON public.facility_report(created_at DESC);

-- ============================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_facility_report_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_facility_report_updated_at ON public.facility_report;
CREATE TRIGGER trigger_facility_report_updated_at
  BEFORE UPDATE ON public.facility_report
  FOR EACH ROW
  EXECUTE FUNCTION update_facility_report_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.facility_report ENABLE ROW LEVEL SECURITY;

-- Players can create reports
DROP POLICY IF EXISTS "Players can create facility reports" ON public.facility_report;
CREATE POLICY "Players can create facility reports"
  ON public.facility_report
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Players can view their own submitted reports
DROP POLICY IF EXISTS "Players can view own facility reports" ON public.facility_report;
CREATE POLICY "Players can view own facility reports"
  ON public.facility_report
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Admins can view all reports
DROP POLICY IF EXISTS "Admins can view all facility reports" ON public.facility_report;
CREATE POLICY "Admins can view all facility reports"
  ON public.facility_report
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- Admins can update reports
DROP POLICY IF EXISTS "Admins can update facility reports" ON public.facility_report;
CREATE POLICY "Admins can update facility reports"
  ON public.facility_report
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- ============================================================
-- GRANTS
-- ============================================================

GRANT SELECT ON public.facility_report TO authenticated;
GRANT INSERT ON public.facility_report TO authenticated;
GRANT UPDATE ON public.facility_report TO authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE public.facility_report IS 'Facility inaccuracy reports submitted by players';
COMMENT ON COLUMN public.facility_report.reason IS 'Type of inaccuracy being reported';
COMMENT ON COLUMN public.facility_report.priority IS 'Priority for admin triage';

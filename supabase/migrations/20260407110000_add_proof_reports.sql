-- ============================================================
-- PROOF REPORTS SYSTEM
-- Migration: 20260407110000_add_proof_reports.sql
-- Purpose: Allow players to report fake or inaccurate rating proofs
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================

-- Proof report reason enum
DO $$ BEGIN
  CREATE TYPE proof_report_reason_enum AS ENUM (
    'fake_proof',
    'misleading',
    'outdated',
    'stolen_content',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PROOF REPORT TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proof_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reporter and proof
  reporter_id UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  proof_id UUID NOT NULL REFERENCES public.rating_proof(id) ON DELETE CASCADE,

  -- Report details
  reason proof_report_reason_enum NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_proof_report_proof ON public.proof_report(proof_id);
CREATE INDEX IF NOT EXISTS idx_proof_report_status ON public.proof_report(status);
CREATE INDEX IF NOT EXISTS idx_proof_report_created ON public.proof_report(created_at DESC);

-- ============================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_proof_report_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_proof_report_updated_at ON public.proof_report;
CREATE TRIGGER trigger_proof_report_updated_at
  BEFORE UPDATE ON public.proof_report
  FOR EACH ROW
  EXECUTE FUNCTION update_proof_report_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.proof_report ENABLE ROW LEVEL SECURITY;

-- Players can create reports
DROP POLICY IF EXISTS "Players can create proof reports" ON public.proof_report;
CREATE POLICY "Players can create proof reports"
  ON public.proof_report
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Players can view their own submitted reports
DROP POLICY IF EXISTS "Players can view own proof reports" ON public.proof_report;
CREATE POLICY "Players can view own proof reports"
  ON public.proof_report
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Admins can view all reports
DROP POLICY IF EXISTS "Admins can view all proof reports" ON public.proof_report;
CREATE POLICY "Admins can view all proof reports"
  ON public.proof_report
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin
      WHERE admin.id = auth.uid()
    )
  );

-- Admins can update reports
DROP POLICY IF EXISTS "Admins can update proof reports" ON public.proof_report;
CREATE POLICY "Admins can update proof reports"
  ON public.proof_report
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

GRANT SELECT ON public.proof_report TO authenticated;
GRANT INSERT ON public.proof_report TO authenticated;
GRANT UPDATE ON public.proof_report TO authenticated;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE public.proof_report IS 'Rating proof reports submitted by players for fake or inaccurate proofs';
COMMENT ON COLUMN public.proof_report.reason IS 'Type of issue being reported';
COMMENT ON COLUMN public.proof_report.priority IS 'Priority for admin triage';

-- =============================================================================
-- Migration: Create referral_link_click table
-- Description: Track unique visits to the web invite page per device.
-- Replaces unreliable "invited" count from referral_invite table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.referral_link_click (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code VARCHAR(12) NOT NULL,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-device deduplication: one click per device per referral code
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_link_click_unique
  ON public.referral_link_click(referral_code, device_fingerprint);

-- Index for counting clicks by referral code
CREATE INDEX IF NOT EXISTS idx_referral_link_click_code
  ON public.referral_link_click(referral_code);

-- RLS: service-role only (inserts from web server)
ALTER TABLE public.referral_link_click ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read clicks for their own referral code
CREATE POLICY "Users can view clicks for own referral code"
ON public.referral_link_click FOR SELECT
TO authenticated
USING (
  referral_code IN (
    SELECT referral_code FROM public.profile WHERE id = auth.uid()
  )
);

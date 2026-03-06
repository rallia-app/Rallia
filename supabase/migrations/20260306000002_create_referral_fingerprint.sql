-- =============================================================================
-- Migration: Create referral_fingerprint table
-- Description: Store device fingerprints from web invite page visits for
-- iOS deferred deep linking. When a new iOS user opens the app, we match
-- their fingerprint to attribute the referral.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.referral_fingerprint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code VARCHAR(12) NOT NULL,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  matched_player_id UUID REFERENCES public.profile(id),
  matched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for matching: find unmatched fingerprints by fingerprint+IP
-- Expiry filtering (expires_at > NOW()) is handled in the query since NOW() is not immutable
CREATE INDEX IF NOT EXISTS idx_referral_fingerprint_match
  ON public.referral_fingerprint(device_fingerprint, ip_address)
  WHERE matched_player_id IS NULL;

-- RLS: service-role only for inserts, authenticated for matching
ALTER TABLE public.referral_fingerprint ENABLE ROW LEVEL SECURITY;

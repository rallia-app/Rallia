-- =============================================================================
-- Migration: Extend referral fingerprint expiry from 24 hours to 7 days
-- Description: Users who click a referral link on iOS often delay signup by
-- several days. A 24-hour window loses attribution for these users.
-- =============================================================================

-- Update the column default for new rows
ALTER TABLE public.referral_fingerprint
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

-- Extend any existing unexpired fingerprints to the new window
UPDATE public.referral_fingerprint
SET expires_at = created_at + INTERVAL '7 days'
WHERE matched_player_id IS NULL
  AND expires_at > NOW();

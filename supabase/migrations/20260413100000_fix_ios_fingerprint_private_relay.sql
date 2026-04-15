-- =============================================================================
-- Migration: Fix iOS fingerprint matching for iCloud Private Relay
-- Description: iCloud Private Relay (enabled by default for iCloud+ subscribers
-- on iOS 15+) routes Safari traffic through Apple's relay servers, giving the
-- web server a different IP than the device's real IP. Since the fingerprint
-- was SHA256(ip:device_traits), the hash computed by the web page (using the
-- relay IP) never matched the hash computed by the mobile app (using the real
-- IP). Fix: match on device_fingerprint alone, using ip_address only as a
-- preference tiebreaker when multiple candidates exist.
-- =============================================================================

-- Update the match function to use two-tier matching:
-- 1. Prefer exact match (fingerprint + IP) for non-Private-Relay cases
-- 2. Fall back to fingerprint-only match for Private Relay cases
DROP FUNCTION IF EXISTS match_referral_fingerprint(TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION match_referral_fingerprint(
  p_device_fingerprint TEXT,
  p_ip_address TEXT,
  p_player_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_fingerprint_id UUID;
  v_referral_code VARCHAR(12);
  v_invitation_type TEXT;
  v_target_id TEXT;
BEGIN
  -- Tier 1: Try exact match on both fingerprint AND IP (highest confidence)
  SELECT id, referral_code, invitation_type, target_id
  INTO v_fingerprint_id, v_referral_code, v_invitation_type, v_target_id
  FROM public.referral_fingerprint
  WHERE device_fingerprint = p_device_fingerprint
    AND ip_address = p_ip_address
    AND matched_player_id IS NULL
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  -- Tier 2: Fall back to fingerprint-only match (handles iCloud Private Relay)
  IF v_fingerprint_id IS NULL THEN
    SELECT id, referral_code, invitation_type, target_id
    INTO v_fingerprint_id, v_referral_code, v_invitation_type, v_target_id
    FROM public.referral_fingerprint
    WHERE device_fingerprint = p_device_fingerprint
      AND matched_player_id IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_fingerprint_id IS NOT NULL THEN
    -- Mark as matched
    UPDATE public.referral_fingerprint
    SET matched_player_id = p_player_id,
        matched_at = NOW()
    WHERE id = v_fingerprint_id;

    RETURN jsonb_build_object(
      'code', v_referral_code,
      'invitation_type', COALESCE(v_invitation_type, 'referral'),
      'target_id', v_target_id
    );
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add index for fingerprint-only lookups (tier 2 fallback)
CREATE INDEX IF NOT EXISTS idx_referral_fingerprint_device_only
  ON public.referral_fingerprint(device_fingerprint)
  WHERE matched_player_id IS NULL;

GRANT EXECUTE ON FUNCTION match_referral_fingerprint(TEXT, TEXT, UUID) TO authenticated;

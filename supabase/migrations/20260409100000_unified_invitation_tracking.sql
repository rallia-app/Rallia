-- =============================================================================
-- Migration: Unified invitation type tracking
-- Description: Extend referral attribution to track which invitation type
-- (referral, match, group, community) led to each signup. Adds invitation_type
-- and target_id columns across the referral tracking tables and updates all RPCs.
-- =============================================================================

-- =============================================================================
-- 1. Add invitation type columns to profile
-- =============================================================================
ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS referral_invitation_type TEXT
    CHECK (referral_invitation_type IN ('referral', 'match', 'group', 'community')),
  ADD COLUMN IF NOT EXISTS referral_target_id TEXT;

COMMENT ON COLUMN public.profile.referral_invitation_type IS 'Which type of invitation link led to this user signing up';
COMMENT ON COLUMN public.profile.referral_target_id IS 'The specific entity ID from the invitation (match ID, group invite code, etc.)';

-- =============================================================================
-- 2. Add invitation type columns to referral_link_click
-- =============================================================================
ALTER TABLE public.referral_link_click
  ADD COLUMN IF NOT EXISTS invitation_type TEXT DEFAULT 'referral'
    CHECK (invitation_type IN ('referral', 'match', 'group', 'community')),
  ADD COLUMN IF NOT EXISTS target_id TEXT;

-- Update unique index to include invitation_type
-- (same referral code + device can click different invitation types)
DROP INDEX IF EXISTS idx_referral_link_click_unique;
CREATE UNIQUE INDEX idx_referral_link_click_unique
  ON public.referral_link_click(referral_code, device_fingerprint, COALESCE(invitation_type, 'referral'));

-- =============================================================================
-- 3. Add invitation type columns to referral_fingerprint
-- =============================================================================
ALTER TABLE public.referral_fingerprint
  ADD COLUMN IF NOT EXISTS invitation_type TEXT DEFAULT 'referral'
    CHECK (invitation_type IN ('referral', 'match', 'group', 'community')),
  ADD COLUMN IF NOT EXISTS target_id TEXT;

-- =============================================================================
-- 4. Update log_referral_click RPC
-- =============================================================================
DROP FUNCTION IF EXISTS log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION log_referral_click(
  p_referral_code VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_invitation_type TEXT DEFAULT 'referral',
  p_target_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.referral_link_click (
    referral_code, device_fingerprint, ip_address, user_agent,
    invitation_type, target_id
  )
  VALUES (
    UPPER(p_referral_code), p_device_fingerprint, p_ip_address, p_user_agent,
    COALESCE(p_invitation_type, 'referral'), p_target_id
  )
  ON CONFLICT (referral_code, device_fingerprint, COALESCE(invitation_type, 'referral'))
  DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 5. Update log_referral_fingerprint RPC
-- =============================================================================
DROP FUNCTION IF EXISTS log_referral_fingerprint(VARCHAR(12), TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION log_referral_fingerprint(
  p_referral_code VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_invitation_type TEXT DEFAULT 'referral',
  p_target_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.referral_fingerprint (
    referral_code, device_fingerprint, ip_address, user_agent,
    invitation_type, target_id
  )
  VALUES (
    UPPER(p_referral_code), p_device_fingerprint, p_ip_address, p_user_agent,
    COALESCE(p_invitation_type, 'referral'), p_target_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 6. Update match_referral_fingerprint RPC
-- Returns JSONB with code, invitation_type, and target_id instead of just TEXT
-- =============================================================================
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
  -- Find the most recent unmatched, unexpired fingerprint
  SELECT id, referral_code, invitation_type, target_id
  INTO v_fingerprint_id, v_referral_code, v_invitation_type, v_target_id
  FROM public.referral_fingerprint
  WHERE device_fingerprint = p_device_fingerprint
    AND ip_address = p_ip_address
    AND matched_player_id IS NULL
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

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

-- =============================================================================
-- 7. Update attribute_referral RPC
-- Now accepts and stores invitation_type and target_id on the profile
-- =============================================================================
DROP FUNCTION IF EXISTS attribute_referral(VARCHAR(12), UUID, TEXT);
DROP FUNCTION IF EXISTS attribute_referral(VARCHAR(12), UUID);

CREATE OR REPLACE FUNCTION attribute_referral(
  p_referral_code VARCHAR(12),
  p_new_player_id UUID,
  p_new_player_email TEXT DEFAULT NULL,
  p_invitation_type TEXT DEFAULT 'referral',
  p_target_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_referrer_id UUID;
BEGIN
  -- Find the referrer by code
  SELECT id INTO v_referrer_id
  FROM public.profile
  WHERE referral_code = UPPER(p_referral_code);

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Don't allow self-referral
  IF v_referrer_id = p_new_player_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  -- Check if already referred
  IF EXISTS(SELECT 1 FROM public.profile WHERE id = p_new_player_id AND referred_by IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred');
  END IF;

  -- Set referred_by and invitation tracking on the new player's profile
  UPDATE public.profile
  SET referred_by = v_referrer_id,
      referral_invitation_type = COALESCE(p_invitation_type, 'referral'),
      referral_target_id = p_target_id
  WHERE id = p_new_player_id;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 8. Grant permissions for updated function signatures
-- =============================================================================
GRANT EXECUTE ON FUNCTION log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION log_referral_fingerprint(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION match_referral_fingerprint(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION attribute_referral(VARCHAR(12), UUID, TEXT, TEXT, TEXT) TO authenticated;

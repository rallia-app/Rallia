-- =============================================================================
-- Migration: Update referral RPCs for click-based tracking
-- Description:
-- - Update get_player_referral_stats to return total_clicked + total_converted
-- - Add log_referral_click RPC
-- - Add log_referral_fingerprint RPC
-- - Add match_referral_fingerprint RPC
-- - Simplify attribute_referral to stop touching referral_invite
-- =============================================================================

-- =============================================================================
-- FUNCTION: Get player referral stats (updated)
-- Now returns total_clicked from referral_link_click table
-- and total_converted from profile.referred_by count
-- =============================================================================
CREATE OR REPLACE FUNCTION get_player_referral_stats(p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_referral_code VARCHAR(12);
  v_total_clicked INT;
  v_total_converted INT;
BEGIN
  -- Get the player's referral code
  SELECT referral_code INTO v_referral_code
  FROM public.profile
  WHERE id = p_player_id;

  -- Count unique clicks on their referral link
  SELECT COUNT(*) INTO v_total_clicked
  FROM public.referral_link_click
  WHERE referral_code = v_referral_code;

  -- Count players who signed up via this referral
  SELECT COUNT(*) INTO v_total_converted
  FROM public.profile
  WHERE referred_by = p_player_id;

  RETURN jsonb_build_object(
    'total_clicked', COALESCE(v_total_clicked, 0),
    'total_converted', COALESCE(v_total_converted, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Log a referral link click (with deduplication)
-- Called from the web invite page server-side
-- =============================================================================
CREATE OR REPLACE FUNCTION log_referral_click(
  p_referral_code VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.referral_link_click (referral_code, device_fingerprint, ip_address, user_agent)
  VALUES (UPPER(p_referral_code), p_device_fingerprint, p_ip_address, p_user_agent)
  ON CONFLICT (referral_code, device_fingerprint) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Log a referral fingerprint for iOS matching
-- Called from the web invite page for iOS visitors
-- =============================================================================
CREATE OR REPLACE FUNCTION log_referral_fingerprint(
  p_referral_code VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.referral_fingerprint (referral_code, device_fingerprint, ip_address, user_agent)
  VALUES (UPPER(p_referral_code), p_device_fingerprint, p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Match a referral fingerprint (iOS deferred deep link)
-- Called from the mobile app on first launch
-- Returns the referral_code if a match is found within 24h window
-- =============================================================================
CREATE OR REPLACE FUNCTION match_referral_fingerprint(
  p_device_fingerprint TEXT,
  p_ip_address TEXT,
  p_player_id UUID
)
RETURNS TEXT AS $$
DECLARE
  v_referral_code VARCHAR(12);
  v_fingerprint_id UUID;
BEGIN
  -- Find the most recent unmatched, unexpired fingerprint
  SELECT id, referral_code INTO v_fingerprint_id, v_referral_code
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

    RETURN v_referral_code;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Attribute a referral (simplified)
-- Only sets profile.referred_by, no longer touches referral_invite table
-- =============================================================================
CREATE OR REPLACE FUNCTION attribute_referral(
  p_referral_code VARCHAR(12),
  p_new_player_id UUID,
  p_new_player_email TEXT DEFAULT NULL
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

  -- Set referred_by on the new player's profile
  UPDATE public.profile
  SET referred_by = v_referrer_id
  WHERE id = p_new_player_id;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Drop unused functions and tables from old invite-tracking system
-- =============================================================================
DROP FUNCTION IF EXISTS check_existing_players_by_email(TEXT[]);
DROP TABLE IF EXISTS public.referral_invite;

-- =============================================================================
-- Grant execute permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION log_referral_fingerprint(VARCHAR(12), TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION match_referral_fingerprint(TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_player_referral_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION attribute_referral(VARCHAR(12), UUID, TEXT) TO authenticated;

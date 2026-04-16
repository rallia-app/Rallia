-- =============================================================================
-- Migration: Add 'flyer' and 'poster' to referral_invitation_type
-- Description: Extends automatic attribution to cover physical marketing
-- channels (printed flyers in parks, posters). Signups from these channels
-- have no referring user, so referred_by stays NULL; referral_invitation_type
-- records which channel drove the install.
-- =============================================================================

-- =============================================================================
-- 1. Extend CHECK constraints on all three invitation_type columns
-- =============================================================================
ALTER TABLE public.profile
  DROP CONSTRAINT IF EXISTS profile_referral_invitation_type_check;
ALTER TABLE public.profile
  ADD CONSTRAINT profile_referral_invitation_type_check
  CHECK (referral_invitation_type IN ('referral', 'match', 'group', 'community', 'flyer', 'poster'));

ALTER TABLE public.referral_link_click
  DROP CONSTRAINT IF EXISTS referral_link_click_invitation_type_check;
ALTER TABLE public.referral_link_click
  ADD CONSTRAINT referral_link_click_invitation_type_check
  CHECK (invitation_type IN ('referral', 'match', 'group', 'community', 'flyer', 'poster'));

ALTER TABLE public.referral_fingerprint
  DROP CONSTRAINT IF EXISTS referral_fingerprint_invitation_type_check;
ALTER TABLE public.referral_fingerprint
  ADD CONSTRAINT referral_fingerprint_invitation_type_check
  CHECK (invitation_type IN ('referral', 'match', 'group', 'community', 'flyer', 'poster'));

-- =============================================================================
-- 2. Update attribute_referral RPC to handle channel-level attribution
-- =============================================================================
-- For flyer/poster: no referring user exists, so skip the referrer lookup and
-- set only referral_invitation_type on the new player's profile.
-- For all other types: existing behavior.
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
  -- Channel attribution (flyer / poster): no referring user
  IF p_invitation_type IN ('flyer', 'poster') THEN
    -- Don't overwrite an existing referral if one was already recorded
    IF EXISTS(SELECT 1 FROM public.profile WHERE id = p_new_player_id AND referred_by IS NOT NULL) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already referred');
    END IF;

    UPDATE public.profile
    SET referral_invitation_type = p_invitation_type
    WHERE id = p_new_player_id;

    RETURN jsonb_build_object('success', true, 'referrer_id', NULL);
  END IF;

  -- Referral attribution (referral / match / group / community): tied to a user
  SELECT id INTO v_referrer_id
  FROM public.profile
  WHERE referral_code = UPPER(p_referral_code);

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  IF v_referrer_id = p_new_player_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  IF EXISTS(SELECT 1 FROM public.profile WHERE id = p_new_player_id AND referred_by IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred');
  END IF;

  UPDATE public.profile
  SET referred_by = v_referrer_id,
      referral_invitation_type = COALESCE(p_invitation_type, 'referral'),
      referral_target_id = p_target_id
  WHERE id = p_new_player_id;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION attribute_referral(VARCHAR(12), UUID, TEXT, TEXT, TEXT) TO authenticated;

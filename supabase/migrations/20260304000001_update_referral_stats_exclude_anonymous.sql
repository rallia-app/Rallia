-- =============================================================================
-- Migration: Update referral stats to exclude anonymous share events
-- Description: The "Invited" counter should only count invites sent to actual
-- contacts (with a phone or email), not anonymous share actions like copy_link
-- or share_sheet. Also tighten attribute_referral to only convert contact-based
-- invites, not anonymous share events.
-- =============================================================================

-- =============================================================================
-- FUNCTION: Get player referral stats (updated)
-- Only counts invites with a known recipient for total_invited
-- =============================================================================
CREATE OR REPLACE FUNCTION get_player_referral_stats(p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_invited INT;
  v_total_converted INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE recipient_phone IS NOT NULL OR recipient_email IS NOT NULL),
    COUNT(*) FILTER (WHERE status = 'signed_up')
  INTO v_total_invited, v_total_converted
  FROM public.referral_invite
  WHERE referrer_id = p_player_id;

  RETURN jsonb_build_object(
    'total_invited', v_total_invited,
    'total_converted', v_total_converted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Attribute a referral (updated)
-- Only converts contact-based invites, not anonymous share events
-- =============================================================================
CREATE OR REPLACE FUNCTION attribute_referral(p_referral_code VARCHAR(12), p_new_player_id UUID)
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

  -- Update only contact-based invite records to signed_up status
  -- (skip anonymous share events that have no recipient info)
  UPDATE public.referral_invite
  SET status = 'signed_up',
      converted_player_id = p_new_player_id,
      updated_at = NOW()
  WHERE referrer_id = v_referrer_id
    AND status = 'sent'
    AND (recipient_phone IS NOT NULL OR recipient_email IS NOT NULL);

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

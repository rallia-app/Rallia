-- =============================================================================
-- Migration: Fix referral attribution, add deduplication, add email check RPC
-- =============================================================================

-- =============================================================================
-- 1. Fix attribute_referral to convert only the matching invite row
-- =============================================================================
CREATE OR REPLACE FUNCTION attribute_referral(
  p_referral_code VARCHAR(12),
  p_new_player_id UUID,
  p_new_player_email TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_referrer_id UUID;
  v_invite_id UUID;
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

  -- Try to match a specific invite by email first
  IF p_new_player_email IS NOT NULL THEN
    SELECT id INTO v_invite_id
    FROM public.referral_invite
    WHERE referrer_id = v_referrer_id
      AND status = 'sent'
      AND recipient_email = p_new_player_email
    LIMIT 1;
  END IF;

  -- If no email match, pick the most recent contact-based invite
  IF v_invite_id IS NULL THEN
    SELECT id INTO v_invite_id
    FROM public.referral_invite
    WHERE referrer_id = v_referrer_id
      AND status = 'sent'
      AND (recipient_phone IS NOT NULL OR recipient_email IS NOT NULL)
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- Update only that single invite row (if found)
  IF v_invite_id IS NOT NULL THEN
    UPDATE public.referral_invite
    SET status = 'signed_up',
        converted_player_id = p_new_player_id,
        updated_at = NOW()
    WHERE id = v_invite_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Deduplication indexes — prevent duplicate sent invites to same contact
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_invite_unique_email
  ON public.referral_invite(referrer_id, recipient_email)
  WHERE recipient_email IS NOT NULL AND status = 'sent';

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_invite_unique_phone
  ON public.referral_invite(referrer_id, recipient_phone)
  WHERE recipient_phone IS NOT NULL AND status = 'sent';

-- =============================================================================
-- 3. RPC to check which emails already belong to Rallia players
-- =============================================================================
CREATE OR REPLACE FUNCTION check_existing_players_by_email(p_emails TEXT[])
RETURNS TEXT[] AS $$
BEGIN
  RETURN ARRAY(
    SELECT email FROM public.profile
    WHERE email = ANY(p_emails)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

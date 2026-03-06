-- =============================================================================
-- Migration: Add Player Referral System
-- Description: Add referral_code and referred_by to profile, create referral_invite
-- tracking table, and DB functions for referral management.
-- =============================================================================

-- Add referral columns to profile table
ALTER TABLE public.profile
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profile(id);

-- Create index for fast referral code lookups
CREATE INDEX IF NOT EXISTS idx_profile_referral_code
ON public.profile(referral_code)
WHERE referral_code IS NOT NULL;

-- Create index for referred_by lookups
CREATE INDEX IF NOT EXISTS idx_profile_referred_by
ON public.profile(referred_by)
WHERE referred_by IS NOT NULL;

-- =============================================================================
-- TABLE: referral_invite - Tracks individual referral invitations
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.referral_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  recipient_name TEXT,
  recipient_phone TEXT,
  recipient_email TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'share_sheet', 'copy_link', 'qr_code', 'contacts')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'clicked', 'signed_up')),
  converted_player_id UUID REFERENCES public.profile(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for referral_invite
CREATE INDEX IF NOT EXISTS idx_referral_invite_referrer
ON public.referral_invite(referrer_id);

CREATE INDEX IF NOT EXISTS idx_referral_invite_status
ON public.referral_invite(referrer_id, status);

-- =============================================================================
-- RLS: referral_invite
-- =============================================================================
ALTER TABLE public.referral_invite ENABLE ROW LEVEL SECURITY;

-- Users can view their own referral invites
CREATE POLICY "Users can view own referral invites"
ON public.referral_invite FOR SELECT
TO authenticated
USING (referrer_id = auth.uid());

-- Users can insert their own referral invites
CREATE POLICY "Users can insert own referral invites"
ON public.referral_invite FOR INSERT
TO authenticated
WITH CHECK (referrer_id = auth.uid());

-- =============================================================================
-- FUNCTION: Generate unique referral code (8-char alphanumeric)
-- Uses same charset as group invite codes (excludes I/O/1/0)
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_unique_referral_code()
RETURNS VARCHAR(12) AS $$
DECLARE
  new_code VARCHAR(12);
  code_exists BOOLEAN;
BEGIN
  LOOP
    new_code := '';
    FOR i IN 1..8 LOOP
      new_code := new_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32 + 1)::int, 1);
    END LOOP;

    -- Check uniqueness against profile table
    SELECT EXISTS(SELECT 1 FROM public.profile WHERE referral_code = new_code) INTO code_exists;

    EXIT WHEN NOT code_exists;
  END LOOP;

  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- FUNCTION: Get or create player referral code (idempotent)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_or_create_player_referral_code(p_player_id UUID)
RETURNS VARCHAR(12) AS $$
DECLARE
  existing_code VARCHAR(12);
  new_code VARCHAR(12);
BEGIN
  -- Check for existing code
  SELECT referral_code INTO existing_code
  FROM public.profile
  WHERE id = p_player_id;

  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;

  -- Generate new code
  new_code := generate_unique_referral_code();

  -- Update profile with new code
  UPDATE public.profile
  SET referral_code = new_code
  WHERE id = p_player_id;

  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION: Get player referral stats
-- Returns total invited and total converted counts
-- =============================================================================
CREATE OR REPLACE FUNCTION get_player_referral_stats(p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_invited INT;
  v_total_converted INT;
BEGIN
  SELECT
    COUNT(*),
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
-- FUNCTION: Attribute a referral when a new player signs up
-- Sets referred_by on profile and updates matching invite records
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

  -- Update any matching invite records to signed_up status
  UPDATE public.referral_invite
  SET status = 'signed_up',
      converted_player_id = p_new_player_id,
      updated_at = NOW()
  WHERE referrer_id = v_referrer_id
    AND status = 'sent';

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION generate_unique_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_player_referral_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_player_referral_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION attribute_referral(VARCHAR(12), UUID) TO authenticated;

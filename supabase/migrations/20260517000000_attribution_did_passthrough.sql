-- =============================================================================
-- Migration: distinct_id passthrough + UTM columns on referral_link_click
-- Description:
--   Adds web_distinct_id + utm_* + referrer_host columns to referral_link_click,
--   so server-side click logging carries the full inbound attribution context
--   (not just the referral code). The web_distinct_id is the PostHog anonymous
--   distinct_id we capture in the ph_did cookie on first visit; pairing it
--   with profile.id after signup is what bridges web → app attribution.
--
--   The existing log_referral_click signature (6 args) is replaced by an 8-arg
--   version that accepts the new context. Old callers should be updated; the
--   `device_fingerprint` arg is retained for back-compat but is now expected
--   to be an empty string in the DIY-attribution path (fingerprinting is
--   forbidden by Apple's App Review Guidelines and we are abandoning it).
-- =============================================================================

ALTER TABLE public.referral_link_click
  ADD COLUMN IF NOT EXISTS web_distinct_id TEXT,
  ADD COLUMN IF NOT EXISTS utm_source      TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium      TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign    TEXT,
  ADD COLUMN IF NOT EXISTS utm_content     TEXT,
  ADD COLUMN IF NOT EXISTS utm_term        TEXT,
  ADD COLUMN IF NOT EXISTS referrer_host   TEXT;

-- Partial index — most rows pre-migration have NULL web_distinct_id, and the
-- admin queries that need this column always filter for non-null.
CREATE INDEX IF NOT EXISTS idx_referral_link_click_web_distinct_id
  ON public.referral_link_click(web_distinct_id)
  WHERE web_distinct_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_link_click_utm_campaign
  ON public.referral_link_click(utm_campaign, created_at DESC)
  WHERE utm_campaign IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Updated log_referral_click — 8-arg signature
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.log_referral_click(
  p_referral_code      VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address         TEXT DEFAULT NULL,
  p_user_agent         TEXT DEFAULT NULL,
  p_invitation_type    TEXT DEFAULT 'referral',
  p_target_id          TEXT DEFAULT NULL,
  p_web_distinct_id    TEXT DEFAULT NULL,
  p_utm                JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.referral_link_click (
    referral_code,
    device_fingerprint,
    ip_address,
    user_agent,
    invitation_type,
    target_id,
    web_distinct_id,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    referrer_host
  )
  VALUES (
    UPPER(p_referral_code),
    p_device_fingerprint,
    p_ip_address,
    p_user_agent,
    COALESCE(p_invitation_type, 'referral'),
    p_target_id,
    NULLIF(p_web_distinct_id, ''),
    NULLIF(p_utm->>'utm_source',    ''),
    NULLIF(p_utm->>'utm_medium',    ''),
    NULLIF(p_utm->>'utm_campaign',  ''),
    NULLIF(p_utm->>'utm_content',   ''),
    NULLIF(p_utm->>'utm_term',      ''),
    NULLIF(p_utm->>'referrer_host', '')
  )
  ON CONFLICT (referral_code, device_fingerprint, COALESCE(invitation_type, 'referral'))
  DO UPDATE SET
    -- First-touch attribution: only fill columns that are still NULL so a
    -- returning visitor's later click doesn't overwrite their original source.
    web_distinct_id = COALESCE(public.referral_link_click.web_distinct_id, EXCLUDED.web_distinct_id),
    utm_source      = COALESCE(public.referral_link_click.utm_source,      EXCLUDED.utm_source),
    utm_medium      = COALESCE(public.referral_link_click.utm_medium,      EXCLUDED.utm_medium),
    utm_campaign    = COALESCE(public.referral_link_click.utm_campaign,    EXCLUDED.utm_campaign),
    utm_content     = COALESCE(public.referral_link_click.utm_content,     EXCLUDED.utm_content),
    utm_term        = COALESCE(public.referral_link_click.utm_term,        EXCLUDED.utm_term),
    referrer_host   = COALESCE(public.referral_link_click.referrer_host,   EXCLUDED.referrer_host);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

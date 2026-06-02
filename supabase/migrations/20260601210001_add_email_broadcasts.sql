-- ============================================================================
-- Migration: email broadcast tables + recipient-resolution RPC
-- Created: 2026-06-01
-- Description:
--   Backs the new admin "Emails" tab (/admin/emails) where admins compose a
--   subject + body and broadcast to a segment of users.
--     1. email_broadcast            — one row per campaign (audit + history).
--     2. email_broadcast_recipient  — one row per Resend send (bounce/complaint
--        tie-back via resend_id, mirroring digest_send_log).
--     3. get_broadcast_recipients() — resolves the eligible recipient list with
--        consent + deliverability baked in (skips bouncing/complained and
--        users who opted out of 'admin_broadcast' email), mirroring
--        get_morning_digest_eligible_users.
--
--   Tables are service-role only (admin app validates the caller); RLS is
--   enabled with no policies so the Data API never exposes them.
--   'admin_broadcast' enum value is added in 20260601210000 (prior migration),
--   so it is committed before the RPC below references it.
-- ============================================================================

-- 1. Campaign table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_broadcast (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       UUID REFERENCES public.admin(id) ON DELETE SET NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  cta_text         TEXT,
  cta_url          TEXT,
  audience         JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipients_total INT  NOT NULL DEFAULT 0,
  sent_count       INT  NOT NULL DEFAULT 0,
  failed_count     INT  NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'partial', 'failed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_broadcast_created_at_idx
  ON public.email_broadcast(created_at DESC);

COMMENT ON TABLE public.email_broadcast IS
  'One row per admin email broadcast composed in /admin/emails. Stores the '
  'content, the audience filter used, and aggregate send counts/status.';

-- 2. Per-recipient send log ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_broadcast_recipient (
  id           BIGSERIAL PRIMARY KEY,
  broadcast_id UUID NOT NULL REFERENCES public.email_broadcast(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.profile(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  resend_id    TEXT,
  status       TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed', 'bounced', 'complained')),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_broadcast_recipient_broadcast_id_idx
  ON public.email_broadcast_recipient(broadcast_id);
CREATE INDEX IF NOT EXISTS email_broadcast_recipient_resend_id_idx
  ON public.email_broadcast_recipient(resend_id);

COMMENT ON TABLE public.email_broadcast_recipient IS
  'One row per Resend send for an email_broadcast. resend_id lets the '
  'resend-webhook tie delivery/bounce/complaint events back to the recipient.';

-- 3. Recipient resolution RPC -------------------------------------------------
-- All filters are optional (NULL / false = no filter). Enforces onboarding,
-- active account, healthy email_status, and respects the per-user
-- 'admin_broadcast' email opt-out written by the unsubscribe flow.
CREATE OR REPLACE FUNCTION public.get_broadcast_recipients(
  p_sport_id         UUID        DEFAULT NULL,
  p_city             TEXT        DEFAULT NULL,
  p_locale           TEXT        DEFAULT NULL,
  p_active_since     TIMESTAMPTZ DEFAULT NULL,
  p_only_subscribers BOOLEAN     DEFAULT FALSE
)
RETURNS TABLE (
  user_id          UUID,
  email            TEXT,
  first_name       TEXT,
  preferred_locale TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                    AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale::text, 'en-US') AS preferred_locale
  FROM public.profile p
  LEFT JOIN public.player pl ON pl.id = p.id
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND p.email_status = 'ok'
    AND (p.account_status IS NULL OR p.account_status = 'active')
    AND (p_locale IS NULL OR p.preferred_locale::text = p_locale)
    AND (p_city IS NULL OR pl.city ILIKE p_city)
    AND (p_active_since IS NULL OR p.last_active_at >= p_active_since)
    AND (
      p_sport_id IS NULL OR EXISTS (
        SELECT 1 FROM public.player_sport ps
        WHERE ps.player_id = p.id AND ps.sport_id = p_sport_id
      )
    )
    AND (
      NOT p_only_subscribers OR EXISTS (
        SELECT 1 FROM public.player_subscription sub
        WHERE sub.player_id = p.id AND sub.status = 'active'
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_preference np
      WHERE np.user_id           = p.id
        AND np.notification_type = 'admin_broadcast'
        AND np.channel           = 'email'
        AND np.enabled           = FALSE
    );
$$;

COMMENT ON FUNCTION public.get_broadcast_recipients IS
  'Returns one row per user eligible for an admin email broadcast given '
  'optional segment filters (sport, city, locale, active-since, subscribers). '
  'Filters out: not onboarded, no email, bouncing/complained, suspended/'
  'deleted, and explicit admin_broadcast email opt-out.';

-- 4. Grants (service-role only; admin app validates the caller) ----------------
GRANT SELECT, INSERT, UPDATE ON public.email_broadcast           TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_broadcast_recipient TO service_role;
GRANT USAGE ON SEQUENCE public.email_broadcast_recipient_id_seq  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_recipients(UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN)
  TO service_role;

-- 5. RLS: enabled with no policies → never exposed via the Data API.
ALTER TABLE public.email_broadcast           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_broadcast_recipient ENABLE ROW LEVEL SECURITY;

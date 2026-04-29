-- ============================================================================
-- Migration: email_status + digest_send_log + digest_event
-- Created: 2026-04-28
-- Description:
--   1. Track per-user email deliverability (bounces / complaints) so we don't
--      keep sending to addresses that hard-bounce or report spam — Resend
--      penalizes our sender reputation globally for that pattern.
--   2. Persist one row per outgoing digest send so the Resend webhook can tie
--      open/click/bounce events back to the user.
--   3. Update get_morning_digest_eligible_users to filter out:
--      - users with email_status != 'ok'
--      - users who explicitly disabled the morning_digest preference
-- ============================================================================

-- 1. profile.email_status
ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'ok'
    CHECK (email_status IN ('ok', 'bouncing', 'complained'));

COMMENT ON COLUMN public.profile.email_status IS
  'Email deliverability state. Set by the resend-webhook edge function on '
  'email.bounced (→ bouncing) and email.complained (→ complained). Filtered '
  'out of digest eligibility.';

-- 2. digest_send_log — one row per successful resend.emails.send().
CREATE TABLE IF NOT EXISTS public.digest_send_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profile(id) ON DELETE CASCADE,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resend_id  TEXT NOT NULL UNIQUE,
  feed_size  INT  NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'bounced', 'complained'))
);

CREATE INDEX IF NOT EXISTS digest_send_log_user_id_idx
  ON public.digest_send_log(user_id);
CREATE INDEX IF NOT EXISTS digest_send_log_sent_at_idx
  ON public.digest_send_log(sent_at DESC);

COMMENT ON TABLE public.digest_send_log IS
  'Audit log of morning digest emails dispatched. One row per Resend send; '
  'updated by resend-webhook on bounce/complaint to reflect downstream state.';

-- 3. digest_event — append-only event stream from Resend webhooks.
CREATE TABLE IF NOT EXISTS public.digest_event (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES public.profile(id) ON DELETE SET NULL,
  resend_id    TEXT,
  event_type   TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL,
  payload      JSONB
);

CREATE INDEX IF NOT EXISTS digest_event_user_id_idx
  ON public.digest_event(user_id);
CREATE INDEX IF NOT EXISTS digest_event_resend_id_idx
  ON public.digest_event(resend_id);
CREATE INDEX IF NOT EXISTS digest_event_event_type_idx
  ON public.digest_event(event_type);

COMMENT ON TABLE public.digest_event IS
  'Append-only event log from the resend-webhook handler: email.delivered, '
  'email.opened, email.clicked, email.bounced, email.complained.';

-- 4. Replace eligibility RPC with the tightened filter.
CREATE OR REPLACE FUNCTION public.get_morning_digest_eligible_users()
RETURNS TABLE (
  user_id                UUID,
  email                  TEXT,
  first_name             TEXT,
  preferred_locale       TEXT,
  lat                    DOUBLE PRECISION,
  lng                    DOUBLE PRECISION,
  max_travel_distance_km INT,
  sport_id               UUID,
  sport_name             TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    p.id                                                 AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale, 'en-US')                AS preferred_locale,
    extensions.ST_Y(pl.location::extensions.geometry)    AS lat,
    extensions.ST_X(pl.location::extensions.geometry)    AS lng,
    COALESCE(pl.max_travel_distance, 25)                 AS max_travel_distance_km,
    ps.sport_id,
    s.name                                               AS sport_name
  FROM public.profile p
  JOIN public.player pl       ON pl.id        = p.id
  JOIN public.player_sport ps ON ps.player_id = p.id
  JOIN public.sport s         ON s.id         = ps.sport_id
  WHERE p.onboarding_completed = TRUE
    AND p.email          IS NOT NULL
    AND pl.location      IS NOT NULL
    AND p.email_status   = 'ok'
    AND (
      p.last_morning_digest_sent_at IS NULL
      OR p.last_morning_digest_sent_at::date < CURRENT_DATE
    )
    -- Respect explicit opt-out via notification_preference for the email channel.
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_preference np
      WHERE np.user_id           = p.id
        AND np.notification_type = 'morning_digest'
        AND np.channel           = 'email'
        AND np.enabled           = FALSE
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_morning_digest_eligible_users()
  TO service_role;

COMMENT ON FUNCTION public.get_morning_digest_eligible_users IS
  'Returns one row per (user, sport) for users eligible to receive today''s '
  'morning digest. Filters out: not onboarded, no email, no location, '
  'already-sent today, bouncing/complained email_status, and explicit '
  'morning_digest opt-out via notification_preference.';

GRANT INSERT, SELECT, UPDATE ON public.digest_send_log TO service_role;
GRANT INSERT, SELECT          ON public.digest_event   TO service_role;
GRANT USAGE ON SEQUENCE public.digest_send_log_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.digest_event_id_seq    TO service_role;

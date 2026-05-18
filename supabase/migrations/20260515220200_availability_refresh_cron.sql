-- =============================================================================
-- Weekly availability refresh infrastructure
--
-- After moving to the 6-block model (20260515220000) and the freshness chokepoint
-- in OnboardingService.saveAvailability (which now stamps last_confirmed_at on
-- every write), we have a per-row signal for "how stale is this player's
-- availability." This migration adds the surrounding plumbing so a weekly job
-- can nudge players whose data has rotted.
--
--   • profile.last_availability_refresh_sent_at — dedup sentinel so the cron
--     doesn't double-fire if it's manually invoked.
--   • notification_type_enum gains 'availability_refresh_reminder'.
--   • get_availability_refresh_eligible_users() — single source of truth for
--     who needs nudging this week. Returns onboarded players with at least
--     one player_availability row whose MAX(last_confirmed_at) is NULL or
--     older than 14 days, and who haven't been nudged in the last 6 days.
--   • cron.schedule fires send-availability-refresh weekly at Monday 14:00
--     UTC (≈ 10 AM EDT), modeled on the existing morning-digest cron.
--
-- Pattern mirrors supabase/migrations/20260429100000_add_morning_digest.sql.
-- =============================================================================

-- 1. Dedup sentinel on profile.
ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS last_availability_refresh_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profile.last_availability_refresh_sent_at IS
  'Last time the weekly availability-refresh push was sent to this user. '
  'Used by get_availability_refresh_eligible_users() to skip users nudged '
  'in the past 6 days, preventing duplicate sends if the cron is invoked '
  'manually.';

-- 2. Extend notification_type_enum (idempotent ADD VALUE).
ALTER TYPE public.notification_type_enum
  ADD VALUE IF NOT EXISTS 'availability_refresh_reminder';

-- 3. Eligibility RPC.
--    Returns one row per user who:
--      • has completed onboarding,
--      • has at least one player_availability row,
--      • whose most-recent last_confirmed_at across those rows is NULL or
--        older than 14 days (the staleness threshold the UI also uses),
--      • who hasn't received this reminder in the past 6 days.
CREATE OR REPLACE FUNCTION public.get_availability_refresh_eligible_users()
RETURNS TABLE (
  user_id                UUID,
  email                  TEXT,
  first_name             TEXT,
  preferred_locale       TEXT,
  most_recent_confirmed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH avail_freshness AS (
    SELECT pa.player_id,
           MAX(pa.last_confirmed_at) AS most_recent
    FROM public.player_availability pa
    WHERE pa.is_active = TRUE
    GROUP BY pa.player_id
  )
  SELECT
    p.id                                          AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale, 'en-US')         AS preferred_locale,
    af.most_recent                                AS most_recent_confirmed_at
  FROM public.profile p
  JOIN avail_freshness af ON af.player_id = p.id
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND (af.most_recent IS NULL OR af.most_recent < NOW() - INTERVAL '14 days')
    AND (
      p.last_availability_refresh_sent_at IS NULL
      OR p.last_availability_refresh_sent_at < NOW() - INTERVAL '6 days'
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_availability_refresh_eligible_users()
  TO service_role;

COMMENT ON FUNCTION public.get_availability_refresh_eligible_users IS
  'Returns onboarded users whose availability has gone stale (>14d since '
  'last_confirmed_at, or never confirmed under the 6-block model) and who '
  'have not received the weekly refresh nudge in the past 6 days. Consumed '
  'by the send-availability-refresh edge function.';

-- 4. Weekly cron — Monday 14:00 UTC ≈ 10 AM EDT.
SELECT cron.unschedule('send-availability-refresh-weekly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-availability-refresh-weekly'
);

SELECT cron.schedule(
  'send-availability-refresh-weekly',
  '0 14 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-availability-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $$
);

DO $$
BEGIN
  RAISE NOTICE 'Scheduled send-availability-refresh-weekly cron job (Mondays 14:00 UTC = 10 AM EDT)';
END $$;

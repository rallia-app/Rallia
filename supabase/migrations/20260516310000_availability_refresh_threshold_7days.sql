-- =============================================================================
-- Tighten the weekly availability-refresh nudge from 14d to 7d
--
-- Originally introduced in 20260515220200_availability_refresh_cron.sql with a
-- 14-day staleness threshold. We're pulling it in to 7 days so a player who
-- last confirmed last Monday becomes eligible at the next weekly cron tick
-- (the cron itself still runs Mondays 14:00 UTC and dedups within 6 days).
-- =============================================================================

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
    AND (af.most_recent IS NULL OR af.most_recent < NOW() - INTERVAL '7 days')
    AND (
      p.last_availability_refresh_sent_at IS NULL
      OR p.last_availability_refresh_sent_at < NOW() - INTERVAL '6 days'
    )
$$;

COMMENT ON FUNCTION public.get_availability_refresh_eligible_users IS
  'Returns onboarded users whose availability has gone stale (>7d since '
  'last_confirmed_at, or never confirmed under the 6-block model) and who '
  'have not received the weekly refresh nudge in the past 6 days. Consumed '
  'by the send-availability-refresh edge function.';

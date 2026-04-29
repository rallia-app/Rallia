-- ============================================================================
-- Migration: Morning Digest Email Infrastructure
-- Created: 2026-04-29
-- Description:
--   1. Add last_morning_digest_sent_at to profile for dedup (skip users who
--      already received today's digest).
--   2. Add 'morning_digest' to notification_type_enum so users can opt out
--      via notification_preference in the future.
--   3. Create get_morning_digest_eligible_users() RPC — returns one row per
--      user per sport with PostGIS lat/lng extracted, avoiding N+1 queries
--      and ST_X/ST_Y syntax unavailable in the JS client.
--   4. Schedule a daily pg_cron job at 12:00 UTC (8 AM ET summer).
-- ============================================================================

-- 1. Dedup sentinel
ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS last_morning_digest_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN profile.last_morning_digest_sent_at IS
  'Last time the morning digest email was sent to this user. Used to prevent '
  'duplicate sends if the cron job fires multiple times in the same day.';

-- 2. Extend enum for future opt-out support
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'morning_digest';

-- 3. RPC: get_morning_digest_eligible_users
--    Returns one row per (user, sport) pair for users who:
--      - Have completed onboarding
--      - Have a valid email
--      - Have a player location (needed for nearby match search)
--      - Have not yet received today's digest
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
AS $$
  SELECT
    p.id                                                      AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale, 'en-US')                    AS preferred_locale,
    extensions.ST_Y(pl.location::extensions.geometry)        AS lat,
    extensions.ST_X(pl.location::extensions.geometry)        AS lng,
    COALESCE(pl.max_travel_distance, 25)                     AS max_travel_distance_km,
    ps.sport_id,
    s.name                                                   AS sport_name
  FROM profile p
  JOIN player pl       ON pl.id      = p.id
  JOIN player_sport ps ON ps.player_id = p.id
  JOIN sport s         ON s.id        = ps.sport_id
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND pl.location IS NOT NULL
    AND (
      p.last_morning_digest_sent_at IS NULL
      OR p.last_morning_digest_sent_at::date < CURRENT_DATE
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_morning_digest_eligible_users()
  TO service_role;

COMMENT ON FUNCTION public.get_morning_digest_eligible_users IS
  'Returns one row per (user, sport) for all onboarded users eligible to '
  'receive today''s morning digest. Extracts PostGIS lat/lng so the Edge '
  'Function can call search_public_matches and get_match_suggestions_scored '
  'without additional geometry parsing.';

-- 4. Schedule daily morning digest at 12:00 UTC (8 AM EDT / 7 AM EST)
SELECT cron.unschedule('send-morning-digest-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-morning-digest-daily'
);

SELECT cron.schedule(
  'send-morning-digest-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-morning-digest',
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
  RAISE NOTICE 'Scheduled send-morning-digest-daily cron job (12:00 UTC = 8 AM ET summer)';
END $$;

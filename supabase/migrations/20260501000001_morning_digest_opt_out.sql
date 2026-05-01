-- Update get_morning_digest_eligible_users to respect notification preferences.
-- Users who explicitly set morning_digest/email = false are excluded.
-- Sparse storage: no row means the default (enabled) applies.

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
  LEFT JOIN notification_preference np
    ON  np.user_id           = p.id
    AND np.notification_type = 'morning_digest'
    AND np.channel           = 'email'
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND pl.location IS NOT NULL
    AND (np.id IS NULL OR np.enabled = TRUE)
    AND (
      p.last_morning_digest_sent_at IS NULL
      OR p.last_morning_digest_sent_at::date < CURRENT_DATE
    )
$$;

GRANT EXECUTE ON FUNCTION public.get_morning_digest_eligible_users()
  TO service_role;

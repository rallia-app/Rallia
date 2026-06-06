-- ============================================================================
-- Migration: expand get_broadcast_recipients with a complete segment filter set
-- Created: 2026-06-05
-- Description:
--   Replaces the 5-param recipient resolver with a comprehensive one backing the
--   admin "Target a segment" builder. All filters optional (NULL = no filter)
--   and combine with AND; multi-value filters (sports, locales, genders) match
--   with OR (ANY). Baseline eligibility (onboarded, active account, healthy
--   email, admin_broadcast opt-out) is unchanged.
--
--   New dimensions: multi-sport, multi-locale, province, country, inactivity
--   window (re-engagement), signup window (new vs veteran), 3-way subscription
--   state, gender (multi), and age range. The signature changes, so the old
--   overload is dropped first.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_broadcast_recipients(UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_broadcast_recipients(
  p_sport_ids       UUID[]      DEFAULT NULL,  -- player has ANY of these sports
  p_locales         TEXT[]      DEFAULT NULL,  -- preferred_locale IN (...)
  p_city            TEXT        DEFAULT NULL,  -- player.city ILIKE
  p_province        TEXT        DEFAULT NULL,  -- player.province ILIKE
  p_country         TEXT        DEFAULT NULL,  -- player.country ILIKE
  p_active_since    TIMESTAMPTZ DEFAULT NULL,  -- last_active_at >= (recently active)
  p_inactive_before TIMESTAMPTZ DEFAULT NULL,  -- last_active_at < (re-engagement)
  p_joined_since    TIMESTAMPTZ DEFAULT NULL,  -- created_at >= (new users)
  p_joined_before   TIMESTAMPTZ DEFAULT NULL,  -- created_at <  (veterans)
  p_subscription    TEXT        DEFAULT NULL,  -- 'subscribers' | 'non_subscribers' | NULL(all)
  p_genders         TEXT[]      DEFAULT NULL,  -- player.gender IN (...)
  p_min_age         INT         DEFAULT NULL,  -- age >= (from birth_date)
  p_max_age         INT         DEFAULT NULL   -- age <= (from birth_date)
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
    p.id                                        AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale::text, 'en-US') AS preferred_locale
  FROM public.profile p
  LEFT JOIN public.player pl ON pl.id = p.id
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND p.email_status = 'ok'
    AND (p.account_status IS NULL OR p.account_status = 'active')
    -- Locale (multi)
    AND (p_locales IS NULL OR p.preferred_locale::text = ANY(p_locales))
    -- Location
    AND (p_city IS NULL OR pl.city ILIKE p_city)
    AND (p_province IS NULL OR pl.province ILIKE p_province)
    AND (p_country IS NULL OR pl.country ILIKE p_country)
    -- Activity window
    AND (p_active_since IS NULL OR p.last_active_at >= p_active_since)
    AND (p_inactive_before IS NULL OR p.last_active_at < p_inactive_before)
    -- Signup window
    AND (p_joined_since IS NULL OR p.created_at >= p_joined_since)
    AND (p_joined_before IS NULL OR p.created_at < p_joined_before)
    -- Demographics
    AND (p_genders IS NULL OR pl.gender::text = ANY(p_genders))
    AND (
      p_min_age IS NULL
      OR (p.birth_date IS NOT NULL
          AND p.birth_date <= (CURRENT_DATE - make_interval(years => p_min_age)))
    )
    AND (
      p_max_age IS NULL
      OR (p.birth_date IS NOT NULL
          AND p.birth_date > (CURRENT_DATE - make_interval(years => p_max_age + 1)))
    )
    -- Sport (multi, OR)
    AND (
      p_sport_ids IS NULL OR EXISTS (
        SELECT 1 FROM public.player_sport ps
        WHERE ps.player_id = p.id AND ps.sport_id = ANY(p_sport_ids)
      )
    )
    -- Subscription state
    AND (
      p_subscription IS NULL
      OR (p_subscription = 'subscribers' AND EXISTS (
            SELECT 1 FROM public.player_subscription sub
            WHERE sub.player_id = p.id AND sub.status = 'active'))
      OR (p_subscription = 'non_subscribers' AND NOT EXISTS (
            SELECT 1 FROM public.player_subscription sub
            WHERE sub.player_id = p.id AND sub.status = 'active'))
    )
    -- Consent
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_preference np
      WHERE np.user_id           = p.id
        AND np.notification_type = 'admin_broadcast'
        AND np.channel           = 'email'
        AND np.enabled           = FALSE
    );
$$;

COMMENT ON FUNCTION public.get_broadcast_recipients IS
  'Returns one row per user eligible for an admin email broadcast given optional '
  'segment filters: sports (multi), locales (multi), city/province/country, '
  'active-since / inactive-before, joined-since / joined-before, subscription '
  'state, gender (multi), and age range. Always enforces: onboarded, active '
  'account, healthy email, and admin_broadcast email opt-out.';

GRANT EXECUTE ON FUNCTION public.get_broadcast_recipients(
  UUID[], TEXT[], TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  TIMESTAMPTZ, TEXT, TEXT[], INT, INT
) TO service_role;

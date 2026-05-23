-- =============================================================================
-- Fix `recently_active` sort in search_players_nearby
--
-- Previously sorted by profile.last_active_at, which is set once on signup and
-- never updated, so the order had no relationship to actual recent activity —
-- and disagreed with the online dot on PlayerCard, which reads player.last_seen_at.
--
-- This migration replaces the function body so the sort uses player.last_seen_at,
-- the same column the online indicator already uses and that useUpdateLastSeen
-- keeps fresh while the app is open. Signature is unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_players_nearby(
  p_sport_id UUID,
  p_current_user_id UUID DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_min_skill_value NUMERIC DEFAULT NULL,
  p_min_travel_distance_km INT DEFAULT NULL,
  p_availability TEXT DEFAULT NULL,    -- DEPRECATED: no-op; preserved for client compat
  p_day TEXT DEFAULT NULL,
  p_play_style TEXT DEFAULT NULL,
  p_favorite_player_ids UUID[] DEFAULT NULL,
  p_blocked_player_ids UUID[] DEFAULT NULL,
  p_favorites_only BOOLEAN DEFAULT FALSE,
  p_blocked_only BOOLEAN DEFAULT FALSE,
  p_exclude_player_ids UUID[] DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'distance',
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_rating_score_ids UUID[] DEFAULT NULL,
  p_reputation_tier TEXT DEFAULT NULL,
  p_certified_only BOOLEAN DEFAULT FALSE,
  p_min_hour SMALLINT DEFAULT NULL,
  p_max_hour SMALLINT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  profile_picture_url TEXT,
  city TEXT,
  gender TEXT,
  rating_label TEXT,
  rating_value DOUBLE PRECISION,
  rating_is_certified BOOLEAN,
  rating_badge_status TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  total_count BIGINT,
  reputation_tier TEXT,
  reputation_score DOUBLE PRECISION,
  reputation_is_public BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      prs.rating_score_id,
      rs.label::TEXT AS rating_label,
      rs.value::DOUBLE PRECISION AS rating_value,
      prs.is_certified AS rating_is_certified,
      CASE
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 'disputed'
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 'certified'
        ELSE 'self_declared'
      END AS rating_badge_status
    FROM public.player_rating_score prs
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    JOIN public.rating_system rsys ON rsys.id = rs.rating_system_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      CASE
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 2
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
        ELSE 1
      END DESC,
      prs.assigned_at DESC
  ),
  filtered AS (
    SELECT
      p.id,
      pr.first_name::TEXT AS first_name,
      pr.last_name::TEXT AS last_name,
      pr.display_name::TEXT AS display_name,
      pr.profile_picture_url::TEXT AS profile_picture_url,
      p.city::TEXT AS city,
      p.gender::TEXT AS gender,
      er.rating_label,
      er.rating_value,
      er.rating_is_certified,
      er.rating_badge_status,
      p.latitude::DOUBLE PRECISION AS latitude,
      p.longitude::DOUBLE PRECISION AS longitude,
      CASE
        WHEN p_latitude IS NULL OR p_longitude IS NULL OR p.location IS NULL THEN NULL
        ELSE extensions.ST_Distance(
          p.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography
        )
      END AS distance_meters,
      rep.reputation_tier::TEXT AS reputation_tier,
      rep.reputation_score::DOUBLE PRECISION AS reputation_score,
      rep.is_public AS reputation_is_public,
      p.last_seen_at
    FROM public.player p
    INNER JOIN public.player_sport ps
      ON ps.player_id = p.id
     AND ps.sport_id = p_sport_id
     AND (ps.is_active IS NULL OR ps.is_active = TRUE)
    INNER JOIN public.profile pr
      ON pr.id = p.id
     AND (pr.is_active IS NULL OR pr.is_active = TRUE)
    LEFT JOIN effective_rating er ON er.player_id = p.id
    LEFT JOIN public.player_reputation rep ON rep.player_id = p.id
    WHERE
      (p_current_user_id IS NULL OR p.id <> p_current_user_id)
      AND (p_exclude_player_ids IS NULL OR NOT (p.id = ANY(p_exclude_player_ids)))
      AND (
        NOT p_favorites_only
        OR (p_favorite_player_ids IS NOT NULL AND p.id = ANY(p_favorite_player_ids))
      )
      AND (
        CASE
          WHEN p_blocked_only THEN
            p_blocked_player_ids IS NOT NULL AND p.id = ANY(p_blocked_player_ids)
          WHEN p_blocked_player_ids IS NOT NULL THEN
            NOT (p.id = ANY(p_blocked_player_ids))
          ELSE TRUE
        END
      )
      AND (p_gender IS NULL OR p.gender::TEXT = p_gender)
      AND (p_min_skill_value IS NULL OR er.rating_value >= p_min_skill_value)
      AND (p_min_travel_distance_km IS NULL OR p.max_travel_distance >= p_min_travel_distance_km)
      AND (
        p_play_style IS NULL
        OR ps.preferred_play_style::TEXT = p_play_style
      )
      AND (
        (p_min_hour IS NULL AND p_max_hour IS NULL AND p_day IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.player_availability pa
          WHERE pa.player_id = p.id
            AND (pa.is_active IS NULL OR pa.is_active = TRUE)
            AND (p_day IS NULL OR pa.day::TEXT = p_day)
            AND (p_min_hour IS NULL OR pa.hour_of_day >= p_min_hour)
            AND (p_max_hour IS NULL OR pa.hour_of_day <= p_max_hour)
        )
      )
      AND (
        p_search_query IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(COALESCE(pr.first_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.last_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.display_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(p.city, '')) ILIKE '%' || extensions.unaccent(word) || '%'
          )
        )
      )
      AND (p_rating_score_ids IS NULL OR er.rating_score_id = ANY(p_rating_score_ids))
      AND (p_reputation_tier IS NULL OR rep.reputation_tier::TEXT = p_reputation_tier)
      AND (NOT p_certified_only OR er.rating_badge_status = 'certified')
  )
  SELECT
    f.id,
    f.first_name,
    f.last_name,
    f.display_name,
    f.profile_picture_url,
    f.city,
    f.gender,
    f.rating_label,
    f.rating_value,
    f.rating_is_certified,
    f.rating_badge_status,
    f.latitude,
    f.longitude,
    f.distance_meters,
    COUNT(*) OVER ()::BIGINT AS total_count,
    f.reputation_tier,
    f.reputation_score,
    f.reputation_is_public,
    f.last_seen_at
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort_by = 'distance' THEN f.distance_meters END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_asc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_desc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_high' THEN f.rating_value END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_low' THEN f.rating_value END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'recently_active' THEN f.last_seen_at END DESC NULLS LAST,
    f.id ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.search_players_nearby IS
  'Server-side player directory search. Returns a paginated, filtered, sorted slice with rating, reputation, and online status. `recently_active` sort uses player.last_seen_at (same column as the online indicator). Hour-range availability via (p_min_hour, p_max_hour). Distance via PostGIS when p_latitude/p_longitude provided.';

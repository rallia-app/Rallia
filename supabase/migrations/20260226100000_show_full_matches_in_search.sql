-- ============================================================================
-- Migration: Show full matches in search results
-- Created: 2026-02-26
-- Description: Removes the filtering of full matches from both
--   search_matches_nearby and search_public_matches RPCs. Full matches
--   should still appear in search results so users can see them.
-- ============================================================================

-- =============================================================================
-- STEP 1: Update search_matches_nearby to remove full-match filtering
-- =============================================================================

CREATE OR REPLACE FUNCTION search_matches_nearby(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_max_distance_km DOUBLE PRECISION,
  p_sport_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_user_gender TEXT DEFAULT NULL
)
RETURNS TABLE (
  match_id UUID,
  distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_point extensions.geography;
BEGIN
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  RETURN QUERY
  WITH match_distances AS (
    SELECT
      m.id,
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN
          extensions.ST_Distance(v_point, f.location::extensions.geography)
        WHEN m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_Distance(
            v_point,
            extensions.ST_SetSRID(extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326)::extensions.geography
          )
        ELSE
          NULL
      END AS dist_meters,
      m.match_date,
      m.start_time
    FROM match m
    LEFT JOIN facility f ON m.facility_id = f.id
    WHERE
      m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.match_date >= CURRENT_DATE
      -- Filter out matches that already started today (time-aware via timezone)
      AND (
        m.match_date > CURRENT_DATE
        OR m.start_time > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::TIME
      )
      AND m.sport_id = p_sport_id
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL)
      )
      AND (
        (m.location_type = 'facility' AND extensions.ST_Distance(v_point, f.location::extensions.geography) <= p_max_distance_km * 1000)
        OR (m.location_type = 'custom' AND extensions.ST_Distance(
          v_point,
          extensions.ST_SetSRID(extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326)::extensions.geography
        ) <= p_max_distance_km * 1000)
      )
      AND (
        m.preferred_opponent_gender IS NULL
        OR p_user_gender IS NULL
        OR m.preferred_opponent_gender::text = p_user_gender
      )
  )
  SELECT
    md.id AS match_id,
    md.dist_meters AS distance_meters
  FROM match_distances md
  ORDER BY
    md.match_date ASC,
    md.start_time ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION search_matches_nearby IS 'Search nearby matches at both facilities AND custom locations. Includes full matches in results.';

-- =============================================================================
-- STEP 2: Update search_public_matches to remove full-match filtering
-- =============================================================================

CREATE OR REPLACE FUNCTION search_public_matches(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_max_distance_km DOUBLE PRECISION,
  p_sport_id UUID,
  p_search_query TEXT DEFAULT NULL,
  p_format TEXT DEFAULT NULL,
  p_match_type TEXT DEFAULT NULL,
  p_date_range TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_skill_level TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_cost TEXT DEFAULT NULL,
  p_join_mode TEXT DEFAULT NULL,
  p_duration TEXT DEFAULT NULL,
  p_court_status TEXT DEFAULT NULL,
  p_specific_date DATE DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_user_gender TEXT DEFAULT NULL,
  p_facility_id UUID DEFAULT NULL
)
RETURNS TABLE (
  match_id UUID,
  distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_point extensions.geography;
  v_date_start DATE;
  v_date_end DATE;
  v_time_start TIME;
  v_time_end TIME;
  v_has_distance_filter BOOLEAN;
  v_has_facility_filter BOOLEAN;
BEGIN
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  v_has_distance_filter := p_max_distance_km IS NOT NULL;
  v_has_facility_filter := p_facility_id IS NOT NULL;

  IF p_specific_date IS NOT NULL THEN
    v_date_start := p_specific_date;
    v_date_end := p_specific_date;
  ELSIF p_date_range = 'today' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE;
  ELSIF p_date_range = 'week' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE + INTERVAL '7 days';
  ELSIF p_date_range = 'weekend' THEN
    v_date_start := CURRENT_DATE + (6 - EXTRACT(DOW FROM CURRENT_DATE))::INT;
    v_date_end := v_date_start + INTERVAL '1 day';
  ELSE
    v_date_start := CURRENT_DATE;
    v_date_end := NULL;
  END IF;

  IF p_time_of_day = 'morning' THEN
    v_time_start := '06:00:00'::TIME;
    v_time_end := '12:00:00'::TIME;
  ELSIF p_time_of_day = 'afternoon' THEN
    v_time_start := '12:00:00'::TIME;
    v_time_end := '18:00:00'::TIME;
  ELSIF p_time_of_day = 'evening' THEN
    v_time_start := '18:00:00'::TIME;
    v_time_end := '23:59:59'::TIME;
  ELSE
    v_time_start := NULL;
    v_time_end := NULL;
  END IF;

  RETURN QUERY
  WITH match_distances AS (
    SELECT
      m.id,
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE THEN
          extensions.ST_Distance(v_point, f.location::extensions.geography)
        WHEN m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_Distance(
            v_point,
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          )
        ELSE NULL
      END AS dist_meters
    FROM match m
    LEFT JOIN facility f ON m.facility_id = f.id AND f.is_active = TRUE
    WHERE
      m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id = p_sport_id
      AND (NOT v_has_facility_filter OR m.facility_id = p_facility_id)
      AND (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (
          (m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE)
          OR
          (m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL)
        )
      )
  ),
  filtered_matches AS (
    SELECT
      m.id,
      md.dist_meters,
      m.match_date,
      m.start_time
    FROM match m
    INNER JOIN match_distances md ON m.id = md.id
    WHERE
      (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (md.dist_meters IS NOT NULL AND md.dist_meters <= p_max_distance_km * 1000)
      )
      AND (
        m.match_date > CURRENT_DATE
        OR m.start_time > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::TIME
      )
      AND m.match_date >= v_date_start
      AND (v_date_end IS NULL OR m.match_date <= v_date_end)
      AND (p_format IS NULL OR m.format::TEXT = p_format)
      AND (
        p_match_type IS NULL
        OR (p_match_type = 'casual' AND m.player_expectation::TEXT IN ('casual', 'both'))
        OR (p_match_type = 'competitive' AND m.player_expectation::TEXT IN ('competitive', 'both'))
      )
      AND (
        v_time_start IS NULL
        OR (m.start_time >= v_time_start AND m.start_time < v_time_end)
      )
      AND (
        p_cost IS NULL
        OR (p_cost = 'free' AND m.is_court_free = TRUE)
        OR (p_cost = 'paid' AND (m.is_court_free = FALSE OR m.estimated_cost IS NOT NULL))
      )
      AND (p_join_mode IS NULL OR m.join_mode::TEXT = p_join_mode)
      AND (
        p_duration IS NULL
        OR (p_duration = '30' AND m.duration::TEXT = '30')
        OR (p_duration = '60' AND m.duration::TEXT = '60')
        OR (p_duration = '90' AND m.duration::TEXT = '90')
        OR (p_duration = '120+' AND m.duration::TEXT IN ('120', 'custom'))
      )
      AND (p_court_status IS NULL OR m.court_status::TEXT = p_court_status)
      AND (
        m.preferred_opponent_gender IS NULL
        OR p_user_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      AND (
        p_gender IS NULL
        OR p_gender = 'all'
        OR m.preferred_opponent_gender = p_gender::gender_enum
      )
      AND (
        p_search_query IS NULL OR LENGTH(TRIM(p_search_query)) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(COALESCE(m.location_name, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(m.location_address, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(m.notes, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR EXISTS (
              SELECT 1 FROM profile p
              WHERE p.id = m.created_by
              AND extensions.unaccent(COALESCE(p.display_name, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            )
          )
        )
      )
  )
  SELECT
    fm.id AS match_id,
    fm.dist_meters AS distance_meters
  FROM filtered_matches fm
  ORDER BY
    fm.match_date ASC,
    fm.start_time ASC,
    COALESCE(fm.dist_meters, 999999999) ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION search_public_matches(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, INT, INT, TEXT, UUID
) IS 'Search public matches with comprehensive filters. Includes full matches in results.';

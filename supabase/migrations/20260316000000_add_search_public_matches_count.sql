-- Migration: Add count function for public match search
-- Description: Creates a function to get total count of public matches matching search criteria
--              without pagination, for displaying total results count.
--              Mirrors the filtering logic of search_public_matches for consistency.

CREATE OR REPLACE FUNCTION public.search_public_matches_count(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_max_distance_km DOUBLE PRECISION DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL,
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
  p_user_gender TEXT DEFAULT NULL,
  p_facility_id UUID DEFAULT NULL,
  p_match_tier TEXT DEFAULT NULL,
  p_spots_available TEXT DEFAULT NULL,
  p_specific_time TIME WITHOUT TIME ZONE DEFAULT NULL
)
RETURNS INTEGER
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
  v_count INTEGER;
BEGIN
  -- Create point from coordinates
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  -- Determine if distance filter is active
  v_has_distance_filter := p_max_distance_km IS NOT NULL;

  -- Determine if facility filter is active
  v_has_facility_filter := p_facility_id IS NOT NULL;

  -- Calculate date range boundaries based on filter
  IF p_specific_date IS NOT NULL THEN
    v_date_start := p_specific_date;
    v_date_end := p_specific_date;
  ELSIF p_date_range = 'today' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE;
  ELSIF p_date_range = 'tomorrow' THEN
    v_date_start := CURRENT_DATE + 1;
    v_date_end := CURRENT_DATE + 1;
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

  -- Calculate time of day boundaries
  IF p_specific_time IS NOT NULL THEN
    v_time_start := p_specific_time - INTERVAL '1 hour';
    v_time_end := p_specific_time + INTERVAL '1 hour';
    IF v_time_start < '00:00:00'::TIME THEN
      v_time_start := '00:00:00'::TIME;
    END IF;
    IF v_time_end > '23:59:59'::TIME THEN
      v_time_end := '23:59:59'::TIME;
    END IF;
  ELSIF p_time_of_day = 'morning' THEN
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

  SELECT COUNT(*) INTO v_count
  FROM (
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
        m.format,
        m.court_status
      FROM match m
      INNER JOIN match_distances md ON m.id = md.id
      WHERE
        (
          v_has_facility_filter
          OR NOT v_has_distance_filter
          OR (md.dist_meters IS NOT NULL AND md.dist_meters <= p_max_distance_km * 1000)
        )
        AND (m.match_date + m.start_time) > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))
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
    ),
    match_counts AS (
      SELECT
        fm.id,
        fm.format,
        fm.court_status,
        CASE fm.format
          WHEN 'doubles' THEN 4
          ELSE 2
        END AS total_spots,
        (
          SELECT COUNT(*)
          FROM match_participant mp
          WHERE mp.match_id = fm.id AND mp.status = 'joined'
        ) AS filled_spots,
        (
          SELECT COUNT(*)
          FROM match_participant mp
          JOIN player_reputation pr ON mp.player_id = pr.player_id
          WHERE mp.match_id = fm.id AND mp.status = 'joined'
            AND pr.reputation_score >= 90
            AND EXISTS (
              SELECT 1 FROM player_rating_score prs
              JOIN rating_score rs ON prs.rating_score_id = rs.id
              JOIN rating_system rsys ON rs.rating_system_id = rsys.id
              WHERE prs.player_id = mp.player_id
                AND rsys.sport_id = p_sport_id
                AND prs.badge_status = 'certified'
            )
        ) AS coveted_count
      FROM filtered_matches fm
    )
    SELECT mc.id
    FROM match_counts mc
    WHERE
      (
        p_match_tier IS NULL
        OR (p_match_tier = 'mostWanted'
            AND mc.court_status = 'reserved'
            AND mc.coveted_count >= CASE WHEN mc.format = 'doubles' THEN 2 ELSE 1 END)
        OR (p_match_tier = 'covetedPlayers'
            AND mc.coveted_count >= CASE WHEN mc.format = 'doubles' THEN 2 ELSE 1 END)
        OR (p_match_tier = 'courtBooked'
            AND mc.court_status = 'reserved')
      )
      AND (
        p_spots_available IS NULL
        OR (p_spots_available = '1' AND mc.total_spots - mc.filled_spots = 1)
        OR (p_spots_available = '2' AND mc.total_spots - mc.filled_spots = 2)
        OR (p_spots_available = '3' AND mc.total_spots - mc.filled_spots >= 3)
      )
  ) AS matching_matches;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.search_public_matches_count IS
'Get total count of public matches matching search criteria without pagination.
Uses the same filtering logic as search_public_matches for consistency.';

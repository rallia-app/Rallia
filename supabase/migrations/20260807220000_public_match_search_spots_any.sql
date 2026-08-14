-- ============================================================================
-- Public match search: add a spots value meaning "not full"
--
-- p_spots_available could say "exactly 1 spot", "exactly 2" or "3 or more",
-- but had no way to say the thing people actually want, which is "don't show
-- me games I cannot join". Public Games therefore listed full games by
-- default, and any feature that counted joinable games could not point at a
-- list matching its own count.
--
-- 'any' means at least one free spot. Everything else is untouched: NULL still
-- means no spots filter at all, and the three headcount values keep their
-- exact-match meaning.
--
-- Both function bodies are copied verbatim from 20260503120000 with only that
-- branch added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_public_matches(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_max_distance_km DOUBLE PRECISION,
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
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_user_gender TEXT DEFAULT NULL,
  p_facility_id UUID DEFAULT NULL,
  p_match_tier TEXT DEFAULT NULL,
  p_spots_available TEXT DEFAULT NULL,
  p_specific_time TIME DEFAULT NULL,
  -- New parameters
  p_reputation_tier TEXT DEFAULT NULL,
  p_rating_score_ids UUID[] DEFAULT NULL
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
  v_time_start TIME;
  v_time_end TIME;
  v_has_distance_filter BOOLEAN;
  v_has_facility_filter BOOLEAN;
BEGIN
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  v_has_distance_filter := p_max_distance_km IS NOT NULL;
  v_has_facility_filter := p_facility_id IS NOT NULL;

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
      AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
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
      m.start_time,
      m.end_time,
      m.timezone,
      m.format,
      m.duration,
      m.player_expectation,
      m.location_type,
      m.location_name,
      m.location_address,
      m.is_court_free,
      m.estimated_cost,
      m.join_mode,
      m.court_status,
      m.created_by,
      m.preferred_opponent_gender,
      m.min_rating_score_id,
      m.notes,
      m.sport_id,
      (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE AS match_local_today
    FROM match m
    INNER JOIN match_distances md ON m.id = md.id
    WHERE
      (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (md.dist_meters IS NOT NULL AND md.dist_meters <= p_max_distance_km * 1000)
      )
      AND (m.match_date + m.start_time) > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))
      -- Date range filter
      AND (
        CASE
          WHEN p_specific_date IS NOT NULL THEN m.match_date = p_specific_date
          WHEN p_date_range = 'today' THEN m.match_date = (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
          WHEN p_date_range = 'tomorrow' THEN m.match_date = (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE + 1
          WHEN p_date_range = 'week' THEN
            m.match_date >= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
            AND m.match_date <= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE + INTERVAL '7 days'
          WHEN p_date_range = 'weekend' THEN
            m.match_date BETWEEN
              ((NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
                + (6 - EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE))::INT)
              AND
              ((NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
                + (6 - EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE))::INT
                + 1)
          ELSE m.match_date >= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
        END
      )
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
      -- Cost filter: per-player cost = estimated_cost / total_spots
      AND (
        p_cost IS NULL
        OR (p_cost = 'free' AND m.is_court_free = TRUE)
        OR (p_cost = 'under_5' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
            AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 5)
        OR (p_cost = 'under_10' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
            AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 10)
        OR (p_cost = 'under_20' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
            AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 20)
        OR (p_cost = '20_plus' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
            AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) >= 20)
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
      -- Reputation filter: filter by match host's reputation tier
      AND (
        p_reputation_tier IS NULL
        OR EXISTS (
          SELECT 1 FROM player_reputation pr
          WHERE pr.player_id = m.created_by
            AND pr.reputation_tier::TEXT = p_reputation_tier
        )
      )
      -- Rating filter: filter by match's min_rating_score_id
      AND (
        p_rating_score_ids IS NULL
        OR m.min_rating_score_id = ANY(p_rating_score_ids)
      )
      -- Search query filter
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
      fm.dist_meters,
      fm.match_date,
      fm.start_time,
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
      CASE WHEN p_sport_id IS NOT NULL THEN (
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
      ) ELSE 0 END AS coveted_count
    FROM filtered_matches fm
  )
  SELECT
    mc.id AS match_id,
    mc.dist_meters AS distance_meters
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
      -- 'any' means "not full": the only spots predicate that is about
      -- joinability rather than a specific headcount.
      OR (p_spots_available = 'any' AND mc.total_spots - mc.filled_spots >= 1)
    )
  ORDER BY
    mc.match_date ASC,
    mc.start_time ASC,
    COALESCE(mc.dist_meters, 999999999) ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

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
  p_specific_time TIME WITHOUT TIME ZONE DEFAULT NULL,
  -- New parameters
  p_reputation_tier TEXT DEFAULT NULL,
  p_rating_score_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_point extensions.geography;
  v_time_start TIME;
  v_time_end TIME;
  v_has_distance_filter BOOLEAN;
  v_has_facility_filter BOOLEAN;
  v_count INTEGER;
BEGIN
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  v_has_distance_filter := p_max_distance_km IS NOT NULL;
  v_has_facility_filter := p_facility_id IS NOT NULL;

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
        AND (
          CASE
            WHEN p_specific_date IS NOT NULL THEN m.match_date = p_specific_date
            WHEN p_date_range = 'today' THEN m.match_date = (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
            WHEN p_date_range = 'tomorrow' THEN m.match_date = (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE + 1
            WHEN p_date_range = 'week' THEN
              m.match_date >= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
              AND m.match_date <= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE + INTERVAL '7 days'
            WHEN p_date_range = 'weekend' THEN
              m.match_date BETWEEN
                ((NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
                  + (6 - EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE))::INT)
                AND
                ((NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
                  + (6 - EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE))::INT
                  + 1)
            ELSE m.match_date >= (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))::DATE
          END
        )
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
        -- Cost filter: per-player cost = estimated_cost / total_spots
        AND (
          p_cost IS NULL
          OR (p_cost = 'free' AND m.is_court_free = TRUE)
          OR (p_cost = 'under_5' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
              AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 5)
          OR (p_cost = 'under_10' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
              AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 10)
          OR (p_cost = 'under_20' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
              AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) < 20)
          OR (p_cost = '20_plus' AND m.is_court_free = FALSE AND m.estimated_cost IS NOT NULL
              AND (m.estimated_cost / CASE m.format WHEN 'doubles' THEN 4.0 ELSE 2.0 END) >= 20)
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
        -- Reputation filter: filter by match host's reputation tier
        AND (
          p_reputation_tier IS NULL
          OR EXISTS (
            SELECT 1 FROM player_reputation pr
            WHERE pr.player_id = m.created_by
              AND pr.reputation_tier::TEXT = p_reputation_tier
          )
        )
        -- Rating filter: filter by match's min_rating_score_id
        AND (
          p_rating_score_ids IS NULL
          OR m.min_rating_score_id = ANY(p_rating_score_ids)
        )
        -- Search query filter
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
      -- 'any' means "not full": the only spots predicate that is about
      -- joinability rather than a specific headcount.
      OR (p_spots_available = 'any' AND mc.total_spots - mc.filled_spots >= 1)
      )
  ) AS matching_matches;

  RETURN v_count;
END;
$$;

-- Grants (updated signatures with new params)
GRANT EXECUTE ON FUNCTION public.search_public_matches(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DATE, INT, INT, TEXT, UUID, TEXT, TEXT, TIME,
  TEXT, UUID[]
) TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.search_public_matches_count(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DATE, TEXT, UUID, TEXT, TEXT, TIME,
  TEXT, UUID[]
) TO authenticated, anon;

COMMENT ON FUNCTION public.search_public_matches IS
'Search public matches with comprehensive filters. Cost filter operates on per-player cost (total / player_count). Reputation and rating filters added 2026-05-03.';

COMMENT ON FUNCTION public.search_public_matches_count IS
'Get total count of public matches matching search criteria. Cost filter operates on per-player cost (total / player_count). Reputation and rating filters added 2026-05-03.';

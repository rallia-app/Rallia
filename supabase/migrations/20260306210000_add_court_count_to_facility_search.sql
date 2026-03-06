-- Add court_count and upcoming_match_count to search_facilities_nearby return type

DROP FUNCTION IF EXISTS search_facilities_nearby(UUID[], DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, TEXT[], TEXT[], TEXT[], BOOLEAN, BOOLEAN, INT, INT);

CREATE OR REPLACE FUNCTION search_facilities_nearby(
  p_sport_ids UUID[],
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_search_query TEXT DEFAULT NULL,
  p_max_distance_km DOUBLE PRECISION DEFAULT NULL,
  p_facility_types TEXT[] DEFAULT NULL,
  p_surface_types TEXT[] DEFAULT NULL,
  p_court_types TEXT[] DEFAULT NULL,
  p_has_lighting BOOLEAN DEFAULT NULL,
  p_membership_required BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  name VARCHAR(255),
  city VARCHAR(100),
  address VARCHAR(255),
  distance_meters DOUBLE PRECISION,
  facility_type TEXT,
  data_provider_id UUID,
  data_provider_type TEXT,
  booking_url_template TEXT,
  external_provider_id TEXT,
  timezone TEXT,
  sport_ids UUID[],
  is_first_come_first_serve BOOLEAN,
  membership_required BOOLEAN,
  court_count INT,
  upcoming_match_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT sub.id, sub.name, sub.city, sub.address, sub.distance_meters,
         sub.facility_type, sub.data_provider_id, sub.data_provider_type,
         sub.booking_url_template, sub.external_provider_id, sub.timezone,
         sub.sport_ids, sub.is_first_come_first_serve, sub.membership_required,
         sub.court_count, sub.upcoming_match_count
  FROM (
    SELECT
      f.id,
      f.name,
      f.city,
      f.address,
      extensions.ST_Distance(
        f.location,
        extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography
      ) AS distance_meters,
      f.facility_type::TEXT AS facility_type,
      COALESCE(f.data_provider_id, o.data_provider_id) AS data_provider_id,
      COALESCE(fp.provider_type, op.provider_type) AS data_provider_type,
      COALESCE(fp.booking_url_template, op.booking_url_template) AS booking_url_template,
      f.external_provider_id,
      f.timezone,
      ARRAY(
        SELECT fs2.sport_id
        FROM facility_sport fs2
        WHERE fs2.facility_id = f.id
          AND fs2.sport_id = ANY(p_sport_ids)
      ) AS sport_ids,
      f.is_first_come_first_serve,
      f.membership_required,
      (
        SELECT COUNT(*)::INT
        FROM court c
        INNER JOIN court_sport cs ON cs.court_id = c.id
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND cs.sport_id = ANY(p_sport_ids)
      ) AS court_count,
      (
        SELECT COUNT(*)::INT
        FROM match m
        WHERE m.facility_id = f.id
          AND m.sport_id = ANY(p_sport_ids)
          AND m.visibility = 'public'
          AND m.cancelled_at IS NULL
          AND (m.match_date + m.start_time) > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))
      ) AS upcoming_match_count
    FROM facility f
    INNER JOIN facility_sport fs ON fs.facility_id = f.id
    LEFT JOIN organization o ON o.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id
    LEFT JOIN data_provider op ON op.id = o.data_provider_id
    WHERE fs.sport_id = ANY(p_sport_ids)
      AND f.is_active = TRUE
      AND (
        p_search_query IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(f.name::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(f.city::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(f.address::text, '')) ILIKE '%' || extensions.unaccent(word) || '%'
          )
        )
      )
      AND (
        p_max_distance_km IS NULL
        OR extensions.ST_DWithin(
          f.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
          p_max_distance_km * 1000
        )
      )
      AND (
        p_facility_types IS NULL
        OR f.facility_type::TEXT = ANY(p_facility_types)
      )
      AND (
        p_surface_types IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.surface_type::TEXT = ANY(p_surface_types)
        )
      )
      AND (
        p_court_types IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND (
              ('indoor' = ANY(p_court_types) AND c.indoor = TRUE)
              OR ('outdoor' = ANY(p_court_types) AND c.indoor = FALSE)
            )
        )
      )
      AND (
        p_has_lighting IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.lighting = p_has_lighting
        )
      )
      AND (
        p_membership_required IS NULL
        OR f.membership_required = p_membership_required
      )
    GROUP BY f.id, f.name, f.city, f.address, f.location, f.facility_type,
             f.data_provider_id, f.external_provider_id, f.timezone,
             f.is_first_come_first_serve, f.membership_required,
             o.data_provider_id, fp.provider_type, op.provider_type,
             fp.booking_url_template, op.booking_url_template
  ) sub
  ORDER BY sub.distance_meters ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

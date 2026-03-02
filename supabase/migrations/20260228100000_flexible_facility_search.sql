-- Migration: Flexible facility search with accent-insensitive, word-tokenized matching
-- Description:
--   1. Enables the `unaccent` PostgreSQL extension for accent-insensitive text comparison.
--   2. Updates `search_facilities_nearby` to use word-tokenized, accent-insensitive search:
--      - Each word in the query must match at least one of name, city, or address.
--      - Accented characters are normalized (e.g. "montreal" matches "Montréal").
--      - Whitespace is trimmed and collapsed before tokenization.
--   3. Updates `search_facilities_nearby_count` with the same logic.

-- Enable unaccent extension
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA extensions;

-- Drop existing function (full signature required)
DROP FUNCTION IF EXISTS search_facilities_nearby(UUID[], DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, TEXT[], TEXT[], TEXT[], BOOLEAN, BOOLEAN, INT, INT);

-- Recreate with flexible text search
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
  sport_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT sub.id, sub.name, sub.city, sub.address, sub.distance_meters,
         sub.facility_type, sub.data_provider_id, sub.data_provider_type,
         sub.booking_url_template, sub.external_provider_id, sub.timezone,
         sub.sport_ids
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
      ) AS sport_ids
    FROM facility f
    INNER JOIN facility_sport fs ON fs.facility_id = f.id
    LEFT JOIN organization o ON o.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id
    LEFT JOIN data_provider op ON op.id = o.data_provider_id
    WHERE fs.sport_id = ANY(p_sport_ids)
      AND f.is_active = TRUE
      -- Text search filter (word-tokenized, accent-insensitive)
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
      -- Distance filter (convert km to meters)
      AND (
        p_max_distance_km IS NULL
        OR extensions.ST_DWithin(
          f.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
          p_max_distance_km * 1000
        )
      )
      -- Facility type filter
      AND (
        p_facility_types IS NULL
        OR f.facility_type::TEXT = ANY(p_facility_types)
      )
      -- Surface type filter (check if facility has any court with matching surface)
      AND (
        p_surface_types IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.surface_type::TEXT = ANY(p_surface_types)
        )
      )
      -- Court type filter (indoor/outdoor based on court.indoor boolean)
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
      -- Lighting filter (check if facility has any court with lighting)
      AND (
        p_has_lighting IS NULL
        OR EXISTS (
          SELECT 1 FROM court c
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND c.lighting = p_has_lighting
        )
      )
      -- Membership required filter
      AND (
        p_membership_required IS NULL
        OR f.membership_required = p_membership_required
      )
    GROUP BY f.id, f.name, f.city, f.address, f.location, f.facility_type,
             f.data_provider_id, f.external_provider_id, f.timezone,
             o.data_provider_id, fp.provider_type, op.provider_type,
             fp.booking_url_template, op.booking_url_template
  ) sub
  ORDER BY sub.distance_meters ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION search_facilities_nearby(UUID[], DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, TEXT[], TEXT[], TEXT[], BOOLEAN, BOOLEAN, INT, INT) IS
'Search for facilities near a location that support one or more sports.
Returns sport_ids array indicating which of the requested sports each facility supports.
Uses word-tokenized, accent-insensitive text matching so that e.g. "montreal" matches "Montréal"
and "tennis park" matches "Park Tennis Club".';

-- Drop existing count function (full signature required)
DROP FUNCTION IF EXISTS search_facilities_nearby_count(UUID[], DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, TEXT[], TEXT[], TEXT[], BOOLEAN, BOOLEAN);

-- Recreate count function with flexible text search
CREATE OR REPLACE FUNCTION search_facilities_nearby_count(
  p_sport_ids UUID[],
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_search_query TEXT DEFAULT NULL,
  p_max_distance_km DOUBLE PRECISION DEFAULT NULL,
  p_facility_types TEXT[] DEFAULT NULL,
  p_surface_types TEXT[] DEFAULT NULL,
  p_court_types TEXT[] DEFAULT NULL,
  p_has_lighting BOOLEAN DEFAULT NULL,
  p_membership_required BOOLEAN DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT f.id) INTO v_count
  FROM facility f
  INNER JOIN facility_sport fs ON fs.facility_id = f.id
  LEFT JOIN organization o ON o.id = f.organization_id
  LEFT JOIN data_provider fp ON fp.id = f.data_provider_id
  LEFT JOIN data_provider op ON op.id = o.data_provider_id
  WHERE fs.sport_id = ANY(p_sport_ids)
    AND f.is_active = TRUE
    -- Text search filter (word-tokenized, accent-insensitive)
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
    -- Distance filter (convert km to meters)
    AND (
      p_max_distance_km IS NULL
      OR extensions.ST_DWithin(
        f.location,
        extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography,
        p_max_distance_km * 1000
      )
    )
    -- Facility type filter
    AND (
      p_facility_types IS NULL
      OR f.facility_type::TEXT = ANY(p_facility_types)
    )
    -- Surface type filter
    AND (
      p_surface_types IS NULL
      OR EXISTS (
        SELECT 1 FROM court c
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND c.surface_type::TEXT = ANY(p_surface_types)
      )
    )
    -- Court type filter
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
    -- Lighting filter
    AND (
      p_has_lighting IS NULL
      OR EXISTS (
        SELECT 1 FROM court c
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND c.lighting = p_has_lighting
      )
    )
    -- Membership required filter
    AND (
      p_membership_required IS NULL
      OR f.membership_required = p_membership_required
    );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION search_facilities_nearby_count(UUID[], DOUBLE PRECISION, DOUBLE PRECISION, TEXT, DOUBLE PRECISION, TEXT[], TEXT[], TEXT[], BOOLEAN, BOOLEAN) IS
'Get total count of facilities matching search criteria without pagination.
Uses the same word-tokenized, accent-insensitive filtering logic as search_facilities_nearby.';

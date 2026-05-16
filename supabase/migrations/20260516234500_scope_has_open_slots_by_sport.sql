-- Migration: Scope p_has_open_slots check by sport_id
-- Description: The previous version of the filter checked
--              facility_availability_snapshot without constraining by sport.
--              Multi-sport facilities (e.g. Parc Warren-Allmand supports both
--              tennis and pickleball) passed the filter whenever any sport had
--              open slots, even though the facility card — which fetches slots
--              for the currently-selected sport — would correctly show none.
--              This migration adds `fas.sport_id = ANY(p_sport_ids)`. NULL
--              sport_id rows are legacy/un-stamped data and are intentionally
--              excluded; new rows are stamped at ingestion.

DROP FUNCTION IF EXISTS search_facilities_nearby;

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
  p_has_availabilities BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_user_gender TEXT DEFAULT NULL,
  p_player_id UUID DEFAULT NULL,
  p_favorites_only BOOLEAN DEFAULT NULL,
  p_organization_nature TEXT DEFAULT NULL,
  p_has_open_slots BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  name VARCHAR(255),
  city VARCHAR(100),
  address VARCHAR(255),
  distance_meters DOUBLE PRECISION,
  facility_type TEXT,
  organization_nature TEXT,
  data_provider_id UUID,
  data_provider_type TEXT,
  booking_url_template TEXT,
  external_provider_id TEXT,
  timezone TEXT,
  sport_ids UUID[],
  is_first_come_first_serve BOOLEAN,
  membership_required BOOLEAN,
  court_count INT,
  upcoming_match_count INT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_favorite BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT sub.id, sub.name, sub.city, sub.address, sub.distance_meters,
         sub.facility_type, sub.organization_nature,
         sub.data_provider_id, sub.data_provider_type,
         sub.booking_url_template, sub.external_provider_id, sub.timezone,
         sub.sport_ids, sub.is_first_come_first_serve, sub.membership_required,
         sub.court_count, sub.upcoming_match_count,
         sub.latitude, sub.longitude,
         sub.is_favorite
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
      o.nature::TEXT AS organization_nature,
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
          AND (
            m.preferred_opponent_gender IS NULL
            OR p_user_gender IS NULL
            OR m.preferred_opponent_gender = p_user_gender::gender_enum
          )
      ) AS upcoming_match_count,
      f.latitude::DOUBLE PRECISION AS latitude,
      f.longitude::DOUBLE PRECISION AS longitude,
      (p_player_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM player_favorite_facility pff
        WHERE pff.facility_id = f.id
          AND pff.player_id = p_player_id
          AND pff.sport_id = ANY(p_sport_ids)
      )) AS is_favorite
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
      AND (
        p_has_availabilities IS NOT TRUE
        OR f.external_provider_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM court_slot cs
          JOIN court c ON c.id = cs.court_id
          WHERE c.facility_id = f.id
            AND c.is_active = TRUE
            AND cs.is_available = TRUE
        )
        OR EXISTS (
          SELECT 1 FROM court_one_time_availability cota
          WHERE cota.facility_id = f.id
            AND cota.is_available = TRUE
            AND cota.availability_date >= CURRENT_DATE
        )
      )
      AND (
        p_has_open_slots IS NOT TRUE
        OR EXISTS (
          SELECT 1 FROM public.facility_availability_snapshot fas
          WHERE fas.facility_id = f.id
            AND fas.is_available = TRUE
            AND fas.slot_start > now()
            AND fas.sport_id = ANY(p_sport_ids)
        )
      )
      AND (
        p_favorites_only IS NOT TRUE
        OR (p_player_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM player_favorite_facility pff
          WHERE pff.facility_id = f.id
            AND pff.player_id = p_player_id
            AND pff.sport_id = ANY(p_sport_ids)
        ))
      )
      AND (
        p_organization_nature IS NULL
        OR o.nature::TEXT = p_organization_nature
      )
    GROUP BY f.id, f.name, f.city, f.address, f.location, f.facility_type,
             f.data_provider_id, f.external_provider_id, f.timezone,
             f.is_first_come_first_serve, f.membership_required,
             f.latitude, f.longitude,
             o.nature, o.data_provider_id,
             fp.provider_type, op.provider_type,
             fp.booking_url_template, op.booking_url_template
  ) sub
  ORDER BY sub.distance_meters ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

DROP FUNCTION IF EXISTS search_facilities_nearby_count;

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
  p_membership_required BOOLEAN DEFAULT NULL,
  p_has_availabilities BOOLEAN DEFAULT NULL,
  p_has_open_slots BOOLEAN DEFAULT NULL
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
    AND (
      p_has_availabilities IS NOT TRUE
      OR f.external_provider_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM court_slot cs
        JOIN court c ON c.id = cs.court_id
        WHERE c.facility_id = f.id
          AND c.is_active = TRUE
          AND cs.is_available = TRUE
      )
      OR EXISTS (
        SELECT 1 FROM court_one_time_availability cota
        WHERE cota.facility_id = f.id
          AND cota.is_available = TRUE
          AND cota.availability_date >= CURRENT_DATE
      )
    )
    AND (
      p_has_open_slots IS NOT TRUE
      OR EXISTS (
        SELECT 1 FROM public.facility_availability_snapshot fas
        WHERE fas.facility_id = f.id
          AND fas.is_available = TRUE
          AND fas.slot_start > now()
          AND fas.sport_id = ANY(p_sport_ids)
      )
    );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION search_facilities_nearby IS
  'Search facilities by sport, sorted by distance. p_has_availabilities filters '
  'to facilities that *could* be booked (provider integration / native slots); '
  'p_has_open_slots is stricter and requires a current row in '
  'facility_availability_snapshot with is_available = TRUE, slot_start > now(), '
  'AND sport_id matching p_sport_ids.';

COMMENT ON FUNCTION search_facilities_nearby_count IS
  'Count companion to search_facilities_nearby. Mirrors all filters including '
  'the sport-scoped p_has_open_slots.';

-- Migration: Add day + time-of-day open-availability filter to facility search
-- Description: Lets the mobile facilities directory filter to facilities that
--              have at least one open snapshot slot on a specific calendar day
--              and/or within an hour window — mirroring the Community player
--              directory's availability filter (presets AM/PM/Eve + exact hour).
--
--              Three new optional params on both search_facilities_nearby and
--              search_facilities_nearby_count:
--                - p_slot_date DATE : a specific local day (facility timezone)
--                - p_min_hour  INT  : inclusive lower bound on the slot's local
--                                     start hour (0..23)
--                - p_max_hour  INT  : inclusive upper bound on the slot's local
--                                     start hour
--
--              All three are NULL by default → no behavioural change for
--              existing callers. The hour and day are evaluated in the
--              facility's own timezone (slots are timestamptz), so "Wednesday
--              PM" means Wednesday afternoon where the courts physically are,
--              not in UTC. Snapshot rows are sport-scoped and future-only, the
--              same gate already used by p_has_open_slots.
--
--              When a day/time filter is active the inline availability_slots
--              LATERAL is scoped to the same window so each facility card shows
--              exactly the matching slots instead of the full week.

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
  p_has_open_slots BOOLEAN DEFAULT NULL,
  p_slot_date DATE DEFAULT NULL,
  p_min_hour INT DEFAULT NULL,
  p_max_hour INT DEFAULT NULL
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
  is_favorite BOOLEAN,
  availability_slots JSONB
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
         sub.is_favorite,
         COALESCE(slots.availability_slots, '[]'::jsonb) AS availability_slots
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
      -- Day + time-of-day availability filter. When any bound is set, require a
      -- matching open snapshot slot; the day and hour are read in the facility's
      -- local timezone so they line up with what the card displays.
      AND (
        (p_slot_date IS NULL AND p_min_hour IS NULL AND p_max_hour IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.facility_availability_snapshot fas
          WHERE fas.facility_id = f.id
            AND fas.is_available = TRUE
            AND fas.slot_start > now()
            AND fas.sport_id = ANY(p_sport_ids)
            AND (
              p_slot_date IS NULL
              OR (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))::date = p_slot_date
            )
            AND (
              p_min_hour IS NULL
              OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))) >= p_min_hour
            )
            AND (
              p_max_hour IS NULL
              OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))) <= p_max_hour
            )
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
  -- Inline availability slots from the snapshot. Runs only for paginated
  -- rows (after LIMIT/OFFSET). Uses idx_fas_facility_sport_window for the
  -- (facility_id, sport_id, slot_start) lookup. When a day/time filter is
  -- active the slots are scoped to the same window so the card shows the
  -- matching openings rather than the whole snapshot week.
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'external_court_id', fas.external_court_id,
        'slot_start',        fas.slot_start,
        'slot_end',          fas.slot_end,
        'external_slot_id',  fas.external_slot_id,
        'court_name',        fas.court_name,
        'court_number',      fas.court_number,
        'price_cents',       fas.price_cents,
        'currency',          fas.currency,
        'source',            fas.source,
        'sport_id',          fas.sport_id,
        'booking_url',       fas.booking_url
      )
      ORDER BY fas.slot_start, fas.external_court_id
    ) AS availability_slots
    FROM public.facility_availability_snapshot fas
    WHERE fas.facility_id = sub.id
      AND fas.is_available = TRUE
      AND fas.slot_start > now()
      AND fas.sport_id = ANY(p_sport_ids)
      AND (
        p_slot_date IS NULL
        OR (fas.slot_start AT TIME ZONE COALESCE(sub.timezone, 'UTC'))::date = p_slot_date
      )
      AND (
        p_min_hour IS NULL
        OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(sub.timezone, 'UTC'))) >= p_min_hour
      )
      AND (
        p_max_hour IS NULL
        OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(sub.timezone, 'UTC'))) <= p_max_hour
      )
  ) slots ON TRUE
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
  p_has_open_slots BOOLEAN DEFAULT NULL,
  p_slot_date DATE DEFAULT NULL,
  p_min_hour INT DEFAULT NULL,
  p_max_hour INT DEFAULT NULL
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
    )
    AND (
      (p_slot_date IS NULL AND p_min_hour IS NULL AND p_max_hour IS NULL)
      OR EXISTS (
        SELECT 1 FROM public.facility_availability_snapshot fas
        WHERE fas.facility_id = f.id
          AND fas.is_available = TRUE
          AND fas.slot_start > now()
          AND fas.sport_id = ANY(p_sport_ids)
          AND (
            p_slot_date IS NULL
            OR (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))::date = p_slot_date
          )
          AND (
            p_min_hour IS NULL
            OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))) >= p_min_hour
          )
          AND (
            p_max_hour IS NULL
            OR EXTRACT(HOUR FROM (fas.slot_start AT TIME ZONE COALESCE(f.timezone, 'UTC'))) <= p_max_hour
          )
      )
    );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION search_facilities_nearby IS
  'Search facilities by sport, sorted by distance. Returns inline '
  'availability_slots from facility_availability_snapshot (sport-scoped, '
  'future-only). p_has_availabilities filters to facilities that *could* be '
  'booked; p_has_open_slots requires a current snapshot row. p_slot_date / '
  'p_min_hour / p_max_hour filter to facilities with an open slot on a given '
  'local day and/or hour window (evaluated in the facility timezone); when set '
  'they also scope the returned availability_slots to that window.';

COMMENT ON FUNCTION search_facilities_nearby_count IS
  'Count companion to search_facilities_nearby. Mirrors all filters including '
  'the sport-scoped p_has_open_slots and the p_slot_date / p_min_hour / '
  'p_max_hour day+time availability window.';

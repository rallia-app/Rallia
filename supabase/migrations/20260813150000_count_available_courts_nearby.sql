-- Migration: count_available_courts_nearby
-- Description: Distinct courts with at least one future bookable snapshot slot
--              within a radius of the player, for the given sport(s). Powers
--              the Home "Book a court" tile stat, which must always count what
--              is open NEAR the player (never a favorites-scoped subset).
--
--              Done server-side on purpose: the equivalent client-side count
--              would mean pulling search_facilities_nearby with inline slots
--              for every nearby facility (~3.7k slot rows inside 20km of
--              downtown Montreal) just to render one number.
--
--              Mirrors the slot predicates of search_facilities_nearby's
--              availability LATERAL (is_available, future-only, sport-scoped)
--              and its facility gate (is_active, ST_DWithin), so the tile's
--              number and the directory it links to agree.

CREATE OR REPLACE FUNCTION public.count_available_courts_nearby(
  p_sport_ids UUID[],
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_max_distance_km DOUBLE PRECISION DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COUNT(DISTINCT (fas.facility_id, fas.external_court_id))::INT
  FROM public.facility_availability_snapshot fas
  INNER JOIN public.facility f ON f.id = fas.facility_id
  WHERE fas.is_available = TRUE
    AND fas.slot_start > now()
    AND fas.sport_id = ANY(p_sport_ids)
    AND f.is_active = TRUE
    AND (
      p_max_distance_km IS NULL
      OR extensions.ST_DWithin(
        f.location,
        extensions.ST_SetSRID(
          extensions.ST_MakePoint(p_longitude, p_latitude), 4326
        )::extensions.geography,
        p_max_distance_km * 1000
      )
    );
$$;

COMMENT ON FUNCTION public.count_available_courts_nearby IS
  'Number of distinct courts with a future bookable slot within p_max_distance_km of (p_latitude, p_longitude) for the given sports. NULL distance = unbounded.';

-- Same audience as the snapshot table itself (world-readable): signed-out
-- visitors see the Home play grid too.
GRANT EXECUTE ON FUNCTION public.count_available_courts_nearby(
  UUID[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO anon, authenticated;

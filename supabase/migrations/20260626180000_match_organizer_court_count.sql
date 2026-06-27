-- ============================================================================
-- Chat Match Organizer — engine v2: expose how many courts are open
-- ============================================================================
-- Adds `court_count` to match_organizer_options: the number of distinct courts
-- available at the facility at that exact hour (was previously just fetching the
-- single cheapest court). The card/preview surface this so players can see "3
-- courts open" instead of a bare "court available". price_cents is the min over
-- the open courts; court_name is the cheapest court's label.
-- Return type changes -> DROP + recreate. Args unchanged.
-- ============================================================================

DROP FUNCTION IF EXISTS public.match_organizer_options(uuid[], uuid, int, int);

CREATE OR REPLACE FUNCTION public.match_organizer_options(
  p_player_ids  uuid[],
  p_sport_id    uuid,
  p_window_days int DEFAULT 14,
  p_limit       int DEFAULT 8
)
RETURNS TABLE (
  slot_start      timestamptz,
  day_label       text,
  hour_of_day     smallint,
  facility_id     uuid,
  facility_name   text,
  fav_count       int,
  distance_km     double precision,
  court_name      text,
  court_count     int,
  price_cents     int,
  court_confirmed boolean,
  tier            text,
  score           double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH params AS (SELECT array_length(p_player_ids, 1) AS n),
overlap AS (
  SELECT pa.day, pa.hour_of_day
  FROM player_availability pa
  WHERE pa.player_id = ANY(p_player_ids) AND pa.is_active
  GROUP BY pa.day, pa.hour_of_day
  HAVING count(DISTINCT pa.player_id) = (SELECT n FROM params)
),
fav AS (
  SELECT pff.facility_id, count(DISTINCT pff.player_id) AS fav_count
  FROM player_favorite_facility pff
  WHERE pff.player_id = ANY(p_player_ids) AND pff.sport_id = p_sport_id
  GROUP BY pff.facility_id
),
fac AS (
  SELECT f.id, f.name, f.timezone, fv.fav_count,
    (SELECT max(extensions.ST_Distance(f.location, p.location) / 1000.0)
       FROM player p WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL) AS distance_km
  FROM facility f
  JOIN fav fv ON fv.facility_id = f.id
  WHERE f.is_active AND f.location IS NOT NULL
),
dow(day, d) AS (VALUES
  ('sunday'::day_enum,0),('monday',1),('tuesday',2),('wednesday',3),
  ('thursday',4),('friday',5),('saturday',6)),
dates AS (
  SELECT g::date AS slot_date
  FROM generate_series(now()::date, (now() + (p_window_days || ' days')::interval)::date, interval '1 day') g
),
projected AS (
  SELECT dt.slot_date, o.day, o.hour_of_day
  FROM dates dt
  JOIN dow ON dow.d = EXTRACT(DOW FROM dt.slot_date)::int
  JOIN overlap o ON o.day = dow.day
),
opt AS (
  SELECT pr.slot_date, pr.day, pr.hour_of_day, fc.id AS facility_id, fc.name AS facility_name,
         fc.fav_count, fc.distance_km,
         ((pr.slot_date::text || ' ' || lpad(pr.hour_of_day::text, 2, '0') || ':00:00')::timestamp
            AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')) AS slot_start
  FROM projected pr CROSS JOIN fac fc
),
-- (4) enrich with how many courts are open at that exact hour
enriched AS (
  SELECT o.*, cs.court_name, cs.court_count, cs.price_cents,
    (COALESCE(cs.court_count, 0) > 0) AS court_confirmed,
    ( (CASE WHEN COALESCE(cs.court_count, 0) > 0 THEN 100 ELSE 0 END)
      + o.fav_count * 10
      - EXTRACT(EPOCH FROM (o.slot_start - now())) / 86400.0      -- sooner ranks higher
      - COALESCE(o.distance_km, 0) * 0.5 )::float8 AS score
  FROM opt o
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT s.external_court_id)::int AS court_count,
           min(s.price_cents)::int AS price_cents,
           (array_agg(s.court_name ORDER BY s.price_cents NULLS LAST))[1] AS court_name
    FROM facility_availability_snapshot s
    WHERE s.facility_id = o.facility_id AND s.sport_id = p_sport_id AND s.is_available
      AND s.slot_start >= o.slot_start AND s.slot_start < o.slot_start + interval '1 hour'
  ) cs ON true
  WHERE o.slot_start > now()
),
-- (5) diversify: best hour per (facility, date)
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY facility_id, slot_date ORDER BY score DESC) AS rn
  FROM enriched
)
SELECT slot_start, day::text, hour_of_day, facility_id, facility_name, fav_count,
       round(distance_km::numeric, 1)::float8, court_name,
       COALESCE(court_count, 0) AS court_count, price_cents, court_confirmed,
       CASE WHEN court_confirmed THEN 'bookable' ELSE 'usually_free' END AS tier,
       score
FROM ranked
WHERE rn = 1 AND array_length(p_player_ids, 1) >= 2
ORDER BY score DESC
LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) IS
  'Ranked time/place options for N players + sport: availability overlap x favorited facilities x live court slots (with open-court count). Generic (no tournament dependency).';

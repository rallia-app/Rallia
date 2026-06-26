-- ============================================================================
-- Chat Match Organizer — suggestion engine
-- ============================================================================
-- Given N players + a sport, returns ranked time/place options to play:
--   * availability overlap (recurring weekly, all N free) projected onto dates
--   * facilities favorited by >=1 of them (a favorite IS the travel-willingness
--     signal — max_travel_distance is NOT used to gate favorites; it excludes
--     facilities players explicitly chose. player_favorite_facility.sport_id is
--     the sport authority, NOT facility_sport, which is inconsistently populated)
--   * enriched with live court availability (facility_availability_snapshot) when
--     a slot falls at a mutually-free hour -> "bookable now" tier
-- Diversified to the best hour per (facility, date) so the card shows variety,
-- not 5 consecutive hours at one club. Validated on prod (2026-06-25): ~64% of
-- same-sport pairs get a bookable-now option, ~89% get at least one option.
-- Read-only / STABLE. Generic — no tournament knowledge.
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
  price_cents     int,
  court_confirmed boolean,
  tier            text,
  score           double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH params AS (SELECT array_length(p_player_ids, 1) AS n),
-- (1) recurring (day, hour) cells where ALL N players are free
overlap AS (
  SELECT pa.day, pa.hour_of_day
  FROM player_availability pa
  WHERE pa.player_id = ANY(p_player_ids) AND pa.is_active
  GROUP BY pa.day, pa.hour_of_day
  HAVING count(DISTINCT pa.player_id) = (SELECT n FROM params)
),
-- (2) facilities favorited (for this sport) by >=1 of the players
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
-- (3) project overlap cells onto concrete upcoming dates
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
-- (4) enrich with a real open court slot at that exact hour, if any
enriched AS (
  SELECT o.*, cs.court_name, cs.price_cents, (cs.court_name IS NOT NULL) AS court_confirmed,
    ( (CASE WHEN cs.court_name IS NOT NULL THEN 100 ELSE 0 END)
      + o.fav_count * 10
      - EXTRACT(EPOCH FROM (o.slot_start - now())) / 86400.0      -- sooner ranks higher
      - COALESCE(o.distance_km, 0) * 0.5 )::float8 AS score
  FROM opt o
  LEFT JOIN LATERAL (
    SELECT s.court_name, s.price_cents
    FROM facility_availability_snapshot s
    WHERE s.facility_id = o.facility_id AND s.sport_id = p_sport_id AND s.is_available
      AND s.slot_start >= o.slot_start AND s.slot_start < o.slot_start + interval '1 hour'
    ORDER BY s.price_cents NULLS LAST
    LIMIT 1
  ) cs ON true
  WHERE o.slot_start > now()
),
-- (5) diversify: best hour per (facility, date)
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY facility_id, slot_date ORDER BY score DESC) AS rn
  FROM enriched
)
SELECT slot_start, day::text, hour_of_day, facility_id, facility_name, fav_count,
       round(distance_km::numeric, 1)::float8, court_name, price_cents, court_confirmed,
       CASE WHEN court_confirmed THEN 'bookable' ELSE 'usually_free' END AS tier,
       score
FROM ranked
WHERE rn = 1 AND array_length(p_player_ids, 1) >= 2
ORDER BY score DESC
LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) IS
  'Ranked time/place options for N players + sport: availability overlap x favorited facilities x live court slots. Generic (no tournament dependency).';

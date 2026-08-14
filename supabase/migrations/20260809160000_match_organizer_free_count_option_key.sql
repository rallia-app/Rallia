-- ============================================================================
-- Match Organizer engine: expose free_count + stable option_key
-- ============================================================================
-- Spec: specs/08-communications/match-organizer-live-suggestions.md
--   §Blocking prerequisite / §Also required
--
-- Two additive return columns on match_organizer_options:
--   * free_count  — how many of the p_player_ids are recurring-free at the
--     slot. Already computed in the avail CTE, never surfaced; the card needs
--     it to label "both available" vs "only you", and the system poster needs
--     it to detect the zero-overlap case instead of posting one-sided options.
--   * option_key  — deterministic identity for a (slot_start, facility) pair:
--     md5(epoch-seconds || '|' || facility). Snapshotted into card metadata so
--     future card regeneration can re-anchor votes on identity instead of
--     array position. Epoch seconds (not ::text) so the key is independent of
--     the session TimeZone GUC.
--
-- Body is otherwise verbatim from 20260713190000 (court-first ranking).
-- Return-type change requires DROP + re-grant.
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
  score           double precision,
  free_count      int,
  option_key      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH params AS (SELECT array_length(p_player_ids, 1) AS n),
-- per (day, hour): how many of the players are recurring-free (>=1 by construction)
avail AS (
  SELECT pa.day, pa.hour_of_day, count(DISTINCT pa.player_id) AS free_count
  FROM player_availability pa
  WHERE pa.player_id = ANY(p_player_ids) AND pa.is_active
  GROUP BY pa.day, pa.hour_of_day
),
fav AS (
  SELECT pff.facility_id, count(DISTINCT pff.player_id) AS fav_count
  FROM player_favorite_facility pff
  WHERE pff.player_id = ANY(p_player_ids) AND pff.sport_id = p_sport_id
  GROUP BY pff.facility_id
),
-- candidate facilities: favorited (bypasses travel cap) OR within EVERY located
-- player's max_travel (only when at least one player has a home location, so a
-- location-less pair doesn't open the whole facility table).
fac AS (
  SELECT f.id, f.name, f.timezone, COALESCE(fv.fav_count, 0) AS fav_count,
         (fv.facility_id IS NOT NULL) AS is_fav,
         (SELECT max(extensions.ST_Distance(f.location, p.location) / 1000.0)
            FROM player p WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL) AS distance_km
  FROM facility f
  LEFT JOIN fav fv ON fv.facility_id = f.id
  WHERE f.is_active AND f.location IS NOT NULL
    AND (
      fv.facility_id IS NOT NULL
      OR (
        EXISTS (SELECT 1 FROM player p WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM player p
          WHERE p.id = ANY(p_player_ids) AND p.location IS NOT NULL
            AND extensions.ST_Distance(f.location, p.location) / 1000.0 > COALESCE(p.max_travel_distance, 25)
        )
      )
    )
),
dow(day, d) AS (VALUES
  ('sunday'::day_enum,0),('monday',1),('tuesday',2),('wednesday',3),
  ('thursday',4),('friday',5),('saturday',6)),
-- SOURCE A: real open-court hours at candidate facilities (local date/hour)
court_hours AS (
  SELECT fc.id AS facility_id, fc.name AS facility_name, fc.timezone,
         fc.fav_count, fc.is_fav, fc.distance_km,
         (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto'))::date AS slot_date,
         extract(hour FROM (s.slot_start AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')))::int AS hour_of_day,
         count(DISTINCT s.external_court_id)::int AS court_count,
         min(s.price_cents)::int AS price_cents,
         (array_agg(s.court_name ORDER BY s.price_cents NULLS LAST))[1] AS court_name
  FROM facility_availability_snapshot s
  JOIN fac fc ON fc.id = s.facility_id
  WHERE s.sport_id = p_sport_id AND s.is_available
    AND s.slot_start > now()
    AND s.slot_start < now() + (p_window_days || ' days')::interval
  GROUP BY fc.id, fc.name, fc.timezone, fc.fav_count, fc.is_fav, fc.distance_km, slot_date, hour_of_day
),
source_a AS (
  SELECT ch.facility_id, ch.facility_name, ch.fav_count, ch.is_fav, ch.distance_km,
         ch.slot_date, dw.day AS day, ch.hour_of_day,
         ch.court_count, ch.price_cents, ch.court_name, true AS court_confirmed,
         av.free_count,
         ((ch.slot_date::text || ' ' || lpad(ch.hour_of_day::text, 2, '0') || ':00:00')::timestamp
            AT TIME ZONE COALESCE(ch.timezone, 'America/Toronto')) AS slot_start
  FROM court_hours ch
  JOIN dow dw ON dw.d = EXTRACT(DOW FROM ch.slot_date)::int
  JOIN avail av ON av.day = dw.day AND av.hour_of_day = ch.hour_of_day  -- >=1 player free
),
-- SOURCE B: speculative mutual-overlap hours x favorited facilities (no live court)
overlap AS (SELECT day, hour_of_day FROM avail WHERE free_count = (SELECT n FROM params)),
dates AS (
  SELECT g::date AS slot_date
  FROM generate_series(now()::date, (now() + (p_window_days || ' days')::interval)::date, interval '1 day') g
),
source_b AS (
  SELECT fc.id AS facility_id, fc.name AS facility_name, fc.fav_count, fc.is_fav, fc.distance_km,
         dt.slot_date, o.day AS day, o.hour_of_day,
         0::int AS court_count, NULL::int AS price_cents, NULL::text AS court_name, false AS court_confirmed,
         (SELECT n FROM params) AS free_count,
         ((dt.slot_date::text || ' ' || lpad(o.hour_of_day::text, 2, '0') || ':00:00')::timestamp
            AT TIME ZONE COALESCE(fc.timezone, 'America/Toronto')) AS slot_start
  FROM dates dt
  JOIN dow dw ON dw.d = EXTRACT(DOW FROM dt.slot_date)::int
  JOIN overlap o ON o.day = dw.day
  JOIN fac fc ON fc.is_fav
  WHERE NOT EXISTS (
    SELECT 1 FROM source_a a
    WHERE a.facility_id = fc.id AND a.slot_date = dt.slot_date AND a.hour_of_day = o.hour_of_day
  )
),
cand AS (
  SELECT * FROM source_a
  UNION ALL
  SELECT * FROM source_b
),
scored AS (
  SELECT c.*,
    ( (CASE WHEN c.court_confirmed THEN 1000 ELSE 0 END)                      -- real courts first
      + (CASE WHEN c.free_count >= (SELECT n FROM params) THEN 200 ELSE 0 END) -- both free preferred
      + c.free_count * 20                                                      -- more free players better
      + (CASE WHEN c.is_fav THEN c.fav_count * 10 ELSE 0 END)                  -- favorite boost
      - EXTRACT(EPOCH FROM (c.slot_start - now())) / 86400.0                   -- sooner ranks higher
      - COALESCE(c.distance_km, 0) * 0.5 )::float8 AS score                    -- nearer ranks higher
  FROM cand c
  WHERE c.slot_start > now()
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY facility_id, slot_date ORDER BY score DESC) AS rn
  FROM scored
)
SELECT slot_start, day::text, hour_of_day::smallint, facility_id, facility_name, fav_count::int,
       round(distance_km::numeric, 1)::float8, court_name, court_count::int, price_cents, court_confirmed,
       CASE WHEN court_confirmed THEN 'bookable' ELSE 'usually_free' END AS tier,
       score,
       free_count::int,
       md5(extract(epoch FROM slot_start)::bigint::text || '|' || COALESCE(facility_id::text, 'none')) AS option_key
FROM ranked
WHERE rn = 1 AND array_length(p_player_ids, 1) >= 2
ORDER BY score DESC
LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.match_organizer_options(uuid[], uuid, int, int) IS
  'Ranked time/place options for N players + sport, court-availability-first: real upcoming open courts near both players (>=1 free) always outrank speculative usually-free favorited-park overlap slots. free_count says how many of the players are recurring-free at the slot; option_key is a stable per-(slot,facility) identity for vote re-anchoring. Generic (no tournament dependency).';

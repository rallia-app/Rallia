-- =============================================================================
-- Weekly check-in: "Games for you" opportunities RPC
--
-- Surfaces existing PUBLIC matches with open spots that fit the availability the
-- player JUST declared in the wizard (not yet persisted — passed in as p_slots).
-- Shown as a step before the auto-generation step so the player can join real
-- games before we offer to create new ones.
--
-- A match qualifies only if ALL hold (per product spec):
--   1. It is at one of the player's favorite facilities for that sport
--      OR within the player's max_travel_distance (home location).
--   2. The match's minimum rating EQUALS the player's ACTIVE rating for that
--      sport (strict equality, resolved via player_sport.active_rating_score_id —
--      the only rating read path; never re-derived). Matches with no min rating
--      do not qualify.
--   3. The match's weekday + start hour is one of the declared availability slots.
--   4. If the match sets preferred_opponent_gender, the player's gender must match.
--
-- Multi-sport: every active sport in player_sport is considered; the rating
-- equality is resolved per the match's own sport. Windowed to today…today+3 in
-- the player's timezone (the same rolling window the wizard collects + the
-- auto-generator targets). Excludes the caller's own matches and ones they're
-- already in/awaiting. Returns match ids + distance for the service to hydrate
-- into MatchWithDetails (same handoff as search_public_matches).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_checkin_match_opportunities(
  p_slots    jsonb,
  p_timezone text DEFAULT NULL,
  p_limit    int  DEFAULT 20
)
RETURNS TABLE (
  match_id        uuid,
  distance_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
-- `extensions` on the path so the PostGIS geography type + ST_Distance resolve.
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tz     text;
  v_today  date;
  v_loc    extensions.geography;
  v_gender gender_enum;
  v_max_km numeric;
BEGIN
  -- Unauthenticated → nothing (mirrors get_check_in_context's guard).
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), NULLIF(p_timezone, ''), 'UTC'),
         p.location, p.gender, COALESCE(p.max_travel_distance, 25)
    INTO v_tz, v_loc, v_gender, v_max_km
    FROM public.player p
   WHERE p.id = v_caller;

  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  RETURN QUERY
  WITH
  -- Active sports + the caller's ACTIVE rating_score for each (the only rating
  -- read path; NULL when the player hasn't set an active rating → that sport
  -- surfaces nothing, since criterion 2 needs an exact match).
  caller_sports AS (
    SELECT ps.sport_id,
           prs.rating_score_id AS active_rating
      FROM public.player_sport ps
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE ps.player_id = v_caller
       AND ps.is_active = TRUE
  ),
  -- Declared (weekday, hour) slots from the wizard's in-memory availability.
  slots AS (
    SELECT s.day AS day, s.hour AS hour
      FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS s(day text, hour int)
  ),
  cand AS (
    SELECT
      m.id,
      m.match_date,
      m.start_time,
      m.format,
      m.facility_id,
      m.sport_id,
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
        WHEN m.location_type = 'custom'
             AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
          )::extensions.geography
        ELSE NULL
      END AS match_loc
    FROM public.match m
    -- Criterion 2: min rating EQUALS the caller's active rating for the match's sport.
    JOIN caller_sports cs
      ON cs.sport_id = m.sport_id
     AND m.min_rating_score_id = cs.active_rating
    LEFT JOIN public.facility f ON f.id = m.facility_id AND f.is_active = TRUE
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.min_rating_score_id IS NOT NULL
      AND m.created_by <> v_caller
      AND m.match_date BETWEEN v_today AND v_today + 3
      AND (m.match_date + m.start_time) > (now() AT TIME ZONE COALESCE(m.timezone, v_tz))
      -- Criterion 4: gender restriction (if set).
      AND (m.preferred_opponent_gender IS NULL OR m.preferred_opponent_gender = v_gender)
      -- Criterion 3: weekday + start hour is a declared slot.
      AND EXISTS (
        SELECT 1 FROM slots s
        WHERE s.day = (CASE EXTRACT(isodow FROM m.match_date)::int
                         WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                         WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                         WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                         WHEN 7 THEN 'sunday' END)
          AND s.hour = EXTRACT(hour FROM m.start_time)::int
      )
      -- Not already in (or awaiting) this match.
      AND NOT EXISTS (
        SELECT 1 FROM public.match_participant mp
        WHERE mp.match_id = m.id
          AND mp.player_id = v_caller
          AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
      )
      -- Open spot: joined count < capacity.
      AND (
        SELECT count(*) FROM public.match_participant mp
        WHERE mp.match_id = m.id AND mp.status = 'joined'
      ) < CASE m.format WHEN 'doubles' THEN 4 ELSE 2 END
  )
  SELECT
    c.id AS match_id,
    CASE WHEN v_loc IS NOT NULL AND c.match_loc IS NOT NULL
         THEN extensions.ST_Distance(v_loc, c.match_loc) END AS distance_meters
  FROM cand c
  WHERE
    -- Criterion 1: favorite facility for the sport OR within max travel distance.
    EXISTS (
      SELECT 1 FROM public.player_favorite_facility pff
      WHERE pff.player_id = v_caller
        AND pff.facility_id = c.facility_id
        AND (pff.sport_id = c.sport_id OR pff.sport_id IS NULL)
    )
    OR (
      v_loc IS NOT NULL AND c.match_loc IS NOT NULL
      AND extensions.ST_Distance(v_loc, c.match_loc) <= v_max_km * 1000
    )
  ORDER BY c.match_date ASC, c.start_time ASC, distance_meters ASC NULLS LAST
  LIMIT GREATEST(p_limit, 0);
END;
$$;

COMMENT ON FUNCTION public.get_checkin_match_opportunities(jsonb, text, int) IS
  'Weekly check-in "Games for you": public matches with open spots fitting the '
  'just-declared availability (p_slots = [{day,hour}]). Filters: favorite facility '
  'OR within max_travel_distance; min rating EQUALS the caller''s active rating for '
  'the match''s sport; weekday+hour in a declared slot; gender match. Multi-sport, '
  'windowed today…today+3 in player tz. Returns match ids + distance to hydrate.';

REVOKE ALL ON FUNCTION public.get_checkin_match_opportunities(jsonb, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_opportunities(jsonb, text, int) TO authenticated, service_role;

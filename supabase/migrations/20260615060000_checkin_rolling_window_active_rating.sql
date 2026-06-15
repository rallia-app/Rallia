-- =============================================================================
-- Fix (again): restore the rolling 4-day window in generate_weekly_matches_for_player
--
-- 20260609120000_checkin_restore_rolling_window restored the rolling window
-- (FOR d IN 0..3 over EXACT local dates today…today+3 — the same 4 days the
-- check-in wizard collects). Nine hours later 20260609210000_active_rating_for
-- _auto_matches rewrote this function to move min_rating_score_id onto the
-- player's ACTIVE rating (player_sport.active_rating_score_id), but it started
-- from the OLD pre-rolling-window body and silently reverted the date logic back
-- to "map each active player_availability day-of-week onto the current ISO week
-- (Monday-anchored), keep everything >= today" — i.e. it creates matches for
-- every active weekday from today THROUGH SUNDAY, including days well outside the
-- 4-day window the wizard actually collected (check in Monday with a stale active
-- Saturday row → a Saturday match, 5 days out).
--
-- This re-applies the rolling-window iteration while KEEPING the active-rating
-- resolution (min_rating_score_id from player_sport.active_rating_score_id, the
-- only rating read path). Nothing else (facility/hour tiering, conflict guard,
-- idempotency, dispatch, ACL) changes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_weekly_matches_for_player(p_player_id uuid)
RETURNS TABLE (
  match_id      uuid,
  sport_name    varchar,
  match_date    date,
  start_time    time without time zone,
  end_time      time without time zone,
  facility_name varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
-- `extensions` on the path so the PostGIS geography type + ST_Distance resolve.
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz                  text;
  v_today               date;
  v_now_hour            int;
  v_auto_create         boolean;
  v_player_loc          extensions.geography;
  v_sport               record;
  v_sel                 record;
  v_duration_min        int;
  v_duration_enum       match_duration_enum;
  v_location_type       text;
  v_court_status        text;
  v_target_date         date;
  v_target_dow          text;
  v_hour                int;
  v_start               time;
  v_end                 time;
  v_match_id            uuid;
  d                     int;
BEGIN
  -- Resolve timezone + home location (fall back to UTC).
  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC'), p.location
    INTO v_tz, v_player_loc
    FROM public.player p
   WHERE p.id = p_player_id;
  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  v_today    := (now() AT TIME ZONE v_tz)::date;
  v_now_hour := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;

  -- Gate: must have opted in to auto-create.
  SELECT pref.auto_create_matches INTO v_auto_create
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = p_player_id;
  IF v_auto_create IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  -- For EACH active sport, create one match per available day in the rolling
  -- window. A player with both tennis and pickleball gets a match of each sport
  -- on every available day (subject to the time-overlap guard).
  FOR v_sport IN
    SELECT ps.sport_id,
           s.name                       AS sport_name,
           ps.preferred_match_duration  AS duration,
           ps.preferred_match_type      AS match_type,
           -- Required level = the host's ACTIVE rating for the sport (the same
           -- score the invite gate and nearby notification compare against).
           -- No active rating → NULL → open to all levels.
           prs.rating_score_id          AS min_rating_score_id
      FROM public.player_sport ps
      JOIN public.sport s ON s.id = ps.sport_id
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE ps.player_id = p_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
  LOOP
    v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
    v_duration_min  := COALESCE(
      public.parse_match_duration_to_minutes(v_duration_enum::text), 60
    );

    -- Walk the rolling window: today … today+3 (exact dates), soonest first.
    -- This is the SAME 4 days the check-in wizard collects availability for, so
    -- no match is ever created beyond the declared window.
    FOR d IN 0..3 LOOP
      v_target_date := v_today + d;
      v_target_dow  := CASE EXTRACT(isodow FROM v_target_date)::int
                         WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                         WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                         WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                         WHEN 7 THEN 'sunday' END;

      -- Skip days the player has no active availability on (that weekday).
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM public.player_availability pa
         WHERE pa.player_id = p_player_id
           AND pa.is_active = TRUE
           AND pa.day::text = v_target_dow
      );

      -- Idempotency: a day that already has an auto match for this sport.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = p_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport.sport_id
           AND m2.match_date = v_target_date
      );

      -- Optimize (facility, hour) for this day among the player's favorite
      -- facilities for the sport and their future-valid hours. Priority:
      --   1. bookable facilities with courts available — most courts wins;
      --   2. first-come, first-served facilities;
      --   3. anything else. Ties break by nearest facility then earliest hour.
      SELECT cand.facility_id, cand.facility_name, cand.address, cand.hour_of_day
        INTO v_sel
        FROM (
          SELECT f.id AS facility_id, f.name AS facility_name, f.address,
                 pa.hour_of_day,
                 ( SELECT count(DISTINCT fas.external_court_id)
                     FROM public.facility_availability_snapshot fas
                    WHERE fas.facility_id = f.id
                      AND fas.is_available = TRUE
                      AND (fas.sport_id = v_sport.sport_id OR fas.sport_id IS NULL)
                      AND fas.slot_start =
                          ((v_target_date + make_time(pa.hour_of_day, 0, 0))::timestamp
                             AT TIME ZONE v_tz)
                 ) AS court_count,
                 CASE WHEN v_player_loc IS NOT NULL AND f.location IS NOT NULL
                      THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist,
                 f.is_first_come_first_serve AS is_fcfs
            FROM public.player_availability pa
            JOIN public.player_favorite_facility pff
              ON pff.player_id = p_player_id
             AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
            JOIN public.facility f
              ON f.id = pff.facility_id AND f.is_active = TRUE
           WHERE pa.player_id = p_player_id
             AND pa.is_active = TRUE
             AND pa.day::text = v_target_dow
             AND NOT (v_target_date = v_today AND pa.hour_of_day <= v_now_hour)
        ) cand
       ORDER BY
         CASE
           WHEN cand.court_count > 0 THEN 0
           WHEN cand.is_fcfs        THEN 1
           ELSE 2
         END ASC,
         cand.court_count DESC,
         cand.dist        ASC NULLS LAST,
         cand.hour_of_day ASC
       LIMIT 1;

      IF FOUND THEN
        v_location_type := 'facility';
        v_court_status  := 'to_reserve';
        v_hour          := v_sel.hour_of_day;
      ELSE
        -- No favorite facility for this sport → TBD location, earliest hour.
        SELECT pa.hour_of_day INTO v_hour
          FROM public.player_availability pa
         WHERE pa.player_id = p_player_id
           AND pa.is_active = TRUE
           AND pa.day::text = v_target_dow
           AND NOT (v_target_date = v_today AND pa.hour_of_day <= v_now_hour)
         ORDER BY pa.hour_of_day ASC
         LIMIT 1;
        CONTINUE WHEN NOT FOUND;  -- no future-valid hour this day
        v_location_type := 'tbd';
        v_court_status  := NULL;
      END IF;

      v_start := make_time(v_hour, 0, 0);
      v_end   := v_start + (v_duration_min || ' minutes')::interval;

      -- Don't stack an auto-match on top of a REAL commitment (a match the
      -- player manually hosts or has joined). The player's own auto-generated
      -- matches are NOT treated as conflicts, so every active sport can share
      -- the same time slot on a given day.
      CONTINUE WHEN EXISTS (
        SELECT 1
          FROM public.match m
          JOIN public.match_participant mp
            ON mp.match_id = m.id
           AND mp.player_id = p_player_id
           AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
         WHERE m.cancelled_at IS NULL
           AND m.match_date = v_target_date
           AND m.start_time < v_end
           AND m.end_time   > v_start
           AND NOT (m.is_auto_generated = TRUE AND m.created_by = p_player_id)
      );

      INSERT INTO public.match (
        sport_id, match_date, start_time, end_time, created_by,
        visibility, join_mode, format, player_expectation, duration,
        location_type, facility_id, location_name, location_address,
        court_status, min_rating_score_id, is_auto_generated, timezone
      ) VALUES (
        v_sport.sport_id, v_target_date, v_start, v_end, p_player_id,
        'public', 'request', 'singles', COALESCE(v_sport.match_type, 'both'), v_duration_enum,
        v_location_type::location_type_enum,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.address END,
        v_court_status::court_status_enum,
        v_sport.min_rating_score_id, TRUE, v_tz
      )
      RETURNING id INTO v_match_id;

      INSERT INTO public.match_participant (
        match_id, player_id, team_number, is_host, status, joined_at
      ) VALUES (
        v_match_id, p_player_id, 1, TRUE, 'joined', now()
      )
      ON CONFLICT ON CONSTRAINT match_participant_match_id_player_id_key DO NOTHING;

      match_id      := v_match_id;
      sport_name    := v_sport.sport_name;
      generate_weekly_matches_for_player.match_date  := v_target_date;
      generate_weekly_matches_for_player.start_time  := v_start;
      generate_weekly_matches_for_player.end_time    := v_end;
      facility_name := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_matches_for_player(uuid) IS
  'Creates one open (request-to-join) match per available day per active sport '
  'over the rolling window today…today+3 (EXACT local dates — the same 4 days the '
  'check-in wizard collects), hosted by the player. Required level = the host''s '
  'ACTIVE rating score (player_sport.active_rating_score_id), NULL when absent. '
  'Per day it picks the favorite facility/hour by tier (bookable-with-courts > '
  'FCFS > rest, nearest then earliest), or TBD when no favorites. Gated on '
  'auto_create_matches. Idempotent per (sport, exact date).';

-- CREATE OR REPLACE preserves the prior REVOKE/GRANT ACL, but re-assert it so the
-- server-side-only contract is explicit alongside the new definition.
REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_player(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_player(uuid) TO service_role;

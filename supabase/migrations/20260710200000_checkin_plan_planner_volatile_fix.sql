-- Fix plan_weekly_matches_for_player: STABLE functions cannot use temp tables.
-- Error surfaced as: "DROP TABLE is not allowed in a non-volatile function"

CREATE OR REPLACE FUNCTION public.plan_weekly_matches_for_player(
  p_player_id     uuid,
  p_slots         jsonb,
  p_goal_override int DEFAULT NULL
)
RETURNS TABLE (
  sport_id            uuid,
  sport_name          varchar,
  match_date          date,
  start_time          time without time zone,
  end_time            time without time zone,
  duration            match_duration_enum,
  match_type          match_type_enum,
  location_type       text,
  facility_id         uuid,
  facility_name       varchar,
  facility_address    text,
  court_status        text,
  min_rating_score_id uuid,
  min_rating_label    text,
  compatible_count    int
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz            text;
  v_today         date;
  v_now_hour      int;
  v_week_start    date;
  v_player_loc    extensions.geography;
  v_goal          int;
  v_committed     int;
  v_to_create     int;
  v_sport         record;
  v_fac           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_target_dow    text;
  v_slot          record;
  v_start         time;
  v_end           time;
  v_compatible    int;
  v_court_count   int;
  v_has_facility  boolean;
  d               int;
BEGIN
  DROP TABLE IF EXISTS tmp_plan_candidates;
  CREATE TEMP TABLE tmp_plan_candidates (
    sport_id            uuid,
    sport_name          varchar,
    match_date          date,
    start_time          time without time zone,
    end_time            time without time zone,
    duration            match_duration_enum,
    match_type          match_type_enum,
    location_type       text,
    facility_id         uuid,
    facility_name       varchar,
    facility_address    text,
    court_status        text,
    min_rating_score_id uuid,
    min_rating_label    text,
    compatible_count    int  NOT NULL,
    court_count         int  NOT NULL DEFAULT 0,
    dist_m              float
  ) ON COMMIT DROP;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC'), p.location
    INTO v_tz, v_player_loc
    FROM public.player p
   WHERE p.id = p_player_id;
  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  v_today      := (now() AT TIME ZONE v_tz)::date;
  v_now_hour   := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;
  v_week_start := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  v_goal := p_goal_override;
  IF v_goal IS NULL THEN
    SELECT wc.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin wc
     WHERE wc.player_id = p_player_id
       AND wc.week_start_date = v_week_start;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = p_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  v_committed := public.count_checkin_window_committed_matches(p_player_id, v_today);
  v_to_create := GREATEST(0, v_goal - COALESCE(v_committed, 0));

  IF v_to_create <= 0 THEN
    RETURN;
  END IF;

  <<day_loop>>
  FOR d IN 0..3 LOOP
    v_target_date := v_today + d;
    v_target_dow  := CASE EXTRACT(isodow FROM v_target_date)::int
                       WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                       WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                       WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                       WHEN 7 THEN 'sunday' END;

    FOR v_sport IN
      SELECT ps.sport_id                  AS sport_id,
             s.name                       AS sport_name,
             ps.preferred_match_duration  AS duration,
             ps.preferred_match_type      AS match_type,
             prs.rating_score_id          AS min_rating_score_id,
             rs.label::text               AS min_rating_label
        FROM public.player_sport ps
        JOIN public.sport s ON s.id = ps.sport_id
        LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
        LEFT JOIN public.rating_score rs ON rs.id = prs.rating_score_id
       WHERE ps.player_id = p_player_id
         AND ps.is_active = TRUE
       ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
    LOOP
      <<hour_loop>>
      FOR v_slot IN
        SELECT DISTINCT sl.hour AS hour_of_day
          FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
         WHERE sl.day = v_target_dow
           AND NOT (v_target_date = v_today AND sl.hour <= v_now_hour)
         ORDER BY sl.hour
      LOOP
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public.match m2
           WHERE m2.created_by = p_player_id
             AND m2.is_auto_generated = TRUE
             AND m2.cancelled_at IS NULL
             AND m2.sport_id = v_sport.sport_id
             AND m2.match_date = v_target_date
             AND EXTRACT(hour FROM m2.start_time)::int = v_slot.hour_of_day
        );

        v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
        v_duration_min  := COALESCE(
          public.parse_match_duration_to_minutes(v_duration_enum::text), 60
        );
        v_start := make_time(v_slot.hour_of_day, 0, 0);
        v_end   := v_start + (v_duration_min || ' minutes')::interval;

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

        v_has_facility := FALSE;

        FOR v_fac IN
          SELECT f.id AS facility_id,
                 f.name AS facility_name,
                 f.address,
                 f.is_first_come_first_serve AS is_fcfs,
                 ( SELECT count(DISTINCT fas.external_court_id)
                     FROM public.facility_availability_snapshot fas
                    WHERE fas.facility_id = f.id
                      AND fas.is_available = TRUE
                      AND (fas.sport_id = v_sport.sport_id OR fas.sport_id IS NULL)
                      AND fas.slot_start =
                          ((v_target_date + make_time(v_slot.hour_of_day, 0, 0))::timestamp
                             AT TIME ZONE v_tz)
                 ) AS court_count,
                 CASE WHEN v_player_loc IS NOT NULL AND f.location IS NOT NULL
                      THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist_m
            FROM public.player_favorite_facility pff
            JOIN public.facility f
              ON f.id = pff.facility_id AND f.is_active = TRUE
           WHERE pff.player_id = p_player_id
             AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
        LOOP
          v_has_facility := TRUE;
          v_court_count  := COALESCE(v_fac.court_count, 0);
          v_compatible   := public.count_auto_invite_candidates_for_slot(
                              p_player_id, v_sport.sport_id, v_fac.facility_id,
                              v_target_date, v_start, v_end, NULL,
                              COALESCE(v_sport.match_type, 'both'::match_type_enum)
                            );

          INSERT INTO tmp_plan_candidates (
            sport_id, sport_name, match_date, start_time, end_time, duration, match_type,
            location_type, facility_id, facility_name, facility_address, court_status,
            min_rating_score_id, min_rating_label, compatible_count, court_count, dist_m
          ) VALUES (
            v_sport.sport_id, v_sport.sport_name, v_target_date, v_start, v_end,
            v_duration_enum, COALESCE(v_sport.match_type, 'both'::match_type_enum),
            'facility', v_fac.facility_id, v_fac.facility_name, v_fac.address,
            'to_reserve',
            v_sport.min_rating_score_id, v_sport.min_rating_label,
            v_compatible, v_court_count, v_fac.dist_m
          );
        END LOOP;

        IF NOT v_has_facility THEN
          INSERT INTO tmp_plan_candidates (
            sport_id, sport_name, match_date, start_time, end_time, duration, match_type,
            location_type, facility_id, facility_name, facility_address, court_status,
            min_rating_score_id, min_rating_label, compatible_count, court_count, dist_m
          ) VALUES (
            v_sport.sport_id, v_sport.sport_name, v_target_date, v_start, v_end,
            v_duration_enum, COALESCE(v_sport.match_type, 'both'::match_type_enum),
            'tbd', NULL, NULL, NULL, NULL,
            v_sport.min_rating_score_id, v_sport.min_rating_label,
            0, 0, NULL
          );
        END IF;
      END LOOP hour_loop;
    END LOOP;
  END LOOP day_loop;

  RETURN QUERY
  WITH best_per_slot AS (
    SELECT DISTINCT ON (c.sport_id, c.match_date, c.start_time)
           c.*
      FROM tmp_plan_candidates c
     ORDER BY c.sport_id, c.match_date, c.start_time,
              c.compatible_count DESC,
              c.court_count DESC,
              c.dist_m ASC NULLS LAST
  )
  SELECT b.sport_id, b.sport_name, b.match_date, b.start_time, b.end_time,
         b.duration, b.match_type, b.location_type, b.facility_id, b.facility_name,
         b.facility_address, b.court_status, b.min_rating_score_id, b.min_rating_label,
         b.compatible_count
    FROM best_per_slot b
   ORDER BY b.compatible_count DESC,
            b.match_date ASC,
            b.start_time ASC,
            b.court_count DESC,
            b.dist_m ASC NULLS LAST
   LIMIT v_to_create;

  RETURN;
END;
$$;

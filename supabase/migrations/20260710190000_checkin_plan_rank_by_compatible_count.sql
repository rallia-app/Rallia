-- =============================================================================
-- Weekly check-in planner: rank proposals by compatible-player count
--
-- Each feasible (day, hour, sport, facility) setting is scored with
-- count_auto_invite_candidates_for_slot. Per time slot we keep the best
-- facility, then pick the top (goal - committed) slots globally.
-- Preview proposals expose compatible_count for the wizard UI.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.count_auto_invite_candidates_for_slot(
  p_host_id     uuid,
  p_sport_id    uuid,
  p_facility_id uuid,
  p_match_date  date,
  p_start_time  time without time zone,
  p_end_time    time without time zone,
  p_gender      gender_enum     DEFAULT NULL,
  p_expectation match_type_enum DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_host_score_id uuid;
  v_weekday       day_enum;
  v_hour          int;
  v_count         int;
BEGIN
  IF p_facility_id IS NULL THEN
    RETURN 0;
  END IF;

  v_weekday := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
                 [extract(dow from p_match_date)::int + 1]::day_enum;
  v_hour    := extract(hour from p_start_time)::int;

  SELECT prs.rating_score_id INTO v_host_score_id
    FROM public.player_sport hps
    JOIN public.player_rating_score prs ON prs.id = hps.active_rating_score_id
   WHERE hps.player_id = p_host_id
     AND hps.sport_id  = p_sport_id;

  SELECT count(*)::int INTO v_count
    FROM public.player p
    JOIN public.player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = p_sport_id AND ps.is_active
    JOIN public.player_availability pa
      ON pa.player_id = p.id AND pa.is_active
     AND pa.day = v_weekday AND pa.hour_of_day = v_hour
    LEFT JOIN public.player_rating_score cprs ON cprs.id = ps.active_rating_score_id
   WHERE p.id <> p_host_id
     AND (v_host_score_id IS NULL OR cprs.rating_score_id = v_host_score_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.player_block b
        WHERE (b.player_id = p_host_id AND b.blocked_player_id = p.id)
           OR (b.player_id = p.id AND b.blocked_player_id = p_host_id)
     )
     AND (p_gender IS NULL OR p.gender = p_gender)
     AND p.location IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.player_favorite_facility pff
         JOIN public.facility f ON f.id = pff.facility_id
        WHERE pff.player_id  = p.id
          AND pff.facility_id = p_facility_id
          AND (pff.sport_id = p_sport_id OR pff.sport_id IS NULL)
          AND f.location IS NOT NULL
          AND extensions.ST_DWithin(
                f.location, p.location,
                LEAST(10, COALESCE(p.max_travel_distance, 10)) * 1000
              )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.match m2
         JOIN public.match_participant mp2
           ON mp2.match_id = m2.id AND mp2.player_id = p.id
          AND mp2.status = 'joined'
        WHERE m2.cancelled_at IS NULL
          AND m2.match_date = p_match_date
          AND m2.start_time < p_end_time
          AND m2.end_time   > p_start_time
          AND NOT (
            m2.is_auto_generated = TRUE
            AND m2.created_by = p.id
            AND NOT EXISTS (
              SELECT 1 FROM public.match_participant mp4
               WHERE mp4.match_id = m2.id AND mp4.status = 'joined' AND mp4.player_id <> p.id
            )
          )
     );

  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.count_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum) IS
  'Count-only variant of get_auto_invite_candidates_for_slot — same hard filters, '
  'no ranking or display fields. Used to rank check-in plan proposals.';

REVOKE ALL ON FUNCTION public.count_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum) TO service_role;


DROP FUNCTION IF EXISTS public.plan_weekly_matches_for_player(uuid, jsonb, int);

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
            CASE WHEN v_court_count > 0 THEN 'to_reserve' ELSE 'to_reserve' END,
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

COMMENT ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) IS
  'PURE planner (zero writes). Scores every declared slot × favorite facility '
  'by compatible-player count, keeps the best court per slot, returns the top '
  '(weekly goal − committed) settings.';

REVOKE ALL ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) TO service_role;


CREATE OR REPLACE FUNCTION public.get_checkin_match_plan(
  p_slots          jsonb,
  p_frequency_goal smallint DEFAULT NULL,
  p_timezone       text     DEFAULT NULL,
  p_max_invitees   int      DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_player_id uuid := auth.uid();
  v_tz        text;
  v_today     date;
  v_week      date;
  v_goal      int;
  v_committed int;
  v_opted_out boolean;
  v_auto_invite boolean;
  v_plan      record;
  v_invitees  jsonb;
  v_courts    int;
  v_proposals jsonb := '[]'::jsonb;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz    := COALESCE(v_tz, 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_week  := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  v_goal := p_frequency_goal;
  IF v_goal IS NULL THEN
    SELECT wc.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin wc
     WHERE wc.player_id = v_player_id AND wc.week_start_date = v_week;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = v_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  v_committed := public.count_checkin_window_committed_matches(v_player_id, v_today);

  SELECT
    NOT COALESCE(pref.auto_create_matches, TRUE),
    COALESCE(pref.auto_invite_players, TRUE)
    INTO v_opted_out, v_auto_invite
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;
  v_opted_out   := COALESCE(v_opted_out, FALSE);
  v_auto_invite := COALESCE(v_auto_invite, TRUE);

  FOR v_plan IN
    SELECT * FROM public.plan_weekly_matches_for_player(v_player_id, p_slots, v_goal)
  LOOP
    IF v_auto_invite AND v_plan.facility_id IS NOT NULL THEN
      SELECT COALESCE(
               jsonb_agg(jsonb_build_object(
                 'player_id',        c.player_id,
                 'first_name',       c.first_name,
                 'last_name',        c.last_name,
                 'avatar_url',       c.avatar_url,
                 'rating_label',     c.rating_label,
                 'reputation_score', c.reputation_score,
                 'reputation_tier',  c.reputation_tier
               )),
               '[]'::jsonb
             )
        INTO v_invitees
        FROM public.get_auto_invite_candidates_for_slot(
               v_player_id, v_plan.sport_id, v_plan.facility_id, v_plan.match_date,
               v_plan.start_time, v_plan.end_time, NULL, v_plan.match_type,
               p_max_invitees) c;
    ELSE
      v_invitees := '[]'::jsonb;
    END IF;

    IF v_plan.facility_id IS NOT NULL THEN
      SELECT count(DISTINCT fas.external_court_id) INTO v_courts
        FROM public.facility_availability_snapshot fas
       WHERE fas.facility_id = v_plan.facility_id
         AND fas.is_available = TRUE
         AND (fas.sport_id = v_plan.sport_id OR fas.sport_id IS NULL)
         AND fas.slot_start =
             ((v_plan.match_date + v_plan.start_time)::timestamp AT TIME ZONE v_tz);
    ELSE
      v_courts := 0;
    END IF;

    v_proposals := v_proposals || jsonb_build_object(
      'key',               v_plan.sport_id::text || ':' || v_plan.match_date::text || ':' || EXTRACT(hour FROM v_plan.start_time)::int,
      'sport_id',          v_plan.sport_id,
      'sport_name',        v_plan.sport_name,
      'match_date',        v_plan.match_date,
      'start_time',        v_plan.start_time,
      'end_time',          v_plan.end_time,
      'start_hour',        EXTRACT(hour FROM v_plan.start_time)::int,
      'duration',          v_plan.duration,
      'match_type',        v_plan.match_type,
      'location_type',     v_plan.location_type,
      'facility_id',       v_plan.facility_id,
      'facility_name',     v_plan.facility_name,
      'facility_address',  v_plan.facility_address,
      'min_rating_label',  v_plan.min_rating_label,
      'available_courts',  COALESCE(v_courts, 0),
      'compatible_count',  COALESCE(v_plan.compatible_count, 0),
      'invitees',          v_invitees
    );
  END LOOP;

  RETURN jsonb_build_object(
    'goal',                v_goal,
    'committed_count',     COALESCE(v_committed, 0),
    'opted_out',           v_opted_out,
    'auto_invite_enabled', v_auto_invite,
    'proposals',           v_proposals
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) IS
  'Check-in wizard plan PREVIEW: proposals ranked by compatible-player count, '
  'capped at weekly goal minus committed upcoming games.';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) TO authenticated, service_role;

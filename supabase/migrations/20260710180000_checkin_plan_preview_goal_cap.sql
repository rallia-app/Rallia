-- =============================================================================
-- Weekly check-in plan preview: restore goal-gap capping
--
-- Preview proposals are capped at (weekly_goal - committed upcoming games) again,
-- matching the autonomous generator. Keeps multi-hour scanning and per-hour
-- proposal keys from the prior preview work.
-- =============================================================================

DROP FUNCTION IF EXISTS public.plan_weekly_matches_for_player(uuid, jsonb, int, int);

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
  min_rating_label    text
)
LANGUAGE plpgsql
STABLE
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
  v_planned       int := 0;
  v_sport         record;
  v_sel           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_target_dow    text;
  v_slot          record;
  v_start         time;
  v_end           time;
  d               int;
BEGIN
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
      EXIT day_loop WHEN v_planned >= v_to_create;

      <<hour_loop>>
      FOR v_slot IN
        SELECT DISTINCT sl.hour AS hour_of_day
          FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
         WHERE sl.day = v_target_dow
           AND NOT (v_target_date = v_today AND sl.hour <= v_now_hour)
         ORDER BY sl.hour
      LOOP
        EXIT day_loop WHEN v_planned >= v_to_create;

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

        SELECT cand.facility_id, cand.facility_name, cand.address, cand.hour_of_day
          INTO v_sel
          FROM (
            SELECT f.id AS facility_id, f.name AS facility_name, f.address,
                   v_slot.hour_of_day AS hour_of_day,
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
                        THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist,
                   f.is_first_come_first_serve AS is_fcfs
              FROM public.player_favorite_facility pff
              JOIN public.facility f
                ON f.id = pff.facility_id AND f.is_active = TRUE
             WHERE pff.player_id = p_player_id
               AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
          ) cand
         ORDER BY
           CASE
             WHEN cand.court_count > 0 THEN 0
             WHEN cand.is_fcfs        THEN 1
             ELSE 2
           END ASC,
           cand.court_count DESC,
           cand.dist        ASC NULLS LAST
         LIMIT 1;

        IF FOUND THEN
          v_location_type := 'facility';
          v_court_status  := 'to_reserve';
        ELSE
          v_location_type := 'tbd';
          v_court_status  := NULL;
        END IF;

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

        v_planned := v_planned + 1;

        plan_weekly_matches_for_player.sport_id            := v_sport.sport_id;
        plan_weekly_matches_for_player.sport_name          := v_sport.sport_name;
        plan_weekly_matches_for_player.match_date          := v_target_date;
        plan_weekly_matches_for_player.start_time          := v_start;
        plan_weekly_matches_for_player.end_time            := v_end;
        plan_weekly_matches_for_player.duration            := v_duration_enum;
        plan_weekly_matches_for_player.match_type          := COALESCE(v_sport.match_type, 'both');
        plan_weekly_matches_for_player.location_type       := v_location_type;
        plan_weekly_matches_for_player.facility_id         := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END;
        plan_weekly_matches_for_player.facility_name       := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END;
        plan_weekly_matches_for_player.facility_address    := CASE WHEN v_location_type = 'facility' THEN v_sel.address END;
        plan_weekly_matches_for_player.court_status        := v_court_status;
        plan_weekly_matches_for_player.min_rating_score_id := v_sport.min_rating_score_id;
        plan_weekly_matches_for_player.min_rating_label    := v_sport.min_rating_label;
        RETURN NEXT;
      END LOOP hour_loop;
    END LOOP;

    EXIT day_loop WHEN v_planned >= v_to_create;
  END LOOP day_loop;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) IS
  'PURE planner (zero writes). Rolling window today…today+3, soonest-first across '
  'days/sports/hours, capped at weekly goal minus committed upcoming games.';

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
      'key',              v_plan.sport_id::text || ':' || v_plan.match_date::text || ':' || EXTRACT(hour FROM v_plan.start_time)::int,
      'sport_id',         v_plan.sport_id,
      'sport_name',       v_plan.sport_name,
      'match_date',       v_plan.match_date,
      'start_time',       v_plan.start_time,
      'end_time',         v_plan.end_time,
      'start_hour',       EXTRACT(hour FROM v_plan.start_time)::int,
      'duration',         v_plan.duration,
      'match_type',       v_plan.match_type,
      'location_type',    v_plan.location_type,
      'facility_id',      v_plan.facility_id,
      'facility_name',    v_plan.facility_name,
      'facility_address', v_plan.facility_address,
      'min_rating_label', v_plan.min_rating_label,
      'available_courts', COALESCE(v_courts, 0),
      'invitees',         v_invitees
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
  'Check-in wizard plan PREVIEW: proposals capped at weekly goal minus committed '
  'upcoming games (same as autonomous generation).';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) TO authenticated, service_role;

-- =============================================================================
-- Weekly check-in: transparent match plan (preview → confirm) — write side
--
-- record_weekly_checkin gains p_match_plan: the proposals the player CONFIRMED
-- on the wizard's plan step (a subset of what get_checkin_match_plan previewed,
-- minus per-proposal excluded invitees). Non-NULL plan → the matches are
-- created SYNCHRONOUSLY here (create_weekly_match, shared with the legacy
-- generator) and returned in a new created_matches column so the wizard's
-- recap can show the real games; only invites/pushes stay async — the dispatch
-- to generate-weekly-matches carries {player_id, matches:[…]} and the edge
-- function runs in invite-only mode, honoring each match's excluded ids.
--
-- NULL plan (old clients, or the wizard degrading after a preview failure) →
-- today's autonomous behavior byte-for-byte: dispatch {player_id}, the edge
-- function generates from saved availability and invites everyone eligible.
--
-- The plan is a SELECTION, not a spec: sport/date/hour/facility identify a
-- proposal; duration, match type, rating requirement and facility details are
-- re-derived server-side, and every proposal re-passes the planner's guards
-- (window, future slot, idempotency, conflict). Invalid proposals are SKIPPED
-- with a warning — one stale slot must never fail the whole check-in.
--
-- DROP + CREATE (not OR REPLACE): the return row gains a column, and keeping a
-- 4-arg overload alongside would make PostgREST named-arg resolution ambiguous.
-- Old clients still call with 4 named args — p_match_plan defaults to NULL —
-- and ignore the extra return column.
-- =============================================================================

DROP FUNCTION IF EXISTS public.record_weekly_checkin(smallint, boolean, boolean, text);

CREATE FUNCTION public.record_weekly_checkin(
  p_frequency_goal SMALLINT,
  p_auto_create BOOLEAN,
  p_auto_invite BOOLEAN,
  p_timezone TEXT DEFAULT NULL,
  p_match_plan JSONB DEFAULT NULL
)
RETURNS TABLE (
  new_streak        SMALLINT,
  freezes           SMALLINT,
  longest_streak    SMALLINT,
  milestone_reached BOOLEAN,
  freeze_earned     BOOLEAN,
  created_matches   JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id        UUID := auth.uid();
  v_tz               TEXT;
  v_today            DATE;
  v_now_hour         INT;
  v_covered_through  DATE;
  v_this_week        DATE;
  v_existing         INT;
  v_is_new           BOOLEAN;
  v_cur_streak       SMALLINT;
  v_cur_freezes      SMALLINT;
  v_cur_longest      SMALLINT;
  v_created          JSONB := '[]'::jsonb;
  v_dispatch         JSONB := '[]'::jsonb;
  v_dispatch_body    JSONB;
  v_prop             JSONB;
  v_sport_id         UUID;
  v_match_date       DATE;
  v_start_hour       INT;
  v_facility_id      UUID;
  v_excluded         JSONB;
  v_sport            RECORD;
  v_fac_name         VARCHAR;
  v_fac_address      TEXT;
  v_duration_enum    match_duration_enum;
  v_duration_min     INT;
  v_start            TIME;
  v_end              TIME;
  v_location_type    TEXT;
  v_match_id         UUID;
  v_min_rating       UUID;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;
  IF p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'frequency_goal must be 1..5';
  END IF;
  -- Malformed plan = a client bug, not a stale slot: fail loudly.
  IF p_match_plan IS NOT NULL AND (
       jsonb_typeof(p_match_plan) <> 'object'
       OR (p_match_plan->>'version')::int IS DISTINCT FROM 1
       OR jsonb_typeof(p_match_plan->'proposals') <> 'array'
     ) THEN
    RAISE EXCEPTION 'p_match_plan must be {"version":1,"proposals":[...]}';
  END IF;

  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  v_today           := (now() AT TIME ZONE v_tz)::date;
  v_now_hour        := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;
  v_covered_through := v_today + 3;
  v_this_week       := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  -- Ensure a streak row exists so the weekly evaluator has something to evaluate.
  -- We DO NOT touch streak values here — the evaluator owns them.
  INSERT INTO public.player_streak (player_id, current_streak, longest_streak, freeze_inventory, freeze_cap)
  VALUES (v_player_id, 0, 0, 0, 2)
  ON CONFLICT (player_id) DO NOTHING;

  SELECT 1 INTO v_existing
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.week_start_date = v_this_week;
  v_is_new := v_existing IS NULL;

  -- Frequency goal is asked ONCE per ISO week: only the first check-in writes it.
  IF v_is_new THEN
    INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_this_week, p_frequency_goal, NULL, FALSE);
  END IF;

  INSERT INTO public.player_check_in_preferences
    (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, availability_covered_through, updated_at)
  VALUES
    (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, v_covered_through, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches          = EXCLUDED.auto_create_matches,
        auto_invite_players          = EXCLUDED.auto_invite_players,
        availability_covered_through = EXCLUDED.availability_covered_through,
        last_frequency_goal          = CASE WHEN v_is_new
                                            THEN EXCLUDED.last_frequency_goal
                                            ELSE public.player_check_in_preferences.last_frequency_goal END,
        updated_at                   = now();

  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  -- ---------------------------------------------------------------------------
  -- Confirmed plan → create the selected matches NOW. Hard-capped at 5 (the max
  -- weekly goal); the player explicitly confirmed this list, so it is NOT
  -- re-netted against the committed count — the guards below catch anything
  -- that became invalid between preview and submit.
  -- ---------------------------------------------------------------------------
  IF p_match_plan IS NOT NULL THEN
    FOR v_prop IN
      SELECT el.value
        FROM jsonb_array_elements(p_match_plan->'proposals') WITH ORDINALITY AS el(value, ord)
       ORDER BY el.ord
       LIMIT 5
    LOOP
      BEGIN
        v_sport_id    := (v_prop->>'sport_id')::uuid;
        v_match_date  := (v_prop->>'match_date')::date;
        v_start_hour  := (v_prop->>'start_hour')::int;
        v_facility_id := NULLIF(v_prop->>'facility_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'record_weekly_checkin: unparseable proposal skipped: %', v_prop;
        CONTINUE;
      END;

      IF v_sport_id IS NULL OR v_match_date IS NULL OR v_start_hour IS NULL THEN
        RAISE WARNING 'record_weekly_checkin: incomplete proposal skipped: %', v_prop;
        CONTINUE;
      END IF;
      IF v_match_date < v_today OR v_match_date > v_today + 3 THEN
        RAISE WARNING 'record_weekly_checkin: proposal outside window skipped (%: %)', v_sport_id, v_match_date;
        CONTINUE;
      END IF;
      IF v_start_hour < 0 OR v_start_hour > 23
         OR (v_match_date = v_today AND v_start_hour <= v_now_hour) THEN
        RAISE WARNING 'record_weekly_checkin: past/invalid hour skipped (%: % %h)', v_sport_id, v_match_date, v_start_hour;
        CONTINUE;
      END IF;

      -- Re-derive everything else from live data (the plan is a selection).
      SELECT ps.preferred_match_duration AS duration,
             ps.preferred_match_type     AS match_type,
             s.name                      AS sport_name,
             prs.rating_score_id         AS min_rating_score_id
        INTO v_sport
        FROM public.player_sport ps
        JOIN public.sport s ON s.id = ps.sport_id
        LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
       WHERE ps.player_id = v_player_id
         AND ps.sport_id  = v_sport_id
         AND ps.is_active = TRUE;
      IF NOT FOUND THEN
        RAISE WARNING 'record_weekly_checkin: inactive sport skipped (%)', v_sport_id;
        CONTINUE;
      END IF;
      v_min_rating := v_sport.min_rating_score_id;

      v_fac_name    := NULL;
      v_fac_address := NULL;
      IF v_facility_id IS NOT NULL THEN
        SELECT f.name, f.address INTO v_fac_name, v_fac_address
          FROM public.facility f
         WHERE f.id = v_facility_id AND f.is_active = TRUE;
        IF NOT FOUND THEN
          RAISE WARNING 'record_weekly_checkin: unknown/inactive facility skipped (%)', v_facility_id;
          CONTINUE;
        END IF;
        v_location_type := 'facility';
      ELSE
        v_location_type := 'tbd';
      END IF;

      -- Idempotency: one auto match per (sport, exact date).
      IF EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = v_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport_id
           AND m2.match_date = v_match_date
      ) THEN
        RAISE WARNING 'record_weekly_checkin: duplicate auto match skipped (%: %)', v_sport_id, v_match_date;
        CONTINUE;
      END IF;

      v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
      v_duration_min  := COALESCE(public.parse_match_duration_to_minutes(v_duration_enum::text), 60);
      v_start         := make_time(v_start_hour, 0, 0);
      v_end           := v_start + (v_duration_min || ' minutes')::interval;

      -- Don't stack onto a REAL commitment (own auto matches exempt) — a game
      -- joined on the "Games for you" step seconds ago counts.
      IF EXISTS (
        SELECT 1
          FROM public.match m
          JOIN public.match_participant mp
            ON mp.match_id = m.id
           AND mp.player_id = v_player_id
           AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
         WHERE m.cancelled_at IS NULL
           AND m.match_date = v_match_date
           AND m.start_time < v_end
           AND m.end_time   > v_start
           AND NOT (m.is_auto_generated = TRUE AND m.created_by = v_player_id)
      ) THEN
        RAISE WARNING 'record_weekly_checkin: conflicting commitment, proposal skipped (%: % %h)', v_sport_id, v_match_date, v_start_hour;
        CONTINUE;
      END IF;

      v_match_id := public.create_weekly_match(
        v_player_id, v_sport_id, v_match_date, v_start, v_end,
        v_duration_enum, v_sport.match_type, v_location_type,
        v_facility_id, v_fac_name, v_fac_address,
        CASE WHEN v_location_type = 'facility' THEN 'to_reserve' END,
        v_min_rating, v_tz
      );

      -- Excluded invitees: uuid-shaped strings only, capped at 100.
      SELECT COALESCE(jsonb_agg(DISTINCT ex.val), '[]'::jsonb)
        INTO v_excluded
        FROM (
          SELECT el.value #>> '{}' AS val
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(v_prop->'invite_excluded_player_ids') = 'array'
                        THEN v_prop->'invite_excluded_player_ids'
                        ELSE '[]'::jsonb END
                 ) el
           LIMIT 100
        ) ex
       WHERE ex.val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

      v_created := v_created || jsonb_build_object(
        'match_id',      v_match_id,
        'sport_id',      v_sport_id,
        'sport_name',    v_sport.sport_name,
        'match_date',    v_match_date,
        'start_time',    v_start,
        'end_time',      v_end,
        'facility_name', CASE WHEN v_location_type = 'facility' THEN v_fac_name END,
        'location_type', v_location_type
      );
      v_dispatch := v_dispatch || jsonb_build_object(
        'match_id',            v_match_id,
        'sport_name',          v_sport.sport_name,
        'match_date',          v_match_date,
        'start_time',          v_start,
        'end_time',            v_end,
        'facility_name',       CASE WHEN v_location_type = 'facility' THEN v_fac_name END,
        'excluded_player_ids', v_excluded
      );
    END LOOP;
  END IF;

  -- Dispatch (fire-and-forget). Plan path → invite-only body with the matches
  -- just created (skipped entirely when nothing was created — nothing to
  -- invite). Legacy path → {player_id}, the edge function generates + invites.
  IF p_match_plan IS NULL THEN
    v_dispatch_body := jsonb_build_object('player_id', v_player_id::text);
  ELSIF jsonb_array_length(v_dispatch) > 0 THEN
    v_dispatch_body := jsonb_build_object('player_id', v_player_id::text, 'matches', v_dispatch);
  ELSE
    v_dispatch_body := NULL;
  END IF;

  IF v_dispatch_body IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'supabase_functions_url' LIMIT 1
        ) || '/functions/v1/generate-weekly-matches',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'service_role_key' LIMIT 1
          )
        ),
        body := v_dispatch_body,
        timeout_milliseconds := 30000
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'record_weekly_checkin: match-generation dispatch failed: %', SQLERRM;
    END;
  END IF;

  -- Return the CURRENT streak unchanged — the check-in doesn't move it
  -- (evaluate_weekly_goals owns streak math).
  SELECT s.current_streak, s.freeze_inventory, s.longest_streak
    INTO v_cur_streak, v_cur_freezes, v_cur_longest
  FROM public.player_streak s
  WHERE s.player_id = v_player_id;

  new_streak        := COALESCE(v_cur_streak, 0);
  freezes           := COALESCE(v_cur_freezes, 0);
  longest_streak    := COALESCE(v_cur_longest, 0);
  milestone_reached := FALSE;
  freeze_earned     := FALSE;
  created_matches   := v_created;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB) IS
  'Rolling-window check-in. Syncs tz, sets availability_covered_through = today+3, '
  'asks frequency_goal once per ISO week. With p_match_plan (the wizard''s '
  'CONFIRMED selection from get_checkin_match_plan): creates those matches '
  'synchronously (guards: window, future slot, active sport, idempotency, '
  'conflict — stale proposals skipped with a warning), returns them in '
  'created_matches, and dispatches invite-only {player_id, matches} honoring '
  'per-match invite_excluded_player_ids. NULL plan (old clients): legacy '
  'autonomous dispatch {player_id}. Streak untouched (evaluate_weekly_goals owns it).';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB) TO authenticated;

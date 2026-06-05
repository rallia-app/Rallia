-- =============================================================================
-- Check-in wizard → rolling 4-day availability window
--
-- Repurposes the weekly check-in from a generic 7-day availability + once-per-
-- ISO-week trigger into a rolling window of "today + the next 3 days":
--
--   1. Coverage tracking. player_check_in_preferences.availability_covered_through
--      stores the last local date the player has declared availability for
--      (= local today + 3 at check-in time). The wizard auto-opens again only
--      once the player is PAST that date (check in on the 20th → covers 20–23 →
--      next auto-open on the 24th).
--
--   2. get_check_in_context now takes the device IANA timezone, lazily syncs
--      player.timezone, and returns the resolved window (4 {date, day_of_week}
--      pairs), the covered-through date, the resolved timezone, a
--      frequency_already_set_this_week flag, and a coverage-based
--      is_pending_check_in. The client renders the server-computed window and
--      never does local date math (avoids JS/DST/off-by-one bugs).
--
--   3. "How many sessions this week" is asked once per ISO week:
--      record_weekly_checkin no longer overwrites frequency_goal (nor
--      last_frequency_goal) on a 2nd same-week check-in.
--
--   4. Match auto-creation is dispatched from INSIDE record_weekly_checkin on
--      EVERY call (the old AFTER INSERT trigger never fired on the 2nd same-week
--      check-in because the row already existed). generate_weekly_matches_for_player
--      now iterates the 4 concrete window dates (today … today+3) instead of
--      mapping day-of-week onto the current ISO week.
--
-- Timezone policy: all date math is server-side in the player's IANA tz,
-- resolved as COALESCE(NULLIF(player.timezone,''),'UTC') after a lazy sync from
-- the client-supplied p_timezone. Window dates use DATE arithmetic (d, d+1,
-- d+2, d+3) so DST 23/25-hour days never shift the window.
--
-- Streak semantics are intentionally UNCHANGED here (still check-in driven).
-- The objective-based streak rework is a separate follow-up.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Coverage column. Existing table → existing Data API grants apply.
-- -----------------------------------------------------------------------------
ALTER TABLE public.player_check_in_preferences
  ADD COLUMN IF NOT EXISTS availability_covered_through DATE;

COMMENT ON COLUMN public.player_check_in_preferences.availability_covered_through IS
  'Last local calendar date the player has declared availability for (= local '
  'today + 3 at check-in). The wizard auto-opens again once the player''s local '
  'today > this date. NULL = never checked in → pending.';


-- -----------------------------------------------------------------------------
-- 2. get_check_in_context(p_timezone) — coverage-based pending + server window
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_check_in_context();

CREATE OR REPLACE FUNCTION public.get_check_in_context(p_timezone TEXT DEFAULT NULL)
RETURNS TABLE (
  current_streak                  SMALLINT,
  longest_streak                  SMALLINT,
  freeze_inventory                SMALLINT,
  freeze_cap                      SMALLINT,
  last_week_frequency_goal        SMALLINT,
  last_week_sessions_played       SMALLINT,
  goals_hit_last_4_weeks          BOOLEAN[],
  last_frequency_goal             SMALLINT,
  is_pending_check_in             BOOLEAN,
  timezone                        TEXT,
  availability_covered_through    DATE,
  frequency_already_set_this_week BOOLEAN,
  checkin_window                  JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id   UUID := auth.uid();
  v_tz          TEXT;
  v_today       DATE;
  v_this_week   DATE;
  v_last_week   DATE;
  v_covered     DATE;
  v_pending     BOOLEAN;
  v_freq_set    BOOLEAN;
  v_window      JSONB;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- Lazily sync the device timezone FIRST so all date math below (and the next
  -- record_weekly_checkin) agree on the player's local frame, even after travel.
  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);  -- qualify: OUT col `timezone` shadows the column
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  v_today     := (now() AT TIME ZONE v_tz)::date;
  v_this_week := date_trunc('week', (now() AT TIME ZONE v_tz))::date;  -- local Monday
  v_last_week := v_this_week - INTERVAL '7 days';

  SELECT pref.availability_covered_through INTO v_covered
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;

  -- Pending = past the last covered date (or never declared).
  v_pending := (v_covered IS NULL) OR (v_today > v_covered);

  -- Frequency is "set this week" iff a real (non-rescue) check-in row exists for
  -- the local week. Freeze-rescue rows have frequency_goal NULL and don't count.
  v_freq_set := EXISTS (
    SELECT 1 FROM public.player_weekly_checkin c
     WHERE c.player_id = v_player_id
       AND c.week_start_date = v_this_week
       AND c.frequency_goal IS NOT NULL
  );

  -- Resolved window: today … today+3, each as {date, day_of_week} (day enum
  -- name via isodow, locale-independent — to_char would risk localized names).
  SELECT jsonb_agg(
           jsonb_build_object(
             'date', (v_today + gs.i)::text,
             'day_of_week', (CASE EXTRACT(isodow FROM (v_today + gs.i))::int
                               WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                               WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                               WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                               WHEN 7 THEN 'sunday' END)
           ) ORDER BY gs.i
         )
    INTO v_window
  FROM generate_series(0, 3) AS gs(i);

  RETURN QUERY
  WITH streak AS (
    SELECT s.current_streak    AS cs_current_streak,
           s.longest_streak    AS cs_longest_streak,
           s.freeze_inventory  AS cs_freeze_inventory,
           s.freeze_cap        AS cs_freeze_cap
    FROM public.player_streak s
    WHERE s.player_id = v_player_id
  ),
  last_week_row AS (
    SELECT c.frequency_goal   AS lw_frequency_goal,
           c.sessions_played  AS lw_sessions_played
    FROM public.player_weekly_checkin c
    WHERE c.player_id = v_player_id
      AND c.week_start_date = v_last_week
  ),
  history AS (
    SELECT
      array_agg(
        CASE
          WHEN h.sessions_played IS NULL THEN FALSE
          WHEN h.frequency_goal IS NULL THEN FALSE
          ELSE h.sessions_played >= h.frequency_goal
        END
        ORDER BY h.week_start_date DESC
      ) AS hits
    FROM (
      SELECT c.frequency_goal, c.sessions_played, c.week_start_date
      FROM public.player_weekly_checkin c
      WHERE c.player_id = v_player_id
        AND c.frequency_goal IS NOT NULL
        AND c.week_start_date < v_this_week
      ORDER BY c.week_start_date DESC
      LIMIT 4
    ) h
  ),
  prefs AS (
    SELECT p.last_frequency_goal AS pr_last_frequency_goal
    FROM public.player_check_in_preferences p
    WHERE p.player_id = v_player_id
  )
  SELECT
    COALESCE((SELECT cs_current_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_longest_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_inventory  FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_cap        FROM streak), 2::SMALLINT),
    (SELECT lw_frequency_goal             FROM last_week_row),
    (SELECT lw_sessions_played            FROM last_week_row),
    COALESCE((SELECT hits                 FROM history), ARRAY[]::BOOLEAN[]),
    (SELECT pr_last_frequency_goal        FROM prefs),
    v_pending,
    v_tz,
    v_covered,
    v_freq_set,
    v_window;
END;
$$;

COMMENT ON FUNCTION public.get_check_in_context(TEXT) IS
  'Wizard cold-start. Lazily syncs player.timezone from the client IANA tz, then '
  'returns streak/recap/history plus the rolling 4-day window (today…today+3), the '
  'covered-through date, resolved timezone, frequency_already_set_this_week, and a '
  'coverage-based is_pending_check_in. All date math is local to player.timezone.';

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. record_weekly_checkin — coverage write, frequency once/week, inline dispatch
--    Streak math is preserved verbatim from the inline-freeze version.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_weekly_checkin(
  p_frequency_goal SMALLINT,
  p_auto_create BOOLEAN,
  p_auto_invite BOOLEAN,
  p_timezone TEXT DEFAULT NULL
)
RETURNS TABLE (
  new_streak        SMALLINT,
  freezes           SMALLINT,
  longest_streak    SMALLINT,
  milestone_reached BOOLEAN,
  freeze_earned     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id           UUID := auth.uid();
  v_tz                  TEXT;
  v_today               DATE;
  v_covered_through     DATE;
  v_this_week           DATE;
  v_prev_week           DATE;
  v_prev_streak         SMALLINT;
  v_prev_freezes        SMALLINT;
  v_freeze_cap          SMALLINT;
  v_prev_last_week      DATE;
  v_gap_weeks           INT;
  v_freezes_to_consume  INT := 0;
  v_new_streak          SMALLINT;
  v_new_freezes         SMALLINT;
  v_new_longest         SMALLINT;
  v_milestone           BOOLEAN := FALSE;
  v_freeze_earned       BOOLEAN := FALSE;
  v_existing_this_week  INT;
  v_is_new              BOOLEAN;
  i                     INT;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;
  IF p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'frequency_goal must be 1..5';
  END IF;

  -- Sync timezone FIRST so coverage + week math use the freshest local frame.
  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);  -- qualify: OUT col `timezone` shadows the column
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  v_today           := (now() AT TIME ZONE v_tz)::date;
  v_covered_through := v_today + 3;                                  -- today + next 3 days
  v_this_week       := date_trunc('week', (now() AT TIME ZONE v_tz))::date;
  v_prev_week       := v_this_week - INTERVAL '7 days';

  -- Idempotency marker: does a row already exist for this local week?
  SELECT 1 INTO v_existing_this_week
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.week_start_date = v_this_week;
  v_is_new := v_existing_this_week IS NULL;

  -- Lock + read current streak state.
  SELECT s.current_streak, s.freeze_inventory, s.freeze_cap, s.last_checkin_week_start
    INTO v_prev_streak, v_prev_freezes, v_freeze_cap, v_prev_last_week
  FROM public.player_streak s
  WHERE s.player_id = v_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.player_streak (player_id, current_streak, longest_streak, freeze_inventory, freeze_cap, last_checkin_week_start)
    VALUES (v_player_id, 0, 0, 0, 2, NULL);
    v_prev_streak := 0;
    v_prev_freezes := 0;
    v_freeze_cap := 2;
    v_prev_last_week := NULL;
  END IF;

  IF NOT v_is_new THEN
    -- Already checked in this week. The weekly objective is asked ONCE per week,
    -- so we deliberately DON'T touch frequency_goal here — a 2nd same-week pass
    -- only refreshes availability + coverage + toggles. Skip streak math too.
    SELECT s.current_streak, s.freeze_inventory, s.longest_streak
      INTO v_new_streak, v_new_freezes, v_new_longest
    FROM public.player_streak s
    WHERE s.player_id = v_player_id;
  ELSE
    -- New check-in for this week. Insert the row first.
    INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_this_week, p_frequency_goal, NULL, FALSE);

    -- ── Streak math (unchanged — Option-C inline freeze consumption) ─────────
    IF v_prev_last_week IS NULL THEN
      v_gap_weeks := 0;
      v_new_streak := 1;
    ELSE
      v_gap_weeks := ((v_this_week - v_prev_last_week) / 7) - 1;

      IF v_gap_weeks < 0 THEN
        v_gap_weeks := 0;
        v_new_streak := 1;
      ELSIF v_gap_weeks = 0 THEN
        v_new_streak := v_prev_streak + 1;
      ELSIF v_gap_weeks <= v_prev_freezes THEN
        v_freezes_to_consume := v_gap_weeks;
        v_new_streak := v_prev_streak + 1;

        FOR i IN 1..v_freezes_to_consume LOOP
          INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
          VALUES (v_player_id, v_prev_last_week + (i * INTERVAL '7 days'), NULL, NULL, TRUE)
          ON CONFLICT (player_id, week_start_date) DO NOTHING;
        END LOOP;
      ELSE
        v_gap_weeks := 0;
        v_new_streak := 1;
      END IF;
    END IF;

    v_new_freezes := v_prev_freezes - v_freezes_to_consume;

    IF v_new_streak > 0 AND v_new_streak % 4 = 0 THEN
      v_milestone := TRUE;
      IF v_new_freezes < v_freeze_cap THEN
        v_new_freezes := v_new_freezes + 1;
        v_freeze_earned := TRUE;
      END IF;
    END IF;

    v_new_longest := GREATEST(
      v_new_streak,
      COALESCE((SELECT s.longest_streak FROM public.player_streak s WHERE s.player_id = v_player_id), 0)
    );

    UPDATE public.player_streak
       SET current_streak = v_new_streak,
           longest_streak = v_new_longest,
           freeze_inventory = v_new_freezes,
           last_checkin_week_start = v_this_week,
           updated_at = now()
     WHERE player_id = v_player_id;
  END IF;

  -- Preferences upsert. Always refresh toggles + coverage. last_frequency_goal
  -- is the "pre-fill next time" hint — only advance it on a NEW weekly check-in
  -- so a 2nd same-week pass can't silently change the remembered goal.
  INSERT INTO public.player_check_in_preferences
    (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, availability_covered_through, updated_at)
  VALUES
    (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, v_covered_through, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches         = EXCLUDED.auto_create_matches,
        auto_invite_players         = EXCLUDED.auto_invite_players,
        availability_covered_through = EXCLUDED.availability_covered_through,
        last_frequency_goal         = CASE WHEN v_is_new
                                           THEN EXCLUDED.last_frequency_goal
                                           ELSE public.player_check_in_preferences.last_frequency_goal END,
        updated_at                  = now();

  -- Refresh availability staleness signal.
  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  -- Dispatch match auto-creation for the CURRENT window on EVERY call (the old
  -- AFTER INSERT trigger missed 2nd same-week check-ins). Fire-and-forget:
  -- net.http_post only enqueues + flushes post-commit, and any failure is
  -- swallowed so it can never roll back the check-in.
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
      body := jsonb_build_object('player_id', v_player_id::text),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_weekly_checkin: match-generation dispatch failed: %', SQLERRM;
  END;

  new_streak := v_new_streak;
  freezes := v_new_freezes;
  longest_streak := v_new_longest;
  milestone_reached := v_milestone;
  freeze_earned := v_freeze_earned;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rolling-window weekly check-in. Syncs player.timezone, sets '
  'availability_covered_through = local today + 3, asks frequency_goal once per '
  'ISO week (no overwrite on a 2nd same-week pass), and dispatches match '
  'auto-creation on every call. Streak math unchanged (Option-C inline freeze).';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. Retire the AFTER INSERT dispatch trigger — dispatch now lives in the RPC.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_dispatch_weekly_match_generation ON public.player_weekly_checkin;
DROP FUNCTION IF EXISTS public.tg_dispatch_weekly_match_generation();


-- -----------------------------------------------------------------------------
-- 5. generate_weekly_matches_for_player — iterate the 4 concrete window dates
--    (today … today+3) instead of mapping day-of-week onto the current ISO week.
--    Facility/hour tier selection + INSERT logic are unchanged.
-- -----------------------------------------------------------------------------
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz            text;
  v_today         date;
  v_now_hour      int;
  v_auto_create   boolean;
  v_player_loc    extensions.geography;
  v_sport         record;
  v_sel           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_target_dow    text;
  v_hour          int;
  v_start         time;
  v_end           time;
  v_match_id      uuid;
  d               int;
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

  FOR v_sport IN
    SELECT ps.sport_id,
           s.name                       AS sport_name,
           ps.preferred_match_duration  AS duration,
           ps.preferred_match_type      AS match_type
      FROM public.player_sport ps
      JOIN public.sport s ON s.id = ps.sport_id
     WHERE ps.player_id = p_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
  LOOP
    v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
    v_duration_min  := COALESCE(
      public.parse_match_duration_to_minutes(v_duration_enum::text), 60
    );

    -- Walk the rolling window: today … today+3 (exact dates), soonest first.
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

      -- Don't stack an auto-match on top of a REAL commitment.
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
        court_status, is_auto_generated, timezone
      ) VALUES (
        v_sport.sport_id, v_target_date, v_start, v_end, p_player_id,
        'public', 'request', 'singles', COALESCE(v_sport.match_type, 'both'), v_duration_enum,
        v_location_type::location_type_enum,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.address END,
        v_court_status::court_status_enum,
        TRUE, v_tz
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
  'over the rolling window today…today+3 (EXACT local dates), hosted by the '
  'player. Per day it picks the favorite facility/hour by tier '
  '(bookable-with-courts > FCFS > rest, nearest then earliest), or TBD when no '
  'favorites. Gated on auto_create_matches. Idempotent per (sport, exact date).';

REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_player(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_player(uuid) TO service_role;

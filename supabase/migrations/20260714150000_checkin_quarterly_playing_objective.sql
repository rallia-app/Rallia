-- =============================================================================
-- Weekly check-in: ask the playing objective once per QUARTER, not every week
--
-- The frequency goal ("games / week") was asked once per ISO week per sport
-- (get_check_in_context.frequency_already_set_this_week keyed on the current
-- week). Players still check in weekly for availability + match planning, but
-- re-picking the same objective every week is noise — it should be asked once
-- every ~3 months (rolling).
--
-- The weekly row's frequency_goal is ALSO what the streak evaluator and the
-- history strip read, so the goal can't just be absent on un-prompted weeks.
-- Fix: every weekly check-in keeps snapshotting the current goal into that
-- week's row (carried forward from the last declared value — the client seeds
-- frequencyGoal from lastFrequencyGoal), and a new goal_is_explicit flag marks
-- the weeks the player actually (re)declared it. The quarterly gate keys off
-- those explicit weeks:
--
--     goal fresh  ⇔  an explicit goal exists for this sport within 3 months
--     prompt      ⇔  availability lapsed OR the goal is stale (not fresh)
--
-- Streak/history logic is untouched: it still reads frequency_goal per week,
-- which is now carried forward instead of set-once-per-week.
-- =============================================================================


-- =============================================================================
-- 1. player_weekly_checkin.goal_is_explicit
--    Backfill existing goal rows → TRUE: under the old weekly regime every
--    goal was explicitly declared, so current active players stay "fresh" and
--    are only re-prompted 3 months after their last check-in (smooth rollout).
-- =============================================================================

ALTER TABLE public.player_weekly_checkin
  ADD COLUMN IF NOT EXISTS goal_is_explicit BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.player_weekly_checkin
   SET goal_is_explicit = TRUE
 WHERE frequency_goal IS NOT NULL
   AND goal_is_explicit = FALSE;

COMMENT ON COLUMN public.player_weekly_checkin.goal_is_explicit IS
  'TRUE on weeks the player actually (re)declared the playing objective. Other '
  'weeks carry the goal forward for streak/history continuity. The quarterly '
  'prompt gate keys off the most recent explicit week per sport.';


-- =============================================================================
-- 2. get_check_in_context — quarterly goal gate
--    Same signature as 20260713180000; only v_freq_set changes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_check_in_context(
  p_timezone TEXT DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  current_streak                  SMALLINT,
  longest_streak                  SMALLINT,
  freeze_inventory                SMALLINT,
  freeze_cap                      SMALLINT,
  last_week_frequency_goal        SMALLINT,
  last_week_sessions_played       SMALLINT,
  history_weeks                   JSONB,
  last_frequency_goal             SMALLINT,
  is_pending_check_in             BOOLEAN,
  timezone                        TEXT,
  availability_covered_through    DATE,
  frequency_already_set_this_week BOOLEAN,
  checkin_window                  JSONB,
  availability_refresh_needed     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id     UUID := auth.uid();
  v_sport_id      UUID := p_sport_id;
  v_tz            TEXT;
  v_today         DATE;
  v_this_week     DATE;
  v_last_week     DATE;
  v_covered       DATE;
  v_avail_pending BOOLEAN;
  v_pending       BOOLEAN;
  v_freq_set      BOOLEAN;
  v_window        JSONB;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- NULL sport (old clients / sport mode still resolving) → the primary sport,
  -- else the most recently touched active sport.
  IF v_sport_id IS NULL THEN
    SELECT ps.sport_id INTO v_sport_id
      FROM public.player_sport ps
     WHERE ps.player_id = v_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
     LIMIT 1;
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

  v_today     := (now() AT TIME ZONE v_tz)::date;
  v_this_week := date_trunc('week', (now() AT TIME ZONE v_tz))::date;
  v_last_week := v_this_week - INTERVAL '7 days';

  -- Availability coverage stays player-wide (the schedule is the schedule).
  SELECT pref.availability_covered_through INTO v_covered
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;

  -- Availability needs refreshing when the rolling window has rolled past what
  -- the player last declared for. Player-wide; drives skipping the wizard's
  -- availability step when it was refreshed recently.
  v_avail_pending := (v_covered IS NULL) OR (v_today > v_covered);

  -- The playing objective is asked once per QUARTER per sport: the goal is
  -- "fresh" when the player explicitly (re)declared it within the last 3 months
  -- (rolling). Weeks in between inherit the goal (goal_is_explicit = FALSE) so
  -- the streak history stays coherent without re-prompting.
  v_freq_set := EXISTS (
    SELECT 1 FROM public.player_weekly_checkin c
     WHERE c.player_id = v_player_id
       AND c.sport_id = v_sport_id
       AND c.goal_is_explicit = TRUE
       AND c.frequency_goal IS NOT NULL
       AND c.week_start_date >= v_this_week - INTERVAL '3 months'
  );

  -- Prompt when availability lapsed OR this sport's goal has gone stale.
  v_pending := v_avail_pending OR (NOT v_freq_set);

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
      AND s.sport_id = v_sport_id
  ),
  last_week_row AS (
    SELECT c.frequency_goal   AS lw_frequency_goal,
           c.sessions_played  AS lw_sessions_played
    FROM public.player_weekly_checkin c
    WHERE c.player_id = v_player_id
      AND c.sport_id = v_sport_id
      AND c.week_start_date = v_last_week
      AND c.sessions_played IS NOT NULL   -- only show an evaluated last week
  ),
  -- One row per each of the last 4 COMPLETED weeks (newest-first), resolved to a
  -- status by the week's REAL date. A week with no check-in row → 'none'.
  history AS (
    SELECT jsonb_agg(
             jsonb_build_object(
               'week_start', g.wk,
               'status', CASE
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                      AND c.sessions_played >= c.frequency_goal           THEN 'hit'
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                      AND COALESCE(c.freeze_used, FALSE)                  THEN 'frozen'
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                                                                          THEN 'miss'
                 ELSE 'none'
               END
             )
             ORDER BY g.wk DESC
           ) AS weeks
    FROM (
      SELECT (v_this_week - (n || ' weeks')::interval)::date AS wk
      FROM generate_series(1, 4) AS n
    ) g
    LEFT JOIN public.player_weekly_checkin c
      ON c.player_id = v_player_id
     AND c.sport_id = v_sport_id
     AND c.week_start_date = g.wk
  ),
  -- Pre-select for the goal pill: the sport's most recent declared goal, falling
  -- back to the player-wide last-used goal for a sport with no history yet.
  last_goal AS (
    SELECT COALESCE(
             ( SELECT c.frequency_goal
                 FROM public.player_weekly_checkin c
                WHERE c.player_id = v_player_id
                  AND c.sport_id = v_sport_id
                  AND c.frequency_goal IS NOT NULL
                ORDER BY c.week_start_date DESC
                LIMIT 1 ),
             ( SELECT p.last_frequency_goal
                 FROM public.player_check_in_preferences p
                WHERE p.player_id = v_player_id )
           ) AS lg_last_frequency_goal
  )
  SELECT
    COALESCE((SELECT cs_current_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_longest_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_inventory  FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_cap        FROM streak), 2::SMALLINT),
    (SELECT lw_frequency_goal             FROM last_week_row),
    (SELECT lw_sessions_played            FROM last_week_row),
    COALESCE((SELECT weeks                FROM history), '[]'::jsonb),
    (SELECT lg_last_frequency_goal        FROM last_goal),
    v_pending,
    v_tz,
    v_covered,
    v_freq_set,
    v_window,
    v_avail_pending;
END;
$$;

COMMENT ON FUNCTION public.get_check_in_context(TEXT, UUID) IS
  'Check-in wizard cold-start, scoped to p_sport_id (NULL → primary sport). '
  'is_pending_check_in = availability coverage lapsed OR this sport''s playing '
  'objective is stale (not explicitly (re)declared within the last 3 months). '
  'frequency_already_set_this_week now means "goal fresh this quarter" — the '
  'wizard skips the recap+goal step while it is. availability_refresh_needed '
  '(player-wide) lets the wizard skip the availability step when the schedule '
  'was refreshed recently. Streak, goal history and the quarterly gate are per '
  'sport; timezone, coverage and window stay player-wide.';

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT, UUID) TO authenticated;


-- =============================================================================
-- 3. record_weekly_checkin — carry the goal forward + mark explicit weeks
--    New trailing param p_goal_is_explicit (DEFAULT TRUE keeps old callers /
--    clients — which always presented the goal step — meaning "explicit").
-- =============================================================================

DROP FUNCTION IF EXISTS public.record_weekly_checkin(smallint, boolean, boolean, text, jsonb, uuid);

CREATE FUNCTION public.record_weekly_checkin(
  p_frequency_goal SMALLINT,
  p_auto_create BOOLEAN,
  p_auto_invite BOOLEAN,
  p_timezone TEXT DEFAULT NULL,
  p_match_plan JSONB DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL,
  p_goal_is_explicit BOOLEAN DEFAULT TRUE
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
  v_checkin_sport    UUID := p_sport_id;
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

  -- NULL sport (old clients) → the primary sport, else the most recently
  -- touched active sport. Goal + streak are per sport, so one is required.
  IF v_checkin_sport IS NULL THEN
    SELECT ps.sport_id INTO v_checkin_sport
      FROM public.player_sport ps
     WHERE ps.player_id = v_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
     LIMIT 1;
  END IF;
  IF v_checkin_sport IS NULL THEN
    RAISE EXCEPTION 'record_weekly_checkin: player has no active sport';
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

  -- Ensure the sport's streak row exists so the weekly evaluator has something
  -- to evaluate. We DO NOT touch streak values here — the evaluator owns them.
  INSERT INTO public.player_streak (player_id, sport_id, current_streak, longest_streak, freeze_inventory, freeze_cap)
  VALUES (v_player_id, v_checkin_sport, 0, 0, 0, 2)
  ON CONFLICT (player_id, sport_id) DO NOTHING;

  SELECT 1 INTO v_existing
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.sport_id = v_checkin_sport
    AND c.week_start_date = v_this_week;
  v_is_new := v_existing IS NULL;

  -- The playing objective is asked once per QUARTER per sport, but each week the
  -- player checks in snapshots the current goal so streak/history stay coherent.
  -- The goal is carried forward from the client (seeded from the last declared
  -- value); goal_is_explicit marks weeks the player actually (re)declared it,
  -- which the quarterly gate keys off. First check-in of the week writes the
  -- row; a same-week re-check-in only promotes explicitness (value stays put).
  INSERT INTO public.player_weekly_checkin
    (player_id, sport_id, week_start_date, frequency_goal, goal_is_explicit, sessions_played, freeze_consumed)
  VALUES (v_player_id, v_checkin_sport, v_this_week, p_frequency_goal, p_goal_is_explicit, NULL, FALSE)
  ON CONFLICT (player_id, sport_id, week_start_date) DO UPDATE
    SET frequency_goal   = COALESCE(public.player_weekly_checkin.frequency_goal, EXCLUDED.frequency_goal),
        goal_is_explicit = public.player_weekly_checkin.goal_is_explicit OR EXCLUDED.goal_is_explicit;

  -- Preferences stay player-wide; last_frequency_goal is the cross-sport
  -- last-used fallback (per-sport pre-select reads the check-in history).
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

  -- Return the sport's CURRENT streak unchanged — the check-in doesn't move it
  -- (evaluate_weekly_goals owns streak math).
  SELECT s.current_streak, s.freeze_inventory, s.longest_streak
    INTO v_cur_streak, v_cur_freezes, v_cur_longest
  FROM public.player_streak s
  WHERE s.player_id = v_player_id
    AND s.sport_id = v_checkin_sport;

  new_streak        := COALESCE(v_cur_streak, 0);
  freezes           := COALESCE(v_cur_freezes, 0);
  longest_streak    := COALESCE(v_cur_longest, 0);
  milestone_reached := FALSE;
  freeze_earned     := FALSE;
  created_matches   := v_created;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB, UUID, BOOLEAN) IS
  'Rolling-window check-in, scoped to p_sport_id (NULL → primary sport). Syncs '
  'tz, sets availability_covered_through = today+3 (player-wide), snapshots the '
  'playing objective into this ISO week''s row (carried forward every check-in '
  'for streak/history continuity). p_goal_is_explicit marks the weeks the player '
  'actually (re)declared it — the quarterly prompt gate keys off those. With '
  'p_match_plan: creates the confirmed matches synchronously and dispatches '
  'invite-only. Streak untouched (evaluate_weekly_goals owns it, per sport).';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB, UUID, BOOLEAN) TO authenticated;

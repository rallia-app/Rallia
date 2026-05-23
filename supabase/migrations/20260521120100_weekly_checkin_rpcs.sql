-- =============================================================================
-- Weekly check-in wizard — RPCs
--
-- Two SECURITY DEFINER functions:
--
--   * get_check_in_context()
--       Read-only. Returns everything the wizard needs to render Step 1 in
--       one round-trip: current streak, freezes, last week's goal/played,
--       last 4 weeks of goal-hit booleans, and is_pending_check_in (drives
--       the banner + auto-opener trigger).
--
--   * record_weekly_checkin(p_frequency_goal, p_auto_create, p_auto_invite)
--       Atomic write. Upserts the 3 wizard tables, refreshes the player's
--       availability last_confirmed_at, and runs the Option-C streak math
--       (increment / freeze-milestone earn / longest-streak update).
--
-- Week math: we use UTC Mondays as the canonical "week start" (date_trunc).
-- Local-timezone awareness can layer on later if needed; the wizard's UX
-- doesn't depend on it (Monday-9am push reminder is local, but the streak
-- arithmetic stays in UTC).
--
-- IMPORTANT: record_weekly_checkin is idempotent within a week — calling it
-- a second time in the same ISO week only updates the goal/prefs; streak
-- math does NOT double-increment.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- get_check_in_context — wizard cold-start in one round-trip
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_check_in_context();

CREATE OR REPLACE FUNCTION public.get_check_in_context()
RETURNS TABLE (
  current_streak             SMALLINT,
  longest_streak             SMALLINT,
  freeze_inventory           SMALLINT,
  freeze_cap                 SMALLINT,
  last_week_frequency_goal   SMALLINT,
  last_week_sessions_played  SMALLINT,
  goals_hit_last_4_weeks     BOOLEAN[],
  last_frequency_goal        SMALLINT,
  is_pending_check_in        BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id  UUID := auth.uid();
  v_this_week  DATE := date_trunc('week', (now() AT TIME ZONE 'UTC'))::date;
  v_last_week  DATE := v_this_week - INTERVAL '7 days';
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- Aliased column names in the CTEs (cs_*, lw_*, etc.) to avoid collision
  -- with the RETURNS TABLE output column names of this function.
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
  -- Last 4 *real* checkins (excludes freeze-rescue rows where frequency_goal IS NULL),
  -- ordered newest first. Goal hit when sessions_played >= frequency_goal.
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
  ),
  this_week_row AS (
    SELECT 1 AS tw_marker
    FROM public.player_weekly_checkin c
    WHERE c.player_id = v_player_id
      AND c.week_start_date = v_this_week
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
    NOT EXISTS (SELECT 1 FROM this_week_row);
END;
$$;

COMMENT ON FUNCTION public.get_check_in_context() IS
  'Wizard cold-start: returns streak state + last-week recap + goals history + pending-checkin flag in a single round-trip.';

GRANT EXECUTE ON FUNCTION public.get_check_in_context() TO authenticated;


-- -----------------------------------------------------------------------------
-- record_weekly_checkin — atomic write on wizard submit
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.record_weekly_checkin(
  p_frequency_goal SMALLINT,
  p_auto_create    BOOLEAN,
  p_auto_invite    BOOLEAN
)
RETURNS TABLE (
  new_streak         SMALLINT,
  freezes            SMALLINT,
  longest_streak     SMALLINT,
  milestone_reached  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id     UUID    := auth.uid();
  v_this_week     DATE    := date_trunc('week', (now() AT TIME ZONE 'UTC'))::date;
  v_prev_week     DATE    := v_this_week - INTERVAL '7 days';
  v_is_first_call BOOLEAN;
  v_existing      public.player_streak%ROWTYPE;
  v_new_streak    SMALLINT;
  v_milestone     BOOLEAN := FALSE;
  v_new_freezes   SMALLINT;
  v_new_longest   SMALLINT;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  IF p_frequency_goal IS NULL OR p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'p_frequency_goal must be between 1 and 5 (got %)', p_frequency_goal;
  END IF;

  -- Detect first-call-this-week. If a row already exists for this week, the
  -- subsequent upserts only refresh the goal/prefs — streak math is skipped
  -- (we never double-increment).
  SELECT NOT EXISTS (
    SELECT 1 FROM public.player_weekly_checkin
    WHERE player_id = v_player_id AND week_start_date = v_this_week
  ) INTO v_is_first_call;

  -- Upsert the audit row for this week. If the cron previously inserted a
  -- freeze-rescue row for this week (shouldn't happen — cron only writes for
  -- *past* missed weeks), the real check-in wins and freeze_consumed flips
  -- to FALSE.
  INSERT INTO public.player_weekly_checkin (
    player_id, week_start_date, frequency_goal, freeze_consumed
  )
  VALUES (v_player_id, v_this_week, p_frequency_goal, FALSE)
  ON CONFLICT (player_id, week_start_date) DO UPDATE
    SET frequency_goal  = EXCLUDED.frequency_goal,
        freeze_consumed = FALSE,
        completed_at    = now();

  -- Upsert preferences (always, idempotent).
  INSERT INTO public.player_check_in_preferences (
    player_id, auto_create_matches, auto_invite_players, last_frequency_goal, updated_at
  )
  VALUES (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches = EXCLUDED.auto_create_matches,
        auto_invite_players = EXCLUDED.auto_invite_players,
        last_frequency_goal = EXCLUDED.last_frequency_goal,
        updated_at          = now();

  -- Refresh availability staleness for the player's active rows (clears the
  -- 7-day-stale banner signal). Same semantics as the existing UserProfile
  -- availability-edit save.
  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  -- Load or seed the streak row.
  SELECT * INTO v_existing
    FROM public.player_streak
   WHERE player_id = v_player_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Brand-new player: seed at streak=1 if this is the first call, else 0.
    INSERT INTO public.player_streak (
      player_id, current_streak, longest_streak, freeze_inventory, freeze_cap,
      last_checkin_week_start, updated_at
    ) VALUES (
      v_player_id,
      CASE WHEN v_is_first_call THEN 1 ELSE 0 END,
      CASE WHEN v_is_first_call THEN 1 ELSE 0 END,
      0, 2,
      CASE WHEN v_is_first_call THEN v_this_week ELSE NULL END,
      now()
    );

    new_streak        := CASE WHEN v_is_first_call THEN 1 ELSE 0 END;
    freezes           := 0;
    longest_streak    := new_streak;
    milestone_reached := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Existing player. If not the first call this week, return current state untouched.
  IF NOT v_is_first_call THEN
    new_streak        := v_existing.current_streak;
    freezes           := v_existing.freeze_inventory;
    longest_streak    := v_existing.longest_streak;
    milestone_reached := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- First call this week → run streak math.
  --
  --   * If last check-in was exactly last week (the cron may have written a
  --     freeze-rescue row that moves last_checkin_week_start to last week,
  --     keeping us in this branch) → increment.
  --   * Otherwise (NULL or earlier) → reset to 1.
  IF v_existing.last_checkin_week_start = v_prev_week THEN
    v_new_streak := v_existing.current_streak + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  -- Milestone: every 4 weeks earn 1 freeze (capped). 4, 8, 12, ...
  IF v_new_streak > 0 AND v_new_streak % 4 = 0 THEN
    v_milestone   := TRUE;
    v_new_freezes := LEAST(v_existing.freeze_inventory + 1, v_existing.freeze_cap);
  ELSE
    v_new_freezes := v_existing.freeze_inventory;
  END IF;

  v_new_longest := GREATEST(v_existing.longest_streak, v_new_streak);

  UPDATE public.player_streak
     SET current_streak          = v_new_streak,
         longest_streak          = v_new_longest,
         freeze_inventory        = v_new_freezes,
         last_checkin_week_start = v_this_week,
         updated_at              = now()
   WHERE player_id = v_player_id;

  new_streak        := v_new_streak;
  freezes           := v_new_freezes;
  longest_streak    := v_new_longest;
  milestone_reached := v_milestone;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN) IS
  'Atomic wizard submit: upserts player_weekly_checkin + player_check_in_preferences + player_streak, refreshes player_availability.last_confirmed_at, runs Option-C streak math. Idempotent within a week.';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN) TO authenticated;

-- =============================================================================
-- Streak meaning rework — weekly GAME OBJECTIVE instead of check-in completion
--
-- Before: current_streak counted consecutive weeks the player completed the
-- check-in wizard. record_weekly_checkin advanced it; the compute-streak-reset
-- cron reset it when a player didn't check in.
--
-- After: current_streak counts consecutive completed ISO weeks where the player
-- HIT their weekly game objective — i.e. played >= frequency_goal qualifying
-- games that week. A "qualifying game" is a match where the player was a joined
-- participant, the match happened that week and is in the past, the match isn't
-- cancelled, and the player CHECKED INTO the game (match_participant.checked_in_at).
-- This rewards actually showing up to play.
--
-- Pieces:
--   1. player_streak.last_evaluated_week_start — per-player evaluation watermark.
--   2. count_player_sessions_for_week() — the qualifying-game counter.
--   3. evaluate_weekly_goals() — week-end evaluator: backfills sessions_played,
--      advances/rescues/resets the streak, earns milestone freezes. Run hourly
--      by pg_cron (timezone-aware: each player's local week rolls over once a day,
--      so an hourly tick catches every timezone). Replaces compute-streak-reset.
--   4. record_weekly_checkin — DECOUPLED from streak/freezes entirely. It still
--      seeds an empty streak row (so the evaluator has something to evaluate) and
--      returns the CURRENT streak unchanged (milestone/freeze_earned always FALSE).
--
-- Freeze mechanic (kept, repurposed): earn 1 freeze on every 4th consecutive
-- goal-HIT week (cap = freeze_cap, default 2); a freeze auto-rescues a missed
-- (or no-goal) week, preserving the streak. A week with no frequency_goal set
-- (player never checked in that week) counts as a MISS.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Evaluation watermark: the most recent COMPLETED local week we've judged
--    for this player. NULL = never evaluated (only the last completed week is
--    judged on first run; we don't backfill ancient history).
-- -----------------------------------------------------------------------------
ALTER TABLE public.player_streak
  ADD COLUMN IF NOT EXISTS last_evaluated_week_start DATE;

COMMENT ON COLUMN public.player_streak.last_evaluated_week_start IS
  'Monday of the most recent COMPLETED local ISO week whose goal outcome has '
  'been folded into the streak by evaluate_weekly_goals(). NULL until first run.';


-- -----------------------------------------------------------------------------
-- 2. Qualifying-game counter for a player + ISO week.
--    A game counts iff: joined participant, checked into the game, match in the
--    week, in the past, not cancelled. Reusable for live current-week progress.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_player_sessions_for_week(
  p_player_id uuid,
  p_week_start date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM public.match_participant mp
  JOIN public.match m ON m.id = mp.match_id
  WHERE mp.player_id = p_player_id
    AND mp.status = 'joined'
    AND mp.checked_in_at IS NOT NULL
    AND m.cancelled_at IS NULL
    AND m.match_date >= p_week_start
    AND m.match_date <  p_week_start + 7
    AND ((m.match_date + COALESCE(m.end_time, time '23:59:59'))
           AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC')) < now();
$$;

COMMENT ON FUNCTION public.count_player_sessions_for_week(uuid, date) IS
  'Number of qualifying games for the player in the given ISO week: joined + '
  'checked-in (match_participant.checked_in_at) + in the past + not cancelled.';

GRANT EXECUTE ON FUNCTION public.count_player_sessions_for_week(uuid, date) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. Week-end evaluator. For each player, fold every completed-but-unevaluated
--    local week into the streak, one week at a time (so freezes are consumed in
--    order). Idempotent: re-running re-derives nothing already past the watermark.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_weekly_goals()
RETURNS TABLE (
  players_evaluated int,
  weeks_evaluated   int,
  hits              int,
  misses            int,
  rescued           int,
  resets            int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p          record;
  v_cur_week date;
  v_target   date;
  v_goal     smallint;
  v_sessions int;
  v_streak   smallint;
  v_freezes  smallint;
  v_cap      smallint;
  v_longest  smallint;
  v_hit      boolean;
  v_did_any  boolean;
  v_players  int := 0;
  v_weeks    int := 0;
  v_hits     int := 0;
  v_misses   int := 0;
  v_rescued  int := 0;
  v_resets   int := 0;
BEGIN
  FOR p IN
    SELECT ps.player_id, ps.current_streak, ps.longest_streak,
           ps.freeze_inventory, ps.freeze_cap, ps.last_evaluated_week_start
    FROM public.player_streak ps
  LOOP
    v_cur_week := public.player_current_week_start(p.player_id);
    -- First un-evaluated week. NULL watermark → only the last completed week.
    v_target   := COALESCE(p.last_evaluated_week_start, v_cur_week - 14) + 7;
    v_streak   := p.current_streak;
    v_freezes  := p.freeze_inventory;
    v_cap      := p.freeze_cap;
    v_longest  := p.longest_streak;
    v_did_any  := FALSE;

    -- Fold each COMPLETED week (strictly before the current local week).
    WHILE v_target < v_cur_week LOOP
      v_goal := NULL;  -- reset: SELECT INTO leaves the var unchanged on no row
      SELECT c.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin c
      WHERE c.player_id = p.player_id
        AND c.week_start_date = v_target;

      v_sessions := public.count_player_sessions_for_week(p.player_id, v_target);

      -- Backfill the historical sessions count if a check-in row exists.
      UPDATE public.player_weekly_checkin
         SET sessions_played = v_sessions
       WHERE player_id = p.player_id
         AND week_start_date = v_target;

      v_hit := (v_goal IS NOT NULL AND v_sessions >= v_goal);

      IF v_hit THEN
        v_streak := v_streak + 1;
        v_hits := v_hits + 1;
        -- Milestone: a freeze every 4th consecutive goal-hit week (capped).
        IF v_streak % 4 = 0 AND v_freezes < v_cap THEN
          v_freezes := v_freezes + 1;
        END IF;
      ELSE
        v_misses := v_misses + 1;
        IF v_freezes > 0 THEN
          v_freezes := v_freezes - 1;  -- freeze auto-rescues the miss
          v_rescued := v_rescued + 1;
        ELSE
          v_streak := 0;
          v_resets := v_resets + 1;
        END IF;
      END IF;

      v_longest := GREATEST(v_longest, v_streak);
      v_weeks   := v_weeks + 1;
      v_did_any := TRUE;
      v_target  := v_target + 7;
    END LOOP;

    IF v_did_any THEN
      UPDATE public.player_streak
         SET current_streak            = v_streak,
             longest_streak            = v_longest,
             freeze_inventory          = v_freezes,
             last_evaluated_week_start = v_target - 7,  -- last week we folded in
             updated_at                = now()
       WHERE player_id = p.player_id;
      v_players := v_players + 1;
    END IF;
  END LOOP;

  players_evaluated := v_players;
  weeks_evaluated   := v_weeks;
  hits              := v_hits;
  misses            := v_misses;
  rescued           := v_rescued;
  resets            := v_resets;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.evaluate_weekly_goals() IS
  'Week-end streak evaluator. Folds each completed-but-unevaluated local week '
  'into player_streak: hit (sessions_played >= frequency_goal) advances + may '
  'earn a milestone freeze; miss (incl. no goal set) consumes a freeze to rescue '
  'or resets to 0. Backfills player_weekly_checkin.sessions_played. Run hourly.';

REVOKE ALL ON FUNCTION public.evaluate_weekly_goals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_weekly_goals() TO service_role;


-- -----------------------------------------------------------------------------
-- 4. record_weekly_checkin — DECOUPLED from streak/freezes.
--    Keeps: tz sync, coverage write, frequency-once-per-week, prefs, availability
--    confirm, match dispatch. Removes ALL streak math. Returns the CURRENT streak
--    unchanged (milestone_reached / freeze_earned always FALSE) so the UI can
--    still show the number without implying the check-in moved it.
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
  v_player_id        UUID := auth.uid();
  v_tz               TEXT;
  v_today            DATE;
  v_covered_through  DATE;
  v_this_week        DATE;
  v_existing         INT;
  v_is_new           BOOLEAN;
  v_cur_streak       SMALLINT;
  v_cur_freezes      SMALLINT;
  v_cur_longest      SMALLINT;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;
  IF p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'frequency_goal must be 1..5';
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
  v_covered_through := v_today + 3;
  v_this_week       := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  -- Ensure a streak row exists so the weekly evaluator has something to evaluate.
  -- We DO NOT touch streak values here — the evaluator owns them now.
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

  -- Dispatch match auto-creation for the current window (fire-and-forget).
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

  -- Return the CURRENT streak unchanged — the check-in no longer moves it.
  SELECT s.current_streak, s.freeze_inventory, s.longest_streak
    INTO v_cur_streak, v_cur_freezes, v_cur_longest
  FROM public.player_streak s
  WHERE s.player_id = v_player_id;

  new_streak        := COALESCE(v_cur_streak, 0);
  freezes           := COALESCE(v_cur_freezes, 0);
  longest_streak    := COALESCE(v_cur_longest, 0);
  milestone_reached := FALSE;
  freeze_earned     := FALSE;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Rolling-window check-in. Syncs tz, sets availability_covered_through = today+3, '
  'asks frequency_goal once per ISO week, dispatches match auto-creation. DECOUPLED '
  'from the streak: it never advances/resets it (evaluate_weekly_goals owns that) '
  'and returns the current streak unchanged with milestone/freeze_earned = FALSE.';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Cron: retire the check-in-based reset, schedule the goal evaluator.
--    Pure-SQL job (no edge function) — evaluate_weekly_goals does everything.
-- -----------------------------------------------------------------------------
SELECT cron.unschedule('compute-streak-reset-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-streak-reset-hourly');

SELECT cron.unschedule('evaluate-weekly-goals-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-weekly-goals-hourly');

SELECT cron.schedule(
  'evaluate-weekly-goals-hourly',
  '15 * * * *',
  $$ SELECT public.evaluate_weekly_goals(); $$
);


-- -----------------------------------------------------------------------------
-- 6. get_check_in_context — don't render UN-EVALUATED weeks as misses.
--    Historically sessions_played is NULL (never counted), and the evaluator
--    only fills it going forward. Exclude NULL-sessions weeks from BOTH the
--    4-week history strip and the last-week recap so pre-rework weeks show as
--    "no data" (first-time card) instead of a wall of ✗.
-- -----------------------------------------------------------------------------
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

  SELECT pref.availability_covered_through INTO v_covered
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;

  v_pending := (v_covered IS NULL) OR (v_today > v_covered);

  v_freq_set := EXISTS (
    SELECT 1 FROM public.player_weekly_checkin c
     WHERE c.player_id = v_player_id
       AND c.week_start_date = v_this_week
       AND c.frequency_goal IS NOT NULL
  );

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
      AND c.sessions_played IS NOT NULL   -- only show an evaluated last week
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
        AND c.sessions_played IS NOT NULL  -- exclude un-evaluated weeks (no ✗)
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

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. One-time rebaseline of EXISTING players to a clean start.
--    Old current_streak values were built on the retired "did you check in"
--    meaning and can't be recomputed (per-game check-in data was never
--    captured). So: zero the current streak + freezes, KEEP longest_streak as a
--    historical high-water mark, and seed the evaluator watermark to this week
--    so it does NOT retroactively judge (and reset) anyone. The first judged
--    week is the first FULL week after ship. New players (added later) get a
--    NULL watermark from record_weekly_checkin and start at 0 anyway.
-- -----------------------------------------------------------------------------
UPDATE public.player_streak
   SET current_streak            = 0,
       freeze_inventory          = 0,
       last_evaluated_week_start = public.player_current_week_start(player_id),
       updated_at                = now();

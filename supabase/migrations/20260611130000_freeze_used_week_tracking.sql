-- Freeze-rescue tracking per week.
--
-- The week-end evaluator (evaluate_weekly_goals) burns a freeze to rescue a
-- missed week, but until now recorded nothing on the week row itself — so the
-- check-in wizard's 4-week history strip could only show a bare ✗ for a week
-- that did NOT break the streak. That made the streak number look wrong next
-- to its own history ("streak 4" above a strip with a miss in it).
--
-- This migration:
--   1. Adds player_weekly_checkin.freeze_used, set by the evaluator when a
--      freeze rescues that week.
--   2. Re-creates evaluate_weekly_goals() to mark the rescued week.
--   3. Re-creates get_check_in_context() with a parallel
--      freezes_used_last_4_weeks BOOLEAN[] (drop+create: return type changes).

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_weekly_checkin
  ADD COLUMN IF NOT EXISTS freeze_used BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.player_weekly_checkin.freeze_used IS
  'TRUE when evaluate_weekly_goals() burned a streak freeze to rescue this '
  'missed week. Lets the client history strip render ❄️ (rescued) instead of '
  'a bare ✗, so the streak count always agrees with the strip.';

-- ---------------------------------------------------------------------------
-- 2. Evaluator — mark the rescued week (one new UPDATE in the miss branch)
-- ---------------------------------------------------------------------------
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
          -- Record the rescue on the week row (if any) so the history strip
          -- can render ❄️ for a miss that did not break the streak.
          UPDATE public.player_weekly_checkin
             SET freeze_used = TRUE
           WHERE player_id = p.player_id
             AND week_start_date = v_target;
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

REVOKE ALL ON FUNCTION public.evaluate_weekly_goals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_weekly_goals() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. get_check_in_context — add freezes_used_last_4_weeks (parallel array,
--    newest-first, same ordering/filtering as goals_hit_last_4_weeks).
--    Return type changes → drop + create.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_check_in_context(TEXT);

CREATE FUNCTION public.get_check_in_context(p_timezone TEXT DEFAULT NULL)
RETURNS TABLE (
  current_streak                  SMALLINT,
  longest_streak                  SMALLINT,
  freeze_inventory                SMALLINT,
  freeze_cap                      SMALLINT,
  last_week_frequency_goal        SMALLINT,
  last_week_sessions_played       SMALLINT,
  goals_hit_last_4_weeks          BOOLEAN[],
  freezes_used_last_4_weeks       BOOLEAN[],
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
      ) AS hits,
      array_agg(
        COALESCE(h.freeze_used, FALSE)
        ORDER BY h.week_start_date DESC
      ) AS freezes_used
    FROM (
      SELECT c.frequency_goal, c.sessions_played, c.week_start_date, c.freeze_used
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
    COALESCE((SELECT freezes_used         FROM history), ARRAY[]::BOOLEAN[]),
    (SELECT pr_last_frequency_goal        FROM prefs),
    v_pending,
    v_tz,
    v_covered,
    v_freq_set,
    v_window;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT) TO authenticated;

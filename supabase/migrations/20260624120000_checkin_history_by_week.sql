-- =============================================================================
-- Check-in history strip: return per-week status keyed by date, not positional
--
-- The streak card's 4-week history strip was driven by two positional boolean
-- arrays (goals_hit_last_4_weeks / freezes_used_last_4_weeks) that only included
-- weeks the player had an evaluated check-in row for. Weeks with NO check-in
-- (the player skipped that week) were omitted entirely, so the client packed the
-- remaining marks against the last N calendar Mondays — silently hiding the gap
-- weeks that actually broke the streak and mislabelling every mark's date.
--
-- This replaces both arrays with a single history_weeks JSONB: one entry per
-- each of the last 4 COMPLETED ISO weeks (newest-first), carrying the week's
-- real start date and its status, so the client can render each week in its true
-- slot:
--   • 'hit'    — goal set and sessions_played >= goal
--   • 'frozen' — missed but a freeze rescued it (streak survived)
--   • 'miss'   — goal set, evaluated, sessions_played < goal
--   • 'none'   — no check-in / no goal / not yet evaluated that week
--
-- A 'none' week is a real streak break (no goal = miss in the evaluator); the
-- client now shows it in place instead of hiding it.
--
-- Return type changes → DROP + CREATE.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_check_in_context(TEXT);

CREATE FUNCTION public.get_check_in_context(p_timezone TEXT DEFAULT NULL)
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
     AND c.week_start_date = g.wk
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
    COALESCE((SELECT weeks                FROM history), '[]'::jsonb),
    (SELECT pr_last_frequency_goal        FROM prefs),
    v_pending,
    v_tz,
    v_covered,
    v_freq_set,
    v_window;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT) TO authenticated;

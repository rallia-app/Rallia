-- =============================================================================
-- Weekly check-in: make the "pending" signal per-sport + expose availability
-- refresh separately
--
-- After 20260713170000, goal + streak are per sport, but the trigger the banner
-- and auto-opener read — is_pending_check_in — was still purely player-wide
-- (derived from availability_covered_through). So completing ONE sport's
-- check-in silenced the prompt for the other sport: switching tennis→pickleball
-- left the player with no nudge to set their pickleball goal.
--
-- This redefines the pending signal as:
--     is_pending_check_in = availability coverage lapsed
--                           OR this sport's goal isn't set this ISO week
-- so each sport is independently promptable while availability stays shared.
--
-- It also adds availability_refresh_needed (= coverage lapsed, player-wide) so
-- the wizard can SKIP the availability step when the schedule was refreshed
-- recently — a sport-switch check-in then goes straight to the goal step.
--
-- Return type changes → DROP + CREATE. Only get_check_in_context changes; body
-- is otherwise identical to 20260713170000.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_check_in_context(TEXT, UUID);

CREATE FUNCTION public.get_check_in_context(
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

  -- The goal is asked once per ISO week PER SPORT.
  v_freq_set := EXISTS (
    SELECT 1 FROM public.player_weekly_checkin c
     WHERE c.player_id = v_player_id
       AND c.sport_id = v_sport_id
       AND c.week_start_date = v_this_week
       AND c.frequency_goal IS NOT NULL
  );

  -- Prompt when availability lapsed OR this sport still owes a goal this week.
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
  'is_pending_check_in = availability coverage lapsed OR this sport''s goal not '
  'set this ISO week, so each sport is independently promptable. '
  'availability_refresh_needed (player-wide) lets the wizard skip the '
  'availability step when the schedule was refreshed recently. Streak, goal '
  'history and the frequency-already-set gate are per sport; timezone, coverage '
  'and window stay player-wide.';

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT, UUID) TO authenticated;

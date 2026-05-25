-- =============================================================================
-- Weekly check-in wizard — timezone awareness
--
-- Previously every weekly-checkin code path computed week boundaries in UTC,
-- which broke the user's mental model around the week rollover:
--
--   * West-coast players (UTC-8): the UTC week rolls forward at 4pm Sun PT.
--     They'd see "this week" jump to the next week several hours before
--     their own Sunday ended, and the wizard would prematurely treat them
--     as pending check-in.
--
--   * The compute-streak-reset cron ran at Monday 02:00 UTC, which is 6pm
--     Sunday in LA — too early. It would reset streaks for west-coast
--     players who still had Monday in front of them locally.
--
-- This migration introduces TZ-aware week math driven by `player.timezone`.
-- The column did not previously exist (the weekly-checkin-reminder edge
-- function referenced it but the column was never created — silent
-- never-fires bug). We add the column here and have record_weekly_checkin
-- lazily populate it from the client's `Intl.DateTimeFormat().resolvedOptions().timeZone`
-- on each check-in, which also naturally handles travel / relocation.
--
-- Touch points:
--   * New: player.timezone TEXT column
--   * New helper: player_current_week_start(p_player_id)
--   * Rewritten: get_check_in_context() — uses helper
--   * Rewritten: record_weekly_checkin() — uses helper + writes timezone
--   * New helper: players_needing_streak_reset() — for the cron
-- =============================================================================


-- -----------------------------------------------------------------------------
-- player.timezone — IANA timezone name (e.g. 'America/Toronto')
-- Nullable so we can distinguish "never set" from "explicitly UTC". All
-- consumers should COALESCE to 'UTC' as a safe fallback.
-- -----------------------------------------------------------------------------
ALTER TABLE public.player
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN public.player.timezone IS
  'IANA timezone name (e.g. ''America/Toronto''). Populated by the mobile client from Intl.DateTimeFormat().resolvedOptions().timeZone on each weekly check-in.';


-- -----------------------------------------------------------------------------
-- Helper: Monday of the player's CURRENT local ISO week.
-- Falls back to UTC when the player row is missing or has no timezone set.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_current_week_start(p_player_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT date_trunc(
    'week',
    (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC'))
  )::date
  FROM public.player p
  WHERE p.id = p_player_id
  UNION ALL
  -- Fallback: player row not found (shouldn't happen for real callers,
  -- but guards against the function being unusable in that edge case).
  SELECT date_trunc('week', (now() AT TIME ZONE 'UTC'))::date
  WHERE NOT EXISTS (SELECT 1 FROM public.player WHERE id = p_player_id)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.player_current_week_start(UUID) IS
  'Monday of the player''s current local ISO week, derived from player.timezone (IANA name). Falls back to UTC for players with no timezone set.';

GRANT EXECUTE ON FUNCTION public.player_current_week_start(UUID) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- get_check_in_context — rewritten to use player's local week
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
  v_this_week  DATE;
  v_last_week  DATE;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- Week boundaries are anchored to the player's local timezone so they
  -- match the player's own perception of "this week" / "last week".
  v_this_week := public.player_current_week_start(v_player_id);
  v_last_week := v_this_week - INTERVAL '7 days';

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
  'Wizard cold-start: streak state + last-week recap + goals history + pending-checkin flag. Week boundaries are LOCAL to the player''s timezone (player.timezone).';

GRANT EXECUTE ON FUNCTION public.get_check_in_context() TO authenticated;


-- -----------------------------------------------------------------------------
-- record_weekly_checkin — rewritten to use player's local week
-- New parameter: p_timezone (IANA name from Intl.DateTimeFormat). The client
-- sends its current timezone on every check-in; we update player.timezone if
-- non-null so the value stays current as players travel / relocate.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN);

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
  milestone_reached BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id        UUID := auth.uid();
  v_this_week        DATE;
  v_prev_week        DATE;
  v_prev_streak      SMALLINT;
  v_prev_freezes     SMALLINT;
  v_freeze_cap       SMALLINT;
  v_prev_last_week   DATE;
  v_new_streak       SMALLINT;
  v_new_freezes      SMALLINT;
  v_new_longest      SMALLINT;
  v_milestone        BOOLEAN := FALSE;
  v_existing_this_week INT;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;
  IF p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'frequency_goal must be 1..5';
  END IF;

  -- Update the player's timezone FIRST, so the subsequent week-start lookup
  -- uses the freshest value. We only write when the client provided a non-
  -- empty string (defensive — bad client could send '' or NULL).
  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (timezone IS DISTINCT FROM p_timezone);
  END IF;

  v_this_week := public.player_current_week_start(v_player_id);
  v_prev_week := v_this_week - INTERVAL '7 days';

  -- Idempotency: short-circuit if this player already has a row for this
  -- local week. Update the prefs (so changes to toggles/freq stick) but
  -- DON'T re-run streak math.
  SELECT 1 INTO v_existing_this_week
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.week_start_date = v_this_week;

  -- Lock + read current streak state.
  SELECT s.current_streak, s.freeze_inventory, s.freeze_cap, s.last_checkin_week_start
    INTO v_prev_streak, v_prev_freezes, v_freeze_cap, v_prev_last_week
  FROM public.player_streak s
  WHERE s.player_id = v_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Seed a fresh row for first-time check-in
    INSERT INTO public.player_streak (player_id, current_streak, longest_streak, freeze_inventory, freeze_cap, last_checkin_week_start)
    VALUES (v_player_id, 0, 0, 0, 2, NULL);
    v_prev_streak := 0;
    v_prev_freezes := 0;
    v_freeze_cap := 2;
    v_prev_last_week := NULL;
  END IF;

  IF v_existing_this_week IS NOT NULL THEN
    -- Already checked in this week — just refresh frequency_goal + prefs.
    UPDATE public.player_weekly_checkin
       SET frequency_goal = p_frequency_goal
     WHERE player_id = v_player_id
       AND week_start_date = v_this_week;
  ELSE
    -- New check-in: insert the row, then run streak math.
    INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_this_week, p_frequency_goal, NULL, FALSE);

    IF v_prev_last_week IS NOT NULL AND v_prev_last_week = v_prev_week THEN
      -- Continuing the streak
      v_new_streak := v_prev_streak + 1;
    ELSE
      -- Either first ever checkin or there was a gap — streak resets to 1.
      v_new_streak := 1;
    END IF;

    -- 4-week milestone: earn 1 freeze (capped at freeze_cap)
    IF v_new_streak > 0 AND v_new_streak % 4 = 0 AND v_prev_freezes < v_freeze_cap THEN
      v_new_freezes := LEAST(v_prev_freezes + 1, v_freeze_cap);
      v_milestone := TRUE;
    ELSE
      v_new_freezes := v_prev_freezes;
    END IF;

    v_new_longest := GREATEST(v_new_streak, COALESCE((SELECT longest_streak FROM public.player_streak WHERE player_id = v_player_id), 0));

    UPDATE public.player_streak
       SET current_streak = v_new_streak,
           longest_streak = v_new_longest,
           freeze_inventory = v_new_freezes,
           last_checkin_week_start = v_this_week,
           updated_at = now()
     WHERE player_id = v_player_id;
  END IF;

  -- Upsert preferences regardless of whether this was a new check-in.
  INSERT INTO public.player_check_in_preferences (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, updated_at)
  VALUES (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches = EXCLUDED.auto_create_matches,
        auto_invite_players = EXCLUDED.auto_invite_players,
        last_frequency_goal = EXCLUDED.last_frequency_goal,
        updated_at = now();

  -- Clear the availability-staleness signal — same write the availability
  -- editor does, kept here for clean side-effect symmetry.
  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  -- Read back the (possibly updated) streak row for the return value.
  SELECT s.current_streak, s.freeze_inventory, s.longest_streak
    INTO v_new_streak, v_new_freezes, v_new_longest
  FROM public.player_streak s
  WHERE s.player_id = v_player_id;

  new_streak := v_new_streak;
  freezes := v_new_freezes;
  longest_streak := v_new_longest;
  milestone_reached := v_milestone;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Atomic weekly check-in. Lazily updates player.timezone from the client-supplied IANA name (Intl.DateTimeFormat) so week math stays anchored to the player''s actual location across travel/relocation. Week boundary is LOCAL to player.timezone.';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- players_needing_streak_reset — used by the compute-streak-reset cron
-- Returns the list of players whose `last_checkin_week_start` is older than
-- their personal "last Monday" (i.e. they missed last week locally).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.players_needing_streak_reset()
RETURNS TABLE (
  player_id                UUID,
  current_streak           SMALLINT,
  freeze_inventory         SMALLINT,
  last_checkin_week_start  DATE,
  player_last_week         DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ps.player_id,
    ps.current_streak,
    ps.freeze_inventory,
    ps.last_checkin_week_start,
    (date_trunc('week', (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC'))) - INTERVAL '7 days')::date
      AS player_last_week
  FROM public.player_streak ps
  JOIN public.player p ON p.id = ps.player_id
  WHERE ps.current_streak > 0
    AND (
      ps.last_checkin_week_start IS NULL
      OR ps.last_checkin_week_start <
         (date_trunc('week', (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC'))) - INTERVAL '7 days')::date
    );
$$;

COMMENT ON FUNCTION public.players_needing_streak_reset() IS
  'Returns players whose streak should be evaluated this tick — i.e. their last check-in is older than last Monday in their LOCAL timezone. Per-row player_last_week is the canonical date to use for the rescue-row insert / week-start advance.';

GRANT EXECUTE ON FUNCTION public.players_needing_streak_reset() TO service_role;

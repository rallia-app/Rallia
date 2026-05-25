-- =============================================================================
-- Fix ambiguous column reference in record_weekly_checkin
--
-- The TZ-aware rewrite of this function (20260525000000) had an inline
-- SELECT that referenced `longest_streak` without a table alias. PL/pgSQL
-- can't disambiguate between the column and the function's RETURNS TABLE
-- output of the same name and raises 42702 at runtime:
--
--   "column reference longest_streak is ambiguous"
--
-- Adds an `s.` table alias to the offending subquery. No behavior change.
-- =============================================================================

DROP FUNCTION IF EXISTS public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT);

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

  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (timezone IS DISTINCT FROM p_timezone);
  END IF;

  v_this_week := public.player_current_week_start(v_player_id);
  v_prev_week := v_this_week - INTERVAL '7 days';

  SELECT 1 INTO v_existing_this_week
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.week_start_date = v_this_week;

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

  IF v_existing_this_week IS NOT NULL THEN
    UPDATE public.player_weekly_checkin
       SET frequency_goal = p_frequency_goal
     WHERE player_id = v_player_id
       AND week_start_date = v_this_week;
  ELSE
    INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_this_week, p_frequency_goal, NULL, FALSE);

    IF v_prev_last_week IS NOT NULL AND v_prev_last_week = v_prev_week THEN
      v_new_streak := v_prev_streak + 1;
    ELSE
      v_new_streak := 1;
    END IF;

    IF v_new_streak > 0 AND v_new_streak % 4 = 0 AND v_prev_freezes < v_freeze_cap THEN
      v_new_freezes := LEAST(v_prev_freezes + 1, v_freeze_cap);
      v_milestone := TRUE;
    ELSE
      v_new_freezes := v_prev_freezes;
    END IF;

    -- AMBIGUITY FIX: alias `player_streak` as `s` so `longest_streak` resolves
    -- unambiguously to the table column (not the RETURNS TABLE output column).
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

  INSERT INTO public.player_check_in_preferences (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, updated_at)
  VALUES (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches = EXCLUDED.auto_create_matches,
        auto_invite_players = EXCLUDED.auto_invite_players,
        last_frequency_goal = EXCLUDED.last_frequency_goal,
        updated_at = now();

  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

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

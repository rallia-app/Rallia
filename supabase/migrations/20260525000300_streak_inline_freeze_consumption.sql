-- =============================================================================
-- Streak + freeze logic — inline freeze consumption on check-in
--
-- Previously the freeze mercy mechanic lived ONLY in the compute-streak-reset
-- cron: if a player missed week W and then checked in week W+1, the RPC's
-- "v_prev_last_week = v_prev_week" check would fail (W ≠ W+1) and the streak
-- would reset to 1, even if the player had a freeze. The cron was supposed
-- to run BEFORE the player got a chance to check in (Monday early-morning
-- local) and rescue them. But with hourly ticks and players opening the app
-- at any time, this race was real — players who checked in before their
-- local cron tick lost streaks they should have kept.
--
-- This migration moves the freeze-consumption logic INTO record_weekly_checkin,
-- so any check-in evaluates the gap and consumes the right number of freezes
-- to preserve the streak. The cron remains the safety net for players who
-- never check in again (their streak still needs to eventually be reset).
--
-- Also splits the milestone semantic into two flags:
--   * milestone_reached — TRUE iff streak hit a 4-week multiple (achievement)
--   * freeze_earned    — TRUE iff freezes incremented this call (capped → FALSE)
-- This lets the UI celebrate the milestone moment even when freezes are
-- already maxed at the cap.
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
  milestone_reached BOOLEAN,
  freeze_earned     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id           UUID := auth.uid();
  v_this_week           DATE;
  v_prev_week           DATE;   -- this_week - 7 days
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
  i                     INT;
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

  -- Idempotency: short-circuit if this player already has a row for this
  -- local week. Update prefs but DON'T re-run streak math.
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
    INSERT INTO public.player_streak (player_id, current_streak, longest_streak, freeze_inventory, freeze_cap, last_checkin_week_start)
    VALUES (v_player_id, 0, 0, 0, 2, NULL);
    v_prev_streak := 0;
    v_prev_freezes := 0;
    v_freeze_cap := 2;
    v_prev_last_week := NULL;
  END IF;

  IF v_existing_this_week IS NOT NULL THEN
    -- Already checked in this week — refresh frequency_goal, skip streak math.
    UPDATE public.player_weekly_checkin
       SET frequency_goal = p_frequency_goal
     WHERE player_id = v_player_id
       AND week_start_date = v_this_week;

    -- Re-read for return values; nothing changed in streak state.
    SELECT s.current_streak, s.freeze_inventory, s.longest_streak
      INTO v_new_streak, v_new_freezes, v_new_longest
    FROM public.player_streak s
    WHERE s.player_id = v_player_id;
  ELSE
    -- New check-in for this week. Insert the row first.
    INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_this_week, p_frequency_goal, NULL, FALSE);

    -- ── Streak math ────────────────────────────────────────────────────────
    -- Compute the gap (in weeks) between the previous check-in and this one.
    --   gap = 0  → previous was last week, continuing the streak
    --   gap > 0  → that many weeks were missed; cover them with freezes if possible
    IF v_prev_last_week IS NULL THEN
      -- First-ever check-in
      v_gap_weeks := 0;
      v_new_streak := 1;
    ELSE
      v_gap_weeks := ((v_this_week - v_prev_last_week) / 7) - 1;

      IF v_gap_weeks < 0 THEN
        -- Shouldn't happen (this_week < last_checkin_week_start would mean
        -- the player checked in for a FUTURE week, which doesn't exist in
        -- our model). Defensive: treat as a fresh start.
        v_gap_weeks := 0;
        v_new_streak := 1;
      ELSIF v_gap_weeks = 0 THEN
        -- Continuing streak — previous check-in was last week
        v_new_streak := v_prev_streak + 1;
      ELSIF v_gap_weeks <= v_prev_freezes THEN
        -- Enough freezes to cover the gap — consume them, preserve streak
        v_freezes_to_consume := v_gap_weeks;
        v_new_streak := v_prev_streak + 1;

        -- Insert one synthetic rescue row per missed week. Same shape as the
        -- cron's rescue row (frequency_goal=NULL, freeze_consumed=TRUE).
        -- ON CONFLICT DO NOTHING in case the cron already filled one in.
        FOR i IN 1..v_freezes_to_consume LOOP
          INSERT INTO public.player_weekly_checkin (player_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
          VALUES (v_player_id, v_prev_last_week + (i * INTERVAL '7 days'), NULL, NULL, TRUE)
          ON CONFLICT (player_id, week_start_date) DO NOTHING;
        END LOOP;
      ELSE
        -- Not enough freezes — streak breaks. We do NOT consume the freezes
        -- the player has; a partial rescue doesn't make sense ("I lost the
        -- streak AND lost my freezes" is worse UX). Leave freezes intact so
        -- the player starts the next streak with their existing reserve.
        v_gap_weeks := 0; -- (cosmetic; we don't insert any rescue rows)
        v_new_streak := 1;
      END IF;
    END IF;

    -- Apply freeze consumption from inline rescue (if any)
    v_new_freezes := v_prev_freezes - v_freezes_to_consume;

    -- ── Milestone + freeze earning ─────────────────────────────────────────
    -- Milestone = streak landed on a 4-week multiple. Separate from whether
    -- a freeze was actually earned (which depends on the cap).
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

  -- Preferences upsert (regardless of new vs idempotent check-in)
  INSERT INTO public.player_check_in_preferences (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, updated_at)
  VALUES (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches = EXCLUDED.auto_create_matches,
        auto_invite_players = EXCLUDED.auto_invite_players,
        last_frequency_goal = EXCLUDED.last_frequency_goal,
        updated_at = now();

  -- Refresh availability staleness signal
  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  new_streak := v_new_streak;
  freezes := v_new_freezes;
  longest_streak := v_new_longest;
  milestone_reached := v_milestone;
  freeze_earned := v_freeze_earned;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) IS
  'Atomic weekly check-in with inline freeze consumption. Detects week-gaps since last check-in and consumes freezes to bridge them (Option-C mercy mechanic). Returns milestone_reached (streak hit 4-week multiple) and freeze_earned (incremented inventory; FALSE when capped) separately.';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT) TO authenticated;

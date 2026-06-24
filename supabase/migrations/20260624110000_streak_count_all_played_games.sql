-- =============================================================================
-- Streak: count every FULL game played, trusting attendance by default
--
-- Originally a game only counted toward the weekly-goal streak if the player
-- geo-checked-in at the court (match_participant.checked_in_at). Players asked
-- for that gate to go away. The rule is now:
--
--   A game counts for a player iff they were a joined participant, the game
--   wasn't cancelled, it already happened, it FILLED (2 joined players for
--   singles, 4 for doubles), AND its attendance isn't disputed — i.e. the
--   player checked in, OR no opponent filed a no-show report against them
--   (a match_feedback row with opponent_id = the player and showed_up = false).
--
-- So players are trusted to have shown up by default; checking in is only NEEDED
-- to rescue a game where an opponent reported them as a no-show. Check-in is
-- otherwise an optional feature.
--
-- Pieces:
--   1. count_player_sessions_for_week() — the single source of truth the
--      evaluator counts against, encoding the rule above.
--   2. Backfill — replay evaluate_weekly_goals() over each player's already-
--      evaluated weeks with the new counts, so past streaks pick up the full
--      games that were previously dropped. Snapshotted and clamped UP, so the
--      backfill can only ever raise a player's streak/longest/freezes vs what
--      they already had, never lower it. Only the post-rework era (weeks the
--      evaluator already judged) is replayed — pre-rework weeks are untouched.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Qualifying-game counter. A game counts iff: joined participant, in the
--    week, in the past, not cancelled, it FILLED (2 singles / 4 doubles), and
--    attendance isn't disputed — the player checked in, OR no opponent filed a
--    no-show report against them. (Was: + checked_in_at IS NOT NULL required.)
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
    AND m.cancelled_at IS NULL
    AND m.match_date >= p_week_start
    AND m.match_date <  p_week_start + 7
    AND ((m.match_date + COALESCE(m.end_time, time '23:59:59'))
           AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC')) < now()
    -- The game must have FILLED: 2 joined players for singles, 4 for doubles.
    AND (
      SELECT count(*)
      FROM public.match_participant mpf
      WHERE mpf.match_id = m.id
        AND mpf.status = 'joined'
    ) >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    -- Attendance: trusted by default. An opponent's no-show report disqualifies
    -- the game UNLESS the player checked in to prove they were there.
    AND (
      mp.checked_in_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.match_feedback mf
        WHERE mf.match_id = m.id
          AND mf.opponent_id = p_player_id
          AND mf.showed_up = false
      )
    );
$$;

COMMENT ON FUNCTION public.count_player_sessions_for_week(uuid, date) IS
  'Number of qualifying games for the player in the given ISO week: joined '
  'participant + in the past + not cancelled + the game FILLED (2 joined for '
  'singles, 4 for doubles) + attendance not disputed (the player checked in, or '
  'no opponent filed a match_feedback no-show report against them).';


-- -----------------------------------------------------------------------------
-- 2. Backfill past streaks with the new counts.
--    Replay the existing week-end evaluator over each player's already-evaluated
--    weeks. sessions_played IS NOT NULL marks the weeks the evaluator already
--    judged (the post-rework era), so anchoring there never reaches back into
--    pre-rework weeks. Snapshot first, then clamp UP — do-no-harm guarantee.
-- -----------------------------------------------------------------------------
DO $backfill$
BEGIN
  -- Snapshot current values so we can clamp afterwards.
  CREATE TEMP TABLE _streak_before ON COMMIT DROP AS
    SELECT player_id, current_streak, longest_streak, freeze_inventory
    FROM public.player_streak;

  -- Clear freeze rescue marks on the weeks we're about to re-judge; the replay
  -- re-sets them only where a freeze is actually consumed under the new counts
  -- (a week that flips from a rescued miss to a clean hit should drop the ❄️).
  UPDATE public.player_weekly_checkin
     SET freeze_used = FALSE
   WHERE sessions_played IS NOT NULL;

  -- Rewind each evaluated player's watermark to just before their earliest
  -- evaluated week and reset the running counters; longest is kept (the
  -- evaluator only GREATESTs it upward). Players with no evaluated week yet are
  -- left for the hourly cron to judge with the new counter going forward.
  UPDATE public.player_streak ps
     SET current_streak            = 0,
         freeze_inventory          = 0,
         last_evaluated_week_start = e.first_eval_week - 7,
         updated_at                = now()
    FROM (
      SELECT player_id, MIN(week_start_date) AS first_eval_week
      FROM public.player_weekly_checkin
      WHERE sessions_played IS NOT NULL
      GROUP BY player_id
    ) e
   WHERE ps.player_id = e.player_id;

  -- Replay every completed evaluated week forward with the new counts.
  PERFORM public.evaluate_weekly_goals();

  -- Clamp UP: the backfill must never reduce a player's streak/longest/freezes.
  UPDATE public.player_streak ps
     SET current_streak   = GREATEST(ps.current_streak,   b.current_streak),
         longest_streak   = GREATEST(ps.longest_streak,   b.longest_streak),
         freeze_inventory = GREATEST(ps.freeze_inventory, b.freeze_inventory),
         updated_at       = now()
    FROM _streak_before b
   WHERE ps.player_id = b.player_id;
END
$backfill$;

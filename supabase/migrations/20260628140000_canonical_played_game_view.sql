-- =============================================================================
-- Canonical "played game" definition
--
-- The rule for "this game counts as actually played, for this player" lived
-- inlined inside count_player_sessions_for_week() (the weekly-streak counter).
-- The leaderboard needs the exact same rule, so this extracts it into ONE
-- reusable primitive — the qualifying_played_game view — and refactors the
-- streak counter to select from it. Any future consumer (leaderboards, stats,
-- analytics) reads this view instead of re-deriving the predicate, so the
-- definition can never drift between features.
--
-- The rule (unchanged from 20260624110000): a game counts for a player iff they
-- were a joined participant, the game wasn't cancelled, it already finished, it
-- FILLED (2 joined for singles, 4 for doubles), AND attendance isn't disputed —
-- the player checked in, OR no opponent filed a no-show report against them.
--
-- The streak refactor is behavior-preserving: the view reproduces the predicate
-- verbatim; the counter just adds the same week-window filter it always had.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The canonical view: one row per (player, game) that qualifies as played.
--    security_invoker = false → evaluates with the view owner's rights, matching
--    the SECURITY DEFINER context its consumers already run in. Kept OFF the Data
--    API (revoked from anon/authenticated); only SECURITY DEFINER functions read
--    it, so it never leaks other players' games to a client.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.qualifying_played_game
WITH (security_invoker = false) AS
SELECT
  mp.player_id,
  m.id          AS match_id,
  m.match_date,
  m.format,
  m.sport_id,
  m.facility_id,
  mp.team_number,
  mp.score
FROM public.match_participant mp
JOIN public.match m ON m.id = mp.match_id
WHERE mp.status = 'joined'
  AND m.cancelled_at IS NULL
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
        AND mf.opponent_id = mp.player_id
        AND mf.showed_up = false
    )
  );

REVOKE ALL ON public.qualifying_played_game FROM anon, authenticated;

COMMENT ON VIEW public.qualifying_played_game IS
  'Canonical "played game" definition. One row per (player, game) that counts as '
  'actually played: joined participant + not cancelled + already finished + the '
  'game FILLED (2 joined singles / 4 doubles) + attendance not disputed (player '
  'checked in, or no opponent no-show report). Single source of truth shared by '
  'count_player_sessions_for_week (weekly streak) and the leaderboard. Internal: '
  'kept off the Data API and read only by SECURITY DEFINER functions.';


-- -----------------------------------------------------------------------------
-- 2. Refactor the streak counter onto the view. Same result as before — joined
--    + past + not cancelled + filled + attendance-ok now live in the view; the
--    counter only contributes the ISO-week window it always applied.
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
  FROM public.qualifying_played_game q
  WHERE q.player_id = p_player_id
    AND q.match_date >= p_week_start
    AND q.match_date <  p_week_start + 7;
$$;

COMMENT ON FUNCTION public.count_player_sessions_for_week(uuid, date) IS
  'Number of qualifying games for the player in the given ISO week. Thin wrapper '
  'over the canonical qualifying_played_game view + a week-window filter.';

GRANT EXECUTE ON FUNCTION public.count_player_sessions_for_week(uuid, date)
  TO authenticated, service_role;

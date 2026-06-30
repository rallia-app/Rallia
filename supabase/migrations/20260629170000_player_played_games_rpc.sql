-- =============================================================================
-- PlayerProfile stats on the canonical "played game" definition
--
-- The Hours Played / Games Hosted / Week Streak stats on the player profile used
-- to inline their own "played" predicate (status='joined' + closed_at set + not
-- cancelled + showed_up != false), which had drifted from the rule used by the
-- weekly streak and the leaderboard (the qualifying_played_game view: joined +
-- not cancelled + already finished + FILLED + attendance not disputed).
--
-- This RPC returns the player's qualifying games straight from that canonical
-- view, joined to match for the duration + host fields the screen aggregates.
-- The "played" rule now lives in exactly one place; the screen only does generic
-- math (sum durations, count hosted, walk weeks) over the canonical set.
--
-- SECURITY DEFINER so it can read qualifying_played_game (kept off the Data API),
-- exactly like count_player_sessions_for_week. Scope is a single player's games —
-- the same data the profile's Game History section already exposes publicly.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_player_played_games(p_player_id uuid)
RETURNS TABLE (
  match_date date,
  duration public.match_duration_enum,
  custom_duration_minutes integer,
  created_by uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.match_date, m.duration, m.custom_duration_minutes, m.created_by
  FROM public.qualifying_played_game q
  JOIN public.match m ON m.id = q.match_id
  WHERE q.player_id = p_player_id;
$$;

COMMENT ON FUNCTION public.get_player_played_games(uuid) IS
  'Qualifying played games for a player (canonical qualifying_played_game view) '
  'joined to match for duration + host, powering PlayerProfile''s Hours Played / '
  'Games Hosted / Week Streak so those stats use the same "played" rule as the '
  'weekly streak and leaderboard.';

GRANT EXECUTE ON FUNCTION public.get_player_played_games(uuid) TO authenticated, service_role;

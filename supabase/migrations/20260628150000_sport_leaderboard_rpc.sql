-- =============================================================================
-- v1 GMA per-sport leaderboard (engagement gamification)
--
-- A monthly, GMA-wide leaderboard PER SPORT (tennis + pickleball, and any future
-- sport) that rewards playing games. Reads the canonical qualifying_played_game
-- view (same "played" rule as the weekly streak — see 20260628140000) so the two
-- can never drift.
--
-- Scoring is participation-weighted on purpose: the bottleneck is getting people
-- to play, not crowning the best player.
--   points = games * GAME_POINTS (10) + wins * WIN_BONUS (5)
-- A loss still earns 10 and a win 15, so a grinder who plays a lot outranks a
-- strong player who sits idle — exactly the incentive we want.
--
-- Win = a non-disputed match_result whose winning_team is the player's team
-- (so both players on a winning doubles pair get the bonus). Most games have no
-- recorded result yet, so the win bonus also nudges players to enter scores.
--
-- v1 scope: per-sport (caller passes the sport), all GMA regions counted, no
-- rating tiers. Season = calendar month in America/Toronto.
--
-- Pieces:
--   1. sport_ranked_board()       — internal: the full ranked board for one
--                                    sport+month. Single place the points/rank
--                                    formula lives.
--   2. get_sport_leaderboard()    — paginated slice (limit/offset) for the
--                                    infinite-scroll list, with display fields.
--   3. get_my_sport_rank()        — the caller's own rank, so the "your rank"
--                                    card stays correct no matter how far the
--                                    list is paged.
-- =============================================================================

-- Earlier tennis-specific / pre-pagination signatures (superseded by the
-- sport-parameterized functions below). No-ops on a fresh database.
DROP FUNCTION IF EXISTS public.get_tennis_leaderboard(date, integer);
DROP FUNCTION IF EXISTS public.get_tennis_leaderboard(date, integer, integer);
DROP FUNCTION IF EXISTS public.get_my_tennis_rank(date);
DROP FUNCTION IF EXISTS public.tennis_ranked_board(date);


-- -----------------------------------------------------------------------------
-- 1. Internal ranked board — one row per player for the sport+month, ranked by
--    points. rank() is a window over the whole set, so it stays global when the
--    public RPCs slice it with LIMIT/OFFSET. Kept off the Data API; only the
--    SECURITY DEFINER RPCs below read it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sport_ranked_board(p_sport_id uuid, p_month date)
RETURNS TABLE (
  player_id uuid,
  rank      integer,
  games     integer,
  wins      integer,
  points    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH played AS (
    SELECT q.player_id, q.match_id, q.team_number
    FROM public.qualifying_played_game q
    WHERE q.sport_id = p_sport_id
      AND q.match_date >= p_month
      AND q.match_date <  (p_month + interval '1 month')::date
  ),
  scored AS (
    SELECT
      pd.player_id,
      count(*)::int AS games,
      count(*) FILTER (
        WHERE r.winning_team IS NOT NULL
          AND r.winning_team = pd.team_number
          AND COALESCE(r.disputed, false) = false
      )::int AS wins
    FROM played pd
    LEFT JOIN public.match_result r ON r.match_id = pd.match_id
    GROUP BY pd.player_id
  )
  SELECT
    s.player_id,
    rank() OVER (ORDER BY (s.games * 10 + s.wins * 5) DESC, s.games DESC, s.player_id)::int AS rank,
    s.games,
    s.wins,
    (s.games * 10 + s.wins * 5) AS points
  FROM scored s;
$$;

REVOKE ALL ON FUNCTION public.sport_ranked_board(uuid, date) FROM anon, authenticated;

COMMENT ON FUNCTION public.sport_ranked_board(uuid, date) IS
  'Internal: full ranked GMA board for p_sport_id in the calendar month '
  'containing p_month (one row per player, points=games*10+wins*5). Single source '
  'of the points/rank formula; read only by get_sport_leaderboard / get_my_sport_rank.';


-- -----------------------------------------------------------------------------
-- 2. Paginated leaderboard slice with display fields (for infinite scroll).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sport_leaderboard(
  p_sport_id uuid,
  p_month    date    DEFAULT date_trunc('month', (now() AT TIME ZONE 'America/Toronto'))::date,
  p_limit    integer DEFAULT 25,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  rank         integer,
  player_id    uuid,
  display_name text,
  avatar_url   text,
  games        integer,
  wins         integer,
  points       integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.rank,
    b.player_id,
    COALESCE(
      NULLIF(trim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
      pr.display_name,
      'Player'
    ) AS display_name,
    pr.profile_picture_url AS avatar_url,
    b.games,
    b.wins,
    b.points
  FROM public.sport_ranked_board(p_sport_id, p_month) b
  JOIN public.profile pr ON pr.id = b.player_id
  ORDER BY b.points DESC, b.games DESC, b.player_id
  LIMIT p_limit OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_sport_leaderboard(uuid, date, integer, integer) IS
  'Monthly GMA leaderboard for p_sport_id, paginated. Calendar month containing '
  'p_month (default: current month, America/Toronto). Returns p_limit rows from '
  'p_offset, ranked by points = games*10 + wins*5 over qualifying_played_game.';

GRANT EXECUTE ON FUNCTION public.get_sport_leaderboard(uuid, date, integer, integer) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. The caller's own rank for the sport+month — powers the pinned "your rank"
--    card independently of which pages the list has loaded. Empty if no games.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_sport_rank(
  p_sport_id uuid,
  p_month    date DEFAULT date_trunc('month', (now() AT TIME ZONE 'America/Toronto'))::date
)
RETURNS TABLE (
  rank   integer,
  games  integer,
  wins   integer,
  points integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.rank, b.games, b.wins, b.points
  FROM public.sport_ranked_board(p_sport_id, p_month) b
  WHERE b.player_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_sport_rank(uuid, date) IS
  'The calling player''s own rank/points on the monthly GMA board for p_sport_id, '
  'so the "your rank" card stays correct regardless of leaderboard pagination.';

GRANT EXECUTE ON FUNCTION public.get_my_sport_rank(uuid, date) TO authenticated;

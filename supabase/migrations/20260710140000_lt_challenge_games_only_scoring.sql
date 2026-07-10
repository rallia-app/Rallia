-- Monthly challenge: rank by games played only (no win bonus).
-- Drops wins/points from the RPC surface — games is the single score.

DROP FUNCTION IF EXISTS public.get_sport_leaderboard(uuid, date, integer, integer);
DROP FUNCTION IF EXISTS public.get_my_sport_rank(uuid, date);
DROP FUNCTION IF EXISTS public.sport_ranked_board(uuid, date);

CREATE OR REPLACE FUNCTION public.sport_ranked_board(p_sport_id uuid, p_month date)
RETURNS TABLE (
  player_id uuid,
  rank      integer,
  games     integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scored AS (
    SELECT
      q.player_id,
      count(*)::int AS games
    FROM public.qualifying_played_game q
    WHERE q.sport_id = p_sport_id
      AND q.match_date >= p_month
      AND q.match_date < (p_month + interval '1 month')::date
    GROUP BY q.player_id
  )
  SELECT
    s.player_id,
    rank() OVER (ORDER BY s.games DESC, s.player_id)::int AS rank,
    s.games
  FROM scored s;
$$;

REVOKE ALL ON FUNCTION public.sport_ranked_board(uuid, date) FROM anon, authenticated;

COMMENT ON FUNCTION public.sport_ranked_board(uuid, date) IS
  'Internal: full ranked GMA board for p_sport_id in the calendar month '
  'containing p_month (one row per player, ranked by games played).';

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
  games        integer
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
    b.games
  FROM public.sport_ranked_board(p_sport_id, p_month) b
  JOIN public.profile pr ON pr.id = b.player_id
  ORDER BY b.games DESC, b.player_id
  LIMIT p_limit OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_sport_leaderboard(uuid, date, integer, integer) IS
  'Monthly GMA challenge for p_sport_id, paginated. Calendar month containing '
  'p_month (default: current month, America/Toronto). Ranked by games played '
  'over qualifying_played_game.';

GRANT EXECUTE ON FUNCTION public.get_sport_leaderboard(uuid, date, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_sport_rank(
  p_sport_id uuid,
  p_month    date DEFAULT date_trunc('month', (now() AT TIME ZONE 'America/Toronto'))::date
)
RETURNS TABLE (
  rank  integer,
  games integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.rank, b.games
  FROM public.sport_ranked_board(p_sport_id, p_month) b
  WHERE b.player_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_sport_rank(uuid, date) IS
  'The calling player''s own rank/games on the monthly GMA challenge for p_sport_id.';

GRANT EXECUTE ON FUNCTION public.get_my_sport_rank(uuid, date) TO authenticated;

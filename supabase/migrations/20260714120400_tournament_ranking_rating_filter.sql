-- ============================================
-- Circuit Rallia — exact-rating filter on the board
-- ============================================
-- Alongside the level filter (bucket of the latest result), the board gains an
-- optional EXACT-rating view: players whose CURRENT active rating for the
-- sport resolves to a given rating_score (compared by id — the canonical
-- rating read path; never by re-derived value). Both filters select PLAYERS;
-- all of a kept player's season rows still count toward best-8.
--
-- Note the deliberate semantic difference: level filter = snapshot on the
-- latest result (matches the board's own data); rating filter = live active
-- rating (exact ratings aren't snapshotted in the ledger).
--
-- Signature changes → DROP + CREATE both functions.
-- ============================================

DROP FUNCTION IF EXISTS public.get_tournament_leaderboard(uuid, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.tournament_ranked_board(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.tournament_ranked_board(
    p_sport_id        uuid,
    p_season_id       uuid,
    p_level_filter    text DEFAULT NULL,
    p_rating_score_id uuid DEFAULT NULL
)
RETURNS TABLE (
    rank          integer,
    user_id       uuid,
    points        integer,
    events_played integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH player_bucket AS (
        SELECT DISTINCT ON (trp.user_id)
               trp.user_id, trp.level_bucket AS latest_bucket
          FROM tournament_ranking_points trp
         WHERE trp.sport_id  = p_sport_id
           AND trp.season_id = p_season_id
         ORDER BY trp.user_id, trp.computed_at DESC, trp.id DESC
    ),
    eligible AS (
        SELECT pb.user_id
          FROM player_bucket pb
         WHERE (p_level_filter IS NULL OR pb.latest_bucket = p_level_filter)
           AND (p_rating_score_id IS NULL OR EXISTS (
                SELECT 1
                  FROM player_sport ps
                  JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
                 WHERE ps.player_id        = pb.user_id
                   AND ps.sport_id         = p_sport_id
                   AND prs.rating_score_id = p_rating_score_id
           ))
    ),
    ranked AS (
        SELECT trp.user_id,
               trp.points,
               row_number() OVER (PARTITION BY trp.user_id
                                  ORDER BY trp.points DESC, trp.id) AS rn,
               count(*)     OVER (PARTITION BY trp.user_id)         AS events_played
          FROM tournament_ranking_points trp
          JOIN eligible e ON e.user_id = trp.user_id
         WHERE trp.sport_id  = p_sport_id
           AND trp.season_id = p_season_id
    ),
    agg AS (
        SELECT user_id,
               sum(points) FILTER (WHERE rn <= 8)::int AS points,
               max(events_played)::int                 AS events_played
          FROM ranked
         GROUP BY user_id
    )
    SELECT
        rank() OVER (ORDER BY points DESC, events_played ASC, user_id)::int AS rank,
        user_id,
        points,
        events_played
      FROM agg;
$$;

REVOKE ALL ON FUNCTION public.tournament_ranked_board(uuid, uuid, text, uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public.tournament_ranked_board(uuid, uuid, text, uuid) IS
  'Internal: full ranked Circuit-Rallia board for (sport, season). points = '
  'best-8 sum. level_filter selects players by latest-result bucket; '
  'rating_score_id selects players by CURRENT active rating (by id). Off the '
  'Data API — read only by the get_* wrappers.';


CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(
    p_sport_id        uuid,
    p_season_code     text    DEFAULT NULL,
    p_level_filter    text    DEFAULT NULL,
    p_rating_score_id uuid    DEFAULT NULL,
    p_limit           integer DEFAULT 25,
    p_offset          integer DEFAULT 0
)
RETURNS TABLE (
    rank          integer,
    user_id       uuid,
    full_name     text,
    avatar_url    text,
    points        integer,
    events_played integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH season AS (
        SELECT id
          FROM ranking_season
         WHERE (p_season_code IS NOT NULL AND code = p_season_code)
            OR (p_season_code IS NULL AND now() >= starts_at AND now() < ends_at)
         LIMIT 1
    )
    SELECT
        b.rank,
        b.user_id,
        COALESCE(
            NULLIF(trim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), ''),
            pr.display_name,
            'Player'
        ) AS full_name,
        pr.profile_picture_url AS avatar_url,
        b.points,
        b.events_played
      FROM season s
      CROSS JOIN LATERAL public.tournament_ranked_board(p_sport_id, s.id, p_level_filter, p_rating_score_id) b
      JOIN public.profile pr ON pr.id = b.user_id
     ORDER BY b.rank
     LIMIT p_limit OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer) IS
  'Paginated Circuit-Rallia board for a sport + season (default: current). '
  'p_level_filter = my-level view (latest-result bucket); p_rating_score_id = '
  'exact-rating view (current active rating, by id).';

GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer) TO authenticated;

-- ============================================
-- Tournament ranking ("Points Rallia") — read path
-- ============================================
-- Spec: specs/tournament-ranking/README.md (rev 4) §8.
--
--   tournament_ranked_board(sport, season, level_filter)  internal, REVOKEd —
--       the single home of the best-8 + ordering + level-filter formula.
--   get_tournament_leaderboard(...)   paginated board with profile display.
--   get_my_tournament_ranking(...)    caller's own standing per sport board.
--
-- best-8: a player's board points = sum of their 8 highest-point results in the
-- season (every result stays in the ledger; the cap is applied here at read).
-- level filter: selects PLAYERS by their most-recent ledger row's bucket (all
-- of a kept player's rows still count toward best-8); unrated players carry no
-- bucket and drop out of any filtered view.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_ranked_board(
    p_sport_id     uuid,
    p_season_id    uuid,
    p_level_filter text DEFAULT NULL
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
        -- Each player's level = the bucket on their most recent result.
        SELECT DISTINCT ON (trp.user_id)
               trp.user_id, trp.level_bucket AS latest_bucket
          FROM tournament_ranking_points trp
         WHERE trp.sport_id  = p_sport_id
           AND trp.season_id = p_season_id
         ORDER BY trp.user_id, trp.computed_at DESC, trp.id DESC
    ),
    eligible AS (
        SELECT user_id
          FROM player_bucket
         WHERE p_level_filter IS NULL
            OR latest_bucket = p_level_filter
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

REVOKE ALL ON FUNCTION public.tournament_ranked_board(uuid, uuid, text) FROM anon, authenticated;

COMMENT ON FUNCTION public.tournament_ranked_board(uuid, uuid, text) IS
  'Internal: full ranked Points-Rallia board for (sport, season). points = '
  'best-8 sum; level_filter selects players by their latest bucket. Off the '
  'Data API — read only by the get_* wrappers.';


CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(
    p_sport_id     uuid,
    p_season_code  text    DEFAULT NULL,
    p_level_filter text    DEFAULT NULL,
    p_limit        integer DEFAULT 25,
    p_offset       integer DEFAULT 0
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
      CROSS JOIN LATERAL public.tournament_ranked_board(p_sport_id, s.id, p_level_filter) b
      JOIN public.profile pr ON pr.id = b.user_id
     ORDER BY b.rank
     LIMIT p_limit OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, integer, integer) IS
  'Paginated Points-Rallia board for a sport + season (default: current '
  'season). p_level_filter NULL = common board; beginner|intermediate|advanced '
  'for the my-level view.';

GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, integer, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_my_tournament_ranking(
    p_season_code text DEFAULT NULL
)
RETURNS TABLE (
    sport_id      uuid,
    rank          integer,
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
    ),
    my_sports AS (
        SELECT DISTINCT trp.sport_id
          FROM tournament_ranking_points trp, season s
         WHERE trp.user_id   = auth.uid()
           AND trp.season_id = s.id
    )
    SELECT ms.sport_id, b.rank, b.points, b.events_played
      FROM my_sports ms
      CROSS JOIN season s
      CROSS JOIN LATERAL public.tournament_ranked_board(ms.sport_id, s.id, NULL) b
     WHERE b.user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_tournament_ranking(text) IS
  'The calling player''s own rank/points on the common (unfiltered) board for '
  'each sport they appear on, in the given season (default: current).';

GRANT EXECUTE ON FUNCTION public.get_my_tournament_ranking(text) TO authenticated;

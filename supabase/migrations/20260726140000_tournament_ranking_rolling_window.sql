-- ============================================================================
-- Circuit Rallia — rolling 52-week board (seasons become an archive)
-- ============================================================================
-- The board was a hard semi-annual reset: every Apr 1 and Oct 1 every player
-- dropped to zero. On a base this thin that means a dead board for weeks, and
-- a player who entered two tournaments in a season watched both evaporate
-- having never held a meaningful rank.
--
-- This is what the ATP rankings actually do: a rolling 52-week window, no
-- reset, results ageing out one at a time. (The semi-annual reset is the
-- *Race*, a separate board whose job is qualification, not ranking.)
--
-- Mechanism: `p_season_id IS NULL` now means ROLLING, not "no board". The
-- wrappers pass NULL when no season code is given, so the default flips to
-- rolling and passing an explicit code still returns that season's final
-- standings for the archive view.
--
-- Deliberately NOT a signature change on any of the three functions — adding a
-- trailing DEFAULT parameter would create a second overload and make existing
-- calls ambiguous. Every existing caller keeps working untouched.
--
-- Expiry is evaluated at READ time: no cron, no expiry sweep, no rewriting of
-- ledger rows.
-- ============================================================================

-- Single home for the window length.
CREATE OR REPLACE FUNCTION public.lt_ranking_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '52 weeks'; $$;

COMMENT ON FUNCTION public.lt_ranking_window() IS
  'How long a Circuit Rallia result counts. 52 weeks, ATP-style. Change here '
  'and the board, the wrappers and any future points-to-defend view follow.';

GRANT EXECUTE ON FUNCTION public.lt_ranking_window() TO authenticated, service_role;


-- --------------------------------------------
-- Board — season-scoped OR rolling
-- --------------------------------------------
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
    WITH eligible AS (
        -- Both filters resolve off the player's CURRENT active rating for the
        -- sport. Unrated players have a NULL bucket / rating → excluded from
        -- any filtered view, kept on the common board (both params NULL).
        SELECT DISTINCT trp.user_id
          FROM tournament_ranking_points trp
          LEFT JOIN player_sport ps
                 ON ps.player_id = trp.user_id AND ps.sport_id = p_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs         ON rs.id  = prs.rating_score_id
         WHERE trp.sport_id = p_sport_id
           AND CASE WHEN p_season_id IS NULL
                    THEN trp.earned_at > now() - public.lt_ranking_window()
                    ELSE trp.season_id = p_season_id
               END
           AND (p_level_filter IS NULL
                OR public.lt_rating_skill_bucket(rs.skill_level) = p_level_filter)
           AND (p_rating_score_id IS NULL
                OR prs.rating_score_id = p_rating_score_id)
    ),
    ranked AS (
        SELECT trp.user_id,
               trp.points,
               row_number() OVER (PARTITION BY trp.user_id
                                  ORDER BY trp.points DESC, trp.id) AS rn,
               count(*)     OVER (PARTITION BY trp.user_id)         AS events_played
          FROM tournament_ranking_points trp
          JOIN eligible e ON e.user_id = trp.user_id
         WHERE trp.sport_id = p_sport_id
           AND CASE WHEN p_season_id IS NULL
                    THEN trp.earned_at > now() - public.lt_ranking_window()
                    ELSE trp.season_id = p_season_id
               END
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

COMMENT ON FUNCTION public.tournament_ranked_board(uuid, uuid, text, uuid) IS
  'Internal: full ranked Circuit-Rallia board for a sport. p_season_id NULL = '
  'the live ROLLING window (results from the last lt_ranking_window()); a '
  'season id = that season''s archived standings. points = best-8 sum within '
  'the chosen window. Both level_filter (bucket) and rating_score_id select '
  'players by their CURRENT active rating for the sport — same axis, so '
  'rating ⊆ level. Off the Data API — read only by the get_* wrappers.';


-- --------------------------------------------
-- Leaderboard wrapper — NULL season code = rolling
-- --------------------------------------------
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
         WHERE p_season_code IS NOT NULL
           AND code = p_season_code
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
      FROM public.tournament_ranked_board(
               p_sport_id, (SELECT id FROM season), p_level_filter, p_rating_score_id) b
      JOIN public.profile pr ON pr.id = b.user_id
     ORDER BY b.rank
     LIMIT p_limit OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer) IS
  'Paginated Circuit-Rallia board for a sport. p_season_code NULL (default) = '
  'the live rolling 52-week board; a season code = that season''s archived '
  'standings. p_level_filter = my-level view, p_rating_score_id = exact-rating '
  'view, both off the player''s current active rating. A code matching no '
  'season falls back to rolling.';

GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer) TO authenticated;


-- --------------------------------------------
-- My-ranking wrapper — NULL season code = rolling
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_tournament_ranking(
    p_season_code text DEFAULT NULL
)
RETURNS TABLE (
    sport_id      uuid,
    rank          integer,
    points        integer,
    events_played integer,
    level_bucket  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH season AS (
        SELECT id
          FROM ranking_season
         WHERE p_season_code IS NOT NULL
           AND code = p_season_code
         LIMIT 1
    ),
    my_sports AS (
        -- Same window the board will use, so a sport can never appear here
        -- with the caller absent from its board.
        SELECT DISTINCT trp.sport_id
          FROM tournament_ranking_points trp
         WHERE trp.user_id = auth.uid()
           AND CASE WHEN (SELECT id FROM season) IS NULL
                    THEN trp.earned_at > now() - public.lt_ranking_window()
                    ELSE trp.season_id = (SELECT id FROM season)
               END
    ),
    my_bucket AS (
        -- Same rule as the board's level filter: the caller's CURRENT active
        -- rating, per sport (so the "my level" chip matches what it filters).
        SELECT ps.sport_id,
               public.lt_rating_skill_bucket(rs.skill_level) AS level_bucket
          FROM player_sport ps
          JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          JOIN rating_score rs         ON rs.id  = prs.rating_score_id
         WHERE ps.player_id = auth.uid()
    )
    SELECT ms.sport_id, b.rank, b.points, b.events_played, mb.level_bucket
      FROM my_sports ms
      CROSS JOIN LATERAL public.tournament_ranked_board(
                             ms.sport_id, (SELECT id FROM season), NULL) b
      LEFT JOIN my_bucket mb ON mb.sport_id = ms.sport_id
     WHERE b.user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_tournament_ranking(text) IS
  'The calling player''s own rank/points on the common (unfiltered) board for '
  'each sport they appear on, plus their level bucket (CURRENT active rating — '
  'drives the "my level" filter). p_season_code NULL (default) = the live '
  'rolling 52-week board; a season code = that season''s archived standings.';

GRANT EXECUTE ON FUNCTION public.get_my_tournament_ranking(text) TO authenticated;

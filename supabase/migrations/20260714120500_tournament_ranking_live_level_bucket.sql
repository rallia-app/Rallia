-- ============================================
-- Circuit Rallia — level filter uses LIVE rating, not the ledger snapshot
-- ============================================
-- The board had two filters on different axes: "my level" compared the bucket
-- SNAPSHOTTED on each player's latest result, while "my rating" compared the
-- CURRENT active rating. Result: the exact-rating set wasn't a subset of the
-- level set, so a player could rank better filtered to their level than to
-- their (narrower) exact rating — nonsensical. It also let a player's own two
-- chips disagree (snapshot beginner vs live intermediate).
--
-- Fix: derive the level bucket from the CURRENT active rating for both filters.
-- Now bucket and rating share one axis — everyone with your exact rating has
-- your bucket, so exact-rating ⊆ level, and your rating rank can never be worse
-- than your level rank. The `level_bucket` column stays in the ledger for
-- history/analytics; it just no longer drives the filter.
--
-- Signatures unchanged → CREATE OR REPLACE (no drops; get_tournament_leaderboard
-- keeps calling tournament_ranked_board unchanged).
-- ============================================

-- Shared skill_level → bucket mapping (professional folds into advanced).
CREATE OR REPLACE FUNCTION public.lt_rating_skill_bucket(p_skill_level public.skill_level)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_skill_level
        WHEN 'professional' THEN 'advanced'
        WHEN 'advanced'     THEN 'advanced'
        WHEN 'intermediate' THEN 'intermediate'
        WHEN 'beginner'     THEN 'beginner'
        ELSE NULL
    END;
$$;


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
         WHERE trp.sport_id  = p_sport_id
           AND trp.season_id = p_season_id
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

COMMENT ON FUNCTION public.tournament_ranked_board(uuid, uuid, text, uuid) IS
  'Internal: full ranked Circuit-Rallia board for (sport, season). points = '
  'best-8 sum. Both level_filter (bucket) and rating_score_id select players by '
  'their CURRENT active rating for the sport — same axis, so rating ⊆ level. '
  'Off the Data API — read only by the get_* wrappers.';


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
         WHERE (p_season_code IS NOT NULL AND code = p_season_code)
            OR (p_season_code IS NULL AND now() >= starts_at AND now() < ends_at)
         LIMIT 1
    ),
    my_sports AS (
        SELECT DISTINCT trp.sport_id
          FROM tournament_ranking_points trp, season s
         WHERE trp.user_id   = auth.uid()
           AND trp.season_id = s.id
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
      CROSS JOIN season s
      CROSS JOIN LATERAL public.tournament_ranked_board(ms.sport_id, s.id, NULL) b
      LEFT JOIN my_bucket mb ON mb.sport_id = ms.sport_id
     WHERE b.user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_tournament_ranking(text) IS
  'The calling player''s own rank/points on the common (unfiltered) board for '
  'each sport they appear on, plus their level bucket (CURRENT active rating — '
  'drives the "my level" filter), in the given season (default: current).';

GRANT EXECUTE ON FUNCTION public.get_my_tournament_ranking(text) TO authenticated;

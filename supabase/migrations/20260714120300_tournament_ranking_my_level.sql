-- ============================================
-- Circuit Rallia — expose the caller's level bucket for the "my level" filter
-- ============================================
-- The mobile "filter to my level" toggle needs the caller's bucket. Deriving
-- it client-side from the active rating could disagree with the board's own
-- player-selection rule (latest ledger row's bucket, spec §8) — so the RPC
-- returns it, computed with the exact same DISTINCT ON semantics as
-- tournament_ranked_board. NULL when the caller's latest result is unrated.
--
-- Return type changes → DROP + CREATE.
-- ============================================

DROP FUNCTION IF EXISTS public.get_my_tournament_ranking(text);

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
        -- Same rule as the board's level filter: the bucket on the caller's
        -- most recent result, per sport.
        SELECT DISTINCT ON (trp.sport_id)
               trp.sport_id, trp.level_bucket
          FROM tournament_ranking_points trp, season s
         WHERE trp.user_id   = auth.uid()
           AND trp.season_id = s.id
         ORDER BY trp.sport_id, trp.computed_at DESC, trp.id DESC
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
  'each sport they appear on, plus their level bucket (latest result — drives '
  'the "my level" filter), in the given season (default: current).';

GRANT EXECUTE ON FUNCTION public.get_my_tournament_ranking(text) TO authenticated;

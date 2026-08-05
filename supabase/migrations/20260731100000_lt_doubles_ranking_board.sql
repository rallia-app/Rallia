-- ============================================================================
-- Tournaments — doubles results get their own ranking board
-- ============================================================================
-- "Comment les points sont-ils geres dans le classement pour les tournois de
-- double? Est-ce que les 2 joueurs recoivent chacun la totalite? Perso je
-- ferais un classement separe pour les doubles comme a l'ATP."
--
-- Until now every result landed on one board per sport, so a doubles run and a
-- singles run competed for the same rank. Doubles now ranks separately.
--
-- Point VALUES are unchanged, deliberately. Both partners still take the team's
-- full award; separating the boards is what removes the unfairness, not
-- halving. Nothing already earned changes value.
--
-- board is derived, never passed. It is a pure function of the tournament's
-- entry_format, so a BEFORE trigger sets it and no caller can disagree with the
-- tournament it came from. That also keeps award_tournament_ranking_points
-- untouched: it is a large function and had no reason to learn about boards.
--
-- mixed_doubles ranks with doubles. Splitting it into a third board would
-- divide an already thin field three ways; revisit if mixed volume justifies it.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Column, derived by trigger, backfilled from the tournament
-- --------------------------------------------------------------------------

ALTER TABLE public.tournament_ranking_points
  ADD COLUMN IF NOT EXISTS board text NOT NULL DEFAULT 'singles';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trp_board_check') THEN
        ALTER TABLE public.tournament_ranking_points
          ADD CONSTRAINT trp_board_check CHECK (board IN ('singles', 'doubles'));
    END IF;
END $$;

COMMENT ON COLUMN public.tournament_ranking_points.board IS
    'Which leaderboard this result ranks on. Derived from tournaments.entry_format by tg_trp_set_board: singles -> singles, doubles and mixed_doubles -> doubles.';

CREATE OR REPLACE FUNCTION public.tg_trp_set_board()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT CASE WHEN t.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END
      INTO NEW.board
      FROM tournaments t
     WHERE t.id = NEW.tournament_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_trp_set_board ON public.tournament_ranking_points;
CREATE TRIGGER tg_trp_set_board
    BEFORE INSERT OR UPDATE OF tournament_id ON public.tournament_ranking_points
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_trp_set_board();

UPDATE public.tournament_ranking_points trp
   SET board = CASE WHEN t.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END
  FROM public.tournaments t
 WHERE t.id = trp.tournament_id
   AND trp.board IS DISTINCT FROM
       CASE WHEN t.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END;

CREATE INDEX IF NOT EXISTS trp_sport_board_earned_idx
    ON public.tournament_ranking_points (sport_id, board, earned_at DESC);


-- --------------------------------------------------------------------------
-- 1b. Drop the pre-board signatures
-- --------------------------------------------------------------------------
-- Adding a trailing DEFAULT parameter does not replace a function, it creates a
-- second overload beside it. PostgREST then refuses the ambiguous call with
-- PGRST203 and every existing leaderboard read breaks. Same trap that took out
-- tournament_join_via_invite in 20260721180000. Drop the old arities first; the
-- new ones below default p_board to 'singles', so existing callers keep working
-- unchanged.

DROP FUNCTION IF EXISTS public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.get_my_tournament_ranking(text);
DROP FUNCTION IF EXISTS public.tournament_ranked_board(uuid, uuid, text, uuid);


-- --------------------------------------------------------------------------
-- 2. The shared board computation learns the filter
-- --------------------------------------------------------------------------
-- Body from the live definition; the only change is the board predicate, which
-- has to appear in BOTH the eligible CTE and the ranked CTE. Filtering one and
-- not the other would let a doubles-only player be "eligible" for the singles
-- board and rank with zero points.

CREATE OR REPLACE FUNCTION public.tournament_ranked_board(
    p_sport_id        uuid,
    p_season_id       uuid,
    p_level_filter    text DEFAULT NULL,
    p_rating_score_id uuid DEFAULT NULL,
    p_board           text DEFAULT 'singles'
)
RETURNS TABLE(rank integer, user_id uuid, points integer, events_played integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH eligible AS (
        SELECT DISTINCT trp.user_id
          FROM tournament_ranking_points trp
          LEFT JOIN player_sport ps
                 ON ps.player_id = trp.user_id AND ps.sport_id = p_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs         ON rs.id  = prs.rating_score_id
         WHERE trp.sport_id = p_sport_id
           AND trp.board    = p_board
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
           AND trp.board    = p_board
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


-- --------------------------------------------------------------------------
-- 3. Both readers pass the board through
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(
    p_sport_id        uuid,
    p_season_code     text DEFAULT NULL,
    p_level_filter    text DEFAULT NULL,
    p_rating_score_id uuid DEFAULT NULL,
    p_limit           integer DEFAULT 25,
    p_offset          integer DEFAULT 0,
    p_board           text DEFAULT 'singles'
)
RETURNS TABLE(rank integer, user_id uuid, full_name text, avatar_url text,
              points integer, events_played integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
               p_sport_id, (SELECT id FROM season), p_level_filter,
               p_rating_score_id, p_board) b
      JOIN public.profile pr ON pr.id = b.user_id
     ORDER BY b.rank
     LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION public.get_my_tournament_ranking(
    p_season_code text DEFAULT NULL,
    p_board       text DEFAULT 'singles'
)
RETURNS TABLE(sport_id uuid, rank integer, points integer, events_played integer,
              level_bucket text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH season AS (
        SELECT id
          FROM ranking_season
         WHERE p_season_code IS NOT NULL
           AND code = p_season_code
         LIMIT 1
    ),
    my_sports AS (
        SELECT DISTINCT trp.sport_id
          FROM tournament_ranking_points trp
         WHERE trp.user_id = auth.uid()
           AND trp.board   = p_board
           AND CASE WHEN (SELECT id FROM season) IS NULL
                    THEN trp.earned_at > now() - public.lt_ranking_window()
                    ELSE trp.season_id = (SELECT id FROM season)
               END
    ),
    my_bucket AS (
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
                             ms.sport_id, (SELECT id FROM season), NULL, NULL, p_board) b
      LEFT JOIN my_bucket mb ON mb.sport_id = ms.sport_id
     WHERE b.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid, text, text, uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tournament_ranking(text, text) TO authenticated;

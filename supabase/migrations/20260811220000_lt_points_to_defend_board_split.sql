-- ============================================================================
-- Circuit Rallia — points to defend never learned about boards
-- ============================================================================
-- get_my_points_to_defend (20260726150000) computes best-8 membership with
-- `PARTITION BY trp.sport_id`, matching how the board aggregated at the time.
-- Six days later 20260731100000 split each sport into a singles and a doubles
-- board, and tournament_ranked_board started aggregating per (sport, board).
-- This function was not updated, so for any player holding results on both
-- boards the two disagree.
--
-- `counts_now` is the field that breaks, and it is the one the RPC exists for:
-- it tells the UI whether an expiring result is actually being defended. A
-- player with eight singles results and one doubles title had the title ranked
-- 9th on a merged list and reported as not counting, when on the doubles board
-- it is rank 1 and the only thing holding their standing up. The reverse
-- misfires too: singles results pushed out by doubles rows are claimed as safe.
--
-- The window predicate and every other column were already correct; only the
-- partition was wrong. `board` joins the output so a caller can label the row
-- and deep-link the right leaderboard tab, which is why this is a DROP and
-- CREATE rather than a REPLACE (the return type changes). The argument list is
-- unchanged, so no second overload and no PGRST203 — the trap 20260731100000
-- documented when it dropped the pre-board signatures.
--
-- Body from 20260726150000, the only migration holding this function.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_points_to_defend(integer);

CREATE OR REPLACE FUNCTION public.get_my_points_to_defend(
    p_within_days integer DEFAULT 60
)
RETURNS TABLE (
    ledger_id       uuid,
    tournament_id   uuid,
    tournament_name text,
    sport_id        uuid,
    board           text,
    placement       text,
    points          integer,
    counts_now      boolean,
    earned_at       timestamptz,
    expires_at      timestamptz,
    days_remaining  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH mine AS (
        -- In-window rows only, so expires_at is always in the future. Best-8
        -- membership is per (sport, board), matching how tournament_ranked_board
        -- aggregates: singles and doubles are separate standings and cannot
        -- crowd each other out of a top 8.
        SELECT trp.id,
               trp.tournament_id,
               trp.sport_id,
               trp.board,
               trp.placement,
               trp.points,
               trp.earned_at,
               trp.earned_at + public.lt_ranking_window() AS expires_at,
               row_number() OVER (PARTITION BY trp.sport_id, trp.board
                                  ORDER BY trp.points DESC, trp.id) AS rn
          FROM tournament_ranking_points trp
         WHERE trp.user_id = auth.uid()
           AND trp.earned_at > now() - public.lt_ranking_window()
    )
    SELECT
        m.id,
        m.tournament_id,
        t.name,
        m.sport_id,
        m.board,
        m.placement,
        m.points,
        (m.rn <= 8) AS counts_now,
        m.earned_at,
        m.expires_at,
        greatest(0, ceil(extract(epoch FROM m.expires_at - now()) / 86400))::int
      FROM mine m
      JOIN tournaments t ON t.id = m.tournament_id
     WHERE m.expires_at <= now() + make_interval(days => greatest(p_within_days, 0))
     ORDER BY m.expires_at, m.points DESC;
$$;

COMMENT ON FUNCTION public.get_my_points_to_defend(integer) IS
  'The calling player''s Circuit Rallia results that still count but expire '
  'within p_within_days (default 60), soonest first. counts_now = the row is '
  'currently inside the player''s best 8 for that sport AND board, i.e. losing '
  'it will actually move that board''s total. Rows already outside the rolling '
  'window are gone, not expiring, and are never returned.';

GRANT EXECUTE ON FUNCTION public.get_my_points_to_defend(integer) TO authenticated;

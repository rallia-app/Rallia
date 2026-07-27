-- ============================================================================
-- Circuit Rallia — points to defend
-- ============================================================================
-- The payoff of the rolling window (20260726140000). Under a hard reset there
-- was one re-engagement moment per half-year, shared by everyone. Under a
-- rolling window every player has their own: "900 points drop off April 12".
--
-- Returns the caller's ledger rows that are still counting but expire inside
-- the horizon, soonest first, with the tournament that produced them.
--
-- `counts_now` is the honest part. A result outside the player's best 8 is not
-- actually being defended — when it expires the board total does not move — so
-- the UI can lead with the rows that cost something and mute the rest. It is
-- best-8 membership as of now, not a prediction: it can flip either way as the
-- player adds results.
--
-- Read-only, no writes, no expiry sweep. Expiry stays a read-time predicate.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_points_to_defend(
    p_within_days integer DEFAULT 60
)
RETURNS TABLE (
    ledger_id       uuid,
    tournament_id   uuid,
    tournament_name text,
    sport_id        uuid,
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
        -- membership is per sport, matching how the board aggregates.
        SELECT trp.id,
               trp.tournament_id,
               trp.sport_id,
               trp.placement,
               trp.points,
               trp.earned_at,
               trp.earned_at + public.lt_ranking_window() AS expires_at,
               row_number() OVER (PARTITION BY trp.sport_id
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
  'currently inside the player''s best 8 for that sport, i.e. losing it will '
  'actually move their total. Rows already outside the rolling window are '
  'gone, not expiring, and are never returned.';

GRANT EXECUTE ON FUNCTION public.get_my_points_to_defend(integer) TO authenticated;

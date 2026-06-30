-- =============================================================================
-- Per-player reputation breakdown for the PlayerProfile Reputation tab
--
-- The Reputation tab focuses on the three things that actually make a player
-- trustworthy to play with: reliability (no-shows), punctuality (lateness), and
-- peer star ratings. Those live in reputation_event broken out by event_type —
-- but reputation_event's RLS only lets a user read their OWN events (or ones
-- they caused), so a viewer can't aggregate another player's events directly.
--
-- This SECURITY DEFINER RPC returns public-safe per-event-type counts for a
-- single player, mirroring get_reputation_summary / get_player_played_games. It
-- is gated on the SAME privacy rule as the rest of reputation: counts are only
-- returned when the player's reputation is public (player_reputation.is_public),
-- i.e. once they have enough events to surface. Otherwise it returns zeros — the
-- tab shows its "building reputation" state and never a partial/negative number.
--
-- Returns only aggregate counts (never raw events / who caused them), so it
-- exposes nothing beyond what the public reputation tier already implies.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_player_reputation_breakdown(p_player_id uuid)
RETURNS TABLE (
  games_completed integer,
  no_shows integer,
  on_time integer,
  late integer,
  left_late integer,
  late_cancellations integer,
  reviews_5 integer,
  reviews_4 integer,
  reviews_3 integer,
  reviews_2 integer,
  reviews_1 integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE e.event_type = 'match_completed')::int,
    count(*) FILTER (WHERE e.event_type = 'match_no_show')::int,
    count(*) FILTER (WHERE e.event_type = 'match_on_time')::int,
    count(*) FILTER (WHERE e.event_type = 'match_late')::int,
    count(*) FILTER (WHERE e.event_type = 'match_left_late')::int,
    count(*) FILTER (WHERE e.event_type = 'match_cancelled_late')::int,
    count(*) FILTER (WHERE e.event_type = 'review_received_5star')::int,
    count(*) FILTER (WHERE e.event_type = 'review_received_4star')::int,
    count(*) FILTER (WHERE e.event_type = 'review_received_3star')::int,
    count(*) FILTER (WHERE e.event_type = 'review_received_2star')::int,
    count(*) FILTER (WHERE e.event_type = 'review_received_1star')::int
  FROM public.reputation_event e
  JOIN public.player_reputation pr ON pr.player_id = e.player_id
  WHERE e.player_id = p_player_id
    AND pr.is_public = true;
$$;

COMMENT ON FUNCTION public.get_player_reputation_breakdown(uuid) IS
  'Public-safe per-event-type reputation counts (no-shows, punctuality, late '
  'cancellations, star-rating histogram) for a single player, powering the '
  'PlayerProfile Reputation tab. Gated on player_reputation.is_public so it '
  'mirrors the existing public reputation privacy rule; returns zeros otherwise.';

GRANT EXECUTE ON FUNCTION public.get_player_reputation_breakdown(uuid) TO authenticated, service_role;

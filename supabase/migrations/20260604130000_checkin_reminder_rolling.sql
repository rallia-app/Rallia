-- =============================================================================
-- Check-in reminder → rolling window (replaces the weekly "Monday 9am" model)
--
-- The reminder used to fire at Monday 9am local for players with no check-in
-- THIS ISO WEEK. With the rolling 4-day window, a check-in is due whenever the
-- player is PAST their availability_covered_through date — exactly the
-- is_pending_check_in signal. This RPC returns players to nudge on this hourly
-- tick: past coverage, at ~9am local (any day), with active availability, and
-- not already reminded within the dedupe window (so it's a gentle nudge, not a
-- daily nag). The edge function just sends the push for each returned player.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.players_needing_checkin_reminder(
  p_target_local_hour int DEFAULT 9,
  p_dedupe_hours      int DEFAULT 72
)
RETURNS TABLE (
  player_id        uuid,
  preferred_locale text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, COALESCE(NULLIF(pr.preferred_locale::text, ''), 'en-US')
  FROM public.player p
  JOIN public.profile pr ON pr.id = p.id
  LEFT JOIN public.player_check_in_preferences cp ON cp.player_id = p.id
  WHERE pr.is_active = TRUE
    -- Send at ~9am local (any day). The cron ticks hourly, so each timezone
    -- crosses its 9am window exactly once per day.
    AND EXTRACT(hour FROM (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC')))::int
        = p_target_local_hour
    -- A check-in is DUE: past the last covered date (or never checked in).
    AND (
      cp.availability_covered_through IS NULL
      OR (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC'))::date
         > cp.availability_covered_through
    )
    -- Only nudge players who actually have availability to confirm.
    AND EXISTS (
      SELECT 1 FROM public.player_availability pa
      WHERE pa.player_id = p.id AND pa.is_active
    )
    -- Gentle: skip if we already reminded them within the dedupe window.
    AND NOT EXISTS (
      SELECT 1 FROM public.notification n
      WHERE n.user_id = p.id
        AND n.type = 'availability_refresh_reminder'
        AND n.created_at > now() - make_interval(hours => p_dedupe_hours)
    );
$$;

COMMENT ON FUNCTION public.players_needing_checkin_reminder(int, int) IS
  'Players to nudge for a check-in this hourly tick: past availability_covered_through '
  '(check-in due), at ~p_target_local_hour local time, with active availability, and not '
  'reminded within p_dedupe_hours. Replaces the weekly Monday-9am targeting.';

REVOKE ALL ON FUNCTION public.players_needing_checkin_reminder(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.players_needing_checkin_reminder(int, int) TO service_role;

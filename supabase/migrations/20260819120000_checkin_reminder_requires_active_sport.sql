-- =============================================================================
-- players_needing_checkin_reminder: never nudge a player with zero active sports.
--
-- The goal + streak the wizard writes are per sport, so record_weekly_checkin
-- rejects a submit from a player with no active player_sport row. 20260814120000
-- stopped the banner + auto-opener from offering the wizard to those players,
-- but the reminder itself was still sent (targeting only looked at availability
-- coverage), and tapping it routes straight into the wizard past that gate: the
-- player walked every step and hit 'player has no active sport' on submit
-- (Sentry REACT-NATIVE-BX, 19 users, still firing 2026-08-18).
--
-- Dropping them from the targeting is the root fix: there is nothing to check
-- in for. Body otherwise copied from 20260604130000.
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
    -- Goal + streak are per sport: a player with no active sport has nothing to
    -- check in for, and record_weekly_checkin would reject the submit.
    AND EXISTS (
      SELECT 1 FROM public.player_sport ps
      WHERE ps.player_id = p.id AND ps.is_active = TRUE
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
  '(check-in due), at ~p_target_local_hour local time, with active availability, with at '
  'least one active sport (the wizard is per sport and record_weekly_checkin rejects a '
  'sportless submit), and not reminded within p_dedupe_hours. Replaces the weekly '
  'Monday-9am targeting.';

REVOKE ALL ON FUNCTION public.players_needing_checkin_reminder(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.players_needing_checkin_reminder(int, int) TO service_role;

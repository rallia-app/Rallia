-- =============================================================================
-- Retire the weekly send-availability-refresh pipeline (duplicate of check-in)
--
-- Since the rolling check-in reminder (20260604130000) went live, two crons
-- have been nudging the SAME audience with the SAME notification type
-- ('availability_refresh_reminder'):
--
--   * weekly-checkin-reminder-hourly — 9am local, dedupes via the notification
--     table, deep-links to the check-in wizard (which also refreshes
--     player_availability.last_confirmed_at).
--   * send-availability-refresh-weekly — Mondays 14:00 UTC, dedupes ONLY via
--     profile.last_availability_refresh_sent_at, so it never sees the pushes
--     the check-in reminder sent one hour earlier (13:00 UTC = 9am EDT).
--
-- Result: every Monday, players due for a check-in got both pushes an hour
-- apart (400 distinct users double-notified in the 21 days before 2026-08-05).
-- The check-in reminder strictly supersedes the refresh nudge, so this
-- unschedules the old cron and drops its eligibility RPC. The edge function
-- directory is deleted in the same commit; profile.last_availability_refresh_sent_at
-- stays as a dormant column per convention.
-- =============================================================================

SELECT cron.unschedule('send-availability-refresh-weekly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-availability-refresh-weekly'
);

DROP FUNCTION IF EXISTS public.get_availability_refresh_eligible_users();

COMMENT ON COLUMN public.profile.last_availability_refresh_sent_at IS
  'Dormant since 2026-08-05: the send-availability-refresh cron was retired '
  '(superseded by the rolling check-in reminder). Kept for history.';

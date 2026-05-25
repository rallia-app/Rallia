-- =============================================================================
-- compute-streak-reset cron: weekly → hourly
--
-- Previously this ran once per week at Monday 02:00 UTC, which prematurely
-- reset streaks for west-coast players (whose Monday hadn't started yet) and
-- couldn't possibly run at "Monday 2am local" for every timezone with a
-- single schedule entry.
--
-- The TZ-aware version (companion migration 20260525000000) does the work
-- per player using their local timezone. To deliver the reset/freeze action
-- at roughly each player's local Monday 2am, we tick hourly. The function's
-- underlying RPC (players_needing_streak_reset) only returns players whose
-- last_checkin_week_start is strictly older than their local "last Monday",
-- so the queue naturally drains as each timezone passes its rollover.
--
-- :15 minute offset keeps it out of phase with other on-the-hour and :05/:10
-- jobs (e.g. weekly-checkin-reminder fires at :10).
-- =============================================================================

SELECT cron.unschedule('compute-streak-reset-weekly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compute-streak-reset-weekly'
);

-- Defensive: also clear any previous hourly registration before re-scheduling.
SELECT cron.unschedule('compute-streak-reset-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compute-streak-reset-hourly'
);

SELECT cron.schedule(
  'compute-streak-reset-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/compute-streak-reset',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-service-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $$
);

-- =============================================================================
-- Weekly check-in wizard — pg_cron job registration
--
-- Two crons:
--
--   * weekly-checkin-reminder-hourly
--       Runs hourly. The edge function itself filters to "send to players
--       whose local time is currently around Monday 9am AND who have no
--       check-in row for the current ISO week". Hourly tick lets us cover
--       every timezone with a single registration. Idempotency is enforced
--       inside the function via a notification-row existence check.
--
--   * compute-streak-reset-weekly
--       Runs every Monday at 02:00 UTC. Walks all players whose
--       last_checkin_week_start < last Monday and either consumes 1 freeze
--       (preserves streak) or resets current_streak to 0.
-- =============================================================================

-- Remove existing jobs if they exist (idempotency).
SELECT cron.unschedule('weekly-checkin-reminder-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-checkin-reminder-hourly'
);
SELECT cron.unschedule('compute-streak-reset-weekly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compute-streak-reset-weekly'
);

-- -----------------------------------------------------------------------------
-- weekly-checkin-reminder — hourly tick, function filters per-user timezone
-- Minute :10 keeps it out of phase with the other on-the-hour and :05 jobs.
-- -----------------------------------------------------------------------------
SELECT cron.schedule(
  'weekly-checkin-reminder-hourly',
  '10 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/weekly-checkin-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-service-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 120000
  );
  $$
);

-- -----------------------------------------------------------------------------
-- compute-streak-reset — Monday 02:00 UTC
-- Runs after the ISO-week boundary (Mon 00:00 UTC) so all "last week" rows
-- are settled. Idempotent inside the function (skips rows already updated
-- this Monday).
-- -----------------------------------------------------------------------------
SELECT cron.schedule(
  'compute-streak-reset-weekly',
  '0 2 * * 1',  -- min hour dom month dow (1 = Monday)
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

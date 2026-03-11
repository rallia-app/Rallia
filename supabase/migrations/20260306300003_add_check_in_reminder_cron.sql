-- =============================================================================
-- CRON JOB: send-check-in-reminders
-- Runs at :05, :20, :35, :50 — exactly 10 minutes before each possible
-- match start time (:00, :15, :30, :45).
-- Calls the send-check-in-reminders Edge Function.
-- =============================================================================

-- Remove if already exists (idempotent)
SELECT cron.unschedule('send-check-in-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-check-in-reminders'
);

-- Schedule at :05, :20, :35, :50 every hour
SELECT cron.schedule(
  'send-check-in-reminders',
  '5,20,35,50 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-check-in-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

DO $$
BEGIN
  RAISE NOTICE 'Scheduled send-check-in-reminders cron job (at :05, :20, :35, :50)';
END $$;

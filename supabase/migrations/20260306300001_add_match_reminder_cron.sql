-- =============================================================================
-- CRON JOB: send-match-reminders (every 5 minutes)
-- Calls the send-match-reminders Edge Function to notify participants
-- whose matches start in ~2 hours.
-- =============================================================================

-- Remove if already exists (idempotent)
SELECT cron.unschedule('send-match-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-match-reminders'
);

-- Schedule every 15 minutes
SELECT cron.schedule(
  'send-match-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-match-reminders',
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
  RAISE NOTICE 'Scheduled send-match-reminders cron job (every 5 minutes)';
END $$;

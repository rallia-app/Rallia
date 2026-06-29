-- ============================================
-- Leagues & Tournaments — settlement cron
-- ============================================
-- Hourly: release held payouts for COMPLETED paid tournaments and issue full
-- entry refunds for CANCELLED ones, via the lt-settle-event-payments edge
-- function. Mirrors the send-availability-refresh cron (20260515220200):
-- net.http_post to the function URL with the anon bearer; the function runs as
-- service role internally and is idempotent.
-- ============================================

SELECT cron.unschedule('lt-settle-event-payments-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-settle-event-payments-hourly'
);

SELECT cron.schedule(
  'lt-settle-event-payments-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/lt-settle-event-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $$
);

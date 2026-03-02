-- ============================================================================
-- Schedule weekly reputation decay recalculation
-- ============================================================================
-- Applies time-based decay to reputation scores so older events gradually
-- lose their impact. Runs every Sunday at 3:00 AM UTC.
--
-- The edge function queries players whose last_decay_calculation is older
-- than 7 days (or NULL) and calls recalculate_player_reputation() with
-- apply_decay = true for each one.
-- ============================================================================

-- Unschedule if exists (idempotent re-runs)
DO $$
BEGIN
  PERFORM cron.unschedule('recalculate-reputation-decay-weekly');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet, nothing to unschedule
END;
$$;

-- Schedule: Every Sunday at 3:00 AM UTC
SELECT cron.schedule(
  'recalculate-reputation-decay-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/recalculate-reputation-decay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

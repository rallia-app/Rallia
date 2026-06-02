-- =============================================================================
-- Fix auth header for the weekly-checkin-reminder + compute-streak-reset crons
--
-- Both jobs were registered (20260521120200, 20260525000100) using the OLD
-- `x-service-key` header convention, copied from a since-reverted template.
-- But the edge functions authenticate via `_shared/auth.ts requireSecretApikey()`,
-- which reads the **`apikey`** header (validated against SUPABASE_SECRET_KEYS).
--
-- Combined with these two functions defaulting to `verify_jwt = true` (they were
-- the only functions missing a `verify_jwt = false` entry in config.toml — fixed
-- in the same change), every hourly invocation was rejected with 401 at the
-- gateway and the function body never ran. Result: streak resets/freezes and
-- weekly check-in reminder pushes have never fired in production.
--
-- This aligns both jobs with the canonical pattern used by every other pg_net
-- caller (see 20260507235522_pg_net_apikey_secret_for_edge_functions): the
-- `apikey:` header carrying the vault `service_role_key` secret (which already
-- holds the new `sb_secret_...` value). Schedules are left untouched.
-- =============================================================================

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'weekly-checkin-reminder-hourly'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/weekly-checkin-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 120000
  );
  $cmd$
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'compute-streak-reset-hourly'),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/compute-streak-reset',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $cmd$
);

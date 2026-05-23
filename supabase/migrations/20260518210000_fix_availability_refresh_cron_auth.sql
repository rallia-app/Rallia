-- =============================================================================
-- Fix auth for send-availability-refresh-weekly cron.
--
-- The job was created in 20260515220200_availability_refresh_cron.sql using
-- the obsolete `Authorization: Bearer <vault.anon_key>` pattern (copied from
-- the original 20260429100000_add_morning_digest.sql). Two problems with that:
--
--   1. send-availability-refresh validates auth via requireSecretApikey()
--      (functions/_shared/auth.ts) which checks the `apikey` header against
--      SUPABASE_SECRET_KEYS["default"] — it never reads Authorization.
--   2. vault.anon_key now holds the new publishable key format
--      (sb_publishable_…), which is not a JWT. The Supabase gateway tries to
--      JWT-decode the Bearer token and rejects with
--      `UNAUTHORIZED_INVALID_JWT_FORMAT` 401 before the function ever runs.
--
-- Switch to the canonical pattern documented in 20260507235522 (the
-- general-purpose pg_net auth fix) and used by the snapshot pre-warm cron in
-- 20260515170000: send the secret key in the `apikey` header only, with no
-- Authorization header. See https://supabase.com/docs/guides/functions/auth
-- and https://supabase.com/docs/guides/getting-started/api-keys.
-- =============================================================================

SELECT cron.alter_job(
  job_id := (
    SELECT jobid FROM cron.job WHERE jobname = 'send-availability-refresh-weekly'
  ),
  command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-availability-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now()::text),
    timeout_milliseconds := 300000
  );
  $cmd$
);

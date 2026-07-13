-- Companion to gating lt-settle-event-payments with requireSecretApikey().
--
-- The function now rejects any request whose `apikey:` header doesn't match the
-- project secret key. The settle cron was still sending `Authorization: Bearer
-- <anon_key>` and NO `apikey` header, so once the guard ships the hourly job
-- would 401 and settlement (organizer payouts + cancellation refunds) would
-- silently stop.
--
-- Switch it to the canonical apikey pattern already used by the working gated
-- crons (close-matches-hourly, send-match-reminders — verified in prod cron.job
-- returning 200, never 401): send the secret key in `apikey:`, drop the
-- Authorization/anon header. The vault entry `service_role_key` holds the
-- `sb_secret_...` value. Schedule, body, and timeout are preserved; only the
-- headers change.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the guarded function.
-- After the migration the cron sends the apikey (the still-open function accepts
-- it); after the function deploy the guard is active and the apikey passes — so
-- there is never a window where the cron is rejected.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'lt-settle-event-payments-hourly';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'lt-settle-event-payments-hourly cron job not found; nothing to alter';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id := v_jobid,
    command := $cmd$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/lt-settle-event-payments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object('triggered_at', now()::text),
      timeout_milliseconds := 300000
    );
    $cmd$
  );
END $$;

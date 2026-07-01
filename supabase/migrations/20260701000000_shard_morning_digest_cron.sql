-- ============================================================================
-- Migration: Shard the morning digest cron across staggered invocations
-- Created: 2026-07-01
-- Description:
--   send-morning-digest processed the ENTIRE eligible userbase inside a single
--   Edge Function request. Once the audience grew past ~250 users the isolate
--   exceeded its per-request resource budget (2s CPU / 256MB) and the runtime
--   killed it mid-run with HTTP 546 (WORKER_RESOURCE_LIMIT) — only a partial
--   batch was delivered each morning (and the fire-and-forget pg_cron reported
--   "succeeded" regardless, masking the failure).
--
--   Fix: fan the daily run out into `shard_count` independent invocations, each
--   processing a stable hash-slice of user_id (the Edge Function reads
--   {shard_index, shard_count} from the request body; defaults 0/1 still process
--   everyone, so manual invokes are unaffected). Jobs are staggered 2 minutes
--   apart so only one shard runs at a time — each isolate stays small AND the
--   aggregate Resend send rate is unchanged (avoids trading 546 for 429s).
--
--   To rescale later, bump `shard_count` and re-run; old shard jobs are
--   unscheduled first, so the migration is idempotent.
-- ============================================================================

DO $$
DECLARE
  shard_count INT := 6;   -- ~250 users -> ~42/shard today, with headroom to grow
  k           INT;
BEGIN
  -- Remove the old single job and any prior shard jobs (idempotent re-run).
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'send-morning-digest-daily'
     OR jobname LIKE 'send-morning-digest-shard-%';

  FOR k IN 0..(shard_count - 1) LOOP
    PERFORM cron.schedule(
      'send-morning-digest-shard-' || k,
      (2 * k) || ' 12 * * *',                 -- 12:00, 12:02, ... UTC
      format(
        $cmd$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/functions/v1/send-morning-digest',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object('shard_index', %s, 'shard_count', %s, 'triggered_at', now()::text),
          timeout_milliseconds := 300000
        );
        $cmd$,
        k, shard_count
      )
    );
  END LOOP;

  RAISE NOTICE 'Scheduled % morning-digest shard jobs (last at 12:% UTC, 2 min apart)',
    shard_count, LPAD((2 * (shard_count - 1))::text, 2, '0');
END $$;

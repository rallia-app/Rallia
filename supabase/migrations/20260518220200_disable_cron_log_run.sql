-- =============================================================================
-- Bound the growth of cron.job_run_details.
--
-- The pg_cron extension inserts a row per job execution into job_run_details.
-- Over the current pg_stat_statements window this accounts for ~5k inserts,
-- ~37 MB of WAL, and ~9k dirtied pages with no operational value beyond what
-- is already visible in cron.job. Disabling that logging entirely requires
-- changing cron.log_run, which is a `postmaster` context GUC -- it cannot be
-- set with ALTER DATABASE or ALTER SYSTEM and only takes effect on server
-- restart. On Supabase managed Postgres that means:
--
--   Dashboard > Project Settings > Database > Custom Postgres Config
--     cron.log_run     = off
--     cron.log_statement = off   (optional; also `postmaster`)
--
-- Until that toggle is flipped, this migration keeps the table bounded so it
-- never grows large enough to drive autovacuum I/O of its own.
-- =============================================================================

-- One-time prune of run history older than 7 days.
DELETE FROM cron.job_run_details
 WHERE end_time < now() - interval '7 days';

-- Idempotent daily prune so job_run_details stays small even with log_run on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-history') THEN
    PERFORM cron.schedule(
      'prune-cron-history',
      '0 3 * * *',
      $cron$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days'$cron$
    );
  END IF;
END $$;

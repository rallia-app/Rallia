-- Migration: Add weekly cron job for auto-match generation
-- This sets up a pg_cron job to call the generate-weekly-matches Edge Function
-- Created: 2026-02-04

-- ============================================
-- ENABLE PG_CRON EXTENSION (if not already enabled)
-- ============================================

-- Note: pg_cron must be enabled in your Supabase project settings
-- Go to Database > Extensions > Enable pg_cron

-- Create the cron extension if it doesn't exist (wrapped to handle errors)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Extension already exists or other issue, continue
  RAISE NOTICE 'pg_cron extension check: %', SQLERRM;
END $$;

-- Grant usage to postgres (ignore if already granted)
DO $$
BEGIN
  GRANT USAGE ON SCHEMA cron TO postgres;
EXCEPTION WHEN OTHERS THEN
  -- Grant already exists or other issue, continue
  NULL;
END $$;

-- ============================================
-- CREATE CRON JOB FOR WEEKLY MATCH GENERATION
-- ============================================

-- Schedule to run every Monday at 1:00 AM UTC
-- This generates matches for the upcoming week

-- First, remove any existing job with the same name (ignore if not exists)
DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-matches');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, that's fine
  NULL;
END $$;

-- Schedule the new job
SELECT cron.schedule(
  'generate-weekly-matches',
  '0 1 * * 1', -- Every Monday at 1:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.edge_function_url') || '/generate-weekly-matches',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'target_match_count', 10
      )
    ) AS request_id;
  $$
);

-- ============================================
-- ALTERNATIVE: Direct SQL call (if Edge Function not available)
-- ============================================

-- If you prefer to call the SQL function directly:
-- SELECT cron.schedule(
--   'generate-weekly-matches-direct',
--   '0 1 * * 1', -- Every Monday at 1:00 AM UTC
--   $$SELECT * FROM generate_weekly_matches_for_all_players(10);$$
-- );

-- ============================================
-- HELPER: Manual trigger function
-- ============================================

-- Function to manually trigger match generation (for testing or admin use)
CREATE OR REPLACE FUNCTION trigger_weekly_match_generation(
  p_target_match_count INT DEFAULT 10
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_results JSON;
BEGIN
  SELECT json_agg(row_to_json(r))
  INTO v_results
  FROM generate_weekly_matches_for_all_players(p_target_match_count) r;
  
  RETURN COALESCE(v_results, '[]'::JSON);
END;
$$;

COMMENT ON FUNCTION trigger_weekly_match_generation IS 'Manually trigger weekly match generation - useful for testing or admin override';

-- ============================================
-- VIEW CRON JOBS (for debugging)
-- ============================================

-- To see scheduled jobs:
-- SELECT * FROM cron.job;

-- To see job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

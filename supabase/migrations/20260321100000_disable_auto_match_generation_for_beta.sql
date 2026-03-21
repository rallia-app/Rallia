-- =============================================================================
-- Migration: Temporarily disable auto-match generation for beta testing
-- 
-- WHY:  The auto-match feature needs rework. Disabling for beta release.
-- WHAT: Drops the onboarding trigger and unschedules the weekly cron job.
--       All underlying functions are LEFT INTACT for easy re-enable.
--
-- TO RE-ENABLE: Create a new migration that:
--   1. Recreates the trigger:
--        CREATE TRIGGER trigger_generate_matches_on_onboarding
--          AFTER UPDATE OF onboarding_completed ON profile
--          FOR EACH ROW
--          EXECUTE FUNCTION trigger_match_generation_on_onboarding();
--
--   2. Reschedules the cron job:
--        SELECT cron.schedule(
--          'generate-weekly-matches',
--          '0 1 * * 1',
--          $$ SELECT net.http_post(
--               url := current_setting('app.settings.edge_function_url') || '/generate-weekly-matches',
--               headers := jsonb_build_object(
--                 'Content-Type', 'application/json',
--                 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
--               ),
--               body := jsonb_build_object('target_match_count', 10)
--             ) AS request_id; $$
--        );
-- =============================================================================

-- ─── 1. Drop the onboarding trigger (function stays) ───────────────────────
DROP TRIGGER IF EXISTS trigger_generate_matches_on_onboarding ON profile;

-- ─── 2. Unschedule the weekly cron job ─────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-matches');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist or pg_cron not available — safe to ignore
  RAISE NOTICE 'Could not unschedule generate-weekly-matches: %', SQLERRM;
END $$;

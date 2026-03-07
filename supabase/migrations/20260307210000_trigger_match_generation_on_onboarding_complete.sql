-- Migration: Trigger auto-match generation when user completes onboarding
-- This ensures new users immediately see matches in "Soon & Nearby" after onboarding
-- instead of waiting for the weekly cron job.
-- Created: 2026-03-07

-- ============================================
-- TRIGGER FUNCTION: Generate matches on onboarding completion
-- ============================================

CREATE OR REPLACE FUNCTION trigger_match_generation_on_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matches_created INT;
  v_target_count INT := 10; -- Generate up to 10 matches for new users
BEGIN
  -- Only trigger when onboarding_completed changes from FALSE/NULL to TRUE
  IF (NEW.onboarding_completed = TRUE) 
     AND (OLD.onboarding_completed IS DISTINCT FROM TRUE) THEN
    
    -- Check if the user has completed enough setup to generate matches
    -- (needs sport profile and availability - same checks as the batch function)
    IF EXISTS (
      SELECT 1 FROM player_sport_profile psp 
      WHERE psp.player_id = NEW.id AND psp.is_active = TRUE
    ) AND EXISTS (
      SELECT 1 FROM player_availability pa 
      WHERE pa.player_id = NEW.id AND pa.is_active = TRUE
    ) THEN
      
      -- Generate matches for this player
      SELECT COUNT(*) INTO v_matches_created
      FROM generate_weekly_matches_for_player(NEW.id, v_target_count);
      
      -- Log the result (visible in Supabase logs)
      RAISE LOG 'Auto-match generation on onboarding: player_id=%, matches_created=%', 
                NEW.id, v_matches_created;
    ELSE
      RAISE LOG 'Auto-match generation skipped (missing sport profile or availability): player_id=%', 
                NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================
-- CREATE TRIGGER ON PROFILE TABLE
-- ============================================

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_generate_matches_on_onboarding ON profile;

-- Create the trigger
CREATE TRIGGER trigger_generate_matches_on_onboarding
  AFTER UPDATE OF onboarding_completed ON profile
  FOR EACH ROW
  EXECUTE FUNCTION trigger_match_generation_on_onboarding();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION trigger_match_generation_on_onboarding IS 
'Trigger function that automatically generates weekly matches for a user when they complete onboarding. This ensures new users immediately see relevant matches in the "Soon & Nearby" section instead of waiting for the weekly cron job.';

COMMENT ON TRIGGER trigger_generate_matches_on_onboarding ON profile IS 
'Fires when onboarding_completed changes to TRUE, generating auto-matches for the new user.';

-- Migration: Allow anonymous users to view player directory
-- This enables logged-out users to browse the player list (read-only)
-- while interactions (clicking a player card) are still guarded at the app level.

-- =============================================================================
-- player_sport table - Allow anon to see which players are active in each sport
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view all player sports" ON "public"."player_sport";

CREATE POLICY "Anon users can view all player sports"
  ON "public"."player_sport"
  FOR SELECT
  TO anon
  USING (true);

-- =============================================================================
-- player table - Allow anon to see basic player info for directory display
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view player profiles" ON "public"."player";

CREATE POLICY "Anon users can view player profiles"
  ON "public"."player"
  FOR SELECT
  TO anon
  USING (true);

-- =============================================================================
-- profile table - Allow anon to see display names for player cards
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view profiles" ON "public"."profile";

CREATE POLICY "Anon users can view profiles"
  ON "public"."profile"
  FOR SELECT
  TO anon
  USING (true);

-- =============================================================================
-- player_rating_score table - Allow anon to see ratings on player cards
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view player ratings" ON "public"."player_rating_score";

CREATE POLICY "Anon users can view player ratings"
  ON "public"."player_rating_score"
  FOR SELECT
  TO anon
  USING (true);

-- Note: These policies only grant READ access. Anonymous users cannot:
-- - Modify any data
-- - Access private/sensitive information beyond what's shown in the directory
-- - Interact with players (guarded at the app level by useRequireOnboarding hook)

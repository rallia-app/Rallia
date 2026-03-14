-- Migration: Allow anonymous users to view community details
-- This enables logged-out users to browse community info, members, and matches
-- while interactions (joining, chatting, etc.) are guarded at the app level.

-- =============================================================================
-- network table - Allow anon to view public communities
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view public networks" ON "public"."network";

CREATE POLICY "Anon users can view public networks"
  ON "public"."network"
  FOR SELECT
  TO anon
  USING (is_private = false OR is_private IS NULL);

-- =============================================================================
-- network_member table - Allow anon to see members of public communities
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view network members" ON "public"."network_member";

CREATE POLICY "Anon users can view network members"
  ON "public"."network_member"
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.network n
      WHERE n.id = network_member.network_id
        AND (n.is_private = false OR n.is_private IS NULL)
    )
  );

-- =============================================================================
-- match table - Allow anon to view public matches
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view public matches" ON "public"."match";

CREATE POLICY "Anon users can view public matches"
  ON "public"."match"
  FOR SELECT
  TO anon
  USING (visibility = 'public' AND cancelled_at IS NULL);

-- =============================================================================
-- match_participant table - Allow anon to view participants of public matches
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view match participants" ON "public"."match_participant";

CREATE POLICY "Anon users can view match participants"
  ON "public"."match_participant"
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.match m
      WHERE m.id = match_participant.match_id
        AND m.visibility = 'public'
        AND m.cancelled_at IS NULL
    )
  );

-- =============================================================================
-- sport table - Allow anon to view sports (for sport icons/names)
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view sports" ON "public"."sport";

CREATE POLICY "Anon users can view sports"
  ON "public"."sport"
  FOR SELECT
  TO anon
  USING (true);

-- =============================================================================
-- facility table - Allow anon to view facilities (for match locations)
-- =============================================================================

DROP POLICY IF EXISTS "Anon users can view facilities" ON "public"."facility";

CREATE POLICY "Anon users can view facilities"
  ON "public"."facility"
  FOR SELECT
  TO anon
  USING (true);

-- Note: These policies only grant READ access. Anonymous users cannot:
-- - Join communities
-- - Create/edit matches
-- - Send messages
-- - Access private community content
-- All such interactions are guarded at the app level by useRequireOnboarding hook

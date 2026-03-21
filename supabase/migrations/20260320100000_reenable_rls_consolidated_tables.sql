-- =============================================================================
-- Migration: Re-enable RLS on tables that lost it during consolidation
-- Description: The plural→singular table consolidation (20251208000000) dropped
--              and recreated these tables without re-enabling RLS. Some have
--              dormant policies that were created but never activated.
--              Made idempotent with DROP POLICY IF EXISTS guards.
-- =============================================================================

-- =============================================================================
-- 1. ADMIN
-- =============================================================================

ALTER TABLE public.admin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view admin records" ON public.admin;
CREATE POLICY "Admins can view admin records"
  ON public.admin FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin a WHERE a.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can insert admin records" ON public.admin;
CREATE POLICY "Admins can insert admin records"
  ON public.admin FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin a WHERE a.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update admin records" ON public.admin;
CREATE POLICY "Admins can update admin records"
  ON public.admin FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin a WHERE a.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can delete admin records" ON public.admin;
CREATE POLICY "Admins can delete admin records"
  ON public.admin FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin a WHERE a.id = auth.uid())
  );

-- =============================================================================
-- 2. SPORT (has dormant anon SELECT policies — drop and recreate properly)
-- =============================================================================

ALTER TABLE public.sport ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon users can view sports" ON public.sport;
DROP POLICY IF EXISTS "Anonymous users can view sports" ON public.sport;
DROP POLICY IF EXISTS "Authenticated users can view sports" ON public.sport;
DROP POLICY IF EXISTS "Anyone can view sports" ON public.sport;
CREATE POLICY "Anyone can view sports"
  ON public.sport FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert sports" ON public.sport;
CREATE POLICY "Admins can insert sports"
  ON public.sport FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update sports" ON public.sport;
CREATE POLICY "Admins can update sports"
  ON public.sport FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can delete sports" ON public.sport;
CREATE POLICY "Admins can delete sports"
  ON public.sport FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 3. RATING_SYSTEM
-- =============================================================================

ALTER TABLE public.rating_system ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view rating systems" ON public.rating_system;
CREATE POLICY "Authenticated users can view rating systems"
  ON public.rating_system FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert rating systems" ON public.rating_system;
CREATE POLICY "Admins can insert rating systems"
  ON public.rating_system FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update rating systems" ON public.rating_system;
CREATE POLICY "Admins can update rating systems"
  ON public.rating_system FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can delete rating systems" ON public.rating_system;
CREATE POLICY "Admins can delete rating systems"
  ON public.rating_system FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 4. RATING_SCORE (has dormant anon SELECT policy — drop and recreate)
-- =============================================================================

ALTER TABLE public.rating_score ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anonymous users can view rating scores" ON public.rating_score;
DROP POLICY IF EXISTS "Anyone can view rating scores" ON public.rating_score;
CREATE POLICY "Anyone can view rating scores"
  ON public.rating_score FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert rating scores" ON public.rating_score;
CREATE POLICY "Admins can insert rating scores"
  ON public.rating_score FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update rating scores" ON public.rating_score;
CREATE POLICY "Admins can update rating scores"
  ON public.rating_score FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can delete rating scores" ON public.rating_score;
CREATE POLICY "Admins can delete rating scores"
  ON public.rating_score FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 5. PLAYER_RATING_SCORE (has dormant anon SELECT policy — drop and recreate)
-- =============================================================================

ALTER TABLE public.player_rating_score ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon users can view player ratings" ON public.player_rating_score;
DROP POLICY IF EXISTS "Anyone can view player rating scores" ON public.player_rating_score;
CREATE POLICY "Anyone can view player rating scores"
  ON public.player_rating_score FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Players can insert own rating scores" ON public.player_rating_score;
CREATE POLICY "Players can insert own rating scores"
  ON public.player_rating_score FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Player or admin can update rating scores" ON public.player_rating_score;
CREATE POLICY "Player or admin can update rating scores"
  ON public.player_rating_score FOR UPDATE
  TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

DROP POLICY IF EXISTS "Player or admin can delete rating scores" ON public.player_rating_score;
CREATE POLICY "Player or admin can delete rating scores"
  ON public.player_rating_score FOR DELETE
  TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())
  );

-- =============================================================================
-- 6. PLAYER_AVAILABILITY
-- =============================================================================

ALTER TABLE public.player_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view player availability" ON public.player_availability;
CREATE POLICY "Authenticated users can view player availability"
  ON public.player_availability FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Players can insert own availability" ON public.player_availability;
CREATE POLICY "Players can insert own availability"
  ON public.player_availability FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "Players can update own availability" ON public.player_availability;
CREATE POLICY "Players can update own availability"
  ON public.player_availability FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid());

DROP POLICY IF EXISTS "Players can delete own availability" ON public.player_availability;
CREATE POLICY "Players can delete own availability"
  ON public.player_availability FOR DELETE
  TO authenticated
  USING (player_id = auth.uid());

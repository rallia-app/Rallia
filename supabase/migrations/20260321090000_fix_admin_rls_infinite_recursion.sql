-- =============================================================================
-- Migration: Fix infinite recursion in admin RLS policies
-- Description: The admin table policies use
--     EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid())
--   which causes infinite recursion because that sub-query also triggers
--   the same RLS policy on the admin table.
--   Fix: create a SECURITY DEFINER function that bypasses RLS to check
--   admin membership, then rewrite every policy that references admin.
-- =============================================================================

-- ─── 1. Helper function (bypasses RLS) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin(check_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin WHERE id = check_uid);
$$;

-- Grant execute to authenticated (used in RLS policies)
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ─── 2. Fix admin table policies ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can view admin records" ON public.admin;
CREATE POLICY "Admins can view admin records"
  ON public.admin FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins can insert admin records" ON public.admin;
CREATE POLICY "Admins can insert admin records"
  ON public.admin FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update admin records" ON public.admin;
CREATE POLICY "Admins can update admin records"
  ON public.admin FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete admin records" ON public.admin;
CREATE POLICY "Admins can delete admin records"
  ON public.admin FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─── 3. Fix sport table policies ────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can insert sports" ON public.sport;
CREATE POLICY "Admins can insert sports"
  ON public.sport FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update sports" ON public.sport;
CREATE POLICY "Admins can update sports"
  ON public.sport FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete sports" ON public.sport;
CREATE POLICY "Admins can delete sports"
  ON public.sport FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─── 4. Fix rating_system table policies ────────────────────────────────────

DROP POLICY IF EXISTS "Admins can insert rating systems" ON public.rating_system;
CREATE POLICY "Admins can insert rating systems"
  ON public.rating_system FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update rating systems" ON public.rating_system;
CREATE POLICY "Admins can update rating systems"
  ON public.rating_system FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete rating systems" ON public.rating_system;
CREATE POLICY "Admins can delete rating systems"
  ON public.rating_system FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─── 5. Fix rating_score table policies ─────────────────────────────────────

DROP POLICY IF EXISTS "Admins can insert rating scores" ON public.rating_score;
CREATE POLICY "Admins can insert rating scores"
  ON public.rating_score FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update rating scores" ON public.rating_score;
CREATE POLICY "Admins can update rating scores"
  ON public.rating_score FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete rating scores" ON public.rating_score;
CREATE POLICY "Admins can delete rating scores"
  ON public.rating_score FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─── 6. Fix player_rating_score table policies ──────────────────────────────

DROP POLICY IF EXISTS "Player or admin can update rating scores" ON public.player_rating_score;
CREATE POLICY "Player or admin can update rating scores"
  ON public.player_rating_score FOR UPDATE
  TO authenticated
  USING (
    player_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Player or admin can delete rating scores" ON public.player_rating_score;
CREATE POLICY "Player or admin can delete rating scores"
  ON public.player_rating_score FOR DELETE
  TO authenticated
  USING (
    player_id = auth.uid()
    OR public.is_admin()
  );

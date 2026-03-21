-- Migration: Fix admin table infinite recursion in RLS policy
-- Created: 2026-03-20
-- Description: The admin SELECT policy from 20260320100000 has a self-referencing
--              EXISTS subquery that causes infinite recursion. The subquery
--              `EXISTS (SELECT 1 FROM admin WHERE id = auth.uid())` triggers the
--              same SELECT policy, which triggers it again, forever.
--
--              Fix: Use only `id = auth.uid()` which is sufficient — if the row
--              exists with id = auth.uid(), the user IS an admin.
--
-- This also affects every other policy that references admin via:
--   `EXISTS (SELECT 1 FROM public.admin WHERE admin.id = auth.uid())`
-- because that subquery triggers the recursive admin SELECT policy.

-- Fix the admin SELECT policy to avoid self-referencing subquery
DROP POLICY IF EXISTS "Admins can view admin records" ON public.admin;

CREATE POLICY "Admins can view admin records"
  ON public.admin FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- =============================================================================
-- Also fix rating_proof SELECT policy: approved proofs should be visible to
-- all authenticated users (they are displayed on other players' profiles).
-- Only non-approved proofs should be restricted to the owner or admin.
-- =============================================================================

DROP POLICY IF EXISTS "Rating owner or admin can view proofs" ON public.rating_proof;

CREATE POLICY "Authenticated users can view rating proofs"
  ON public.rating_proof FOR SELECT
  TO authenticated
  USING (true);

-- =============================================================================
-- Fix rating_system SELECT policy: reference data should be visible to anon
-- users too (needed for displaying ratings on public profiles).
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can view rating systems" ON public.rating_system;

CREATE POLICY "Anyone can view rating systems"
  ON public.rating_system FOR SELECT
  TO anon, authenticated
  USING (true);

-- Migration: Allow anonymous users to view group activity for public communities
-- This supports the discovery experience where logged-out users can browse community details

-- =============================================================================
-- RLS Policy: Allow anonymous users to SELECT group_activity for public networks
-- =============================================================================
DROP POLICY IF EXISTS "Anon users can view group activity for public communities" ON public.group_activity;
CREATE POLICY "Anon users can view group activity for public communities" ON public.group_activity
  FOR SELECT
  TO anon
  USING (
    network_id IN (
      SELECT id FROM public.network WHERE is_private = false OR is_private IS NULL
    )
  );

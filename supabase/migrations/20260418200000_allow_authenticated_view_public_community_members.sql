-- Migration: Allow authenticated non-members to view members of public communities
-- Issue: Authenticated users who are NOT members of a public community cannot see
--        the member list (avatars), even though anonymous users CAN (via the anon policy).
--        This is because the network_member_select policy only checks is_network_member,
--        is_network_creator, or player_id = auth.uid().
-- Fix: Add a permissive SELECT policy for authenticated users on public communities,
--      mirroring the existing anon policy from 20260314000001.

DROP POLICY IF EXISTS "Authenticated users can view public community members" ON public.network_member;

CREATE POLICY "Authenticated users can view public community members"
  ON public.network_member
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.network n
      WHERE n.id = network_member.network_id
        AND (n.is_private = false OR n.is_private IS NULL)
    )
  );

-- Migration: Allow members to update their own membership status (for leaving groups)
-- Issue: The UPDATE policy only allowed moderators/creators, preventing regular members from leaving

-- Drop existing update policy (both possible names from different migrations)
DROP POLICY IF EXISTS "Moderators can update members" ON public.network_member;
DROP POLICY IF EXISTS "network_member_update_policy" ON public.network_member;

-- Create new update policy that allows:
-- 1. Moderators/creators to update any member
-- 2. Regular members to update their own status (for leaving)
CREATE POLICY "Members can update own status" ON public.network_member
  FOR UPDATE
  USING (
    -- Moderators and creators can update any member
    is_network_moderator(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    -- Members can update their own record (for leaving)
    OR player_id = auth.uid()
  )
  WITH CHECK (
    -- Moderators and creators can set any status
    is_network_moderator(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    -- Regular members can only set their own status to 'removed' (leaving)
    OR (player_id = auth.uid() AND status = 'removed')
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Members can update own status" ON public.network_member IS
  'Allow moderators/creators to update any member, and regular members to update their own status to "removed" (leaving the group)';

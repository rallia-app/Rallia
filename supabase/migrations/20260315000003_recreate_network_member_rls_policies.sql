-- Migration: Ensure network_member RLS policies exist with proper member self-update capability
-- This migration recreates all necessary policies with proper permissions

-- First, ensure RLS is enabled
ALTER TABLE public.network_member ENABLE ROW LEVEL SECURITY;

-- Drop ALL possible policy names (clean slate)
DROP POLICY IF EXISTS "Members can view network members" ON public.network_member;
DROP POLICY IF EXISTS "Members can add members" ON public.network_member;
DROP POLICY IF EXISTS "Moderators can update members" ON public.network_member;
DROP POLICY IF EXISTS "Moderators can remove members" ON public.network_member;
DROP POLICY IF EXISTS "Members can update own status" ON public.network_member;
DROP POLICY IF EXISTS "network_member_select_policy" ON public.network_member;
DROP POLICY IF EXISTS "network_member_insert_policy" ON public.network_member;
DROP POLICY IF EXISTS "network_member_update_policy" ON public.network_member;
DROP POLICY IF EXISTS "network_member_delete_policy" ON public.network_member;
DROP POLICY IF EXISTS "Users can view their own membership" ON public.network_member;

-- SELECT: Members can view members of networks they belong to
CREATE POLICY "network_member_select" ON public.network_member
  FOR SELECT
  USING (
    is_network_member(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    OR player_id = auth.uid()
  );

-- INSERT: Members can add new members (only as regular members, not moderators)
CREATE POLICY "network_member_insert" ON public.network_member
  FOR INSERT
  WITH CHECK (
    (
      is_network_member(network_id, auth.uid())
      OR is_network_creator(network_id, auth.uid())
    )
    AND (
      role = 'member'
      OR is_network_moderator(network_id, auth.uid())
      OR is_network_creator(network_id, auth.uid())
    )
  );

-- UPDATE: Moderators can update any member, members can update their own status to 'removed' (leave)
CREATE POLICY "network_member_update" ON public.network_member
  FOR UPDATE
  USING (
    is_network_moderator(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    OR player_id = auth.uid()
  )
  WITH CHECK (
    is_network_moderator(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    OR (player_id = auth.uid() AND status = 'removed')
  );

-- DELETE: Moderators can remove members, members can remove themselves
CREATE POLICY "network_member_delete" ON public.network_member
  FOR DELETE
  USING (
    is_network_moderator(network_id, auth.uid())
    OR is_network_creator(network_id, auth.uid())
    OR player_id = auth.uid()
  );

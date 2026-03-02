-- =============================================================================
-- Migration: Fix RLS recursion in network and network_member policies (v2)
-- Description: Complete fix for infinite recursion by using SECURITY DEFINER functions
-- This migration is idempotent and can be safely re-run
-- =============================================================================

-- Check if role column exists before proceeding with the entire migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'network_member' 
    AND column_name = 'role'
  ) THEN
    RAISE NOTICE 'role column does not exist on network_member - skipping RLS recursion fix';
    RETURN;
  END IF;

  -- =============================================================================
  -- STEP 1: Create/Replace helper functions with SECURITY DEFINER
  -- =============================================================================
  
  -- Function to check if user is a member of a network
  EXECUTE $func$
  CREATE OR REPLACE FUNCTION is_network_member(network_id_param UUID, user_id_param UUID)
  RETURNS BOOLEAN
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  STABLE
  AS $inner$
    SELECT EXISTS (
      SELECT 1 FROM public.network_member
      WHERE network_id = network_id_param
      AND player_id = user_id_param
      AND status = 'active'
    );
  $inner$;
  $func$;

  -- Function to check if user is a moderator of a network
  EXECUTE $func$
  CREATE OR REPLACE FUNCTION is_network_moderator(network_id_param UUID, user_id_param UUID)
  RETURNS BOOLEAN
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  STABLE
  AS $inner$
    SELECT EXISTS (
      SELECT 1 FROM public.network_member
      WHERE network_id = network_id_param
      AND player_id = user_id_param
      AND role = 'moderator'
      AND status = 'active'
    );
  $inner$;
  $func$;

  -- Function to check if user is the creator of a network
  EXECUTE $func$
  CREATE OR REPLACE FUNCTION is_network_creator(network_id_param UUID, user_id_param UUID)
  RETURNS BOOLEAN
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  STABLE
  AS $inner$
    SELECT EXISTS (
      SELECT 1 FROM public.network
      WHERE id = network_id_param
      AND created_by = user_id_param
    );
  $inner$;
  $func$;

  -- =============================================================================
  -- STEP 2: Drop ALL existing policies on network_member (clean slate)
  -- =============================================================================
  DROP POLICY IF EXISTS "Members can view network members" ON public.network_member;
  DROP POLICY IF EXISTS "Members can add members" ON public.network_member;
  DROP POLICY IF EXISTS "Moderators can update members" ON public.network_member;
  DROP POLICY IF EXISTS "Moderators can remove members" ON public.network_member;
  DROP POLICY IF EXISTS "Users can view their own membership" ON public.network_member;
  DROP POLICY IF EXISTS "network_member_select_policy" ON public.network_member;
  DROP POLICY IF EXISTS "network_member_insert_policy" ON public.network_member;
  DROP POLICY IF EXISTS "network_member_update_policy" ON public.network_member;
  DROP POLICY IF EXISTS "network_member_delete_policy" ON public.network_member;

  -- =============================================================================
  -- STEP 3: Create new non-recursive policies for network_member
  -- =============================================================================

  -- Members can view members of networks they belong to
  EXECUTE $policy$
  CREATE POLICY "Members can view network members" ON public.network_member
    FOR SELECT
    USING (
      is_network_member(network_id, auth.uid())
      OR is_network_creator(network_id, auth.uid())
      OR player_id = auth.uid()
    );
  $policy$;

  -- Members can add new members
  EXECUTE $policy$
  CREATE POLICY "Members can add members" ON public.network_member
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
  $policy$;

  -- Only moderators can update member status/role
  EXECUTE $policy$
  CREATE POLICY "Moderators can update members" ON public.network_member
    FOR UPDATE
    USING (
      is_network_moderator(network_id, auth.uid())
      OR is_network_creator(network_id, auth.uid())
    );
  $policy$;

  -- Moderators can remove members, or members can remove themselves
  EXECUTE $policy$
  CREATE POLICY "Moderators can remove members" ON public.network_member
    FOR DELETE
    USING (
      is_network_moderator(network_id, auth.uid())
      OR is_network_creator(network_id, auth.uid())
      OR player_id = auth.uid()
    );
  $policy$;

  -- =============================================================================
  -- STEP 4: Drop ALL existing policies on network table (clean slate)
  -- =============================================================================
  DROP POLICY IF EXISTS "Members can view their networks" ON public.network;
  DROP POLICY IF EXISTS "Users can create networks" ON public.network;
  DROP POLICY IF EXISTS "Moderators can update network" ON public.network;
  DROP POLICY IF EXISTS "Creator can delete network" ON public.network;
  DROP POLICY IF EXISTS "network_select_policy" ON public.network;
  DROP POLICY IF EXISTS "network_insert_policy" ON public.network;
  DROP POLICY IF EXISTS "network_update_policy" ON public.network;
  DROP POLICY IF EXISTS "network_delete_policy" ON public.network;

  -- =============================================================================
  -- STEP 5: Create new non-recursive policies for network table
  -- =============================================================================

  -- Members can view networks they belong to
  EXECUTE $policy$
  CREATE POLICY "Members can view their networks" ON public.network
    FOR SELECT
    USING (
      created_by = auth.uid()
      OR is_network_member(id, auth.uid())
    );
  $policy$;

  -- Only authenticated users can create networks
  EXECUTE $policy$
  CREATE POLICY "Users can create networks" ON public.network
    FOR INSERT
    WITH CHECK (auth.uid() = created_by);
  $policy$;

  -- Only creator or moderators can update network
  EXECUTE $policy$
  CREATE POLICY "Moderators can update network" ON public.network
    FOR UPDATE
    USING (
      created_by = auth.uid()
      OR is_network_moderator(id, auth.uid())
    );
  $policy$;

  -- Only creator can delete network
  EXECUTE $policy$
  CREATE POLICY "Creator can delete network" ON public.network
    FOR DELETE
    USING (created_by = auth.uid());
  $policy$;

  -- =============================================================================
  -- STEP 6: Grant execute permissions on helper functions
  -- =============================================================================
  GRANT EXECUTE ON FUNCTION is_network_member(UUID, UUID) TO authenticated;
  GRANT EXECUTE ON FUNCTION is_network_moderator(UUID, UUID) TO authenticated;
  GRANT EXECUTE ON FUNCTION is_network_creator(UUID, UUID) TO authenticated;

  -- =============================================================================
  -- STEP 7: Verify RLS is enabled
  -- =============================================================================
  ALTER TABLE public.network ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.network_member ENABLE ROW LEVEL SECURITY;

  RAISE NOTICE 'RLS recursion fix applied successfully!';
END $$;

-- Migration: Allow network members to view private matches shared into their groups/communities
--
-- Context
-- -------
-- Private matches have two opt-in visibility flags set at creation time:
--   * match.visible_in_groups        (default true) — show in the creator's groups
--   * match.visible_in_communities   (default true) — show in the creator's communities
--
-- The app-level query in getNetworkMemberUpcomingMatches already returns those
-- matches, but the row-level security policies on `match` only allow SELECT for
-- the creator, joined participants, or fully public matches. As a result, a
-- private match that the creator wanted to share with their groups was being
-- silently filtered out by RLS for every viewer that wasn't the creator/a
-- participant — so the Games tab in a group or community never surfaced these
-- matches.
--
-- This migration plugs that hole by adding two narrowly scoped SELECT policies
-- that grant visibility on a private match when:
--   * the match's matching visibility flag is true, AND
--   * the viewer shares an active network membership with the creator in a
--     network of the matching type (player_group or community).

-- =============================================================================
-- HELPER: shares_active_network_of_type
-- Returns true when two players are both active members of at least one
-- network of the requested type. SECURITY DEFINER so it bypasses RLS on
-- network_member while answering the policy check.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.shares_active_network_of_type(
    p_player_a UUID,
    p_player_b UUID,
    p_network_type_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.network_member nm_a
        JOIN public.network_member nm_b
          ON nm_b.network_id = nm_a.network_id
        JOIN public.network n
          ON n.id = nm_a.network_id
        JOIN public.network_type nt
          ON nt.id = n.network_type_id
        WHERE nm_a.player_id = p_player_a
          AND nm_b.player_id = p_player_b
          AND nm_a.status = 'active'
          AND nm_b.status = 'active'
          AND nt.name = p_network_type_name
    );
$$;

COMMENT ON FUNCTION public.shares_active_network_of_type(UUID, UUID, TEXT) IS
  'True when both players are active members of at least one network of the given type (player_group or community). Used by match RLS to grant visibility on private matches shared into a network.';

GRANT EXECUTE ON FUNCTION public.shares_active_network_of_type(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_active_network_of_type(UUID, UUID, TEXT) TO service_role;

-- =============================================================================
-- RLS POLICIES on public.match
-- Additive — existing policies (creator/participant/public) remain untouched.
-- =============================================================================
DROP POLICY IF EXISTS "match_select_private_in_shared_group" ON public.match;
CREATE POLICY "match_select_private_in_shared_group"
ON public.match
FOR SELECT
TO authenticated
USING (
    visibility = 'private'
    AND visible_in_groups = true
    AND public.shares_active_network_of_type(created_by, auth.uid(), 'player_group')
);

DROP POLICY IF EXISTS "match_select_private_in_shared_community" ON public.match;
CREATE POLICY "match_select_private_in_shared_community"
ON public.match
FOR SELECT
TO authenticated
USING (
    visibility = 'private'
    AND visible_in_communities = true
    AND public.shares_active_network_of_type(created_by, auth.uid(), 'community')
);

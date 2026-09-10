-- ============================================================================
-- A game shared into a community shows who is in it
-- ============================================================================
-- `match` was taught about network-shared private games in
-- match_select_private_in_shared_community / _in_shared_group.
-- `match_participant` never was: its SELECT policies are self, creator,
-- co-participant and is_public_match. So a community member could read the
-- game row and none of its participation rows, and every surface that counts
-- joined players counted zero.
--
-- Live on prod 2026-09-08: Wes D's singles game in "Monkland Ace — Tennis
-- Intermédiaire" (private, visible_in_communities) was full — himself plus
-- Louai — and the chat card offered "2 spots left". The detail sheet drew the
-- host from created_by_player (a join on `match`, still readable) on top of a
-- full set of empty slots, so a 2-player game showed 3 seats. joinMatch sized
-- the game off the same empty list, so the Join button was live on a full game.
--
-- Widening access, so a new permissive policy is the right shape here: SELECT
-- policies are OR'd and the existing four stay exactly as they are.
--
-- The predicate goes through a SECURITY DEFINER helper rather than inlining a
-- subquery on `match`: match's own policies read match_participant through
-- is_match_participant, and an inlined subquery would recurse back into them.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_network_shared_match(p_match_id uuid, p_viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.match m
        WHERE m.id = p_match_id
          AND m.visibility = 'private'
          AND (
                (m.visible_in_communities
                 AND public.shares_active_network_of_type(m.created_by, p_viewer, 'community'))
             OR (m.visible_in_groups
                 AND public.shares_active_network_of_type(m.created_by, p_viewer, 'player_group'))
              )
    );
$$;

COMMENT ON FUNCTION public.is_network_shared_match(uuid, uuid) IS
'True when a private game was shared into a community or player group the
viewer shares with its host. Mirrors the two match_select_private_in_shared_*
policies; SECURITY DEFINER because match''s own policies read match_participant.';

REVOKE ALL ON FUNCTION public.is_network_shared_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_network_shared_match(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "match_participant_select_network_shared" ON match_participant;

CREATE POLICY "match_participant_select_network_shared"
ON match_participant FOR SELECT
TO authenticated
USING (public.is_network_shared_match(match_id, (SELECT auth.uid())));

COMMENT ON POLICY "match_participant_select_network_shared" ON match_participant IS
'Lets members of a community or player group see who is in a private game
shared into it. Without this the game row is readable and its participants are
not, so spot counts and avatar rows read the game as empty.';

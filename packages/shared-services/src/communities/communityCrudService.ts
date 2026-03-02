/**
 * Community CRUD Service
 * Create, read, update, delete operations for communities
 * Reuses network infrastructure with community-specific logic
 */

import { supabase } from '../supabase';
import type {
  Community,
  CommunityWithStatus,
  CommunityWithMembers,
  CommunityMember,
  CreateCommunityInput,
  UpdateCommunityInput,
  PendingMemberRequest,
} from './communityTypes';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Get the community network type ID
 */
export async function getCommunityTypeId(): Promise<string> {
  const { data, error } = await supabase
    .from('network_type')
    .select('id')
    .eq('name', 'community')
    .single();

  if (error || !data) {
    throw new Error('Community type not found');
  }

  return data.id;
}

/**
 * Check if a player is a community moderator
 */
async function checkIsCommunityModerator(communityId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('network_member')
    .select('role')
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .single();

  if (error || !data) return false;
  return data.role === 'moderator';
}

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

/**
 * Create a new community
 * @param playerId - ID of the player creating the community
 * @param input - Community creation input
 * @returns The created community
 */
export async function createCommunity(
  playerId: string,
  input: CreateCommunityInput
): Promise<Community> {
  const typeId = await getCommunityTypeId();

  const { data, error } = await supabase
    .from('network')
    .insert({
      network_type_id: typeId,
      name: input.name,
      description: input.description || null,
      cover_image_url: input.cover_image_url || null,
      is_private: !(input.is_public ?? true), // Default to public
      max_members: null, // Communities have no member limit
      created_by: playerId,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating community:', error);
    throw new Error(error.message);
  }

  // Transform is_private to is_public for the response
  return {
    ...data,
    is_public: !data.is_private,
    max_members: null,
  } as Community;
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get a community by ID
 */
export async function getCommunity(communityId: string): Promise<Community | null> {
  const { data, error } = await supabase.from('network').select('*').eq('id', communityId).single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('Error fetching community:', error);
    throw new Error(error.message);
  }

  return {
    ...data,
    is_public: !data.is_private,
    max_members: null,
  } as Community;
}

/**
 * Get a community with its members
 */
export async function getCommunityWithMembers(
  communityId: string
): Promise<CommunityWithMembers | null> {
  const { data: community, error: communityError } = await supabase
    .from('network')
    .select('*')
    .eq('id', communityId)
    .single();

  if (communityError) {
    if (communityError.code === 'PGRST116') return null;
    console.error('Error fetching community:', communityError);
    throw new Error(communityError.message);
  }

  const { data: members, error: membersError } = await supabase
    .from('network_member')
    .select(
      `
      *,
      player:player_id (
        id,
        profile (
          first_name,
          last_name,
          display_name,
          profile_picture_url,
          last_active_at
        )
      )
    `
    )
    .eq('network_id', communityId)
    .eq('status', 'active')
    .order('role', { ascending: false }) // Moderators first
    .order('joined_at', { ascending: true });

  if (membersError) {
    console.error('Error fetching members:', membersError);
    throw new Error(membersError.message);
  }

  return {
    ...community,
    is_public: !community.is_private,
    max_members: null,
    members: members as CommunityMember[],
  };
}

/**
 * Get all public communities for discovery
 * Returns communities with membership status for the current user
 */
export async function getPublicCommunities(playerId?: string): Promise<CommunityWithStatus[]> {
  const { data, error } = await supabase.rpc('get_public_communities', {
    p_player_id: playerId || null,
  });

  if (error) {
    console.error('Error fetching public communities:', error);
    throw new Error(error.message);
  }

  return (data || []).map((c: Record<string, unknown>) => ({
    ...c,
    is_public: true,
    max_members: null,
  })) as CommunityWithStatus[];
}

/**
 * Get all communities for a player (communities they are a member of)
 */
export async function getPlayerCommunities(playerId: string): Promise<CommunityWithStatus[]> {
  const { data, error } = await supabase.rpc('get_player_communities', { p_player_id: playerId });

  if (error) {
    console.error('Error fetching player communities:', error);
    throw new Error(error.message);
  }

  return (data || []).map((c: Record<string, unknown>) => ({
    ...c,
    is_public: !c.is_private, // Transform from DB field
    max_members: null,
  })) as CommunityWithStatus[];
}

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

/**
 * Update a community (moderators only)
 */
export async function updateCommunity(
  communityId: string,
  playerId: string,
  input: UpdateCommunityInput
): Promise<Community> {
  // Verify the player is a moderator
  const isMod = await checkIsCommunityModerator(communityId, playerId);
  if (!isMod) {
    throw new Error('Only moderators can update the community');
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    updateData.name = input.name;
  }
  if (input.description !== undefined) {
    updateData.description = input.description;
  }
  if (input.cover_image_url !== undefined) {
    updateData.cover_image_url = input.cover_image_url;
  }
  if (input.is_public !== undefined) {
    updateData.is_private = !input.is_public;
  }

  const { data, error } = await supabase
    .from('network')
    .update(updateData)
    .eq('id', communityId)
    .select()
    .single();

  if (error) {
    console.error('Error updating community:', error);
    throw new Error(error.message);
  }

  return {
    ...data,
    is_public: !data.is_private,
    max_members: null,
  } as Community;
}

// ============================================================================
// DELETE OPERATIONS
// ============================================================================

/**
 * Delete a community (creator only)
 */
export async function deleteCommunity(communityId: string, playerId: string): Promise<void> {
  // Verify the player is the creator
  const community = await getCommunity(communityId);
  if (!community || community.created_by !== playerId) {
    throw new Error('Only the community creator can delete the community');
  }

  const { error } = await supabase.from('network').delete().eq('id', communityId);

  if (error) {
    console.error('Error deleting community:', error);
    throw new Error(error.message);
  }
}

// ============================================================================
// MEMBERSHIP OPERATIONS
// ============================================================================

/**
 * Request to join a public community
 */
export async function requestToJoinCommunity(
  communityId: string,
  playerId: string
): Promise<string> {
  const { data, error } = await supabase.rpc('request_to_join_community', {
    p_community_id: communityId,
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error requesting to join community:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Refer a player to join a community (member referral)
 */
export async function referPlayerToCommunity(
  communityId: string,
  referredPlayerId: string,
  referrerId: string
): Promise<string> {
  const { data, error } = await supabase.rpc('refer_player_to_community', {
    p_community_id: communityId,
    p_referred_player_id: referredPlayerId,
    p_referrer_id: referrerId,
  });

  if (error) {
    console.error('Error referring player to community:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Approve a pending membership request (moderators only)
 */
export async function approveCommunityMember(
  communityId: string,
  memberId: string,
  approverId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('approve_community_member', {
    p_community_id: communityId,
    p_member_id: memberId,
    p_approver_id: approverId,
  });

  if (error) {
    console.error('Error approving community member:', error);
    throw new Error(error.message);
  }

  return data as boolean;
}

/**
 * Reject a pending membership request (moderators only)
 */
export async function rejectCommunityMember(
  communityId: string,
  memberId: string,
  rejectorId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('reject_community_member', {
    p_community_id: communityId,
    p_member_id: memberId,
    p_rejector_id: rejectorId,
  });

  if (error) {
    console.error('Error rejecting community member:', error);
    throw new Error(error.message);
  }

  return data as boolean;
}

/**
 * Get pending membership requests for a community (moderators only)
 */
export async function getPendingCommunityMembers(
  communityId: string,
  moderatorId: string
): Promise<PendingMemberRequest[]> {
  const { data, error } = await supabase.rpc('get_pending_community_members', {
    p_community_id: communityId,
    p_moderator_id: moderatorId,
  });

  if (error) {
    console.error('Error fetching pending community members:', error);
    throw new Error(error.message);
  }

  return data as PendingMemberRequest[];
}

/**
 * Check if a player is a community member
 */
export async function isCommunityMember(communityId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('network_member')
    .select('id')
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    console.error('Error checking community membership:', error);
    return false;
  }

  return !!data;
}

/**
 * Check if a player is a community moderator
 */
export async function isCommunityModerator(
  communityId: string,
  playerId: string
): Promise<boolean> {
  return checkIsCommunityModerator(communityId, playerId);
}

/**
 * Get a player's membership status in a community
 */
export async function getCommunityMembershipStatus(
  communityId: string,
  playerId: string
): Promise<{ isMember: boolean; status: string | null; role: string | null }> {
  const { data, error } = await supabase
    .from('network_member')
    .select('status, role')
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    console.error('Error checking membership status:', error);
    return { isMember: false, status: null, role: null };
  }

  if (!data) {
    return { isMember: false, status: null, role: null };
  }

  return {
    isMember: data.status === 'active',
    status: data.status,
    role: data.role,
  };
}

/**
 * Check if a player can access community features
 * Uses the check_community_access RPC to determine access eligibility
 */
export async function checkCommunityAccess(
  communityId: string,
  playerId?: string
): Promise<{
  canAccess: boolean;
  isMember: boolean;
  membershipStatus: string | null;
  membershipRole: string | null;
  isPublic: boolean;
  hasActiveModerator: boolean;
  accessReason: string;
}> {
  interface CheckCommunityAccessResponse {
    can_access: boolean;
    is_member: boolean;
    membership_status: string | null;
    membership_role: string | null;
    is_public: boolean;
    has_active_moderator: boolean;
    access_reason: string;
  }

  const { data, error } = await supabase
    .rpc('check_community_access', { 
      p_community_id: communityId, 
      p_player_id: playerId || null 
    })
    .single<CheckCommunityAccessResponse>();

  if (error) {
    console.error('Error checking community access:', error);
    // Default to no access on error
    return {
      canAccess: false,
      isMember: false,
      membershipStatus: null,
      membershipRole: null,
      isPublic: false,
      hasActiveModerator: false,
      accessReason: 'Error checking access',
    };
  }

  return {
    canAccess: data.can_access,
    isMember: data.is_member,
    membershipStatus: data.membership_status,
    membershipRole: data.membership_role,
    isPublic: data.is_public,
    hasActiveModerator: data.has_active_moderator,
    accessReason: data.access_reason,
  };
}

/**
 * Leave a community
 */
export async function leaveCommunity(communityId: string, playerId: string): Promise<void> {
  // Check if the player is the creator
  const community = await getCommunity(communityId);
  if (community?.created_by === playerId) {
    throw new Error(
      'The creator cannot leave the community. Transfer ownership or delete the community instead.'
    );
  }

  const { error } = await supabase
    .from('network_member')
    .update({ status: 'removed' })
    .eq('network_id', communityId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error leaving community:', error);
    throw new Error(error.message);
  }
}

/**
 * Add a member directly to a community (MODERATORS ONLY)
 * - Only moderators can directly add members without approval
 * - Moderators can also add members as moderators
 */
export async function addCommunityMember(
  communityId: string,
  playerId: string,
  moderatorId: string,
  addAsModerator: boolean = false
): Promise<void> {
  // Verify the adder is a moderator
  const isMod = await checkIsCommunityModerator(communityId, moderatorId);
  if (!isMod) {
    throw new Error('Only moderators can directly add members to a community');
  }

  const role = addAsModerator ? 'moderator' : 'member';

  // Check if already a member or has pending request
  const { data: existing } = await supabase
    .from('network_member')
    .select('id, status')
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'active') {
      throw new Error('Player is already a member of this community');
    }
    if (existing.status === 'pending') {
      // Moderator is approving the pending request directly
      const { error } = await supabase
        .from('network_member')
        .update({
          status: 'active',
          role,
          joined_at: new Date().toISOString(),
          added_by: moderatorId,
        })
        .eq('id', existing.id);

      if (error) throw new Error(error.message);
      return;
    }
    // Reactivate if they were previously removed
    const { error } = await supabase
      .from('network_member')
      .update({
        status: 'active',
        role,
        joined_at: new Date().toISOString(),
        added_by: moderatorId,
        request_type: 'direct_add',
      })
      .eq('id', existing.id);

    if (error) throw new Error(error.message);
    return;
  }

  // Add new member
  const { error } = await supabase.from('network_member').insert({
    network_id: communityId,
    player_id: playerId,
    status: 'active',
    role,
    added_by: moderatorId,
    request_type: 'direct_add',
    joined_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error adding community member:', error);
    throw new Error(error.message);
  }
}

/**
 * Remove a member from the community (moderators only)
 */
export async function removeCommunityMember(
  communityId: string,
  playerId: string,
  moderatorId: string
): Promise<void> {
  // Verify the moderator has permission
  const isMod = await checkIsCommunityModerator(communityId, moderatorId);
  if (!isMod) {
    throw new Error('Only moderators can remove members');
  }

  // Can't remove the creator
  const community = await getCommunity(communityId);
  if (community?.created_by === playerId) {
    throw new Error('Cannot remove the community creator');
  }

  const { error } = await supabase
    .from('network_member')
    .update({ status: 'removed' })
    .eq('network_id', communityId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error removing community member:', error);
    throw new Error(error.message);
  }
}

/**
 * Promote a member to moderator (moderators only)
 */
export async function promoteCommunityMember(
  communityId: string,
  playerId: string,
  promoterId: string
): Promise<void> {
  const isMod = await checkIsCommunityModerator(communityId, promoterId);
  if (!isMod) {
    throw new Error('Only moderators can promote members');
  }

  const { error } = await supabase
    .from('network_member')
    .update({ role: 'moderator' })
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .eq('status', 'active');

  if (error) {
    console.error('Error promoting member:', error);
    throw new Error(error.message);
  }
}

/**
 * Demote a moderator to member (creator only)
 */
export async function demoteCommunityMember(
  communityId: string,
  playerId: string,
  demoterId: string
): Promise<void> {
  // Only creator can demote moderators
  const community = await getCommunity(communityId);
  if (!community || community.created_by !== demoterId) {
    throw new Error('Only the community creator can demote moderators');
  }

  // Can't demote the creator
  if (playerId === community.created_by) {
    throw new Error('Cannot demote the community creator');
  }

  const { error } = await supabase
    .from('network_member')
    .update({ role: 'member' })
    .eq('network_id', communityId)
    .eq('player_id', playerId)
    .eq('status', 'active');

  if (error) {
    console.error('Error demoting member:', error);
    throw new Error(error.message);
  }
}

// ============================================================================
// INVITE CODE OPERATIONS
// ============================================================================

/**
 * Request to join a community by invite code (from QR scan)
 * This creates a pending membership request for moderator approval
 */
export async function requestToJoinCommunityByInviteCode(
  inviteCode: string,
  playerId: string
): Promise<{ success: boolean; communityId?: string; communityName?: string; error?: string }> {
  // First, look up the community by invite code
  const { data: networkData, error: lookupError } = await supabase
    .from('network')
    .select(
      `
      id,
      name,
      network_type:network_type_id (name)
    `
    )
    .eq('invite_code', inviteCode.toUpperCase())
    .single();

  if (lookupError || !networkData) {
    return {
      success: false,
      error: 'Invalid invite code. This community may not exist or the code has been reset.',
    };
  }

  // Verify it's a community (not a group)
  // Note: Supabase returns single relations as object, not array
  const networkType = networkData.network_type as unknown as { name: string } | null;
  if (networkType?.name !== 'community') {
    return {
      success: false,
      error: 'This invite code is not for a community.',
    };
  }

  // Check if already a member or has pending request
  const { data: existingMember } = await supabase
    .from('network_member')
    .select('status')
    .eq('network_id', networkData.id)
    .eq('player_id', playerId)
    .single();

  if (existingMember) {
    if (existingMember.status === 'active') {
      return {
        success: false,
        communityId: networkData.id,
        communityName: networkData.name,
        error: 'You are already a member of this community.',
      };
    }
    if (existingMember.status === 'pending') {
      return {
        success: false,
        communityId: networkData.id,
        communityName: networkData.name,
        error: 'You already have a pending request to join this community.',
      };
    }
  }

  // Create the membership request using the existing function
  try {
    await requestToJoinCommunity(networkData.id, playerId);
    return {
      success: true,
      communityId: networkData.id,
      communityName: networkData.name,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send join request',
    };
  }
}

/**
 * Get or create an invite code for a community
 */
export async function getOrCreateCommunityInviteCode(communityId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_group_invite_code', {
    group_id: communityId,
  });

  if (error) {
    console.error('Error getting/creating community invite code:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Get the invite link URL for a community
 */
export function getCommunityInviteLink(inviteCode: string): string {
  return `https://rallia.app/community/join/${inviteCode}`;
}

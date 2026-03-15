/**
 * Member Service
 * Member management operations: add, remove, promote, demote, leave
 */

import { supabase } from '../supabase';
import type { GroupMember, Group, GroupWithMembers, GroupActivity } from './groupTypes';

// ============================================================================
// INTERNAL HELPERS (to avoid circular imports)
// ============================================================================

/**
 * Get a group by ID (internal helper)
 */
async function getGroupInternal(groupId: string): Promise<Group | null> {
  const { data, error } = await supabase.from('network').select('*').eq('id', groupId).single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }

  return data as Group;
}

/**
 * Get a group with its members (internal helper)
 */
async function getGroupWithMembersInternal(groupId: string): Promise<GroupWithMembers | null> {
  const { data: group, error: groupError } = await supabase
    .from('network')
    .select('*')
    .eq('id', groupId)
    .single();

  if (groupError) {
    if (groupError.code === 'PGRST116') return null;
    throw new Error(groupError.message);
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
    .eq('network_id', groupId)
    .eq('status', 'active')
    .order('role', { ascending: false })
    .order('joined_at', { ascending: true });

  if (membersError) {
    throw new Error(membersError.message);
  }

  return {
    ...(group as Group),
    members: members as GroupMember[],
  };
}

/**
 * Log a group activity (internal helper to avoid circular import)
 */
async function logActivityInternal(
  groupId: string,
  activityType: GroupActivity['activity_type'],
  actorId: string | null,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!actorId) return;

  const { error } = await supabase.from('group_activity').insert({
    network_id: groupId,
    activity_type: activityType,
    player_id: actorId,
    related_entity_id: targetId || null,
    metadata: metadata || null,
  });

  if (error) {
    console.error('Error logging activity:', error);
  }
}

// ============================================================================
// MEMBER STATUS CHECKS
// ============================================================================

/**
 * Check if a player is a group moderator
 */
export async function isGroupModerator(groupId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('network_member')
    .select('role')
    .eq('network_id', groupId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .single();

  if (error || !data) return false;
  return data.role === 'moderator';
}

/**
 * Check if a player is a group member
 */
export async function isGroupMember(groupId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('network_member')
    .select('id')
    .eq('network_id', groupId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .single();

  return !error && !!data;
}

/**
 * Get all moderator player IDs for a group/network
 */
export async function getGroupModeratorIds(groupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('network_member')
    .select('player_id')
    .eq('network_id', groupId)
    .eq('role', 'moderator')
    .eq('status', 'active');

  if (error || !data) return [];
  return data.map(m => m.player_id);
}

/**
 * Get member info for a player in a group
 */
export async function getGroupMemberInfo(
  groupId: string,
  playerId: string
): Promise<GroupMember | null> {
  const { data, error } = await supabase
    .from('network_member')
    .select(
      `
      *,
      player:player_id (
        id,
        profile:id (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('network_id', groupId)
    .eq('player_id', playerId)
    .single();

  if (error) return null;
  return data as GroupMember;
}

// ============================================================================
// ADD / REMOVE MEMBERS
// ============================================================================

/**
 * Add a member to a group
 * - Members can add other members (as regular members)
 * - Moderators can add other members (as regular members)
 */
export async function addGroupMember(
  groupId: string,
  inviterId: string,
  playerIdToAdd: string
): Promise<GroupMember> {
  // Verify inviter is a member
  const inviterIsMember = await isGroupMember(groupId, inviterId);
  if (!inviterIsMember) {
    throw new Error('You must be a member to add others');
  }

  // Check if the player is already a member
  const existingMember = await getGroupMemberInfo(groupId, playerIdToAdd);
  if (existingMember && existingMember.status === 'active') {
    throw new Error('Player is already a member of this group');
  }

  // Check group capacity (default to 20 if max_members is null)
  const group = await getGroupInternal(groupId);
  const maxMembers = group?.max_members ?? 20;
  if (group && group.member_count >= maxMembers) {
    throw new Error(`Group has reached maximum capacity of ${maxMembers} members`);
  }

  const { data, error } = await supabase
    .from('network_member')
    .upsert(
      {
        network_id: groupId,
        player_id: playerIdToAdd,
        role: 'member',
        added_by: inviterId,
        status: 'active',
        joined_at: new Date().toISOString(),
      },
      {
        onConflict: 'network_id,player_id',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error adding member:', error);
    throw new Error(error.message);
  }

  return data as GroupMember;
}

/**
 * Remove a member from a group (moderators only)
 */
export async function removeGroupMember(
  groupId: string,
  moderatorId: string,
  playerIdToRemove: string
): Promise<void> {
  // Verify the actor is a moderator
  const isMod = await isGroupModerator(groupId, moderatorId);
  if (!isMod) {
    throw new Error('Only moderators can remove members');
  }

  // Cannot remove yourself as moderator if you're the only one
  if (moderatorId === playerIdToRemove) {
    const group = await getGroupWithMembersInternal(groupId);
    const moderators = group?.members.filter(m => m.role === 'moderator') || [];
    if (moderators.length <= 1) {
      throw new Error(
        'Cannot remove the last moderator. Transfer moderator role first or delete the group.'
      );
    }
  }

  const { error } = await supabase
    .from('network_member')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('network_id', groupId)
    .eq('player_id', playerIdToRemove);

  if (error) {
    console.error('Error removing member:', error);
    throw new Error(error.message);
  }
}

/**
 * Leave a group (self-removal)
 * If the leaving member is the LAST moderator, all remaining active members will be promoted to moderator.
 */
export async function leaveGroup(groupId: string, playerId: string): Promise<void> {
  // Check if the player is a moderator by querying their own membership directly
  // This avoids the problematic getGroupMemberInfo which can fail due to RLS edge cases
  const { data: ownMembership, error: membershipError } = await supabase
    .from('network_member')
    .select('id, role, status')
    .eq('network_id', groupId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .maybeSingle();

  // If we can't find an active membership, try the update anyway (like community leave)
  // The update will fail if the user isn't actually a member
  const isModerator = ownMembership?.role === 'moderator';

  // If leaving as moderator, check if there are other moderators remaining
  if (isModerator) {
    // Count other active moderators (excluding the leaving player)
    const { count: otherModeratorCount, error: countError } = await supabase
      .from('network_member')
      .select('id', { count: 'exact', head: true })
      .eq('network_id', groupId)
      .eq('role', 'moderator')
      .eq('status', 'active')
      .neq('player_id', playerId);

    // Only promote all remaining members if this is the LAST moderator
    if (!countError && (otherModeratorCount === null || otherModeratorCount === 0)) {
      const { error: promoteError } = await supabase
        .from('network_member')
        .update({ role: 'moderator', updated_at: new Date().toISOString() })
        .eq('network_id', groupId)
        .eq('status', 'active')
        .neq('player_id', playerId);

      if (promoteError) {
        console.error('Error promoting remaining members to moderator:', promoteError);
        // Continue with leave - promotion failure shouldn't block leaving
      }
    }
  }

  // Perform the leave operation (set status to 'removed')
  const { data: updateData, error } = await supabase
    .from('network_member')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('network_id', groupId)
    .eq('player_id', playerId)
    .eq('status', 'active')
    .select('id');

  if (error) {
    console.error('Error leaving group:', error);
    throw new Error(error.message);
  }

  // If no rows were updated, the player wasn't an active member
  if (!updateData || updateData.length === 0) {
    throw new Error('You are not a member of this group');
  }
}

// ============================================================================
// PROMOTE / DEMOTE MEMBERS
// ============================================================================

/**
 * Promote a member to moderator (moderators only)
 */
export async function promoteMember(
  groupId: string,
  moderatorId: string,
  playerIdToPromote: string
): Promise<GroupMember> {
  const isMod = await isGroupModerator(groupId, moderatorId);
  if (!isMod) {
    throw new Error('Only moderators can promote members');
  }

  const { data, error } = await supabase
    .from('network_member')
    .update({ role: 'moderator', updated_at: new Date().toISOString() })
    .eq('network_id', groupId)
    .eq('player_id', playerIdToPromote)
    .eq('status', 'active')
    .select()
    .single();

  if (error) {
    console.error('Error promoting member:', error);
    throw new Error(error.message);
  }

  // Activity logging is handled by database trigger (log_member_role_change_activity)

  return data as GroupMember;
}

/**
 * Demote a moderator to member (moderators only, cannot demote self if last mod)
 */
export async function demoteMember(
  groupId: string,
  moderatorId: string,
  playerIdToDemote: string
): Promise<GroupMember> {
  const isMod = await isGroupModerator(groupId, moderatorId);
  if (!isMod) {
    throw new Error('Only moderators can demote members');
  }

  // Cannot demote if last moderator
  const group = await getGroupWithMembersInternal(groupId);
  const moderators = group?.members.filter(m => m.role === 'moderator') || [];
  if (moderators.length <= 1 && playerIdToDemote === moderatorId) {
    throw new Error('Cannot demote the last moderator');
  }

  const { data, error } = await supabase
    .from('network_member')
    .update({ role: 'member', updated_at: new Date().toISOString() })
    .eq('network_id', groupId)
    .eq('player_id', playerIdToDemote)
    .eq('status', 'active')
    .select()
    .single();

  if (error) {
    console.error('Error demoting member:', error);
    throw new Error(error.message);
  }

  // Activity logging is handled by database trigger (log_member_role_change_activity)

  return data as GroupMember;
}

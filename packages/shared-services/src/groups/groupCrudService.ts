/**
 * Group CRUD Service
 * Create, read, update, delete operations for groups
 */

import { supabase } from '../supabase';
import type {
  Group,
  GroupWithMembers,
  GroupMember,
  CreateGroupInput,
  UpdateGroupInput,
} from './groupTypes';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Get the player_group network type ID
 */
export async function getPlayerGroupTypeId(): Promise<string> {
  const { data, error } = await supabase
    .from('network_type')
    .select('id')
    .eq('name', 'player_group')
    .single();

  if (error || !data) {
    throw new Error('Player group type not found');
  }

  return data.id;
}

/**
 * Check if a player is a group moderator (internal helper to avoid circular import)
 */
async function checkIsGroupModerator(groupId: string, playerId: string): Promise<boolean> {
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

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

/**
 * Create a new player group
 */
export async function createGroup(playerId: string, input: CreateGroupInput): Promise<Group> {
  const typeId = await getPlayerGroupTypeId();

  const { data, error } = await supabase
    .from('network')
    .insert({
      network_type_id: typeId,
      name: input.name,
      description: input.description || null,
      cover_image_url: input.cover_image_url || null,
      is_private: true, // Groups are always private
      created_by: playerId,
      sport_id: input.sport_id || null, // null means both sports
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating group:', error);
    throw new Error(error.message);
  }

  return data as Group;
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get a group by ID
 */
export async function getGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await supabase.from('network').select('*').eq('id', groupId).single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('Error fetching group:', error);
    throw new Error(error.message);
  }

  return data as Group;
}

/**
 * Get a group with its members
 */
export async function getGroupWithMembers(groupId: string): Promise<GroupWithMembers | null> {
  const { data: group, error: groupError } = await supabase
    .from('network')
    .select('*')
    .eq('id', groupId)
    .single();

  if (groupError) {
    if (groupError.code === 'PGRST116') return null;
    console.error('Error fetching group:', groupError);
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
    .order('role', { ascending: false }) // Moderators first
    .order('joined_at', { ascending: true });

  if (membersError) {
    console.error('Error fetching members:', membersError);
    throw new Error(membersError.message);
  }

  return {
    ...(group as Group),
    members: members as GroupMember[],
  };
}

/**
 * Get all groups for a player (groups they are a member of)
 * Only returns networks with type 'player_group', not communities
 * @param playerId - The player's ID
 * @param sportId - Optional sport ID to filter by (null returns groups for all sports)
 */
export async function getPlayerGroups(playerId: string, sportId?: string | null): Promise<Group[]> {
  const { data, error } = await supabase.rpc('get_player_groups', {
    p_player_id: playerId,
    p_sport_id: sportId || null,
  });

  if (error) {
    console.error('Error fetching player groups:', error);
    throw new Error(error.message);
  }

  return (data || []) as Group[];
}

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

/**
 * Update a group (moderators only)
 */
export async function updateGroup(
  groupId: string,
  playerId: string,
  input: UpdateGroupInput
): Promise<Group> {
  // Verify the player is a moderator
  const isMod = await checkIsGroupModerator(groupId, playerId);
  if (!isMod) {
    throw new Error('Only moderators can update the group');
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
  if (input.sport_id !== undefined) {
    updateData.sport_id = input.sport_id;
  }

  const { data, error } = await supabase
    .from('network')
    .update(updateData)
    .eq('id', groupId)
    .select()
    .single();

  if (error) {
    console.error('Error updating group:', error);
    throw new Error(error.message);
  }

  return data as Group;
}

// ============================================================================
// DELETE OPERATIONS
// ============================================================================

/**
 * Delete a group (creator only)
 */
export async function deleteGroup(groupId: string, playerId: string): Promise<void> {
  // Verify the player is the creator
  const group = await getGroup(groupId);
  if (!group || group.created_by !== playerId) {
    throw new Error('Only the group creator can delete the group');
  }

  const { error } = await supabase.from('network').delete().eq('id', groupId);

  if (error) {
    console.error('Error deleting group:', error);
    throw new Error(error.message);
  }
}

/**
 * Group Invite Service
 * Invite code operations: create, join, reset
 */

import { supabase } from '../supabase';

// ============================================================================
// INVITE CODE OPERATIONS
// ============================================================================

/**
 * Get or create an invite code for a group
 */
export async function getOrCreateGroupInviteCode(groupId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_group_invite_code', {
    group_id: groupId,
  });

  if (error) {
    console.error('Error getting/creating invite code:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Join a group using an invite code
 */
export async function joinGroupByInviteCode(
  inviteCode: string,
  playerId: string
): Promise<{ success: boolean; groupId?: string; groupName?: string; error?: string }> {
  const { data, error } = await supabase.rpc('join_group_by_invite_code', {
    p_invite_code: inviteCode.toUpperCase(),
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error joining group by invite code:', error);
    throw new Error(error.message);
  }

  const result = data as {
    success: boolean;
    group_id?: string;
    group_name?: string;
    error?: string;
  };

  return {
    success: result.success,
    groupId: result.group_id,
    groupName: result.group_name,
    error: result.error,
  };
}

/**
 * Reset (regenerate) the invite code for a group
 * Only moderators can do this
 */
export async function resetGroupInviteCode(groupId: string, moderatorId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reset_group_invite_code', {
    p_group_id: groupId,
    p_moderator_id: moderatorId,
  });

  if (error) {
    console.error('Error resetting invite code:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Get the invite link URL for a group
 */
export function getGroupInviteLink(inviteCode: string): string {
  // Using a custom scheme that can be handled by the app
  // This can be a universal link or deep link depending on your setup
  return `https://rallia.app/join/${inviteCode}`;
}

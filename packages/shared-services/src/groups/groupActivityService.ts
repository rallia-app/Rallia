/**
 * Group Activity Service
 * Activity logging and statistics for groups
 */

import { supabase } from '../supabase';
import type { GroupActivity, GroupStats } from './groupTypes';

// ============================================================================
// ACTIVITY LOGGING
// ============================================================================

/**
 * Log a group activity (for game creation, etc.)
 */
export async function logGroupActivity(
  groupId: string,
  activityType: GroupActivity['activity_type'],
  actorId: string | null,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  // Only insert if we have an actorId (player_id is required in the table)
  if (!actorId) {
    console.warn('Cannot log activity without actorId');
    return;
  }

  const { error } = await supabase
    .from('group_activity')
    .insert({
      network_id: groupId,
      activity_type: activityType,
      player_id: actorId,
      related_entity_id: targetId || null,
      metadata: metadata || null,
    });

  if (error) {
    console.error('Error logging activity:', error);
    // Don't throw - activity logging should not break main operations
  }
}

// ============================================================================
// ACTIVITY RETRIEVAL
// ============================================================================

/**
 * Get recent activity for a group
 */
export async function getGroupActivity(
  groupId: string,
  limit: number = 20
): Promise<GroupActivity[]> {
  const { data, error } = await supabase
    .from('group_activity')
    .select(`
      id,
      network_id,
      player_id,
      activity_type,
      related_entity_id,
      metadata,
      created_at,
      player:player_id (
        id,
        profile (
          first_name,
          last_name,
          profile_picture_url
        )
      )
    `)
    .eq('network_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching group activity:', error);
    // Return empty array if table doesn't exist (PGRST205) to prevent crashes
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      console.warn('group_activity table does not exist - returning empty array');
      return [];
    }
    throw new Error(error.message);
  }

  // Transform data to match GroupActivity interface
  const activities = (data || []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    network_id: item.network_id as string,
    actor_id: item.player_id as string,
    activity_type: item.activity_type as GroupActivity['activity_type'],
    target_id: item.related_entity_id as string | null,
    metadata: item.metadata as Record<string, unknown> | null,
    created_at: item.created_at as string,
    actor: item.player as GroupActivity['actor'],
    added_by_name: null as string | null,
  }));

  // Extract unique added_by IDs from member_joined activities
  const addedByIds = new Set<string>();
  for (const activity of activities) {
    if (activity.activity_type === 'member_joined' && activity.metadata?.added_by) {
      const addedById = activity.metadata.added_by as string;
      // Only fetch if the adder is different from the actor (self-join doesn't need "added by")
      if (addedById !== activity.actor_id) {
        addedByIds.add(addedById);
      }
    }
  }

  // Fetch profiles for all added_by IDs
  if (addedByIds.size > 0) {
    const { data: profiles } = await supabase
      .from('player')
      .select('id, profile(first_name)')
      .in('id', Array.from(addedByIds));

    // Create a map for quick lookup
    const profileMap = new Map<string, string>();
    for (const p of profiles || []) {
      // profile can be an array or single object depending on the relationship
      const profileData = Array.isArray(p.profile) ? p.profile[0] : p.profile;
      const firstName = (profileData as { first_name?: string } | null)?.first_name;
      if (firstName) {
        profileMap.set(p.id, firstName);
      }
    }

    // Enrich activities with added_by_name
    for (const activity of activities) {
      if (activity.activity_type === 'member_joined' && activity.metadata?.added_by) {
        const addedById = activity.metadata.added_by as string;
        // Don't show "added by" for self-joins
        if (addedById !== activity.actor_id) {
          activity.added_by_name = profileMap.get(addedById) || null;
        }
      }
    }
  }

  return activities;
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get group statistics for the home view
 */
export async function getGroupStats(groupId: string): Promise<GroupStats> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  // Get member count
  const { count: memberCount } = await supabase
    .from('network_member')
    .select('*', { count: 'exact', head: true })
    .eq('network_id', groupId)
    .eq('status', 'active');

  // Get new members in last 7 days
  const { count: newMembers } = await supabase
    .from('network_member')
    .select('*', { count: 'exact', head: true })
    .eq('network_id', groupId)
    .eq('status', 'active')
    .gte('joined_at', sevenDaysAgoISO);

  // Get games created in last 7 days (from activity log)
  const { count: gamesCreated } = await supabase
    .from('group_activity')
    .select('*', { count: 'exact', head: true })
    .eq('network_id', groupId)
    .eq('activity_type', 'game_created')
    .gte('created_at', sevenDaysAgoISO);

  // Get message count in last 7 days (from activity log)
  const { count: messages } = await supabase
    .from('group_activity')
    .select('*', { count: 'exact', head: true })
    .eq('network_id', groupId)
    .eq('activity_type', 'message_sent')
    .gte('created_at', sevenDaysAgoISO);

  return {
    memberCount: memberCount || 0,
    newMembersLast7Days: newMembers || 0,
    gamesCreatedLast7Days: gamesCreated || 0,
    messagesLast7Days: messages || 0,
  };
}

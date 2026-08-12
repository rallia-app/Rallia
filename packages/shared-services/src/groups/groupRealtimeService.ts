/**
 * Group Realtime Service
 * Real-time subscriptions for group members, activity, and matches
 */

import { supabase } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// GROUP MEMBER SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to member changes in a group (joins, leaves, role changes)
 */
export function subscribeToGroupMembers(
  groupId: string,
  onMemberChange: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; member: unknown }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`group_members:${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'network_member',
        filter: `network_id=eq.${groupId}`,
      },
      payload => {
        onMemberChange({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          member: payload.new || payload.old,
        });
      }
    )
    .subscribe();

  return channel;
}

// ============================================================================
// GROUP ACTIVITY SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to activity feed for a group
 */
export function subscribeToGroupActivity(
  groupId: string,
  onActivity: (payload: { eventType: 'INSERT'; activity: unknown }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`group_activity:${groupId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_activity',
        filter: `group_id=eq.${groupId}`,
      },
      payload => {
        onActivity({
          eventType: 'INSERT',
          activity: payload.new,
        });
      }
    )
    .subscribe();

  return channel;
}

// ============================================================================
// GROUP MATCH SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to match changes for a group (new matches, score updates)
 */
export function subscribeToGroupMatches(
  groupId: string,
  onMatchChange: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; match: unknown }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`group_matches:${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'match_result',
        filter: `network_id=eq.${groupId}`,
      },
      payload => {
        onMatchChange({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          match: payload.new || payload.old,
        });
      }
    )
    .subscribe();

  return channel;
}

// ============================================================================
// GROUP SETTINGS SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to group settings changes (name, description, cover image)
 */
export function subscribeToGroupSettings(
  groupId: string,
  onGroupChange: (payload: { eventType: 'UPDATE' | 'DELETE'; group: unknown }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`group_settings:${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'network',
        filter: `id=eq.${groupId}`,
      },
      payload => {
        onGroupChange({
          eventType: payload.eventType as 'UPDATE' | 'DELETE',
          group: payload.new || payload.old,
        });
      }
    )
    .subscribe();

  return channel;
}

// ============================================================================
// PLAYER'S GROUPS LIST SUBSCRIPTION
// ============================================================================

// ============================================================================
// SCORE CONFIRMATION SUBSCRIPTIONS
// ============================================================================

/**
 * Subscribe to pending score confirmation changes for a player
 */
export function subscribeToScoreConfirmations(
  playerId: string,
  onConfirmationChange: (payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    confirmation: unknown;
  }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`score_confirmations:${playerId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'match_score_confirmation',
        filter: `player_id=eq.${playerId}`,
      },
      payload => {
        onConfirmationChange({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          confirmation: payload.new || payload.old,
        });
      }
    )
    .subscribe();

  return channel;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Unsubscribe from a realtime channel
 */
export function unsubscribeFromGroupChannel(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}

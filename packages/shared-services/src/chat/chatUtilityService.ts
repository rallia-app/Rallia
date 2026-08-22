/**
 * Chat Utility Service
 * Search, online status, chat agreement, and other utility functions
 */

import { supabase } from '../supabase';
import type { PlayerOnlineStatus, SearchMessageResult, ConversationPreview } from './chatTypes';

// ============================================================================
// DISPLAY NAME UTILITY
// ============================================================================

function formatMatchTime(pgTime: string, locale: string): string {
  const [hours, minutes] = pgTime.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale.startsWith('en'),
  });
}

// Formats a Postgres DATE ("YYYY-MM-DD") as "MMM d" in local time; building the
// Date from parts avoids the UTC-midnight parse that shifts the day in -UTC zones.
function formatMatchDate(pgDate: string, locale: string): string {
  const [year, month, day] = pgDate.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Derive the display name for a conversation from its data.
 *
 * Single source of truth — replaces the duplicated name-resolution logic
 * that previously existed in ConversationItem, ConversationActionsSheet, and
 * ChatConversation.
 *
 * Priority for each type:
 *  - direct  → other_participant full name
 *  - match   → "{Sport} {Singles|Doubles} - {MMM d}" derived from match_info
 *              (never trusts the stored title, which may be stale or null)
 *  - all others → stored conversation title, fallback to t('chat.conversation.groupChat')
 */
export function getConversationDisplayName(
  conversation: ConversationPreview,
  t: (key: string) => string,
  locale: string
): string {
  if (conversation.conversation_type === 'direct') {
    const p = conversation.other_participant;
    if (!p) return t('chat.conversation.groupChat');
    return p.last_name ? `${p.first_name} ${p.last_name}` : p.first_name;
  }

  if (conversation.conversation_type === 'match') {
    const mi = conversation.match_info;
    if (mi) {
      const formatLabel =
        mi.format === 'doubles' ? t('match.format.doubles') : t('match.format.singles');
      const dateStr = mi.match_date ? formatMatchDate(mi.match_date, locale) : '';
      const timeStr = mi.start_time ? formatMatchTime(mi.start_time, locale) : '';
      const datePart = [dateStr, timeStr].filter(Boolean).join(', ');
      return datePart ? `${formatLabel} - ${datePart}` : formatLabel;
    }
    return conversation.title || t('chat.filters.match');
  }

  if (conversation.conversation_type === 'tournament') {
    return conversation.tournament_info?.name || conversation.title || t('chat.filters.tournament');
  }

  return conversation.title || t('chat.conversation.groupChat');
}

// ============================================================================
// ONLINE STATUS OPERATIONS
// ============================================================================

/**
 * Update player's last seen timestamp (call this periodically or on activity)
 */
export async function updatePlayerLastSeen(playerId: string): Promise<void> {
  const { error } = await supabase
    .from('player')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', playerId);

  if (error) {
    console.error('Error updating last seen:', error);
    // Don't throw - this is a background operation
  }
}

/**
 * Get online status for multiple players
 */
export async function getPlayersOnlineStatus(playerIds: string[]): Promise<PlayerOnlineStatus[]> {
  if (playerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('player')
    .select('id, last_seen_at')
    .in('id', playerIds);

  if (error) {
    console.error('Error fetching online status:', error);
    return playerIds.map(id => ({ player_id: id, is_online: false, last_seen_at: null }));
  }

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  return (data || []).map(player => ({
    player_id: player.id,
    is_online: player.last_seen_at ? new Date(player.last_seen_at) > fiveMinutesAgo : false,
    last_seen_at: player.last_seen_at,
  }));
}

/**
 * Check if a single player is online
 */
export async function isPlayerOnline(playerId: string): Promise<boolean> {
  const statuses = await getPlayersOnlineStatus([playerId]);
  return statuses[0]?.is_online ?? false;
}

// ============================================================================
// SEARCH OPERATIONS
// ============================================================================

/**
 * Search messages within a conversation
 * Uses full-text search for efficient querying
 */
export async function searchMessagesInConversation(
  conversationId: string,
  query: string,
  limit = 50
): Promise<SearchMessageResult[]> {
  if (!query.trim()) return [];

  // Use the database function for efficient search
  const { data, error } = await supabase.rpc('search_conversation_messages', {
    p_conversation_id: conversationId,
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    console.error('Error searching messages:', error);
    // Fallback to simple ILIKE search if full-text search fails
    return searchMessagesFallback(conversationId, query, limit);
  }

  // Fetch sender names for results
  const senderIds = [
    ...new Set((data || []).map((r: { sender_id: string }) => r.sender_id)),
  ] as string[];
  const senderMap = await getSenderNames(senderIds);

  return (data || []).map(
    (r: {
      id: string;
      conversation_id: string;
      sender_id: string;
      content: string;
      created_at: string;
      rank: number;
    }) => ({
      id: r.id,
      conversation_id: r.conversation_id,
      sender_id: r.sender_id,
      content: r.content,
      created_at: r.created_at,
      rank: r.rank,
      sender_name: senderMap.get(r.sender_id) || 'Unknown',
    })
  );
}

/**
 * Fallback search using ILIKE (if full-text search is not available)
 */
async function searchMessagesFallback(
  conversationId: string,
  query: string,
  limit: number
): Promise<SearchMessageResult[]> {
  const { data, error } = await supabase
    .from('message')
    .select(
      `
      id,
      conversation_id,
      sender_id,
      content,
      created_at
    `
    )
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error in fallback search:', error);
    return [];
  }

  const senderIds = [...new Set((data || []).map(m => m.sender_id))];
  const senderMap = await getSenderNames(senderIds);

  return (data || []).map(m => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    content: m.content,
    created_at: m.created_at,
    rank: 1, // No ranking for fallback
    sender_name: senderMap.get(m.sender_id) || 'Unknown',
  }));
}

/**
 * Helper to get sender names for search results
 */
async function getSenderNames(senderIds: string[]): Promise<Map<string, string>> {
  if (senderIds.length === 0) return new Map();

  const { data } = await supabase
    .from('player')
    .select(
      `
      id,
      profile!player_id_fkey (
        first_name
      )
    `
    )
    .in('id', senderIds);

  const map = new Map<string, string>();
  for (const player of data || []) {
    const profile = Array.isArray(player.profile)
      ? (player.profile[0] as { first_name: string } | undefined)
      : (player.profile as { first_name: string } | null);
    map.set(player.id, profile?.first_name || 'Unknown');
  }

  return map;
}

// ============================================================================
// UNREAD COUNT
// ============================================================================

/**
 * Total unread messages across non-archived conversations (chat tab badge).
 */
export async function getTotalUnreadCount(playerId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_total_unread_count', {
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error fetching total unread count:', error);
    return 0;
  }

  return data ?? 0;
}

/**
 * Get count of conversations with unread messages (for Unread chip badge).
 * Uses a lightweight RPC instead of fetching all conversations.
 */
export async function getUnreadConversationsCount(playerId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_conversations_count', {
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error fetching unread conversations count:', error);
    return 0;
  }

  return data ?? 0;
}

// ============================================================================
// CHAT AGREEMENT
// ============================================================================

/**
 * Check if player has agreed to chat rules
 */
export async function hasAgreedToChatRules(playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('player')
    .select('chat_rules_agreed_at')
    .eq('id', playerId)
    .single();

  if (error || !data) {
    return false;
  }

  return data.chat_rules_agreed_at !== null;
}

/**
 * Record player agreement to chat rules
 */
export async function agreeToChatRules(playerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('player')
    .update({ chat_rules_agreed_at: new Date().toISOString() })
    .eq('id', playerId);

  return !error;
}

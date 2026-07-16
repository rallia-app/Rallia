/**
 * Conversation Service
 * CRUD operations for conversations
 */

import { supabase } from '../supabase';

import type {
  Conversation,
  ConversationPreview,
  ConversationWithDetails,
  ConversationType,
  CreateConversationInput,
  UpdateConversationInput,
  MessageStatus,
  MessageWithSender,
} from './chatTypes';

// Formats a Postgres TIME string ("HH:MM:SS") into a locale-aware time string ("9:00 AM")
function formatMatchTime(pgTime: string): string {
  const [hours, minutes] = pgTime.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Formats a Postgres DATE ("YYYY-MM-DD") as "MMM d" in local time; building the
// Date from parts avoids the UTC-midnight parse that shifts the day in -UTC zones.
function formatMatchDate(pgDate: string): string {
  const [year, month, day] = pgDate.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// Type for the optimized RPC function return
interface ConversationRPCRow {
  id: string;
  conversation_type: string;
  title: string | null;
  picture_url: string | null;
  match_id: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_first_name: string | null;
  is_pinned: boolean;
  is_muted: boolean;
  is_archived: boolean;
  participant_count: number;
  unread_count: number;
  other_participant_id: string | null;
  other_participant_first_name: string | null;
  other_participant_last_name: string | null;
  other_participant_picture_url: string | null;
  other_participant_last_seen_at: string | null;
  network_id: string | null;
  network_type: string | null;
  network_cover_image_url: string | null;
  match_format: string | null;
  match_date: string | null;
  match_start_time: string | null;
  match_sport_name: string | null;
  tournament_id: string | null;
  tournament_name: string | null;
  tournament_status: string | null;
  tournament_sport_name: string | null;
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get all conversations for a player (OPTIMIZED)
 * Uses a single RPC call instead of N+1 queries for much faster loading
 */
export async function getPlayerConversations(
  playerId: string,
  sportId?: string
): Promise<ConversationPreview[]> {
  try {
    const { data, error } = await supabase.rpc('get_player_conversations_optimized', {
      p_player_id: playerId,
      ...(sportId ? { p_sport_id: sportId } : {}),
    });

    if (error) {
      console.error('Error fetching conversations from RPC:', error);
      // Return empty array instead of throwing to prevent app crash
      return [];
    }

    if (!data || (data as ConversationRPCRow[]).length === 0) {
      return [];
    }

    const rows = data as ConversationRPCRow[];

    // Transform RPC results to ConversationPreview format
    const previews: ConversationPreview[] = rows.map((row: ConversationRPCRow) => {
      // Build other_participant for direct chats
      let otherParticipant: ConversationPreview['other_participant'] | undefined;
      if (row.other_participant_id) {
        const isOnline = row.other_participant_last_seen_at
          ? new Date(row.other_participant_last_seen_at) > new Date(Date.now() - 5 * 60 * 1000)
          : false;

        otherParticipant = {
          id: row.other_participant_id,
          first_name: row.other_participant_first_name || '',
          last_name: row.other_participant_last_name,
          profile_picture_url: row.other_participant_picture_url,
          is_online: isOnline,
          last_seen_at: row.other_participant_last_seen_at,
        };
      }

      // Build match_info for match-linked chats
      let matchInfo: ConversationPreview['match_info'] = null;
      if (row.match_id && row.match_sport_name) {
        matchInfo = {
          sport_name: row.match_sport_name,
          match_date: row.match_date || '',
          start_time: row.match_start_time || null,
          format: (row.match_format as 'singles' | 'doubles') || 'singles',
        };
      }

      // Build tournament_info for tournament-linked chats
      let tournamentInfo: ConversationPreview['tournament_info'] = null;
      if (row.tournament_id && row.tournament_name) {
        tournamentInfo = {
          name: row.tournament_name,
          sport_name: row.tournament_sport_name || '',
          status: row.tournament_status || '',
        };
      }

      return {
        id: row.id,
        conversation_type: row.conversation_type as ConversationType,
        title: row.title,
        last_message_content: row.last_message_content,
        last_message_at: row.last_message_at,
        last_message_sender_name: row.last_message_sender_first_name,
        unread_count: Number(row.unread_count) || 0,
        participant_count: Number(row.participant_count) || 0,
        other_participant: otherParticipant,
        cover_image_url: row.network_cover_image_url || row.picture_url,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
        is_archived: row.is_archived,
        match_id: row.match_id,
        match_info: matchInfo,
        network_id: row.network_id,
        network_type: row.network_type,
        tournament_id: row.tournament_id,
        tournament_info: tournamentInfo,
      };
    });

    return previews;
  } catch (err) {
    console.error('Unexpected error in getPlayerConversations:', err);
    return [];
  }
}

/**
 * Get a single conversation with details
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationWithDetails | null> {
  const { data: conversation, error } = await supabase
    .from('conversation')
    .select(
      `
      id,
      conversation_type,
      title,
      picture_url,
      match_id,
      tournament_match_id,
      created_by,
      created_at,
      updated_at
    `
    )
    .eq('id', conversationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('Error fetching conversation:', error);
    throw error;
  }

  // Get participants
  const { data: participants } = await supabase
    .from('conversation_participant')
    .select(
      `
      id,
      player_id,
      last_read_at,
      is_muted,
      player:player!conversation_participant_player_id_fkey (
        id,
        profile!player_id_fkey (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('conversation_id', conversationId);

  // Get last message
  const { data: lastMessage } = await supabase
    .from('message')
    .select(
      `
      id,
      conversation_id,
      sender_id,
      content,
      status,
      read_by,
      created_at,
      updated_at,
      sender:player!message_sender_id_fkey (
        id,
        profile!player_id_fkey (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return {
    ...conversation,
    participants: (participants || []).map(p => ({
      id: p.id,
      player_id: p.player_id,
      last_read_at: p.last_read_at,
      is_muted: p.is_muted || false,
      player: p.player as unknown as {
        id: string;
        profile: {
          first_name: string;
          last_name: string | null;
          display_name: string | null;
          profile_picture_url: string | null;
        } | null;
      } | null,
    })),
    last_message: lastMessage
      ? {
          ...lastMessage,
          status: (lastMessage.status || 'sent') as MessageStatus,
          read_by: lastMessage.read_by as string[] | null,
          sender: lastMessage.sender as unknown as MessageWithSender['sender'],
        }
      : null,
    unread_count: 0, // TODO: Calculate based on current user
  };
}

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

/**
 * Create a new conversation
 */
export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
  const { data: conversation, error } = await supabase
    .from('conversation')
    .insert({
      conversation_type: input.conversation_type,
      title: input.title || null,
      match_id: input.match_id || null,
      created_by: input.created_by,
      picture_url: input.picture_url || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }

  // Add participants
  const participantInserts = input.participant_ids.map(playerId => ({
    conversation_id: conversation.id,
    player_id: playerId,
  }));

  const { error: partError } = await supabase
    .from('conversation_participant')
    .insert(participantInserts);

  if (partError) {
    console.error('Error adding participants:', partError);
    // Clean up conversation on failure
    await supabase.from('conversation').delete().eq('id', conversation.id);
    throw partError;
  }

  return conversation;
}

/**
 * Create or get existing direct conversation between two players
 */
export async function getOrCreateDirectConversation(
  playerId1: string,
  playerId2: string
): Promise<Conversation> {
  // Try the RPC first (most efficient — single query with match_id IS NULL filter)
  const { data: existingConvId, error: rpcError } = await supabase.rpc('find_direct_conversation', {
    p_player1: playerId1,
    p_player2: playerId2,
  });

  if (!rpcError && existingConvId) {
    const { data: existingConv } = await supabase
      .from('conversation')
      .select(
        `
        id,
        conversation_type,
        title,
        picture_url,
        match_id,
        created_by,
        created_at,
        updated_at
      `
      )
      .eq('id', existingConvId)
      .single();

    if (existingConv) {
      return existingConv;
    }
  }

  // Fallback: query directly if RPC is unavailable or returned nothing
  if (rpcError || !existingConvId) {
    const { data: existingConvs } = await supabase
      .from('conversation')
      .select(
        `
        id,
        conversation_type,
        title,
        picture_url,
        match_id,
        created_by,
        created_at,
        updated_at
      `
      )
      .eq('conversation_type', 'direct')
      .is('match_id', null);

    if (existingConvs) {
      for (const conv of existingConvs) {
        const { data: participants } = await supabase
          .from('conversation_participant')
          .select('player_id')
          .eq('conversation_id', conv.id);

        if (participants?.length === 2) {
          const playerIds = participants.map(p => p.player_id);
          if (playerIds.includes(playerId1) && playerIds.includes(playerId2)) {
            return conv;
          }
        }
      }
    }
  }

  // Create new direct conversation
  return createConversation({
    conversation_type: 'direct',
    participant_ids: [playerId1, playerId2],
    created_by: playerId1,
  });
}

// ============================================================================
// MATCH CHAT OPERATIONS
// ============================================================================
// Match chats are created and their participants are kept in sync entirely by
// Postgres triggers on `match` and `match_participant` (see migration
// 20260426120000_match_chat_lifecycle_via_triggers.sql). No client-side
// create/ensure helper exists — call sites simply read the conversation by
// match_id when they need it.

/**
 * Check if a match chat exists for a given match
 */
export async function getMatchChat(matchId: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversation')
    .select('*')
    .eq('match_id', matchId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('Error fetching match chat:', error);
    return null;
  }

  return data;
}

/**
 * Get or create the per-pairing "round chat" for a tournament bracket match.
 * Idempotent: both opponents share one conversation tagged with the round. The
 * caller must be one of the round's players. Returns the conversation id.
 */
export async function getOrCreateTournamentRoundChat(tournamentMatchId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_tournament_round_chat', {
    p_tournament_match_id: tournamentMatchId,
  });

  if (error) {
    console.error('Error getting/creating tournament round chat:', error);
    throw error;
  }

  return data as string;
}

// ============================================================================
// TOURNAMENT CHAT OPERATIONS
// ============================================================================
// Tournament chats mirror match chats: created and synced entirely by Postgres
// triggers on `tournaments`, `tournament_registrations` and
// `tournament_co_organizers` (see migration 20260613100100). Call sites read
// the conversation by tournament_id when they need it.

/**
 * Check if a tournament chat exists (and is visible to the caller) for a
 * given tournament. RLS restricts visibility to conversation participants.
 */
export async function getTournamentChat(tournamentId: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversation')
    .select('*')
    .eq('tournament_id', tournamentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    console.error('Error fetching tournament chat:', error);
    return null;
  }

  return data;
}

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

/**
 * Update conversation details (title, picture)
 */
export async function updateConversation(
  conversationId: string,
  updates: UpdateConversationInput
): Promise<boolean> {
  const updateData: Record<string, unknown> = {};

  if (updates.title !== undefined) {
    updateData.title = updates.title;
  }
  if (updates.picture_url !== undefined) {
    updateData.picture_url = updates.picture_url;
  }

  if (Object.keys(updateData).length === 0) {
    return true; // Nothing to update
  }

  const { error } = await supabase.from('conversation').update(updateData).eq('id', conversationId);

  if (error) {
    console.error('Error updating conversation:', error);
    throw error;
  }

  return true;
}

// ============================================================================
// NETWORK CONVERSATION UTILITIES
// ============================================================================

/**
 * Get conversation by network (group/community/club)
 * Useful when you have a network ID and need its conversation
 */
export async function getConversationByNetworkId(networkId: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('network')
    .select('conversation_id')
    .eq('id', networkId)
    .single();

  if (error || !data?.conversation_id) {
    return null;
  }

  const { data: conversation, error: convError } = await supabase
    .from('conversation')
    .select('*')
    .eq('id', data.conversation_id)
    .single();

  if (convError) {
    return null;
  }

  return conversation;
}

/**
 * Get network info for a conversation (for group/community chats)
 * Returns network details including cover image and description
 */
export async function getNetworkByConversationId(conversationId: string): Promise<{
  id: string;
  name: string;
  cover_image_url: string | null;
  description: string | null;
  member_count: number;
  type: 'community' | 'player_group' | string | null;
} | null> {
  const { data, error } = await supabase
    .from('network')
    .select(
      `
      id, 
      name, 
      cover_image_url, 
      description, 
      member_count,
      network_type:network_type_id (name)
    `
    )
    .eq('conversation_id', conversationId)
    .single();

  if (error || !data) {
    return null;
  }

  // Extract network type name
  const networkType = data.network_type as { name?: string } | null;

  return {
    id: data.id,
    name: data.name,
    cover_image_url: data.cover_image_url,
    description: data.description,
    member_count: data.member_count,
    type: networkType?.name || null,
  };
}

// ============================================================================
// FILTERED CONVERSATIONS
// ============================================================================

/**
 * FilteredConversationsRPC row type
 */
interface FilteredConversationRPCRow {
  id: string;
  conversation_type: string;
  title: string | null;
  picture_url: string | null;
  match_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_id: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  last_message_sender_first_name: string | null;
  is_pinned: boolean;
  is_muted: boolean;
  is_archived: boolean;
  last_read_at: string | null;
  participant_count: number;
  unread_count: number;
  other_participant_id: string | null;
  other_participant_first_name: string | null;
  other_participant_last_name: string | null;
  other_participant_picture_url: string | null;
  other_participant_last_seen_at: string | null;
  network_id: string | null;
  network_type: string | null;
  network_cover_image_url: string | null;
  match_format: string | null;
  match_date: string | null;
  match_start_time: string | null;
  match_sport_name: string | null;
  tournament_id: string | null;
  tournament_name: string | null;
  tournament_status: string | null;
  tournament_sport_name: string | null;
}

/**
 * Input parameters for filtered conversations query
 */
export interface GetFilteredConversationsInput {
  playerId: string;
  filter?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sportId?: string;
}

/**
 * Paginated result for filtered conversations
 */
export interface FilteredConversationsPage {
  conversations: ConversationPreview[];
  nextOffset: number | null;
  hasMore: boolean;
}

/**
 * Get filtered and paginated conversations for a player
 * Uses a single RPC call with filters for efficient loading
 *
 * @param options - Object containing playerId, filter, search, limit, offset
 * @returns Paginated result with conversations, nextOffset, and hasMore flag
 */
export async function getPlayerConversationsFiltered(
  options: GetFilteredConversationsInput
): Promise<FilteredConversationsPage> {
  const { playerId, filter = 'all', search = '', limit = 20, offset = 0, sportId } = options;

  try {
    const { data, error } = await supabase.rpc('get_player_conversations_filtered', {
      p_player_id: playerId,
      p_filter: filter,
      p_search: search,
      p_limit: limit + 1, // Fetch one extra to determine if there are more
      p_offset: offset,
      ...(sportId ? { p_sport_id: sportId } : {}),
    });

    if (error) {
      console.error('Error fetching filtered conversations from RPC:', error);
      return { conversations: [], nextOffset: null, hasMore: false };
    }

    if (!data || (data as FilteredConversationRPCRow[]).length === 0) {
      return { conversations: [], nextOffset: null, hasMore: false };
    }

    const rows = data as FilteredConversationRPCRow[];

    // Check if there are more results
    const hasMore = rows.length > limit;
    const rowsToProcess = hasMore ? rows.slice(0, limit) : rows;

    // Transform RPC results to ConversationPreview format
    const conversations: ConversationPreview[] = rowsToProcess.map(
      (row: FilteredConversationRPCRow) => {
        // Build other_participant for direct chats
        let otherParticipant: ConversationPreview['other_participant'] | undefined;
        if (row.other_participant_id) {
          const isOnline = row.other_participant_last_seen_at
            ? new Date(row.other_participant_last_seen_at) > new Date(Date.now() - 5 * 60 * 1000)
            : false;

          otherParticipant = {
            id: row.other_participant_id,
            first_name: row.other_participant_first_name || '',
            last_name: row.other_participant_last_name,
            profile_picture_url: row.other_participant_picture_url,
            is_online: isOnline,
            last_seen_at: row.other_participant_last_seen_at,
          };
        }

        // Build match_info for match-linked chats
        let matchInfo: ConversationPreview['match_info'] = null;
        if (row.match_id && row.match_sport_name) {
          matchInfo = {
            sport_name: row.match_sport_name,
            match_date: row.match_date || '',
            start_time: row.match_start_time || null,
            format: (row.match_format as 'singles' | 'doubles') || 'singles',
          };
        }

        let tournamentInfo: ConversationPreview['tournament_info'] = null;
        if (row.tournament_id && row.tournament_name) {
          tournamentInfo = {
            name: row.tournament_name,
            sport_name: row.tournament_sport_name || '',
            status: row.tournament_status || '',
          };
        }

        return {
          id: row.id,
          conversation_type: row.conversation_type as ConversationType,
          title: row.title,
          last_message_content: row.last_message_content,
          last_message_at: row.last_message_at,
          last_message_sender_name: row.last_message_sender_first_name,
          unread_count: row.unread_count || 0,
          participant_count: row.participant_count || 0,
          other_participant: otherParticipant,
          cover_image_url: row.network_cover_image_url || row.picture_url,
          is_pinned: row.is_pinned || false,
          is_muted: row.is_muted || false,
          is_archived: row.is_archived || false,
          match_id: row.match_id,
          match_info: matchInfo,
          network_id: row.network_id,
          network_type: row.network_type,
          tournament_id: row.tournament_id,
          tournament_info: tournamentInfo,
        };
      }
    );

    return {
      conversations,
      nextOffset: hasMore ? offset + limit : null,
      hasMore,
    };
  } catch (error) {
    console.error('Error in getPlayerConversationsFiltered:', error);
    return { conversations: [], nextOffset: null, hasMore: false };
  }
}

// ============================================================================
// MATCH CONVERSATION SYNC
// ============================================================================

/**
 * Sync match conversation title when match details change
 * Updates the conversation title to reflect current match info
 *
 * @param matchId - Match UUID
 * @param format - Match format (singles/doubles)
 * @param matchDate - Match date string
 * @param createdBy - Host player ID (for fetching sport)
 */
export async function syncMatchConversationTitle(
  matchId: string,
  format: 'singles' | 'doubles',
  matchDate: string | null,
  createdBy: string
): Promise<void> {
  try {
    // Get the conversation for this match
    const conversation = await getMatchChat(matchId);
    if (!conversation) {
      return;
    }

    // Get match details including start_time
    const { data: matchData, error: matchError } = await supabase
      .from('match')
      .select('id, format, match_date, start_time')
      .eq('id', matchId)
      .single();

    if (matchError || !matchData) {
      console.error('[syncMatchConversationTitle] Failed to fetch match:', matchError);
      return;
    }

    // Build new title
    const formatLabel = format === 'doubles' ? 'Doubles' : 'Singles';
    const dateStr = matchDate ? formatMatchDate(matchDate) : '';
    const startTime = matchData.start_time as string | null;
    const timeStr = startTime ? formatMatchTime(startTime) : '';

    const datePart = [dateStr, timeStr].filter(Boolean).join(', ');
    const newTitle = datePart ? `${formatLabel} - ${datePart}` : formatLabel;

    // Update conversation title
    await updateConversation(conversation.id, { title: newTitle });
  } catch (error) {
    console.error('[syncMatchConversationTitle] Error:', error);
  }
}

// ============================================================================
// UNREAD COUNT
// ============================================================================

/**
 * Get unread message count for a specific conversation for a player
 */
export async function getConversationUnreadCount(
  conversationId: string,
  playerId: string
): Promise<number> {
  // Get player's last_read_at timestamp for this conversation
  const { data: participation } = await supabase
    .from('conversation_participant')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId)
    .single();

  const lastReadAt = participation?.last_read_at;

  if (lastReadAt) {
    // Count messages after the last read timestamp (excluding player's own messages)
    const { count } = await supabase
      .from('message')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', playerId)
      .gt('created_at', lastReadAt);
    return count || 0;
  } else {
    // Never read - count all messages not from this player
    const { count } = await supabase
      .from('message')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', playerId);
    return count || 0;
  }
}

/**
 * Get unread message count for a specific conversation for a player, limited to last 7 days
 */
export async function getConversationUnreadCountLast7Days(
  conversationId: string,
  playerId: string
): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  // Get player's last_read_at timestamp for this conversation
  const { data: participation, error: participationError } = await supabase
    .from('conversation_participant')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId)
    .single();

  // If no participation record exists, that's fine - means they've never read any messages
  if (participationError && participationError.code !== 'PGRST116') {
    console.error('Error fetching conversation participation:', participationError);
  }

  const lastReadAt = participation?.last_read_at;

  if (lastReadAt) {
    // Count messages after the last read timestamp, from the last 7 days, excluding player's own messages
    const { count, error } = await supabase
      .from('message')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', playerId)
      .gt('created_at', lastReadAt)
      .gte('created_at', sevenDaysAgoISO);
    if (error) {
      console.error('Error counting unread messages (with lastReadAt):', error);
      return 0;
    }
    return count || 0;
  } else {
    // Never read - count all messages from last 7 days not from this player
    const { count, error } = await supabase
      .from('message')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', playerId)
      .gte('created_at', sevenDaysAgoISO);
    if (error) {
      console.error('Error counting unread messages (no lastReadAt):', error);
      return 0;
    }
    return count || 0;
  }
}

// ============================================================================
// ACTIVE CONVERSATION (notification suppression)
// ============================================================================

/**
 * Mark the current user as actively viewing a conversation. While active, the
 * backend suppresses new-message notifications (in-app row + push) for it.
 * Call on screen focus and periodically (heartbeat) while the screen stays open;
 * the server treats the active state as valid for 60 seconds.
 */
export async function setActiveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('set_active_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) {
    console.error('Error setting active conversation:', error);
  }
}

/**
 * Clear the current user's active conversation so notifications resume.
 * Call on screen blur and when the app goes to the background.
 */
export async function clearActiveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_active_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) {
    console.error('Error clearing active conversation:', error);
  }
}

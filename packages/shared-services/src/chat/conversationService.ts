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
  match_sport_name: string | null;
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get all conversations for a player (OPTIMIZED)
 * Uses a single RPC call instead of N+1 queries for much faster loading
 */
export async function getPlayerConversations(playerId: string): Promise<ConversationPreview[]> {
  try {
    const { data, error } = await supabase.rpc('get_player_conversations_optimized', {
      p_player_id: playerId,
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
          format: (row.match_format as 'singles' | 'doubles') || 'singles',
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
      };
    });

    return previews;
  } catch (err) {
    console.error('Unexpected error in getPlayerConversations:', err);
    return [];
  }
}

/**
 * Get filtered + paginated conversations for a player.
 * Uses the get_player_conversations_filtered RPC with server-side filtering.
 */
export async function getPlayerConversationsFiltered(params: {
  playerId: string;
  filter?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  conversations: ConversationPreview[];
  hasMore: boolean;
  nextOffset: number | null;
}> {
  const { playerId, filter = 'all', search = '', limit = 20, offset = 0 } = params;

  try {
    const { data, error } = await supabase.rpc('get_player_conversations_filtered', {
      p_player_id: playerId,
      p_filter: filter,
      p_search: search,
      p_limit: limit + 1, // Fetch one extra to determine hasMore
      p_offset: offset,
    });

    if (error) {
      console.error('Error fetching filtered conversations from RPC:', error);
      return { conversations: [], hasMore: false, nextOffset: null };
    }

    if (!data || (data as ConversationRPCRow[]).length === 0) {
      return { conversations: [], hasMore: false, nextOffset: null };
    }

    const rows = data as ConversationRPCRow[];
    const hasMore = rows.length > limit;
    const rowsToMap = hasMore ? rows.slice(0, limit) : rows;

    // Transform RPC results to ConversationPreview format (same mapping as getPlayerConversations)
    const previews: ConversationPreview[] = rowsToMap.map((row: ConversationRPCRow) => {
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

      let matchInfo: ConversationPreview['match_info'] = null;
      if (row.match_id && row.match_sport_name) {
        matchInfo = {
          sport_name: row.match_sport_name,
          match_date: row.match_date || '',
          format: (row.match_format as 'singles' | 'doubles') || 'singles',
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
      };
    });

    return {
      conversations: previews,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  } catch (err) {
    console.error('Unexpected error in getPlayerConversationsFiltered:', err);
    return { conversations: [], hasMore: false, nextOffset: null };
  }
}

/**
 * Get a single conversation with details
 * Fetches conversation, participants, and last message in parallel
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

  // Fetch participants and last message in parallel
  const [participantsResult, lastMessageResult] = await Promise.all([
    supabase
      .from('conversation_participant')
      .select(
        `
        id,
        player_id,
        last_read_at,
        is_muted,
        player:player!conversation_participant_player_id_fkey (
          id,
          profile (
            first_name,
            last_name,
            display_name,
            profile_picture_url
          )
        )
      `
      )
      .eq('conversation_id', conversationId),
    supabase
      .from('message')
      .select(
        `
        id,
        conversation_id,
        sender_id,
        content,
        status,
        created_at,
        updated_at,
        sender:player!message_sender_id_fkey (
          id,
          profile (
            first_name,
            last_name,
            display_name,
            profile_picture_url
          )
        )
      `
      )
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const participants = participantsResult.data;
  const lastMessage = lastMessageResult.data;

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
          read_by: null,
          sender: lastMessage.sender as unknown as MessageWithSender['sender'],
        }
      : null,
    unread_count: 0,
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
 * Uses an RPC function for a single-query lookup instead of N+1
 */
export async function getOrCreateDirectConversation(
  playerId1: string,
  playerId2: string
): Promise<Conversation> {
  // Single query to find existing direct conversation between these two players
  const { data: existingId } = await supabase.rpc('find_direct_conversation', {
    p_player1: playerId1,
    p_player2: playerId2,
  });

  if (existingId) {
    const { data: conversation } = await supabase
      .from('conversation')
      .select('*')
      .eq('id', existingId)
      .single();

    if (conversation) {
      return conversation;
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

const FORMAT_LABELS: Record<string, Record<string, string>> = {
  singles: { 'en-US': 'Singles', 'en-CA': 'Singles', 'fr-CA': 'Simple', 'fr-FR': 'Simple' },
  doubles: { 'en-US': 'Doubles', 'en-CA': 'Doubles', 'fr-CA': 'Double', 'fr-FR': 'Double' },
};

function generateMatchChatTitle(
  matchFormat: 'singles' | 'doubles',
  hostFirstName: string,
  matchDate: string,
  locale: string
): string {
  const formattedDate = new Date(matchDate).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const withWord = locale.startsWith('fr') ? 'avec' : 'with';
  const formatLabel =
    FORMAT_LABELS[matchFormat]?.[locale] ||
    matchFormat.charAt(0).toUpperCase() + matchFormat.slice(1);
  return `${formatLabel} ${withWord} ${hostFirstName} - ${formattedDate}`;
}

/**
 * Create a match chat when a match becomes full (all players confirmed)
 * Always creates a 'match' type conversation with a descriptive title.
 *
 * @param matchId - The match ID
 * @param createdBy - The player ID who triggered the full match (e.g., last to join or host who accepted)
 * @param participantIds - All player IDs in the match (including host)
 * @param matchFormat - 'singles' or 'doubles'
 * @param sportName - The sport name for the chat title
 * @param matchDate - The match date for the chat title
 * @returns The created conversation
 */
export async function createMatchChat(
  matchId: string,
  createdBy: string,
  participantIds: string[],
  matchFormat: 'singles' | 'doubles',
  sportName: string,
  matchDate: string
): Promise<Conversation> {
  // First check if a chat for this match already exists
  const { data: existingConv } = await supabase
    .from('conversation')
    .select('*')
    .eq('match_id', matchId)
    .single();

  if (existingConv) {
    // Chat already exists for this match, return it
    return existingConv;
  }

  // Fetch the match host's first name for the title
  // Note: createdBy is the authenticated user (for RLS), not necessarily the match host
  const { data: matchData } = await supabase
    .from('match')
    .select('created_by')
    .eq('id', matchId)
    .single();

  const matchHostId = matchData?.created_by || createdBy;

  const { data: hostProfile } = await supabase
    .from('profile')
    .select('first_name, preferred_locale')
    .eq('id', matchHostId)
    .single();

  const hostFirstName = hostProfile?.first_name || 'Player';
  const locale = hostProfile?.preferred_locale || 'en-US';

  const title = generateMatchChatTitle(matchFormat, hostFirstName, matchDate, locale);

  return createConversation({
    conversation_type: 'match',
    title,
    participant_ids: participantIds,
    created_by: createdBy,
    match_id: matchId,
  });
}

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
 * Sync match conversation title when match format or date changes.
 * Re-generates the title using the host's locale.
 */
export async function syncMatchConversationTitle(
  matchId: string,
  matchFormat: 'singles' | 'doubles',
  matchDate: string,
  hostId: string
): Promise<void> {
  const { data: conversation } = await supabase
    .from('conversation')
    .select('id')
    .eq('match_id', matchId)
    .single();

  if (!conversation) return;

  const { data: hostProfile } = await supabase
    .from('profile')
    .select('first_name, preferred_locale')
    .eq('id', hostId)
    .single();

  const hostFirstName = hostProfile?.first_name || 'Player';
  const locale = hostProfile?.preferred_locale || 'en-US';

  const title = generateMatchChatTitle(matchFormat, hostFirstName, matchDate, locale);

  await supabase.from('conversation').update({ title }).eq('id', conversation.id);
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

  let query = supabase
    .from('message')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', playerId)
    .is('deleted_at', null);

  if (lastReadAt) {
    query = query.gt('created_at', lastReadAt);
  }

  const { count } = await query;
  return count || 0;
}

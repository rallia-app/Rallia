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

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get all conversations for a player
 */
export async function getPlayerConversations(
  playerId: string
): Promise<ConversationPreview[]> {
  // Get conversations where player is a participant
  const { data: participations, error: partError } = await supabase
    .from('conversation_participant')
    .select('conversation_id')
    .eq('player_id', playerId);

  if (partError) {
    console.error('Error fetching participations:', partError);
    throw partError;
  }

  if (!participations || participations.length === 0) {
    return [];
  }

  const conversationIds = participations.map((p) => p.conversation_id);

  // Get conversations with last message
  const { data: conversations, error: convError } = await supabase
    .from('conversation')
    .select(`
      id,
      conversation_type,
      title,
      match_id,
      picture_url,
      created_at,
      updated_at
    `)
    .in('id', conversationIds)
    .order('updated_at', { ascending: false });

  if (convError) {
    console.error('Error fetching conversations:', convError);
    throw convError;
  }

  if (!conversations) {
    return [];
  }

  // Build preview for each conversation
  const previews: ConversationPreview[] = [];

  for (const conv of conversations) {
    // Get last message
    const { data: lastMessage } = await supabase
      .from('message')
      .select(`
        id,
        content,
        created_at,
        sender_id,
        sender:player!message_sender_id_fkey (
          id,
          profile (
            first_name,
            last_name
          )
        )
      `)
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Get participant count
    const { count: participantCount } = await supabase
      .from('conversation_participant')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id);

    // Get unread count for this player (and their participation settings)
    const { data: participation } = await supabase
      .from('conversation_participant')
      .select('last_read_at, is_muted, is_pinned, is_archived')
      .eq('conversation_id', conv.id)
      .eq('player_id', playerId)
      .single();

    const lastReadAt = participation?.last_read_at;
    const isPinned = participation?.is_pinned ?? false;
    const isMuted = participation?.is_muted ?? false;
    const isArchived = participation?.is_archived ?? false;
    
    let unreadCount = 0;
    if (lastReadAt) {
      const { count } = await supabase
        .from('message')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', playerId)
        .gt('created_at', lastReadAt);
      unreadCount = count || 0;
    } else {
      // Never read - count all messages not from this player
      const { count } = await supabase
        .from('message')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', playerId);
      unreadCount = count || 0;
    }

    // For direct messages, get the other participant
    let otherParticipant: ConversationPreview['other_participant'] | undefined;
    let coverImageUrl: string | null = null;
    let networkId: string | null = null;
    let networkType: string | null = null;

    if (conv.conversation_type === 'direct') {
      const { data: otherPart } = await supabase
        .from('conversation_participant')
        .select(`
          player:player!conversation_participant_player_id_fkey (
            id,
            last_seen_at,
            profile (
              first_name,
              last_name,
              profile_picture_url
            )
          )
        `)
        .eq('conversation_id', conv.id)
        .neq('player_id', playerId)
        .single();

      const player = otherPart?.player as unknown as {
        id: string;
        last_seen_at: string | null;
        profile: {
          first_name: string;
          last_name: string | null;
          profile_picture_url: string | null;
        } | null;
      } | undefined;

      if (player?.profile) {
        // Check if player was seen in last 5 minutes
        const isOnline = player.last_seen_at 
          ? new Date(player.last_seen_at) > new Date(Date.now() - 5 * 60 * 1000)
          : false;

        otherParticipant = {
          id: player.id,
          first_name: player.profile.first_name,
          last_name: player.profile.last_name,
          profile_picture_url: player.profile.profile_picture_url,
          is_online: isOnline,
          last_seen_at: player.last_seen_at,
        };
      }
    } else if (conv.conversation_type === 'group') {
      // For group chats, check if linked to a network (for categorization and cover image)
      const { data: network } = await supabase
        .from('network')
        .select(`
          id, 
          cover_image_url,
          network_type:network_type_id (
            name
          )
        `)
        .eq('conversation_id', conv.id)
        .single();

      if (network) {
        coverImageUrl = network.cover_image_url || null;
        networkId = network.id;
        // Extract network type name
        const networkTypeData = network.network_type as { name?: string } | null;
        networkType = networkTypeData?.name || null;
      } else {
        // No network linked - use conversation's own picture_url (for standalone group chats)
        coverImageUrl = (conv as { picture_url?: string | null }).picture_url || null;
      }
    }

    // For match-linked chats, get the match info
    let matchInfo: ConversationPreview['match_info'] = null;
    if (conv.match_id) {
      const { data: match } = await supabase
        .from('match')
        .select(`
          format,
          match_date,
          sport:sport_id (
            name
          )
        `)
        .eq('id', conv.match_id)
        .single();

      if (match) {
        // Supabase can return nested objects as arrays, handle both cases
        const sportData = Array.isArray(match.sport) 
          ? (match.sport[0] as { name: string } | undefined)
          : (match.sport as unknown as { name: string } | null);
        matchInfo = {
          sport_name: sportData?.name || 'Match',
          match_date: match.match_date,
          format: match.format as 'singles' | 'doubles',
        };
      }
    }

    // Get sender name
    let lastMessageSenderName: string | null = null;
    if (lastMessage?.sender) {
      const sender = lastMessage.sender as unknown as {
        id: string;
        profile: { first_name: string; last_name: string | null } | null;
      };
      if (sender.profile) {
        lastMessageSenderName = sender.profile.first_name;
      }
    }

    previews.push({
      id: conv.id,
      conversation_type: conv.conversation_type,
      title: conv.title,
      last_message_content: lastMessage?.content || null,
      last_message_at: lastMessage?.created_at || null,
      last_message_sender_name: lastMessageSenderName,
      unread_count: unreadCount,
      participant_count: participantCount || 0,
      other_participant: otherParticipant,
      cover_image_url: coverImageUrl,
      is_pinned: isPinned,
      is_muted: isMuted,
      is_archived: isArchived,
      match_id: conv.match_id || null,
      match_info: matchInfo,
      network_id: networkId,
      network_type: networkType,
    });
  }

  // Sort: pinned first, then by last_message_at
  previews.sort((a, b) => {
    // Pinned conversations first
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    
    // Then by last message time
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bTime - aTime;
  });

  return previews;
}

/**
 * Get a single conversation with details
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationWithDetails | null> {
  const { data: conversation, error } = await supabase
    .from('conversation')
    .select(`
      id,
      conversation_type,
      title,
      picture_url,
      match_id,
      created_by,
      created_at,
      updated_at
    `)
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
    .select(`
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
    `)
    .eq('conversation_id', conversationId);

  // Get last message
  const { data: lastMessage } = await supabase
    .from('message')
    .select(`
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
        profile (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return {
    ...conversation,
    participants: (participants || []).map((p) => ({
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
export async function createConversation(
  input: CreateConversationInput
): Promise<Conversation> {
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
  const participantInserts = input.participant_ids.map((playerId) => ({
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
  // Check if direct conversation already exists between these two players
  const { data: existingConvs } = await supabase
    .from('conversation')
    .select(`
      id,
      conversation_type,
      title,
      picture_url,
      match_id,
      created_by,
      created_at,
      updated_at
    `)
    .eq('conversation_type', 'direct');

  if (existingConvs) {
    for (const conv of existingConvs) {
      const { data: participants } = await supabase
        .from('conversation_participant')
        .select('player_id')
        .eq('conversation_id', conv.id);

      if (participants?.length === 2) {
        const playerIds = participants.map((p) => p.player_id);
        if (playerIds.includes(playerId1) && playerIds.includes(playerId2)) {
          return conv;
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

/**
 * Create a match chat when a match becomes full (all players confirmed)
 * - Singles (2 players): Creates a direct chat linked to the match
 * - Doubles (4 players): Creates a group chat linked to the match
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

  // Generate title: "Sport - Date" format
  const formattedDate = new Date(matchDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const title = `${sportName} - ${formattedDate}`;

  // Singles = direct chat with match_id, Doubles = group chat with match_id
  const conversationType: ConversationType = matchFormat === 'singles' ? 'direct' : 'group';

  return createConversation({
    conversation_type: conversationType,
    title: conversationType === 'group' ? title : undefined, // Direct chats don't need title
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

  const { error } = await supabase
    .from('conversation')
    .update(updateData)
    .eq('id', conversationId);

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
export async function getConversationByNetworkId(
  networkId: string
): Promise<Conversation | null> {
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
export async function getNetworkByConversationId(
  conversationId: string
): Promise<{
  id: string;
  name: string;
  cover_image_url: string | null;
  description: string | null;
  member_count: number;
  type: 'community' | 'player_group' | string | null;
} | null> {
  const { data, error } = await supabase
    .from('network')
    .select(`
      id, 
      name, 
      cover_image_url, 
      description, 
      member_count,
      network_type:network_type_id (name)
    `)
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

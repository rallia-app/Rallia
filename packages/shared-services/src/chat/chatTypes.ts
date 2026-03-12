/**
 * Chat Types
 * All type definitions for chat, conversations, and messages
 * @module chatTypes
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Type of conversation
 * - 'direct': 1-on-1 chat between two players
 * - 'group': Group chat (may be linked to a network)
 * - 'match': Chat created for a specific match
 * - 'announcement': Broadcast channel (future)
 */
export type ConversationType = 'direct' | 'group' | 'match' | 'announcement';

/**
 * Delivery status of a message
 * - 'sent': Message sent to server
 * - 'delivered': Message delivered to recipient(s)
 * - 'read': Message read by recipient(s)
 * - 'failed': Message failed to send
 */
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Core conversation entity
 * @property id - Unique conversation ID
 * @property conversation_type - Type of conversation (direct, group, match, announcement)
 * @property title - Display title (null for direct chats)
 * @property picture_url - Cover/profile image URL
 * @property match_id - Associated match ID (for match chats)
 * @property created_by - Player ID who created the conversation
 * @property created_at - ISO timestamp of creation
 * @property updated_at - ISO timestamp of last update
 */
export interface Conversation {
  id: string;
  conversation_type: ConversationType;
  title: string | null;
  picture_url: string | null;
  match_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Participant record in a conversation
 * @property id - Unique participant record ID
 * @property conversation_id - ID of the conversation
 * @property player_id - ID of the player
 * @property last_read_at - Timestamp of last read message
 * @property is_muted - Whether notifications are muted
 * @property joined_at - When the player joined
 * @property is_pinned - Whether conversation is pinned
 * @property is_archived - Whether conversation is archived
 */
export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  player_id: string;
  last_read_at: string | null;
  is_muted: boolean;
  joined_at: string;
  is_pinned?: boolean;
  pinned_at?: string | null;
  is_archived?: boolean;
  archived_at?: string | null;
}

/**
 * Core message entity
 * @property id - Unique message ID
 * @property conversation_id - ID of the conversation
 * @property sender_id - ID of the sender
 * @property content - Message text content
 * @property status - Delivery status
 * @property read_by - Deprecated: use conversation_participant.last_read_at instead
 * @property created_at - ISO timestamp of creation
 * @property updated_at - ISO timestamp of last update
 * @property reply_to_message_id - ID of message being replied to
 * @property is_edited - Whether message has been edited
 * @property edited_at - When message was edited
 * @property deleted_at - When message was soft-deleted
 */
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  status: MessageStatus;
  read_by: string[] | null;
  created_at: string;
  updated_at: string;
  reply_to_message_id?: string | null;
  is_edited?: boolean;
  edited_at?: string | null;
  deleted_at?: string | null;
}

// ============================================================================
// REACTION TYPES
// ============================================================================

/**
 * A single emoji reaction on a message
 * @property id - Unique reaction ID
 * @property message_id - ID of the message reacted to
 * @property player_id - ID of the player who reacted
 * @property emoji - The emoji character
 * @property created_at - When the reaction was added
 * @property player - Optional nested player profile
 */
export interface MessageReaction {
  id: string;
  message_id: string;
  player_id: string;
  emoji: string;
  created_at: string;
  player?: {
    id: string;
    profile: {
      first_name: string;
      last_name: string | null;
    } | null;
  };
}

/**
 * Aggregated summary of reactions for a message
 * @property emoji - The emoji character
 * @property count - Number of reactions with this emoji
 * @property players - List of players who reacted
 * @property hasReacted - Whether current user has reacted with this emoji
 */
export interface ReactionSummary {
  emoji: string;
  count: number;
  players: Array<{
    id: string;
    first_name: string;
  }>;
  hasReacted: boolean;
}

// ============================================================================
// MESSAGE WITH RELATIONS
// ============================================================================

/**
 * Message with sender profile and reactions included
 * @extends Message
 * @property sender - Nested sender profile data
 * @property reactions - Aggregated reaction summaries
 * @property reply_to - The message being replied to (if any)
 */
export interface MessageWithSender extends Message {
  sender: {
    id: string;
    profile: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
  reactions?: ReactionSummary[];
  // For replies - the message being replied to
  reply_to?: {
    id: string;
    content: string;
    sender_name: string;
  } | null;
}

// ============================================================================
// CONVERSATION WITH RELATIONS
// ============================================================================

/**
 * Full conversation with participants, last message, and unread count
 * @extends Conversation
 * @property participants - Array of participants with profiles
 * @property last_message - Most recent message
 * @property unread_count - Number of unread messages for current user
 */
export interface ConversationWithDetails extends Conversation {
  participants: Array<{
    id: string;
    player_id: string;
    last_read_at: string | null;
    is_muted: boolean;
    player: {
      id: string;
      profile: {
        first_name: string;
        last_name: string | null;
        display_name: string | null;
        profile_picture_url: string | null;
      } | null;
    } | null;
  }>;
  last_message: MessageWithSender | null;
  unread_count: number;
}

/**
 * Lightweight conversation preview for lists
 * Used in conversation list screens for efficient display
 * @property id - Conversation ID
 * @property conversation_type - Type of conversation
 * @property title - Display title
 * @property last_message_content - Preview of last message
 * @property last_message_at - When last message was sent
 * @property last_message_sender_name - Who sent the last message
 * @property unread_count - Number of unread messages
 * @property participant_count - Total participants
 * @property other_participant - For direct chats, the other person
 * @property cover_image_url - For groups, the cover image
 * @property is_pinned - Whether conversation is pinned
 * @property is_muted - Whether notifications are muted
 * @property is_archived - Whether conversation is archived
 * @property match_id - Associated match ID
 * @property match_info - Match details if match-linked
 * @property network_id - Associated network/group ID
 * @property network_type - Type of network
 */
export interface ConversationPreview {
  id: string;
  conversation_type: ConversationType;
  title: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_name: string | null;
  unread_count: number;
  participant_count: number;
  // For direct messages, show the other participant
  other_participant?: {
    id: string;
    first_name: string;
    last_name: string | null;
    profile_picture_url: string | null;
    is_online?: boolean;
    last_seen_at?: string | null;
  };
  // For group chats, show the cover image from the network
  cover_image_url?: string | null;
  // Enhanced features
  is_pinned?: boolean;
  is_muted?: boolean;
  is_archived?: boolean;
  // Match-linked chat info (for singles or doubles match chats)
  match_id?: string | null;
  match_info?: {
    sport_name: string;
    match_date: string;
    format: 'singles' | 'doubles';
  } | null;
  // Network-linked chat info (for groups/communities)
  network_id?: string | null;
  network_type?: string | null; // 'friends', 'player_group', 'club', 'community', 'public', 'private'
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for sending a new message
 * @property conversation_id - ID of the conversation to send to
 * @property content - Message text content
 * @property sender_id - ID of the sending player
 * @property reply_to_message_id - Optional ID of message being replied to
 */
export interface SendMessageInput {
  conversation_id: string;
  content: string;
  sender_id: string;
  reply_to_message_id?: string;
}

/**
 * Input for creating a new conversation
 * @property conversation_type - Type of conversation to create
 * @property title - Optional title (for groups)
 * @property participant_ids - Array of player IDs to include
 * @property created_by - ID of the creating player
 * @property match_id - Optional match ID to link
 * @property picture_url - Optional cover image URL
 */
export interface CreateConversationInput {
  conversation_type: ConversationType;
  title?: string;
  participant_ids: string[];
  created_by: string;
  match_id?: string;
  picture_url?: string;
}

/**
 * Input for updating a conversation
 * @property title - New title
 * @property picture_url - New cover image URL
 */
export interface UpdateConversationInput {
  title?: string;
  picture_url?: string;
}

// ============================================================================
// ENHANCED TYPES - Online Status, Typing, Search
// ============================================================================

/**
 * Online status for a player
 * @property player_id - ID of the player
 * @property is_online - Whether currently online
 * @property last_seen_at - ISO timestamp of last activity
 */
export interface PlayerOnlineStatus {
  player_id: string;
  is_online: boolean;
  last_seen_at: string | null;
}

/**
 * Real-time typing indicator
 * @property player_id - ID of the player typing
 * @property player_name - Display name of the player
 * @property conversation_id - ID of the conversation
 * @property timestamp - When the typing started (for timeout)
 */
export interface TypingIndicator {
  player_id: string;
  player_name: string;
  conversation_id: string;
  timestamp: number;
}

/**
 * Result from searching messages
 * @property id - Message ID
 * @property conversation_id - Conversation the message is in
 * @property sender_id - Who sent the message
 * @property content - Message content
 * @property created_at - When message was sent
 * @property sender_name - Display name of sender
 * @property rank - Search relevance rank
 */
export interface SearchMessageResult {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_name: string;
  rank: number;
}

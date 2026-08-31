/**
 * Chat Types
 * All type definitions for chat, conversations, and messages
 * @module chatTypes
 */

import type { Enums } from '@rallia/shared-types';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Type of conversation
 * - 'direct': 1-on-1 chat between two players
 * - 'group_chat': Friend group chat (created from FAB)
 * - 'player_group': Player group network chat
 * - 'community': Community network chat
 * - 'club': Club network chat
 * - 'match': Chat created for a specific match
 * - 'tournament': Chat created for a specific tournament
 * - 'announcement': Broadcast channel (future)
 */
export type ConversationType =
  | 'direct'
  | 'group_chat'
  | 'player_group'
  | 'community'
  | 'club'
  | 'match'
  | 'tournament'
  | 'announcement';

// Migration 20260312100001 renamed all 'group' rows to their exact types.
const GROUP_CONVERSATION_TYPES: ConversationType[] = [
  'group_chat',
  'player_group',
  'community',
  'club',
];

export function isGroupConversationType(type: ConversationType): boolean {
  return GROUP_CONVERSATION_TYPES.includes(type);
}

/**
 * Delivery status of a message
 * - 'sent': Message sent to server
 * - 'delivered': Message delivered to recipient(s)
 * - 'read': Message read by recipient(s)
 * - 'failed': Message failed to send
 */
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Kind of message. 'user' is a normal chat message; the others are system cards
 * posted by the "Rallia" sender (see migration 20260605120000) and rendered as
 * rich cards instead of text bubbles.
 */
export type MessageType = 'user' | 'court_booking_prompt' | 'court_booked' | 'match_organizer';

/** metadata for a 'court_booking_prompt' system message. */
export interface CourtBookingPromptMetadata {
  match_id: string;
  facility_name: string | null;
}

/** metadata for a 'court_booked' system message. */
export interface CourtBookedMetadata {
  match_id: string;
  court_label: string | null;
  facility_name: string | null;
  booked_by: string | null;
}

/**
 * A single time/place option inside a 'match_organizer' card. Snapshotted into
 * the message metadata at post time (NOT recomputed live) so an option_index
 * means the same option to everyone voting.
 */
export interface MatchOrganizerOption {
  /** ISO timestamp of the proposed start (timezone-resolved by the engine). */
  slot_start: string;
  /** Lowercase weekday key, e.g. 'monday' (display via i18n). */
  day_label: string;
  hour_of_day: number;
  facility_id: string | null;
  facility_name: string | null;
  /** Cheapest open court's label at that hour (present only when court_confirmed). */
  court_name: string | null;
  /** Number of distinct courts open at the facility at that hour. */
  court_count: number;
  price_cents: number | null;
  court_confirmed: boolean;
  /**
   * 'bookable' = a court is open now; 'usually_free' = recurring availability;
   * 'custom' = a participant proposed this slot by hand (the degradation floor,
   * so a pair with no overlap or no known facility can still reach a game).
   */
  tier: 'bookable' | 'usually_free' | 'custom';
  distance_km: number | null;
  /**
   * Why there is no confirmed court. 'not_published_yet' = past that facility's
   * feed horizon, so one may still open; 'booked' = the feed covers this hour and
   * nothing is free; 'untracked' = facility not covered, or closed that hour.
   * Absent on cards snapshotted before migration 20260812270000.
   */
  court_state?: 'confirmed' | 'not_published_yet' | 'booked' | 'untracked' | null;
  /**
   * How many of the card's participants are recurring-free at this slot. NULL on
   * a custom option: the engine never vetted it, so the card must not claim
   * anyone is free.
   */
  free_count?: number | null;
  /** Stable (slot, place) identity, used to re-anchor votes on regenerate. */
  option_key?: string;
  /**
   * How many of the card's players favourite this facility for the sport. Equal
   * to the participant count means it is a SHARED favourite, the strongest
   * signal a slot will actually happen.
   */
  fav_count?: number | null;
  /** Free-text place on a custom option with no facility. */
  place_name?: string | null;
  /** Who proposed a custom option. */
  proposed_by?: string | null;
  /** A voted engine option that vanished on refresh; kept, but no longer real. */
  stale?: boolean;
}

/** metadata for a 'match_organizer' card (chat Match Organizer). */
export interface MatchOrganizerMetadata {
  kind: 'match_organizer';
  sport_id: string;
  sport_name: string | null;
  format: 'singles' | 'doubles';
  /** Players who must each thumbs-up an option for it to become mutual. */
  participant_ids: string[];
  /** Null on system-posted cards (posted_by='system'). */
  organizer_id: string | null;
  /** 'system' = auto-posted (round chats); absent/'player' = posted via the sheet. */
  posted_by?: 'system' | 'player';
  /** Bracket pairing behind an auto-posted card. Drives card regeneration. */
  tournament_match_id?: string | null;
  /** When the options snapshot was last generated (regeneration staleness). */
  options_generated_at?: string | null;
  /** Suppresses the new_message notification fan-out (system cards). */
  silent?: boolean;
  /** True when no option was free for every participant — options is empty. */
  no_overlap?: boolean;
  options: MatchOrganizerOption[];
  /** Set once a game is created from this card (flips the card to a final state). */
  created_match_id?: string | null;
  confirmed_option_index?: number | null;
}

export type MessageMetadata =
  | CourtBookingPromptMetadata
  | CourtBookedMetadata
  | MatchOrganizerMetadata
  | Record<string, unknown>;

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
  tournament_id?: string | null;
  /** Set on a tournament "round chat" — the per-pairing chat for a bracket match. */
  tournament_match_id?: string | null;
  /** Set on a league "pairing chat" — the per-pairing chat for a session sheet match. */
  session_match_id?: string | null;
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
  /** Defaults to 'user' when absent (e.g. optimistic local messages). */
  message_type?: MessageType;
  /** Structured payload for system cards (court booking prompt / booked). */
  metadata?: MessageMetadata | null;
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
  /**
   * Message type of the preview line ('user', 'match_organizer', ...). Lets the
   * conversation list localize structured-card previews per viewer instead of
   * echoing `content`, which a server-posted card can only write in one locale.
   */
  last_message_type?: string | null;
  /** Trimmed metadata for preview localization (never the full options array). */
  last_message_meta?: {
    kind?: string;
    no_overlap?: boolean;
    system_note?: string;
    actor_name?: string;
  } | null;
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
    start_time: string | null;
    format: 'singles' | 'doubles';
  } | null;
  // Network-linked chat info (for groups/communities)
  network_id?: string | null;
  network_type?: string | null; // 'friends', 'player_group', 'club', 'community', 'public', 'private'
  // Tournament-linked chat info
  tournament_id?: string | null;
  tournament_info?: {
    name: string;
    sport_name: string;
    status: string;
  } | null;
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
  /** Client-generated message id (idempotency key). Generated when omitted. */
  id?: string;
  conversation_id: string;
  content: string;
  sender_id: string;
  reply_to_message_id?: string;
  /** Defaults to 'user' when omitted. Set for structured cards (e.g. 'match_organizer'). */
  message_type?: MessageType;
  /** Structured payload for non-'user' message types. */
  metadata?: MessageMetadata | null;
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

/**
 * One pairing's score-entry context (lt_pairing_score_context), as read from a
 * pairing chat. `can_self_score` mirrors the participant guards of the write
 * RPCs; `reason` names why it is false, for copy.
 */
export type PairingScoreContext =
  | {
      kind: 'tournament';
      can_self_score: boolean;
      reason: string | null;
      tournament_match_id: string;
      tournament_id: string;
      player1_registration_id: string;
      player2_registration_id: string;
      player1_name: string;
      player2_name: string;
      sport_name: string | null;
      match_format: Enums<'match_format'> | null;
      points_per_game: number | null;
      is_final: boolean;
      is_pool_match: boolean;
    }
  | {
      kind: 'session';
      can_self_score: boolean;
      reason: string | null;
      session_match_id: string;
      session_id: string;
      season_id: string;
      version_was: number;
      team_a_name: string;
      team_b_name: string;
      sport_name: string | null;
      match_format: Enums<'match_format'> | null;
      points_per_game: number | null;
      is_decider: boolean;
    };

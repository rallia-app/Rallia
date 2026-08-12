/**
 * Chat Service - Main Barrel File
 *
 * Re-exports all chat-related functions and types from modular service files.
 * This maintains backward compatibility with existing imports.
 *
 * Module Structure:
 * - chatTypes.ts          - Type definitions
 * - conversationService.ts - Conversation CRUD operations
 * - messageService.ts     - Message operations
 * - participantService.ts - Participant management (mute, pin, archive, add, remove)
 * - realtimeService.ts    - Real-time subscriptions
 * - reactionService.ts    - Emoji reaction operations
 * - chatUtilityService.ts - Search, online status, chat agreement, utilities
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  ConversationType,
  MessageStatus,
  Conversation,
  ConversationParticipant,
  Message,
  MessageType,
  MessageMetadata,
  CourtBookingPromptMetadata,
  CourtBookedMetadata,
  MatchOrganizerOption,
  MatchOrganizerMetadata,
  MessageReaction,
  ReactionSummary,
  MessageWithSender,
  ConversationWithDetails,
  ConversationPreview,
  SendMessageInput,
  CreateConversationInput,
  UpdateConversationInput,
  PlayerOnlineStatus,
  SearchMessageResult,
} from './chatTypes';

export { isGroupConversationType } from './chatTypes';

// ============================================================================
// CONVERSATION OPERATIONS
// ============================================================================

export {
  getPlayerConversations,
  getPlayerConversationsFiltered,
  getConversation,
  createConversation,
  getOrCreateDirectConversation,
  getMatchChat,
  getTournamentChat,
  getOrCreateTournamentRoundChat,
  getOrCreateSessionPairingChat,
  syncMatchConversationTitle,
  updateConversation,
  getConversationByNetworkId,
  getNetworkByConversationId,
  getConversationUnreadCount,
  getConversationUnreadCountLast7Days,
  setActiveConversation,
  clearActiveConversation,
} from './conversationService';

export type {
  GetFilteredConversationsInput,
  FilteredConversationsPage,
} from './conversationService';

// ============================================================================
// MESSAGE OPERATIONS
// ============================================================================

export {
  getMessages,
  sendMessage,
  markMessagesAsRead,
  markMessagesAsDelivered,
  markMessageAsDelivered,
  deleteMessage,
  editMessage,
  clearChatForUser,
} from './messageService';

// ============================================================================
// PARTICIPANT OPERATIONS
// ============================================================================

export {
  toggleMuteConversation,
  leaveConversation,
  addParticipant,
  addConversationParticipant,
  removeConversationParticipant,
  togglePinConversation,
  toggleArchiveConversation,
} from './participantService';

// ============================================================================
// REALTIME SUBSCRIPTIONS
// ============================================================================

export {
  subscribeToMessages,
  subscribeToConversations,
  subscribeToReactions,
  subscribeToMatchVotes,
  unsubscribeFromChannel,
  type MessageEventCallback,
} from './realtimeService';

// ============================================================================
// MATCH ORGANIZER OPERATIONS
// ============================================================================

export {
  getMatchOrganizerOptions,
  regenerateRoundChatSuggestions,
  addCustomOrganizerOption,
  getSharedSports,
  postMatchOrganizerCard,
  getMatchTimeVotes,
  addMatchTimeVote,
  removeMatchTimeVote,
  toggleMatchTimeVote,
  createCasualMatch,
  getTournamentMatchSportId,
  getSessionMatchSportId,
  type OrganizerSport,
  type MatchTimeVote,
} from './matchOrganizerService';

// ============================================================================
// REACTION OPERATIONS
// ============================================================================

export {
  COMMON_REACTIONS,
  addReaction,
  removeReaction,
  toggleReaction,
  getMessageReactions,
  getMessagesReactions,
} from './reactionService';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export {
  updatePlayerLastSeen,
  getPlayersOnlineStatus,
  isPlayerOnline,
  searchMessagesInConversation,
  getTotalUnreadCount,
  getUnreadConversationsCount,
  hasAgreedToChatRules,
  agreeToChatRules,
  getConversationDisplayName,
} from './chatUtilityService';

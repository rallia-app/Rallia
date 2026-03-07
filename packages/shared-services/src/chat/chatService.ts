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
 * - realtimeService.ts    - Real-time subscriptions & typing indicators
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
  MessageReaction,
  ReactionSummary,
  MessageWithSender,
  ConversationWithDetails,
  ConversationPreview,
  SendMessageInput,
  CreateConversationInput,
  UpdateConversationInput,
  PlayerOnlineStatus,
  TypingIndicator,
  SearchMessageResult,
} from './chatTypes';

// ============================================================================
// CONVERSATION OPERATIONS
// ============================================================================

export {
  getPlayerConversations,
  getConversation,
  createConversation,
  getOrCreateDirectConversation,
  createMatchChat,
  getMatchChat,
  updateConversation,
  getConversationByNetworkId,
  getNetworkByConversationId,
  getConversationUnreadCount,
} from './conversationService';

// ============================================================================
// MESSAGE OPERATIONS
// ============================================================================

export {
  getMessages,
  sendMessage,
  markMessagesAsRead,
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
  unsubscribeFromChannel,
  subscribeToTypingIndicators,
  sendTypingIndicator,
  unsubscribeFromTypingIndicators,
  type MessageEventCallback,
} from './realtimeService';

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
  hasAgreedToChatRules,
  agreeToChatRules,
} from './chatUtilityService';

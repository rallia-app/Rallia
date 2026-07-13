/**
 * Chat Service - Export all chat-related functions and types
 */

export {
  // Types
  type ConversationType,
  type MessageStatus,
  type Conversation,
  type ConversationParticipant,
  type Message,
  type MessageType,
  type MessageMetadata,
  type CourtBookingPromptMetadata,
  type CourtBookedMetadata,
  type MatchOrganizerOption,
  type MatchOrganizerMetadata,
  type MessageWithSender,
  type ConversationWithDetails,
  type ConversationPreview,
  type SendMessageInput,
  type CreateConversationInput,
  type MessageReaction,
  type ReactionSummary,
  // New enhanced types
  type PlayerOnlineStatus,
  type TypingIndicator,
  type SearchMessageResult,

  // Helpers
  isGroupConversationType,

  // Constants
  COMMON_REACTIONS,

  // Conversation Operations
  getPlayerConversations,
  getPlayerConversationsFiltered,
  getConversation,
  createConversation,
  getOrCreateDirectConversation,
  getMatchChat,
  getTournamentChat,
  getOrCreateTournamentRoundChat,
  syncMatchConversationTitle,
  setActiveConversation,
  clearActiveConversation,

  // Message Operations
  getMessages,
  sendMessage,
  markMessagesAsRead,
  markMessagesAsDelivered,
  markMessageAsDelivered,
  deleteMessage,
  editMessage,
  clearChatForUser,

  // Participant Operations
  toggleMuteConversation,
  leaveConversation,
  addParticipant,

  // Pin & Archive Operations
  togglePinConversation,
  toggleArchiveConversation,

  // Online Status Operations
  updatePlayerLastSeen,
  getPlayersOnlineStatus,
  isPlayerOnline,

  // Typing Indicator Operations
  subscribeToTypingIndicators,
  sendTypingIndicator,
  unsubscribeFromTypingIndicators,

  // Search Operations
  searchMessagesInConversation,

  // Reaction Operations
  addReaction,
  removeReaction,
  toggleReaction,
  getMessageReactions,
  getMessagesReactions,

  // Real-time Subscriptions
  subscribeToMessages,
  subscribeToConversations,
  subscribeToReactions,
  subscribeToMatchVotes,
  unsubscribeFromChannel,
  type MessageEventCallback,

  // Match Organizer Operations
  getMatchOrganizerOptions,
  getSharedSports,
  postMatchOrganizerCard,
  getMatchTimeVotes,
  addMatchTimeVote,
  removeMatchTimeVote,
  toggleMatchTimeVote,
  createCasualMatch,
  getTournamentMatchSportId,
  type OrganizerSport,
  type MatchTimeVote,

  // Utility Functions
  getTotalUnreadCount,
  getUnreadConversationsCount,
  getConversationByNetworkId,
  getNetworkByConversationId,
  getConversationUnreadCount,
  getConversationUnreadCountLast7Days,
  getConversationDisplayName,

  // Chat Agreement
  hasAgreedToChatRules,
  agreeToChatRules,

  // Conversation Management
  type UpdateConversationInput,
  updateConversation,
  addConversationParticipant,
  removeConversationParticipant,
} from './chatService';

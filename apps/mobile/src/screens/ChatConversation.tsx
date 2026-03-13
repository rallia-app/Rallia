/**
 * ChatConversation Screen
 * The actual chat view for a conversation
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, Alert, Keyboard } from 'react-native';
import { Skeleton, SkeletonAvatar, useToast } from '@rallia/shared-components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import {
  useThemeStyles,
  useAuth,
  useProfile,
  useTranslation,
  useNavigateToPlayerProfile,
  type TranslationKey,
} from '../hooks';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useConversation,
  useMessages,
  useSendMessage,
  useMarkMessagesAsRead,
  useToggleReaction,
  useChatRealtime,
  useReactionsRealtime,
  useChatAgreement,
  useAgreeToChatRules,
  useEditMessage,
  useTypingIndicators,
  useToggleMuteConversation,
  useBlockedStatus,
  useFavoriteStatus,
  chatKeys,
} from '@rallia/shared-hooks';
import { useQueryClient } from '@tanstack/react-query';
import {
  getMessagesReactions,
  getNetworkByConversationId,
  getMatchWithDetails,
  deleteMessage,
  isGroupConversationType,
  type ReactionSummary,
  type MessageWithSender,
} from '@rallia/shared-services';
import {
  ChatHeader,
  MessageList,
  MessageInput,
  TypingIndicator,
  ChatSearchBar,
  BlockedUserModal,
} from '../features/chat';
import { SheetManager } from 'react-native-actions-sheet';
import { useMatchDetailSheet } from '../context/MatchDetailSheetContext';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import type { MessageListRef } from '../features/chat';
import type { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ChatRouteProp = RouteProp<RootStackParamList, 'ChatConversation'>;

interface NetworkInfo {
  id: string;
  name: string;
  cover_image_url: string | null;
  member_count: number;
}

export default function ChatConversationScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ChatRouteProp>();
  const { conversationId, title: routeTitle } = route.params;

  const { colors } = useThemeStyles();
  const { session } = useAuth();
  const { profile } = useProfile();
  const toast = useToast();
  const { t } = useTranslation();
  const playerId = session?.user?.id;
  // Get player name for typing indicator - use type assertion since DB types may not include first_name directly
  const playerName = (profile as { first_name?: string } | null)?.first_name || t('common.user');
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { openSheet: openMatchDetailSheet } = useMatchDetailSheet();

  const [reactions, setReactions] = useState<Map<string, ReactionSummary[]>>(new Map());
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);

  // Reply state
  const [replyToMessage, setReplyToMessage] = useState<MessageWithSender | null>(null);

  // Search bar state
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedMessageIds, setHighlightedMessageIds] = useState<string[]>([]);
  const [currentHighlightedId, setCurrentHighlightedId] = useState<string | undefined>();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Ref for MessageList to scroll to messages
  const messageListRef = React.useRef<MessageListRef>(null);

  // Ref to track if agreement modal has been shown (prevents showing twice)
  const agreementModalShownRef = React.useRef(false);

  // Check if user has agreed to chat rules
  const { data: hasAgreed, isLoading: isLoadingAgreement } = useChatAgreement(playerId);
  const agreeToChatRulesMutation = useAgreeToChatRules();

  // Mute mutation
  const { mutate: toggleMuteMutation } = useToggleMuteConversation();

  // Handle agreeing to chat rules
  const handleAgreeToRules = useCallback(() => {
    if (!playerId) return;
    agreeToChatRulesMutation.mutate(playerId);
  }, [playerId, agreeToChatRulesMutation]);

  // Handle declining chat rules - navigate back
  const handleDeclineRules = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Show agreement modal if user hasn't agreed yet (only once)
  useEffect(() => {
    if (!isLoadingAgreement && hasAgreed === false && !agreementModalShownRef.current) {
      agreementModalShownRef.current = true;
      SheetManager.show('chat-agreement', {
        payload: {
          onAgree: handleAgreeToRules,
          onDecline: handleDeclineRules,
        },
      });
    }
    // Reset ref when agreement status changes to true (user agreed)
    if (hasAgreed === true) {
      agreementModalShownRef.current = false;
    }
  }, [hasAgreed, isLoadingAgreement, routeTitle, handleAgreeToRules, handleDeclineRules]);

  // Fetch conversation details
  const { data: conversation, isLoading: isLoadingConversation } = useConversation(conversationId);

  // Get current participant's mute status (needed early for haptic feedback)
  const isMuted = useMemo(() => {
    if (!conversation?.participants || !playerId) return false;
    const currentParticipant = conversation.participants.find(p => p.player_id === playerId);
    return currentParticipant?.is_muted ?? false;
  }, [conversation, playerId]);

  // Fetch messages with infinite scroll
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchMessages,
  } = useMessages(conversationId);

  // Flatten pages into a single array
  const messages = useMemo(() => messagesData?.pages.flat() || [], [messagesData]);

  // Mutations
  const sendMessageMutation = useSendMessage();
  const markAsReadMutation = useMarkMessagesAsRead();
  const toggleReactionMutation = useToggleReaction();
  const editMessageMutation = useEditMessage();

  // Typing indicators
  const { typingUsers, sendTyping } = useTypingIndicators(conversationId, playerId, playerName);

  // Handle typing change from input
  const handleTypingChange = useCallback(
    (isTyping: boolean) => {
      sendTyping(isTyping);
    },
    [sendTyping]
  );

  // Real-time subscriptions for messages (including edits and deletes)
  // Includes haptic feedback for incoming messages (respecting mute status)
  useChatRealtime(conversationId, playerId, {
    onNewMessage: message => {
      // Only trigger haptic for messages from other users, and only if not muted
      if (message.sender_id !== playerId && !isMuted) {
        lightHaptic();
      }
      // Mark messages as read since user is viewing the conversation
      if (playerId && conversationId) {
        markAsReadMutation.mutate({ conversationId, playerId });
      }
    },
  });

  // Real-time subscription for reactions
  useReactionsRealtime(conversationId);

  // Invalidate messages cache and mark as read when entering the conversation
  // This ensures message statuses (sent → read) are fresh from the server
  useEffect(() => {
    if (conversationId && playerId) {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(conversationId),
      });
      markAsReadMutation.mutate({ conversationId, playerId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, playerId]);

  // Avoid bottom safe area spacer when keyboard is open (removes gap between input and keyboard)
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Fetch network info for group chats (for cover image)
  useEffect(() => {
    const fetchNetworkInfo = async () => {
      if (!conversation || !isGroupConversationType(conversation.conversation_type)) {
        setNetworkInfo(null);
        return;
      }

      try {
        const info = await getNetworkByConversationId(conversationId);
        setNetworkInfo(info);
      } catch (error) {
        console.error('Error fetching network info:', error);
      }
    };

    fetchNetworkInfo();
  }, [conversation, conversationId]);

  // Fetch reactions for visible messages
  const fetchReactions = useCallback(async () => {
    if (messages.length === 0 || !playerId) return;

    try {
      const messageIds = messages.map(m => m.id);

      if (messageIds.length === 0) return;

      const reactionsMap = await getMessagesReactions(messageIds, playerId);
      setReactions(reactionsMap);
    } catch (error) {
      console.error('Error fetching reactions:', error);
    }
  }, [messages, playerId]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  // Get conversation info for header
  const headerTitle = useMemo(() => {
    if (routeTitle) return routeTitle;
    if (conversation?.title) return conversation.title;

    // For direct conversations, show the other participant's name
    if (conversation?.conversation_type === 'direct' && conversation.participants) {
      const otherParticipant = conversation.participants.find(p => p.player_id !== playerId);
      if (otherParticipant?.player?.profile) {
        const { first_name, last_name } = otherParticipant.player.profile;
        return last_name ? `${first_name} ${last_name}` : first_name;
      }
    }

    return t('chat.title');
  }, [routeTitle, conversation, playerId, t]);

  const headerSubtitle = useMemo(() => {
    if (!conversation) return undefined;

    if (
      isGroupConversationType(conversation.conversation_type) ||
      conversation.conversation_type === 'announcement'
    ) {
      const count = networkInfo?.member_count || conversation.participants?.length || 0;
      return `${count} participant${count !== 1 ? 's' : ''}`;
    }

    return undefined;
  }, [conversation, networkInfo]);

  // Get group avatar (if it's a group conversation linked to a network)
  const headerImage = useMemo(() => {
    // For group chats linked to a network, use network cover image
    if (
      conversation &&
      isGroupConversationType(conversation.conversation_type) &&
      networkInfo?.cover_image_url
    ) {
      return networkInfo.cover_image_url;
    }

    // For simple group chats (no network), use conversation picture_url
    if (
      conversation &&
      isGroupConversationType(conversation.conversation_type) &&
      conversation.picture_url
    ) {
      return conversation.picture_url;
    }

    // For direct messages, show the other participant's avatar
    if (conversation?.conversation_type === 'direct' && conversation.participants) {
      const otherParticipant = conversation.participants.find(p => p.player_id !== playerId);
      return otherParticipant?.player?.profile?.profile_picture_url || null;
    }

    return null;
  }, [conversation, playerId, networkInfo]);

  // Check if this is a direct (user-to-user) chat
  const isDirectChat = useMemo(() => {
    return conversation?.conversation_type === 'direct';
  }, [conversation]);

  // Get the other user's ID for direct chats (used for blocking)
  const otherUserId = useMemo(() => {
    if (!isDirectChat || !conversation?.participants || !playerId) return undefined;
    const otherParticipant = conversation.participants.find(p => p.player_id !== playerId);
    return otherParticipant?.player_id;
  }, [isDirectChat, conversation, playerId]);

  // Get the other user's name for the blocked modal
  const otherUserName = useMemo(() => {
    if (!isDirectChat || !conversation?.participants || !playerId) return t('chat.thisUser');
    const otherParticipant = conversation.participants.find(p => p.player_id !== playerId);
    if (otherParticipant?.player?.profile) {
      const { first_name, last_name } = otherParticipant.player.profile;
      return last_name ? `${first_name} ${last_name}` : first_name || t('chat.thisUser');
    }
    return t('chat.thisUser');
  }, [isDirectChat, conversation, playerId, t]);

  // Block status for direct chats
  const {
    isBlocked,
    isToggling: isTogglingBlock,
    toggleBlock,
    unblockUser,
  } = useBlockedStatus(playerId, otherUserId);

  // Favorite status for direct chats
  const { isFavorite, toggleFavorite } = useFavoriteStatus(playerId, otherUserId);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  // Navigate to player profile (direct chat), group info (group chat), or match detail (match chat) when tapping header
  const handleTitlePress = useCallback(async () => {
    lightHaptic();
    if (isDirectChat && otherUserId) {
      navigateToPlayerProfile(otherUserId);
    } else if (conversation?.conversation_type === 'match' && conversation.match_id) {
      try {
        const match = await getMatchWithDetails(conversation.match_id);
        if (match) {
          openMatchDetailSheet(match as MatchDetailData, {
            onMatchRemoved: () => {
              // Optimistically remove this conversation from the cached list
              if (playerId) {
                queryClient.setQueryData(
                  chatKeys.playerConversations(playerId),
                  (old: { id: string }[] | undefined) => old?.filter(c => c.id !== conversationId)
                );
              }
              navigation.goBack();
            },
          });
        }
      } catch (error) {
        console.error('Error fetching match details:', error);
      }
    } else if (conversation && isGroupConversationType(conversation.conversation_type)) {
      navigation.navigate('GroupChatInfo', { conversationId });
    }
  }, [
    isDirectChat,
    otherUserId,
    conversation,
    conversationId,
    navigation,
    navigateToPlayerProfile,
    openMatchDetailSheet,
    playerId,
    queryClient,
  ]);

  // Header menu handlers
  const handleSearchPress = useCallback(() => {
    setShowSearchBar(true);
  }, []);

  const handleToggleMute = useCallback(() => {
    if (!playerId || !conversationId) return;
    toggleMuteMutation({
      conversationId,
      playerId,
      isMuted: !isMuted,
    });
  }, [playerId, conversationId, isMuted, toggleMuteMutation]);

  const handleToggleBlock = useCallback(async () => {
    if (!isDirectChat || !otherUserId) return;
    try {
      await toggleBlock();
    } catch (error) {
      console.error('Failed to toggle block:', error);
    }
  }, [isDirectChat, otherUserId, toggleBlock]);

  // Handle toggle favorite
  const handleToggleFavorite = useCallback(async () => {
    if (!isDirectChat || !otherUserId) return;
    try {
      await toggleFavorite();
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  }, [isDirectChat, otherUserId, toggleFavorite]);

  // Handle unblock from the blocked modal
  const handleUnblockFromModal = useCallback(async () => {
    try {
      await unblockUser();
    } catch (error) {
      console.error('Failed to unblock:', error);
    }
  }, [unblockUser]);

  const handleReport = useCallback(() => {
    if (!isDirectChat || !otherUserId || !playerId) {
      Alert.alert(t('chat.alerts.cannotReport'), t('chat.alerts.cannotReportMessage'));
      return;
    }
    SheetManager.show('report-user', {
      payload: {
        reporterId: playerId,
        reportedId: otherUserId,
        reportedName: headerTitle,
        conversationId,
      },
    });
  }, [isDirectChat, otherUserId, playerId, t, headerTitle, conversationId]);

  const handleClearChat = useCallback(() => {
    if (!playerId) return;

    Alert.alert(t('chat.alerts.clearYourMessages'), t('chat.alerts.clearYourMessagesConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.alerts.clear'),
        style: 'destructive',
        onPress: async () => {
          try {
            const { clearChatForUser } = await import('@rallia/shared-services');
            const deletedCount = await clearChatForUser(conversationId, playerId);
            refetchMessages();
            toast.success(t('chat.alerts.messagesDeleted', { count: deletedCount }));
          } catch (error) {
            console.error('Failed to clear chat:', error);
            toast.error(t('chat.alerts.failedToClear'));
          }
        },
      },
    ]);
  }, [conversationId, playerId, refetchMessages, toast, t]);

  const handleCloseSearch = useCallback(() => {
    setShowSearchBar(false);
    setSearchQuery('');
    setHighlightedMessageIds([]);
    setCurrentHighlightedId(undefined);
  }, []);

  // Handle search query change from ChatSearchBar
  const handleSearchChange = useCallback((query: string, matchedIds: string[]) => {
    setSearchQuery(query);
    setHighlightedMessageIds(matchedIds);
    if (matchedIds.length > 0) {
      setCurrentHighlightedId(matchedIds[0]);
    } else {
      setCurrentHighlightedId(undefined);
    }
  }, []);

  // Handle navigation to a matched message
  const handleNavigateToMatch = useCallback((messageId: string) => {
    setCurrentHighlightedId(messageId);
    // Scroll to the message
    messageListRef.current?.scrollToMessage(messageId);
  }, []);

  const handleSendMessage = useCallback(
    (content: string, replyToMessageId?: string) => {
      if (!playerId || !conversationId) return;

      sendMessageMutation.mutate({
        conversation_id: conversationId,
        sender_id: playerId,
        content,
        reply_to_message_id: replyToMessageId,
      });

      // Clear reply state after sending
      setReplyToMessage(null);
    },
    [playerId, conversationId, sendMessageMutation]
  );

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      if (!playerId) return;

      toggleReactionMutation.mutate(
        {
          messageId,
          playerId,
          emoji,
          conversationId,
        },
        {
          onSuccess: () => {
            // Refetch reactions to update the count
            fetchReactions();
          },
        }
      );
    },
    [playerId, conversationId, toggleReactionMutation, fetchReactions]
  );

  // Handle reply to message
  const handleReplyToMessage = useCallback((message: MessageWithSender) => {
    setReplyToMessage(message);
  }, []);

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Handle long press on message (show actions sheet)
  const handleLongPressMessage = useCallback(
    (message: MessageWithSender, pageY?: number) => {
      const handleReply = () => {
        setReplyToMessage(message);
      };

      const handleEdit = () => {
        // Show edit message sheet after a brief delay
        setTimeout(() => {
          SheetManager.show('edit-message', {
            payload: {
              message,
              onSave: async (newContent: string) => {
                if (!playerId || !conversationId) return;
                try {
                  await editMessageMutation.mutateAsync({
                    messageId: message.id,
                    senderId: playerId,
                    newContent,
                    conversationId,
                  });
                  refetchMessages();
                } catch (error) {
                  console.error('Error editing message:', error);
                }
              },
              isSaving: editMessageMutation.isPending,
            },
          });
        }, 350);
      };

      const handleDelete = async () => {
        if (!playerId) return;
        try {
          await deleteMessage(message.id, playerId);
          refetchMessages();
        } catch (error) {
          console.error('Error deleting message:', error);
        }
      };

      const handleReact = (emoji: string) => {
        if (!playerId) return;
        toggleReactionMutation.mutate(
          { messageId: message.id, playerId, emoji, conversationId },
          { onSuccess: () => fetchReactions() }
        );
      };

      SheetManager.show('message-actions', {
        payload: {
          message,
          isOwnMessage: message.sender_id === playerId,
          messageY: pageY,
          onReply: handleReply,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onReact: handleReact,
        },
      });
    },
    [
      playerId,
      conversationId,
      editMessageMutation,
      refetchMessages,
      toggleReactionMutation,
      fetchReactions,
    ]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const isLoading = isLoadingConversation || isLoadingMessages;

  if (isLoading && messages.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ChatHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          imageUrl={headerImage}
          onBack={handleBack}
          onTitlePress={handleTitlePress}
          isDirectChat={isDirectChat}
          isMuted={isMuted}
          isBlocked={isBlocked}
          isFavorite={isFavorite}
          onSearchPress={handleSearchPress}
          onToggleMute={handleToggleMute}
          onToggleFavorite={handleToggleFavorite}
          onToggleBlock={handleToggleBlock}
          onReport={handleReport}
          onClearChat={handleClearChat}
        />
        <View style={styles.loadingContainer}>
          {/* Message Skeleton Loaders */}
          {[...Array(6)].map((_, index) => {
            const isMe = index % 3 === 0;
            return (
              <View
                key={index}
                style={[
                  styles.messageSkeletonRow,
                  isMe ? styles.messageSkeletonRowRight : styles.messageSkeletonRowLeft,
                ]}
              >
                {!isMe && (
                  <SkeletonAvatar
                    size={32}
                    backgroundColor={colors.cardBackground}
                    highlightColor={colors.border}
                  />
                )}
                <View style={[styles.messageSkeleton, isMe && styles.messageSkeletonRight]}>
                  <Skeleton
                    width={isMe ? 150 : 200}
                    height={50}
                    borderRadius={16}
                    backgroundColor={colors.cardBackground}
                    highlightColor={colors.border}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ChatHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        imageUrl={headerImage}
        onBack={handleBack}
        onTitlePress={handleTitlePress}
        isDirectChat={isDirectChat}
        isMuted={isMuted}
        isBlocked={isBlocked}
        isFavorite={isFavorite}
        onSearchPress={handleSearchPress}
        onToggleMute={handleToggleMute}
        onToggleFavorite={handleToggleFavorite}
        onToggleBlock={handleToggleBlock}
        onReport={handleReport}
        onClearChat={handleClearChat}
      />

      {/* Search bar - shown when search is activated from menu */}
      {showSearchBar && (
        <ChatSearchBar
          conversationId={conversationId}
          visible={showSearchBar}
          onClose={handleCloseSearch}
          onSearchChange={handleSearchChange}
          onNavigateToMatch={handleNavigateToMatch}
        />
      )}

      <MessageList
        ref={messageListRef}
        messages={messages}
        currentUserId={playerId || ''}
        onReact={handleReact}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
        hasMore={hasNextPage || false}
        reactions={reactions}
        onReplyToMessage={handleReplyToMessage}
        onLongPressMessage={handleLongPressMessage}
        searchQuery={searchQuery}
        highlightedMessageIds={highlightedMessageIds}
        currentHighlightedId={currentHighlightedId}
      />

      {/* Typing indicators */}
      {typingUsers.length > 0 && <TypingIndicator typingUsers={typingUsers} />}

      {/* Show blocked modal if user has blocked the other user */}
      {isDirectChat && isBlocked ? (
        <BlockedUserModal
          visible={true}
          userName={otherUserName}
          onUnblock={handleUnblockFromModal}
          onReport={handleReport}
          onBack={handleBack}
          isUnblocking={isTogglingBlock}
        />
      ) : (
        <MessageInput
          onSend={handleSendMessage}
          replyToMessage={replyToMessage}
          onCancelReply={handleCancelReply}
          onTypingChange={handleTypingChange}
          keyboardVisible={isKeyboardVisible}
        />
      )}

      {/* Bottom safe area spacer when keyboard is closed (skip when keyboard open to avoid gap above keyboard) */}
      <View
        style={{
          height: isKeyboardVisible ? 0 : Platform.OS === 'ios' ? 0 : insets.bottom,
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  messageSkeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  messageSkeletonRowLeft: {
    justifyContent: 'flex-start',
  },
  messageSkeletonRowRight: {
    justifyContent: 'flex-end',
  },
  messageSkeleton: {
    marginLeft: 8,
  },
  messageSkeletonRight: {
    marginLeft: 0,
    marginRight: 0,
  },
});

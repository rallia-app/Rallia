/**
 * MessageList Component
 * Displays messages in a chat with date separators and infinite scroll
 * Supports search highlighting, navigation, and scroll-to-bottom button
 */

import React, {
  useCallback,
  useMemo,
  memo,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels } from '@rallia/design-system';
import type { MessageWithSender, ReactionSummary } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';

import { CourtSystemMessageCard } from './CourtSystemMessageCard';
import { MatchOrganizerCard } from './MatchOrganizerCard';
import { MessageBubble } from './MessageBubble';

export interface MessageListRef {
  scrollToMessage: (messageId: string) => void;
  scrollToBottom: () => void;
}

interface MessageListProps {
  messages: MessageWithSender[];
  currentUserId: string;
  onReact: (messageId: string, emoji: string) => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  hasMore: boolean;
  reactions?: Map<string, ReactionSummary[]>;
  onReplyToMessage?: (message: MessageWithSender) => void;
  onLongPressMessage?: (message: MessageWithSender, pageY?: number) => void;
  onAvatarPress?: (senderId: string) => void;
  searchQuery?: string;
  highlightedMessageIds?: string[];
  currentHighlightedId?: string;
}

// Threshold for showing scroll-to-bottom button (in pixels)
const SCROLL_THRESHOLD = 200;

// Translation function type that accepts any key (for internal use)
type TranslateFn = (key: string, options?: Record<string, string | number | boolean>) => string;

// Helper to format date for separators
function formatDateSeparator(date: Date, locale: string, t: TranslateFn): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return t('chat.today');
  } else if (isYesterday) {
    return t('chat.yesterday');
  } else {
    // Check if within last week
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      return date.toLocaleDateString(locale, { weekday: 'long' });
    }
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }
}

// Check if two messages are from the same day
function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() === date2.toDateString();
}

// Check if we should show sender info (first message from this sender in a sequence)
function shouldShowSenderInfo(
  currentMessage: MessageWithSender,
  previousMessage: MessageWithSender | undefined,
  currentUserId: string
): boolean {
  // Always show for other's first message in a sequence
  if (currentMessage.sender_id === currentUserId) return false;
  if (!previousMessage) return true;
  if (previousMessage.sender_id !== currentMessage.sender_id) return true;

  // Also show if there's been a significant time gap (5 minutes)
  const timeDiff =
    new Date(currentMessage.created_at).getTime() - new Date(previousMessage.created_at).getTime();
  if (timeDiff > 5 * 60 * 1000) return true;

  return false;
}

function MessageListComponent(
  {
    messages = [],
    currentUserId,
    onReact,
    onLoadMore,
    isLoadingMore,
    hasMore,
    reactions = new Map(),
    onReplyToMessage,
    onLongPressMessage,
    onAvatarPress,
    searchQuery = '',
    highlightedMessageIds = [],
    currentHighlightedId,
  }: MessageListProps,
  ref: React.Ref<MessageListRef>
) {
  const { colors } = useThemeStyles();
  const { t, locale } = useTranslation();
  const flatListRef = useRef<FlatList>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollButtonOpacity = useRef(new Animated.Value(0)).current;

  // Create a set for O(1) lookup of highlighted IDs
  const highlightedSet = useMemo(() => new Set(highlightedMessageIds), [highlightedMessageIds]);

  // Messages come newest first from the API
  // FlatList with inverted=true displays them with oldest at top, newest at bottom
  // Date separators should appear ABOVE (visually) the first message of each day
  const processedMessages = useMemo(() => {
    const result: Array<{
      type: 'message' | 'dateSeparator';
      message?: MessageWithSender;
      date?: string;
      id: string;
      showSenderInfo?: boolean;
    }> = [];

    // Guard against undefined messages
    if (!messages || messages.length === 0) {
      return result;
    }

    // Messages are in descending order (newest first)
    // In inverted list: first item (newest) appears at bottom, last item (oldest) at top
    // We want: DateSeparator to appear ABOVE its day's messages
    // In data terms: DateSeparator should come AFTER its day's messages

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageDate = new Date(message.created_at);
      const nextMessage = messages[i + 1]; // Older message (appears above in UI)

      // Determine if we should show sender info
      const showSenderInfo = shouldShowSenderInfo(message, nextMessage, currentUserId);

      // Add the message first
      result.push({
        type: 'message',
        message,
        id: message.id,
        showSenderInfo,
      });

      // Check if we need a date separator AFTER this message (appears ABOVE in UI)
      // Add separator if this is the last message OR the next message is from a different day
      const needsSeparator =
        !nextMessage || !isSameDay(messageDate, new Date(nextMessage.created_at));

      if (needsSeparator) {
        result.push({
          type: 'dateSeparator',
          date: formatDateSeparator(messageDate, locale, t as TranslateFn),
          id: `date-${messageDate.toDateString()}`,
        });
      }
    }

    return result;
  }, [messages, currentUserId, locale, t]);

  // Handle scroll to track if user scrolled up
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // In an inverted list, contentOffset.y increases as you scroll UP (away from bottom)
      const offsetY = event.nativeEvent.contentOffset.y;
      const shouldShow = offsetY > SCROLL_THRESHOLD;

      if (shouldShow !== showScrollButton) {
        setShowScrollButton(shouldShow);
        Animated.timing(scrollButtonOpacity, {
          toValue: shouldShow ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    },
    [showScrollButton, scrollButtonOpacity]
  );

  // Scroll to bottom (index 0 in inverted list)
  const scrollToBottom = useCallback(() => {
    if (flatListRef.current && processedMessages.length > 0) {
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
      });
    }
  }, [processedMessages.length]);

  // Expose scrollToMessage and scrollToBottom methods to parent
  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage: (messageId: string) => {
        // Find the index of the message in processedMessages
        const index = processedMessages.findIndex(
          item => item.type === 'message' && item.id === messageId
        );
        if (index !== -1 && flatListRef.current) {
          flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5, // Center the message on screen
          });
        }
      },
      scrollToBottom,
    }),
    [processedMessages, scrollToBottom]
  );

  const handleReact = useCallback(
    (messageId: string) => (emoji: string) => {
      onReact(messageId, emoji);
    },
    [onReact]
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof processedMessages)[0] }) => {
      if (item.type === 'dateSeparator') {
        return (
          <View style={styles.dateSeparatorContainer}>
            <View style={[styles.dateSeparatorLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dateSeparatorText, { color: colors.textMuted }]}>{item.date}</Text>
            <View style={[styles.dateSeparatorLine, { backgroundColor: colors.border }]} />
          </View>
        );
      }

      if (item.message) {
        // System cards (court booking prompt / booked) render full-width,
        // not as a sender bubble.
        if (
          item.message.message_type === 'court_booking_prompt' ||
          item.message.message_type === 'court_booked'
        ) {
          return <CourtSystemMessageCard message={item.message} />;
        }

        // Match Organizer card: votable time/place options, full-width.
        if (item.message.message_type === 'match_organizer') {
          return <MatchOrganizerCard message={item.message} />;
        }

        // System notes (e.g. "Alex updated their availability") render as a
        // centered muted line, localized here from metadata rather than from the
        // stored content — one message row is shared by readers whose locales
        // may differ.
        const systemNote = (item.message.metadata as { system_note?: string } | null)?.system_note;
        if (systemNote === 'availability_updated' || systemNote === 'custom_option_added') {
          const actorName =
            (item.message.metadata as { actor_name?: string } | null)?.actor_name ?? '';
          return (
            <View style={styles.systemNote}>
              <Text size="xs" color={colors.textMuted} style={styles.systemNoteText}>
                {t(
                  systemNote === 'custom_option_added'
                    ? 'matchOrganizer.custom.systemNote'
                    : 'availabilityOverlay.systemNote.updated'
                ).replace('{name}', actorName)}
              </Text>
            </View>
          );
        }

        const messageReactions = reactions.get(item.message.id) || [];
        const isHighlighted = highlightedSet.has(item.message.id);
        const isCurrentHighlight = item.message.id === currentHighlightedId;

        return (
          <MessageBubble
            message={item.message}
            isOwnMessage={item.message.sender_id === currentUserId}
            showSenderInfo={item.showSenderInfo || false}
            onReact={handleReact(item.message.id)}
            reactions={messageReactions}
            onReplyPress={onReplyToMessage ? () => onReplyToMessage(item.message!) : undefined}
            onLongPress={
              onLongPressMessage
                ? (pageY: number) => onLongPressMessage(item.message!, pageY)
                : undefined
            }
            onAvatarPress={onAvatarPress ? () => onAvatarPress(item.message!.sender_id) : undefined}
            searchQuery={searchQuery}
            isHighlighted={isHighlighted}
            isCurrentHighlight={isCurrentHighlight}
          />
        );
      }

      return null;
    },
    [
      colors,
      currentUserId,
      handleReact,
      reactions,
      onReplyToMessage,
      onLongPressMessage,
      onAvatarPress,
      searchQuery,
      highlightedSet,
      currentHighlightedId,
    ]
  );

  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }, [isLoadingMore, colors]);

  const keyExtractor = useCallback((item: (typeof processedMessages)[0]) => item.id, []);

  const handleEndReached = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Handle scroll to index failure (item not rendered yet)
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      // Wait and try again
      setTimeout(() => {
        if (flatListRef.current && processedMessages.length > 0) {
          flatListRef.current.scrollToIndex({
            index: Math.min(info.index, processedMessages.length - 1),
            animated: true,
            viewPosition: 0.5,
          });
        }
      }, 100);
    },
    [processedMessages.length]
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={processedMessages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        inverted
        contentContainerStyle={styles.listContent}
        // Dismiss the keyboard when the user drags the list. The message input
        // is multiline (return inserts a newline, never closes the keyboard),
        // so dragging is the primary dismiss gesture. "on-drag" works even in
        // sparse conversations where there's little content to tap on.
        keyboardDismissMode="on-drag"
        // Pass taps to children (reactions, long-press, etc.) but dismiss the
        // keyboard when a tap lands on non-interactive space.
        keyboardShouldPersistTaps="handled"
        // Keep the list draggable even when there's little/no content, so the
        // "on-drag" dismiss gesture still fires in sparse conversations.
        alwaysBounceVertical
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        ListFooterComponent={renderFooter}
        // Note: RefreshControl is intentionally not used here because:
        // 1. The list is inverted, which reverses the pull gesture direction
        // 2. New messages arrive via real-time subscriptions automatically
        // 3. Older messages are loaded via onEndReached when scrolling up
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={10}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {/* Scroll to Bottom Button */}
      <Animated.View
        style={[styles.scrollButtonContainer, { opacity: scrollButtonOpacity }]}
        pointerEvents={showScrollButton ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={[styles.scrollButton, { backgroundColor: colors.cardBackground }]}
          onPress={scrollToBottom}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-down" size={24} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export const MessageList = memo(forwardRef(MessageListComponent)) as React.MemoExoticComponent<
  React.ForwardRefExoticComponent<MessageListProps & React.RefAttributes<MessageListRef>>
>;

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: spacingPixels[4],
  },
  container: {
    flex: 1,
  },
  dateSeparatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
  },
  systemNote: {
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[2],
  },
  systemNoteText: {
    textAlign: 'center',
  },
  dateSeparatorText: {
    fontSize: fontSizePixels.xs,
    fontWeight: '500',
    paddingHorizontal: spacingPixels[3],
    textTransform: 'capitalize',
  },
  loadingFooter: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  scrollButtonContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  scrollButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});

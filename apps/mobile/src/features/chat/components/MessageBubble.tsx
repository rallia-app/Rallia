/**
 * MessageBubble Component
 * Displays a single message in the chat with sender info, reactions, replies, and edit status
 * Includes swipe-to-reply with visual feedback
 */

import React, { useCallback, memo, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Pressable,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getShortName, getProfilePictureUrl, lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, fontSizePixels, primary, status } from '@rallia/design-system';
import type { MessageWithSender, ReactionSummary } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';
import { formatTimeOfDay } from '#/utils/dateFormatting';

import { useChatLinkPress } from '../hooks/useChatLinkPress';

interface MessageBubbleProps {
  message: MessageWithSender;
  isOwnMessage: boolean;
  showSenderInfo: boolean;
  onReact: (emoji: string) => void;
  onLongPress?: (pageY: number) => void;
  onReplyPress?: () => void;
  onAvatarPress?: () => void;
  reactions?: ReactionSummary[];
  searchQuery?: string;
  isHighlighted?: boolean;
  isCurrentHighlight?: boolean;
}

// Regex to detect URLs in text
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
// Anchored, non-global: .test() on a /g regex is lastIndex-dependent.
const URL_TEST_REGEX = /^https?:\/\/[^\s]+$/;

// Swipe threshold to trigger reply
const SWIPE_THRESHOLD = 60;

interface ReactionPillProps {
  reaction: ReactionSummary;
  onPress: () => void;
  isDark: boolean;
  backgroundColor: string;
  borderColor: string;
  countColor: string;
}

function ReactionPill({
  reaction,
  onPress,
  isDark,
  backgroundColor,
  borderColor,
  countColor,
}: ReactionPillProps) {
  const scale = useMemo(() => new Animated.Value(0.6), []);

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 160,
    }).start();
  }, [scale]);

  const handlePress = useCallback(() => {
    void lightHaptic();
    onPress();
  }, [onPress]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.reactionPill,
          !isDark && styles.reactionPillShadow,
          { backgroundColor, borderColor },
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      >
        <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
        <Text style={[styles.reactionCount, { color: countColor }]}>{reaction.count}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function MessageBubbleComponent({
  message,
  isOwnMessage,
  showSenderInfo,
  onReact,
  onLongPress,
  onReplyPress,
  onAvatarPress,
  reactions = [],
  searchQuery = '',
  isHighlighted = false,
  isCurrentHighlight = false,
}: MessageBubbleProps) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const handleLinkPress = useChatLinkPress();

  // Animation values for swipe-to-reply - using useMemo for stable instances
  const translateX = useMemo(() => new Animated.Value(0), []);
  const replyIconOpacity = useMemo(() => new Animated.Value(0), []);
  const replyIconScale = useMemo(() => new Animated.Value(0.5), []);

  const senderName = getShortName(message.sender?.profile, 'Unknown');

  const senderAvatar = getProfilePictureUrl(message.sender?.profile?.profile_picture_url);

  const formattedTime = formatTimeOfDay(new Date(message.created_at), locale, { hour: '2-digit' });

  const isEdited = message.is_edited ?? false;
  const isDeleted = message.deleted_at != null;
  // Optimistic placeholder not yet confirmed by the server. Its id is a temp
  // string (not a real UUID), so actions that hit the DB by id (react, edit,
  // delete, reply) must be disabled until the real row replaces it.
  const isPending = message.id.startsWith('optimistic-');

  // Pan responder for swipe gesture - using useMemo for stable instance
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Only respond to horizontal swipes (right direction for reply)
          return (
            Math.abs(gestureState.dx) > 10 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
            gestureState.dx > 0 && // Only swipe right
            !isDeleted &&
            !isPending &&
            onReplyPress != null
          );
        },
        onPanResponderGrant: () => {
          // Reset values at start of gesture
        },
        onPanResponderMove: (_, gestureState) => {
          // Limit the swipe distance and only allow right swipe
          const clampedX = Math.min(Math.max(gestureState.dx, 0), SWIPE_THRESHOLD + 20);
          translateX.setValue(clampedX);

          // Calculate opacity and scale based on swipe progress
          const progress = Math.min(clampedX / SWIPE_THRESHOLD, 1);
          replyIconOpacity.setValue(progress);
          replyIconScale.setValue(0.5 + progress * 0.5);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx >= SWIPE_THRESHOLD && onReplyPress) {
            // Trigger reply
            onReplyPress();
          }

          // Animate back to original position
          Animated.parallel([
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 100,
              friction: 10,
            }),
            Animated.timing(replyIconOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(replyIconScale, {
              toValue: 0.5,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        },
        onPanResponderTerminate: () => {
          // Reset on termination
          Animated.parallel([
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }),
            Animated.timing(replyIconOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PanResponder creation uses initial values intentionally
    []
  );

  // Helper to render text with search highlighting
  const renderTextWithHighlight = useCallback(
    (text: string, baseStyle: object, key?: string | number, isLink?: boolean) => {
      const handlePress = isLink ? () => handleLinkPress(text) : undefined;

      if (!searchQuery || searchQuery.length < 2) {
        return (
          <Text key={key} style={baseStyle} onPress={handlePress}>
            {text}
          </Text>
        );
      }

      // Case-insensitive search and split
      const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = text.split(regex);

      return (
        <Text key={key} style={baseStyle} onPress={handlePress}>
          {parts.map((part, i) => {
            if (part.toLowerCase() === searchQuery.toLowerCase()) {
              return (
                <Text
                  key={i}
                  style={[
                    baseStyle,
                    styles.highlightedText,
                    { backgroundColor: status.warning.light },
                  ]}
                >
                  {part}
                </Text>
              );
            }
            return part;
          })}
        </Text>
      );
    },
    [searchQuery, handleLinkPress]
  );

  // Parse content for URLs with optional search highlighting
  const renderContent = useCallback(() => {
    // Show "This message was deleted" for deleted messages
    if (isDeleted) {
      return (
        <Text
          style={[
            styles.messageText,
            styles.deletedText,
            { color: isOwnMessage ? 'rgba(255,255,255,0.7)' : colors.textMuted },
          ]}
        >
          {t('chat.message.deleted')}
        </Text>
      );
    }

    const parts = message.content.split(URL_REGEX);

    return parts.map((part, index) => {
      const baseStyle = [styles.messageText, { color: isOwnMessage ? '#FFFFFF' : colors.text }];

      if (URL_TEST_REGEX.test(part)) {
        // URL part - still apply highlighting if needed, and make clickable
        return renderTextWithHighlight(
          part,
          [...baseStyle, styles.linkText],
          index,
          true // isLink
        );
      }

      // Regular text - apply highlighting
      return renderTextWithHighlight(part, baseStyle, index, false);
    });
  }, [
    message.content,
    isOwnMessage,
    colors.text,
    colors.textMuted,
    isDeleted,
    renderTextWithHighlight,
    t,
  ]);

  const handleLongPress = useCallback(
    (event: { nativeEvent: { pageY: number } }) => {
      // No actions on deleted or not-yet-confirmed (optimistic) messages
      if (isDeleted || isPending) return;
      onLongPress?.(event.nativeEvent.pageY);
    },
    [onLongPress, isDeleted, isPending]
  );

  return (
    <View style={styles.swipeContainer}>
      {/* Reply icon that appears when swiping */}
      <Animated.View
        style={[
          styles.replyIconContainer,
          {
            opacity: replyIconOpacity,
            transform: [{ scale: replyIconScale }],
          },
        ]}
      >
        <View style={[styles.replyIcon, { backgroundColor: primary[500] }]}>
          <Ionicons name="arrow-undo-outline" size={18} color="#FFFFFF" />
        </View>
      </Animated.View>

      {/* Swipeable message container */}
      <Animated.View
        style={[styles.animatedContainer, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.container, isOwnMessage && styles.containerOwn]}>
          {/* Avatar - only for other's messages */}
          {!isOwnMessage && showSenderInfo && (
            <TouchableOpacity
              style={styles.avatarContainer}
              onPress={onAvatarPress}
              disabled={!onAvatarPress}
              activeOpacity={onAvatarPress ? 0.7 : 1}
            >
              {senderAvatar ? (
                <Image source={{ uri: senderAvatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Spacer for messages without avatar */}
          {!isOwnMessage && !showSenderInfo && <View style={styles.avatarSpacer} />}

          <View style={[styles.bubbleContainer, isOwnMessage && styles.bubbleContainerOwn]}>
            {/* Sender name */}
            {!isOwnMessage && showSenderInfo && (
              <Text style={[styles.senderName, { color: primary[500] }]}>{senderName}</Text>
            )}

            {/* Message bubble */}
            <Pressable
              onLongPress={handleLongPress}
              style={[
                styles.bubble,
                isOwnMessage
                  ? { backgroundColor: primary[600] }
                  : { backgroundColor: isDark ? colors.card : '#F0F0F0' },
                isDeleted && styles.deletedBubble,
                // Search highlight styling
                isHighlighted && !isCurrentHighlight && styles.highlightedBubble,
                isCurrentHighlight && styles.currentHighlightedBubble,
              ]}
            >
              {/* Reply Preview - Show the message being replied to */}
              {message.reply_to && !isDeleted && (
                <TouchableOpacity
                  style={[
                    styles.replyPreview,
                    {
                      borderLeftColor: primary[400],
                      backgroundColor: isOwnMessage
                        ? 'rgba(255,255,255,0.15)'
                        : isDark
                          ? 'rgba(0,0,0,0.1)'
                          : 'rgba(0,0,0,0.05)',
                    },
                  ]}
                  onPress={onReplyPress}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.replyName,
                      { color: isOwnMessage ? 'rgba(255,255,255,0.9)' : primary[500] },
                    ]}
                    numberOfLines={1}
                  >
                    {message.reply_to.sender_name}
                  </Text>
                  <Text
                    style={[
                      styles.replyText,
                      { color: isOwnMessage ? 'rgba(255,255,255,0.7)' : colors.textMuted },
                    ]}
                    numberOfLines={1}
                  >
                    {message.reply_to.content}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={styles.messageContent}>{renderContent()}</View>

              {/* Timestamp, edited indicator, and delivery status */}
              <View style={styles.timestampRow}>
                {isEdited && !isDeleted && (
                  <Text
                    style={[
                      styles.editedLabel,
                      { color: isOwnMessage ? 'rgba(255,255,255,0.6)' : colors.textMuted },
                    ]}
                  >
                    {t('chat.message.edited')}
                  </Text>
                )}
                <Text
                  style={[
                    styles.timestamp,
                    { color: isOwnMessage ? 'rgba(255,255,255,0.7)' : colors.textMuted },
                  ]}
                >
                  {formattedTime}
                </Text>
                {/* Delivery status indicators - only for own messages */}
                {isOwnMessage && !isDeleted && (
                  <View style={styles.deliveryStatus}>
                    {message.status === 'failed' ? (
                      <Ionicons
                        name="alert-circle-outline"
                        size={14}
                        color={status.error.DEFAULT}
                      />
                    ) : message.status === 'read' ? (
                      <View style={styles.doubleCheck}>
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color="#34B7F1"
                          style={styles.checkFirst}
                        />
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color="#34B7F1"
                          style={styles.checkSecond}
                        />
                      </View>
                    ) : message.status === 'delivered' ? (
                      <View style={styles.doubleCheck}>
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color="rgba(255,255,255,0.6)"
                          style={styles.checkFirst}
                        />
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color="rgba(255,255,255,0.6)"
                          style={styles.checkSecond}
                        />
                      </View>
                    ) : (
                      // 'sent' status - single check
                      <Ionicons name="checkmark-outline" size={14} color="rgba(255,255,255,0.6)" />
                    )}
                  </View>
                )}
              </View>
            </Pressable>

            {/* Reactions — pills overlapping the bubble's bottom edge */}
            {reactions.length > 0 && (
              <View
                style={[styles.reactionsContainer, isOwnMessage && styles.reactionsContainerOwn]}
              >
                {reactions.map(reaction => (
                  <ReactionPill
                    key={reaction.emoji}
                    reaction={reaction}
                    onPress={() => onReact(reaction.emoji)}
                    isDark={isDark}
                    backgroundColor={
                      reaction.hasReacted
                        ? isDark
                          ? primary[900]
                          : primary[100]
                        : colors.background
                    }
                    borderColor={reaction.hasReacted ? primary[500] : colors.border}
                    countColor={
                      reaction.hasReacted
                        ? isDark
                          ? primary[300]
                          : primary[600]
                        : colors.textMuted
                    }
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);

const styles = StyleSheet.create({
  swipeContainer: {
    position: 'relative',
    overflow: 'visible',
  },
  replyIconContainer: {
    position: 'absolute',
    left: spacingPixels[2],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: -1,
  },
  replyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedContainer: {
    width: '100%',
  },
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[1],
    maxWidth: '100%',
  },
  containerOwn: {
    flexDirection: 'row-reverse',
  },
  avatarContainer: {
    marginRight: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSpacer: {
    width: 32 + spacingPixels[2],
  },
  bubbleContainer: {
    maxWidth: '75%',
  },
  bubbleContainerOwn: {
    alignItems: 'flex-end',
  },
  senderName: {
    fontSize: fontSizePixels.sm,
    fontWeight: '600',
    marginBottom: spacingPixels[1],
    marginLeft: spacingPixels[2],
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    minWidth: 60,
  },
  deletedBubble: {
    opacity: 0.7,
  },
  replyPreview: {
    borderLeftWidth: 3,
    paddingLeft: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    marginBottom: spacingPixels[2],
    borderRadius: 4,
  },
  replyName: {
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyText: {
    fontSize: fontSizePixels.xs,
  },
  messageContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  messageText: {
    fontSize: fontSizePixels.base,
    lineHeight: 22,
  },
  deletedText: {
    fontStyle: 'italic',
  },
  linkText: {
    textDecorationLine: 'underline',
  },
  timestampRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
  editedLabel: {
    fontSize: fontSizePixels.xs,
    fontStyle: 'italic',
    marginRight: spacingPixels[1],
  },
  timestamp: {
    fontSize: fontSizePixels.xs,
  },
  deliveryStatus: {
    marginLeft: spacingPixels[1],
    flexDirection: 'row',
    alignItems: 'center',
  },
  doubleCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 16,
  },
  checkFirst: {
    marginRight: -6,
  },
  checkSecond: {
    marginLeft: 0,
  },
  reactionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Pull the pills up so they overlap the bubble's bottom corner
    // (-8 = the bubble's own bottom padding, so the timestamp is never covered)
    marginTop: -8,
    marginLeft: spacingPixels[3],
    marginBottom: spacingPixels[1],
    gap: spacingPixels[1],
  },
  reactionsContainerOwn: {
    justifyContent: 'flex-end',
    marginLeft: 0,
    marginRight: spacingPixels[3],
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[2],
    gap: 3,
  },
  reactionPillShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  reactionEmoji: {
    fontSize: 15,
    lineHeight: 19,
  },
  reactionCount: {
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
  },
  // Search highlight styles
  highlightedText: {
    borderRadius: 2,
  },
  highlightedBubble: {
    borderWidth: 2,
    borderColor: status.warning.light,
  },
  currentHighlightedBubble: {
    borderWidth: 2,
    borderColor: status.warning.DEFAULT,
    shadowColor: status.warning.DEFAULT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
});

/**
 * Skeleton Component
 * Animated placeholder for loading states - provides better UX than spinners
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle, Easing, DimensionValue } from 'react-native';

import { typography, spacing } from '../theme';

export interface SkeletonProps {
  /**
   * Width of the skeleton
   * Can be number (pixels) or string (percentage)
   * @default '100%'
   */
  width?: number | string;

  /**
   * Height of the skeleton
   * @default 16
   */
  height?: number;

  /**
   * Border radius of the skeleton
   * @default 4
   */
  borderRadius?: number;

  /**
   * Whether the skeleton is circular
   * @default false
   */
  circle?: boolean;

  /**
   * Custom style overrides
   */
  style?: ViewStyle;

  /**
   * Whether to animate the skeleton
   * @default true
   */
  animated?: boolean;

  /**
   * Background color (base)
   * @default '#E1E9EE' (light) or '#2C2C2E' (dark)
   */
  backgroundColor?: string;

  /**
   * Highlight color for shimmer
   * @default '#F2F8FC' (light) or '#3C3C3E' (dark)
   */
  highlightColor?: string;
}

/**
 * Skeleton component for loading states
 * Displays an animated shimmer effect to indicate content is loading
 *
 * @example
 * ```tsx
 * // Text skeleton
 * <Skeleton width={200} height={16} />
 *
 * // Avatar skeleton
 * <Skeleton width={48} height={48} circle />
 *
 * // Card skeleton
 * <Skeleton width="100%" height={120} borderRadius={12} />
 * ```
 */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  circle = false,
  style,
  animated = true,
  backgroundColor = '#E1E9EE',
  highlightColor = '#F2F8FC',
}: SkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [animated, shimmerAnim]);

  const animatedBackground = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [backgroundColor, highlightColor],
  });

  const skeletonStyle: ViewStyle = {
    width: (circle ? height : width) as DimensionValue,
    height,
    borderRadius: circle ? height / 2 : borderRadius,
  };

  if (!animated) {
    return <View style={[styles.skeleton, skeletonStyle, { backgroundColor }, style]} />;
  }

  return (
    <Animated.View
      style={[styles.skeleton, skeletonStyle, { backgroundColor: animatedBackground }, style]}
    />
  );
}

// ============================================================================
// PRESET SKELETON COMPONENTS
// ============================================================================

export interface SkeletonTextProps {
  /** Number of lines */
  lines?: number;
  /** Width of the last line (percentage or pixels) */
  lastLineWidth?: number | string;
  /** Line height */
  lineHeight?: number;
  /** Space between lines */
  spacing?: number;
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Multi-line text skeleton
 */
export function SkeletonText({
  lines = 3,
  lastLineWidth = '60%',
  lineHeight = 14,
  spacing = 8,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonTextProps) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          width={index === lines - 1 ? lastLineWidth : '100%'}
          height={lineHeight}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={index < lines - 1 ? { marginBottom: spacing } : undefined}
        />
      ))}
    </View>
  );
}

export interface SkeletonTextLineProps {
  /** Text size this line stands in for — same values as Text's `size` prop */
  size?: keyof typeof typography.fontSize;
  /** Line-height variant — same values as Text's `lineHeight` prop */
  lineHeight?: keyof typeof typography.lineHeight;
  /** Bar width within the line box */
  width?: number | string;
  /** Custom style (applied to the line box) */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * A placeholder for exactly one `Text` line. The outer box takes the same
 * height the real Text would occupy (fontSize × line-height multiplier), with
 * a slightly thinner shimmer bar centered inside — the way glyphs sit within
 * their line box. Using this instead of a bare `Skeleton` bar keeps skeleton
 * layouts pixel-identical to the loaded content.
 *
 * Pair it 1:1 with the Text it replaces:
 * `<Text size="sm">` → `<SkeletonTextLine size="sm" width="45%" />`
 */
export function SkeletonTextLine({
  size = 'base',
  lineHeight = 'normal',
  width = '100%',
  style,
  backgroundColor,
  highlightColor,
}: SkeletonTextLineProps) {
  const fontSize = typography.fontSize[size];
  const boxHeight = Math.round(fontSize * typography.lineHeight[lineHeight]);
  const barHeight = Math.round(fontSize * 0.9);
  return (
    <View style={[{ height: boxHeight, justifyContent: 'center' }, style]}>
      <Skeleton
        width={width}
        height={barHeight}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
      />
    </View>
  );
}

export interface SkeletonAvatarProps {
  /** Size of the avatar */
  size?: number;
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Circular avatar skeleton
 */
export function SkeletonAvatar({
  size = 48,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonAvatarProps) {
  return (
    <Skeleton
      width={size}
      height={size}
      circle
      backgroundColor={backgroundColor}
      highlightColor={highlightColor}
      style={style}
    />
  );
}

export interface SkeletonCardProps {
  /** Whether to show avatar */
  showAvatar?: boolean;
  /** Number of text lines */
  lines?: number;
  /** Card height */
  height?: number;
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Card-style skeleton with optional avatar and text lines
 */
export function SkeletonCard({
  showAvatar = true,
  lines = 2,
  height,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonCardProps) {
  return (
    <View style={[styles.card, height ? { height } : undefined, style]}>
      {showAvatar && (
        <SkeletonAvatar
          size={40}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={styles.cardAvatar}
        />
      )}
      <View style={styles.cardContent}>
        <Skeleton
          width="40%"
          height={14}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={styles.cardTitle}
        />
        <SkeletonText
          lines={lines}
          lineHeight={12}
          spacing={6}
          lastLineWidth="80%"
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
      </View>
    </View>
  );
}

export interface SkeletonListProps {
  /** Number of items */
  count?: number;
  /** Item height */
  itemHeight?: number;
  /** Space between items */
  spacing?: number;
  /** Whether to show avatars */
  showAvatar?: boolean;
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * List skeleton with multiple items
 */
export function SkeletonList({
  count = 5,
  itemHeight = 72,
  spacing = 12,
  showAvatar = true,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonListProps) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.listItem,
            { height: itemHeight },
            index < count - 1 ? { marginBottom: spacing } : undefined,
          ]}
        >
          {showAvatar && (
            <SkeletonAvatar
              size={48}
              backgroundColor={backgroundColor}
              highlightColor={highlightColor}
              style={styles.listAvatar}
            />
          )}
          <View style={styles.listContent}>
            <Skeleton
              width="50%"
              height={16}
              backgroundColor={backgroundColor}
              highlightColor={highlightColor}
              style={styles.listTitle}
            />
            <Skeleton
              width="80%"
              height={12}
              backgroundColor={backgroundColor}
              highlightColor={highlightColor}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface SkeletonMatchCardProps {
  /** Custom style applied to the outer card wrapper */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Match card skeleton matching the MatchCard layout:
 * time row, location row, player avatars, badge pills, CTA button.
 */
export function SkeletonMatchCard({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonMatchCardProps) {
  return (
    <View style={[styles.matchCard, style]}>
      {/* Time row */}
      <View style={styles.matchCardRow}>
        <Skeleton
          width={16}
          height={16}
          circle
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width={120}
          height={16}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
      </View>
      {/* Location row */}
      <View style={styles.matchCardRow}>
        <Skeleton
          width={14}
          height={14}
          circle
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width="55%"
          height={14}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
      </View>
      {/* Player avatars */}
      <View style={styles.matchCardRow}>
        {[0, 1, 2].map(j => (
          <Skeleton
            key={j}
            width={32}
            height={32}
            circle
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
            style={j > 0 ? { marginLeft: -6 } : undefined}
          />
        ))}
        <Skeleton
          width={40}
          height={12}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
      </View>
      {/* Badge pills */}
      <View style={styles.matchCardRow}>
        <Skeleton
          width={70}
          height={20}
          borderRadius={10}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width={55}
          height={20}
          borderRadius={10}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
      </View>
      {/* CTA button */}
      <Skeleton
        width="100%"
        height={40}
        borderRadius={10}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
      />
    </View>
  );
}

export interface SkeletonMyMatchCardProps {
  /** Custom style applied to the outer card wrapper */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Compact match card skeleton matching the MyMatchCard layout (240px wide):
 * day label, time, location row, player avatars.
 */
export function SkeletonMyMatchCard({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonMyMatchCardProps) {
  return (
    <View style={[styles.myMatchCard, style]}>
      {/* Day label */}
      <Skeleton
        width={60}
        height={14}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
      />
      {/* Time */}
      <Skeleton
        width={80}
        height={20}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
        style={{ marginTop: 6 }}
      />
      {/* Location row */}
      <View style={[styles.matchCardRow, { marginTop: 8 }]}>
        <Skeleton
          width={12}
          height={12}
          circle
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width={70}
          height={12}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 4 }}
        />
      </View>
      {/* Avatars */}
      <View style={[styles.matchCardRow, { marginTop: 8 }]}>
        {[0, 1, 2].map(j => (
          <Skeleton
            key={j}
            width={24}
            height={24}
            circle
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
            style={j > 0 ? { marginLeft: -4 } : undefined}
          />
        ))}
      </View>
    </View>
  );
}

export interface SkeletonPlayerCardProps {
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Player card skeleton for directory
 */
export function SkeletonPlayerCard({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonPlayerCardProps) {
  return (
    <View style={[styles.playerCard, style]}>
      <SkeletonAvatar size={56} backgroundColor={backgroundColor} highlightColor={highlightColor} />
      <View style={styles.playerCardContent}>
        <Skeleton
          width="60%"
          height={16}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={styles.playerCardName}
        />
        <View style={styles.playerCardInfo}>
          <Skeleton
            width={50}
            height={12}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
          />
          <Skeleton
            width={60}
            height={12}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
            style={{ marginLeft: 12 }}
          />
        </View>
      </View>
    </View>
  );
}

export interface SkeletonConversationProps {
  /** Row position, used to vary bar widths so the list looks organic */
  index?: number;
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

// Deterministic width variation so rows read as real conversations, not a grid.
const CONVERSATION_NAME_WIDTHS = ['46%', '58%', '38%', '52%', '64%', '42%'];
const CONVERSATION_PREVIEW_WIDTHS = ['72%', '54%', '84%', '62%', '44%', '76%'];
const CONVERSATION_TIME_WIDTHS = [36, 48, 40, 32, 44, 38];

/**
 * Conversation list item skeleton for chat.
 * Mirrors ConversationItem 1:1 (50px avatar, name/time top row, preview line)
 * so the list doesn't shift when real conversations load in.
 */
export function SkeletonConversation({
  index = 0,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonConversationProps) {
  const nameWidth = CONVERSATION_NAME_WIDTHS[index % CONVERSATION_NAME_WIDTHS.length];
  const previewWidth = CONVERSATION_PREVIEW_WIDTHS[index % CONVERSATION_PREVIEW_WIDTHS.length];
  const timeWidth = CONVERSATION_TIME_WIDTHS[index % CONVERSATION_TIME_WIDTHS.length];
  return (
    <View style={[styles.conversation, style]}>
      <SkeletonAvatar size={50} backgroundColor={backgroundColor} highlightColor={highlightColor} />
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <View style={styles.conversationName}>
            <SkeletonTextLine
              size="base"
              width={nameWidth}
              backgroundColor={backgroundColor}
              highlightColor={highlightColor}
            />
          </View>
          <SkeletonTextLine
            size="sm"
            width={timeWidth}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
          />
        </View>
        <View style={styles.conversationPreviewRow}>
          <SkeletonTextLine
            size="sm"
            width={previewWidth}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
          />
        </View>
      </View>
    </View>
  );
}

export interface SkeletonMessageBubbleProps {
  /** Right-aligned own message (no avatar, mirrored layout) */
  isOwn?: boolean;
  /** Incoming only: render the 32px avatar (first bubble of a group); false keeps the aligned spacer */
  showAvatar?: boolean;
  /** Bubble width (number or percentage of the row) */
  width?: number | string;
  /** How many text lines the bubble stands in for (drives bubble height) */
  lines?: number;
  /** Custom style applied to the row */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * One chat message bubble skeleton. Mirrors MessageBubble's row metrics:
 * 32px avatar (or matching spacer for grouped bubbles), 16px bubble radius,
 * height derived from the real line height + padding + timestamp row.
 */
export function SkeletonMessageBubble({
  isOwn = false,
  showAvatar = false,
  width = '55%',
  lines = 1,
  style,
  backgroundColor,
  highlightColor,
}: SkeletonMessageBubbleProps) {
  // 22px per text line + vertical padding + timestamp row, as in MessageBubble.
  const bubbleHeight = lines * 22 + 36;
  return (
    <View style={[styles.messageRow, isOwn && styles.messageRowOwn, style]}>
      {!isOwn &&
        (showAvatar ? (
          <SkeletonAvatar
            size={32}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
            style={styles.messageAvatar}
          />
        ) : (
          <View style={styles.messageAvatarSpacer} />
        ))}
      <Skeleton
        width={width}
        height={bubbleHeight}
        borderRadius={16}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
      />
    </View>
  );
}

export interface SkeletonChatMessagesProps {
  /** Custom style applied to the container */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

// A realistic exchange: grouped incoming bubbles (avatar on the first of each
// group) alternating with own replies, varied widths and line counts.
const CHAT_MESSAGE_PATTERN = [
  { isOwn: false, showAvatar: true, width: '58%', lines: 2, groupStart: true },
  { isOwn: true, showAvatar: false, width: '46%', lines: 1, groupStart: true },
  { isOwn: false, showAvatar: true, width: '64%', lines: 2, groupStart: true },
  { isOwn: true, showAvatar: false, width: '38%', lines: 1, groupStart: true },
];

/**
 * Full conversation-thread skeleton. Bottom-anchored like a real chat (newest
 * at the bottom), with older bubbles fading out toward the top.
 */
export function SkeletonChatMessages({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonChatMessagesProps) {
  const count = CHAT_MESSAGE_PATTERN.length;
  return (
    <View style={[styles.chatMessages, style]}>
      {CHAT_MESSAGE_PATTERN.map((message, index) => (
        <SkeletonMessageBubble
          key={index}
          isOwn={message.isOwn}
          showAvatar={message.showAvatar}
          width={message.width}
          lines={message.lines}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{
            opacity: 0.35 + (0.65 * (index + 1)) / count,
            marginTop: message.groupStart ? spacing[3] : 0,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    padding: 12,
  },
  cardAvatar: {
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  listAvatar: {
    marginRight: 12,
  },
  listContent: {
    flex: 1,
  },
  listTitle: {
    marginBottom: 8,
  },
  matchCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
  },
  matchCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  myMatchCard: {
    // Matches MyMatchCard's CARD_WIDTH so the carousel doesn't shift on load.
    width: 240,
    padding: 16,
    borderRadius: 12,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  playerCardContent: {
    flex: 1,
    marginLeft: 12,
  },
  playerCardName: {
    marginBottom: 6,
  },
  playerCardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversation: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  conversationContent: {
    flex: 1,
    marginLeft: spacing[3],
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  conversationName: {
    flex: 1,
    marginRight: spacing[2],
  },
  conversationPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  messageRowOwn: {
    flexDirection: 'row-reverse',
  },
  messageAvatar: {
    marginRight: spacing[2],
    marginTop: spacing[1],
  },
  messageAvatarSpacer: {
    width: 32 + spacing[2],
  },
  chatMessages: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing[2],
  },
});

export default Skeleton;

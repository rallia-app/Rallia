/**
 * Skeleton Component
 * Animated placeholder for loading states - provides better UX than spinners
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle, Easing, DimensionValue } from 'react-native';

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
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Match card skeleton for home screen
 */
export function SkeletonMatchCard({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonMatchCardProps) {
  return (
    <View style={[styles.matchCard, style]}>
      {/* Header with sport icon and type */}
      <View style={styles.matchCardHeader}>
        <Skeleton
          width={24}
          height={24}
          circle
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width={80}
          height={14}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={styles.matchCardType}
        />
      </View>

      {/* Date and time */}
      <Skeleton
        width={120}
        height={18}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
        style={styles.matchCardDate}
      />

      {/* Location */}
      <View style={styles.matchCardLocation}>
        <Skeleton
          width={16}
          height={16}
          circle
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <Skeleton
          width="60%"
          height={14}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
      </View>

      {/* Players */}
      <View style={styles.matchCardPlayers}>
        <SkeletonAvatar
          size={32}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
        />
        <SkeletonAvatar
          size={32}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: -8 }}
        />
        <Skeleton
          width={60}
          height={12}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginLeft: 8 }}
        />
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
  /** Custom style */
  style?: ViewStyle;
  /** Theme colors */
  backgroundColor?: string;
  highlightColor?: string;
}

/**
 * Conversation list item skeleton for chat
 */
export function SkeletonConversation({
  style,
  backgroundColor,
  highlightColor,
}: SkeletonConversationProps) {
  return (
    <View style={[styles.conversation, style]}>
      <SkeletonAvatar size={50} backgroundColor={backgroundColor} highlightColor={highlightColor} />
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Skeleton
            width="40%"
            height={16}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
          />
          <Skeleton
            width={40}
            height={12}
            backgroundColor={backgroundColor}
            highlightColor={highlightColor}
          />
        </View>
        <Skeleton
          width="70%"
          height={14}
          backgroundColor={backgroundColor}
          highlightColor={highlightColor}
          style={{ marginTop: 6 }}
        />
      </View>
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
    padding: 16,
    borderRadius: 12,
    minHeight: 150,
  },
  matchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  matchCardType: {
    marginLeft: 8,
  },
  matchCardDate: {
    marginBottom: 8,
  },
  matchCardLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  matchCardPlayers: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
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
    padding: 12,
  },
  conversationContent: {
    flex: 1,
    marginLeft: 12,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

export default Skeleton;

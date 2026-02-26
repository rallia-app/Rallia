/**
 * MyMatchCard Component - Compact Card for "My Matches" Section
 *
 * A minimal, reminder-focused card showing only essential info:
 * - Three-tier visual hierarchy based on match desirability:
 *   - Most Wanted: Court booked + high reputation creator (90%+) → gold/amber
 *   - Ready to Play: Court booked only → secondary/coral tones
 *   - Regular: Default → primary/teal tones
 * - Date/time prominently displayed with urgent animation
 * - Location (brief)
 * - Participant avatars
 */

import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './foundation/Text.native';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  accent,
  neutral,
  base,
  duration,
} from '@rallia/design-system';
import type { MatchWithDetails } from '@rallia/shared-types';
import {
  formatTimeInTimezone,
  getTimeDifferenceFromNow,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
  deriveMatchStatus,
} from '@rallia/shared-utils';
import { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// TIER-BASED GRADIENT PALETTES (using design system tokens)
// =============================================================================

/**
 * Match tier determines visual styling based on desirability:
 * - mostWanted: Court booked + high reputation creator (90%+) → accent/gold
 * - readyToPlay: Court booked only → secondary/coral
 * - regular: Default → primary/teal
 * - expired: Match started but not full (disabled appearance) → neutral/gray
 */
type MatchTier = 'mostWanted' | 'readyToPlay' | 'regular' | 'expired';

/**
 * Threshold for "high reputation" creator (percentage 0-100)
 */
const HIGH_REPUTATION_THRESHOLD = 90;

/**
 * Determine match tier based on court status and creator reputation
 */
function getMatchTier(courtStatus: string | null, creatorReputationScore?: number): MatchTier {
  const isCourtBooked = courtStatus === 'reserved';
  const isHighReputation = (creatorReputationScore ?? 0) >= HIGH_REPUTATION_THRESHOLD;

  if (isCourtBooked && isHighReputation) return 'mostWanted';
  if (isCourtBooked) return 'readyToPlay';
  return 'regular';
}

/**
 * Tier-based color palettes for accent strips and backgrounds
 * Built from @rallia/design-system tokens for consistency
 *
 * Tier Strategy:
 * - mostWanted: accent (amber/gold) - premium, highly desirable
 * - readyToPlay: secondary (coral/red) - court ready, energetic
 * - regular: primary (teal) - standard matches
 */
const TIER_PALETTES = {
  mostWanted: {
    light: { background: primary[50] },
    dark: { background: primary[950] },
  },
  readyToPlay: {
    light: { background: primary[50] },
    dark: { background: primary[950] },
  },
  regular: {
    light: { background: primary[50] },
    dark: { background: primary[950] },
  },
  expired: {
    light: { background: neutral[100] },
    dark: { background: neutral[900] },
  },
} as const;

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_WIDTH = 160;
const AVATAR_SIZE = 24;
const MAX_VISIBLE_AVATARS = 4;

// =============================================================================
// TYPES
// =============================================================================

interface TranslationOptions {
  [key: string]: string | number | boolean;
}

export interface MyMatchCardProps {
  /** Match data with all related details */
  match: MatchWithDetails;
  /** Callback when the card is pressed */
  onPress?: () => void;
  /** Whether dark mode is enabled */
  isDark: boolean;
  /** Translation function */
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  /** Current locale for date/time formatting */
  locale: string;
  /**
   * Number of pending join requests (only shown to match creator)
   * Shows a notification badge in the top-right corner
   */
  pendingRequestCount?: number;
  /**
   * Whether the current user has been invited to this match
   * Shows an "Invited" indicator in the day label row
   */
  isInvited?: boolean;
}

interface ThemeColors {
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  secondary: string;
  avatarPlaceholder: string;
  // Tier-aware accent colors (set based on match tier)
  tierAccent: string;
  tierAccentLight: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get compact time display for the card
 *
 * Shows intuitive date labels:
 * - "Today" for today's date
 * - "Tomorrow" for tomorrow's date
 * - Weekday name for dates within the next 6 days (e.g., "Wednesday")
 * - "Month Day" for dates further out (e.g., "Jan 15")
 */
function getCompactTimeDisplay(
  dateString: string,
  startTime: string,
  timezone: string,
  locale: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): { dayLabel: string; timeLabel: string; isUrgent: boolean } {
  const tz = timezone || 'UTC';

  // Calculate time difference to determine if urgent (within 3 hours)
  const msDiff = getTimeDifferenceFromNow(dateString, startTime, tz);
  const hoursDiff = Math.floor(msDiff / (1000 * 60 * 60));
  const isUrgent = hoursDiff >= 0 && hoursDiff < 3;

  // Get intuitive date label (Today, Tomorrow, Wednesday, or Jan 15)
  const dateResult = formatIntuitiveDateInTimezone(dateString, tz, locale);

  // Use translation for Today/Tomorrow, otherwise use the formatted date
  let dayLabel: string;
  if (dateResult.translationKey) {
    dayLabel = t(dateResult.translationKey);
  } else {
    dayLabel = dateResult.label;
  }

  // Format time in the match's timezone (without city name)
  const timeResult = formatTimeInTimezone(dateString, startTime, tz, locale);
  const timeLabel = timeResult.formattedTime; // e.g., "2:00 PM"

  return { dayLabel, timeLabel, isUrgent };
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

// =============================================================================
// PENDING REQUESTS BADGE (Creator view - top-right notification badge)
// =============================================================================

interface PendingRequestsBadgeProps {
  count: number;
  isDark: boolean;
}

/**
 * Notification badge for pending join requests
 * Shows in top-right corner with shimmer animation (matching invited badge)
 * Uses secondary (coral) color for visual distinction from invited badge
 */
const PendingRequestsBadge: React.FC<PendingRequestsBadgeProps> = ({ count, isDark }) => {
  // Use useMemo to avoid accessing refs during render
  const shimmerAnim = useMemo(() => new Animated.Value(0), []);

  // Memoize interpolated values
  const shimmerOpacity = useMemo(
    () =>
      shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.8, 1, 0.8],
      }),
    [shimmerAnim]
  );

  const shimmerScale = useMemo(
    () =>
      shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.1, 1],
      }),
    [shimmerAnim]
  );

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );
    shimmer.start();
    return () => shimmer.stop();
  }, [shimmerAnim]);

  // Use secondary (coral) color for distinction from gold invited badge
  const badgeColor = isDark ? secondary[400] : secondary[500];
  const textColor = base.white;

  return (
    <Animated.View
      style={[
        styles.pendingBadge,
        {
          backgroundColor: badgeColor,
          shadowColor: badgeColor,
          transform: [{ scale: shimmerScale }],
          opacity: shimmerOpacity,
        },
      ]}
    >
      <Text size="xs" weight="bold" color={textColor} style={styles.pendingBadgeText}>
        {count > 9 ? '9+' : count}
      </Text>
    </Animated.View>
  );
};

// =============================================================================
// INVITED INDICATOR (Player view - shows when invited to a match)
// =============================================================================

interface InvitedIndicatorProps {
  isDark: boolean;
}

/**
 * "Invited" badge indicator with subtle shimmer animation
 * Compact icon-only design for bottom-right position
 * Uses accent (gold) color to signal something special awaits action
 */
const InvitedIndicator: React.FC<InvitedIndicatorProps> = ({ isDark }) => {
  // Use useMemo to avoid accessing refs during render
  const shimmerAnim = useMemo(() => new Animated.Value(0), []);

  // Memoize interpolated values
  const shimmerOpacity = useMemo(
    () =>
      shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.8, 1, 0.8],
      }),
    [shimmerAnim]
  );

  const shimmerScale = useMemo(
    () =>
      shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.1, 1],
      }),
    [shimmerAnim]
  );

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );
    shimmer.start();
    return () => shimmer.stop();
  }, [shimmerAnim]);

  const badgeBg = isDark ? accent[600] : accent[500];
  const iconColor = base.white;

  return (
    <Animated.View
      style={[
        styles.invitedBadge,
        {
          backgroundColor: badgeBg,
          transform: [{ scale: shimmerScale }],
          opacity: shimmerOpacity,
          shadowColor: badgeBg,
        },
      ]}
    >
      <Ionicons name="mail" size={12} color={iconColor} />
    </Animated.View>
  );
};

interface ParticipantAvatarsProps {
  match: MatchWithDetails;
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

const ParticipantAvatars: React.FC<ParticipantAvatarsProps> = ({ match, colors, isDark, t }) => {
  const participants = match.participants?.filter(p => p.status === 'joined') ?? [];

  // Identify host and other participants using is_host flag
  const hostParticipant = participants.find(p => p.is_host);
  const otherParticipants = participants.filter(p => !p.is_host);

  // Calculate total spots and spots left (creator is now in participants)
  const total = match.format === 'doubles' ? 4 : 2;
  const current = participants.length;
  const spotsLeft = Math.max(0, total - current);

  // If no other participants, show spots available indicator
  if (otherParticipants.length === 0) {
    return (
      <View style={styles.spotsIndicator}>
        <Ionicons name="people-outline" size={12} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.spotsText}>
          {spotsLeft === 0
            ? t('match.slots.full')
            : spotsLeft === 1
              ? t('match.slots.oneLeft')
              : t('match.slots.left', { count: spotsLeft })}
        </Text>
      </View>
    );
  }

  // Build avatars list (host first, then other participants)
  // Normalize URLs to use current environment's Supabase URL
  const avatars: Array<{ url?: string }> = [];

  // Add host (using is_host flag to identify)
  if (hostParticipant) {
    avatars.push({
      url: getProfilePictureUrl(hostParticipant.player?.profile?.profile_picture_url) ?? undefined,
    });
  } else {
    // Fallback to created_by_player for backwards compatibility
    avatars.push({
      url: getProfilePictureUrl(match.created_by_player?.profile?.profile_picture_url) ?? undefined,
    });
  }

  // Add other participants
  for (const participant of otherParticipants) {
    avatars.push({
      url: getProfilePictureUrl(participant.player?.profile?.profile_picture_url) ?? undefined,
    });
  }

  const visibleAvatars = avatars.slice(0, MAX_VISIBLE_AVATARS);
  const extraCount = avatars.length - MAX_VISIBLE_AVATARS;

  return (
    <View style={styles.avatarsRow}>
      {visibleAvatars.map((avatar, index) => {
        const isHost = index === 0;
        return (
          <View key={index} style={styles.avatarWrapper}>
            <View
              style={[
                styles.avatar,
                index > 0 && { marginLeft: -8 },
                {
                  backgroundColor: avatar.url ? colors.tierAccent : colors.avatarPlaceholder,
                  borderWidth: 2.5,
                  borderColor: colors.tierAccent,
                  shadowColor: colors.tierAccent,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: 3,
                },
              ]}
            >
              {avatar.url ? (
                <Image source={{ uri: avatar.url }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="person" size={12} color={isDark ? neutral[400] : neutral[500]} />
              )}
            </View>
            {isHost && (
              <View style={[styles.hostBadge, { backgroundColor: colors.tierAccent }]}>
                <Ionicons name="star" size={5} color={base.white} />
              </View>
            )}
          </View>
        );
      })}
      {extraCount > 0 && (
        <View
          style={[
            styles.avatar,
            styles.extraCount,
            {
              marginLeft: -8,
              backgroundColor: colors.tierAccent,
              borderColor: colors.tierAccentLight,
              shadowColor: colors.tierAccent,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 3,
              elevation: 2,
            },
          ]}
        >
          <Text size="xs" weight="bold" color={base.white}>
            +{extraCount}
          </Text>
        </View>
      )}
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MyMatchCard: React.FC<MyMatchCardProps> = ({
  match,
  onPress,
  isDark,
  t,
  locale,
  pendingRequestCount = 0,
  isInvited = false,
}) => {
  // Calculate participant info early to check for expired state
  const participants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const total = match.format === 'doubles' ? 4 : 2;
  const isFull = participants.length >= total;

  // Derive match status early to check for expired state
  const derivedStatus = deriveMatchStatus({
    cancelled_at: match.cancelled_at,
    match_date: match.match_date,
    start_time: match.start_time,
    end_time: match.end_time,
    timezone: match.timezone,
    result: match.result,
  });
  const isInProgress = derivedStatus === 'in_progress';
  const hasMatchEnded = derivedStatus === 'completed';

  // Check if match is expired (started or ended but not full)
  const isExpired = (isInProgress || hasMatchEnded) && !isFull;

  // Determine match tier based on court status and creator reputation
  // Override with 'expired' tier if match is expired
  const creatorReputationScore = match.created_by_player?.reputation_score;
  const baseTier = getMatchTier(match.court_status, creatorReputationScore);
  const tier: MatchTier = isExpired ? 'expired' : baseTier;
  const isMostWanted = tier === 'mostWanted';

  // Animated pulse effect for urgent matches - use useMemo to avoid accessing refs during render
  const urgentPulseAnimation = useMemo(() => new Animated.Value(0), []);

  // Get tier palette colors
  const tierPaletteColors = TIER_PALETTES[tier][isDark ? 'dark' : 'light'];

  // All tiers use primary accent colors (except expired which uses neutral)
  const tierAccentColors = useMemo(() => {
    if (tier === 'expired') {
      return {
        accent: isDark ? neutral[500] : neutral[400],
        accentLight: isDark ? neutral[700] : neutral[300],
      };
    }
    return {
      accent: isDark ? primary[400] : primary[500],
      accentLight: isDark ? primary[700] : primary[200],
    };
  }, [isDark, tier]);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = useMemo(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[400] : primary[600],
      secondary: isDark ? secondary[400] : secondary[500],
      avatarPlaceholder: isDark ? neutral[700] : neutral[200],
      // Tier-aware accent colors for consistent theming
      tierAccent: tierAccentColors.accent,
      tierAccentLight: tierAccentColors.accentLight,
    }),
    [themeColors, isDark, tierAccentColors]
  );

  const { dayLabel, timeLabel, isUrgent } = getCompactTimeDisplay(
    match.match_date,
    match.start_time,
    match.timezone,
    locale,
    t
  );

  // Get location - check facility first, then custom location, fallback to TBD
  const locationName = match.facility?.name ?? match.location_name ?? t('matchDetail.locationTBD');

  // Determine animation type (derivedStatus already computed above for expired check):
  // - "in_progress" = ongoing match = live indicator animation
  // - "isUrgent" (< 3 hours) but not in_progress = starting soon = countdown animation
  const isOngoing = isInProgress;
  const isStartingSoon = isUrgent && !isOngoing;
  const liveColor = isDark ? secondary[400] : secondary[500];
  const soonColor = isDark ? accent[400] : accent[500];

  // Start animation when match is ongoing or starting soon
  useEffect(() => {
    if (isOngoing || isStartingSoon) {
      const animationDuration = isOngoing ? duration.extraSlow : duration.verySlow;
      const pulseAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(urgentPulseAnimation, {
            toValue: 1,
            duration: animationDuration,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: true,
          }),
          Animated.timing(urgentPulseAnimation, {
            toValue: 0,
            duration: animationDuration,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: true,
          }),
        ])
      );

      pulseAnim.start();
      return () => {
        pulseAnim.stop();
      };
    }
  }, [isOngoing, isStartingSoon, urgentPulseAnimation]);

  // "Live indicator" interpolations for ongoing matches - memoize to avoid accessing refs during render
  const liveRingScale = useMemo(
    () =>
      urgentPulseAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2],
      }),
    [urgentPulseAnimation]
  );

  const liveRingOpacity = useMemo(
    () =>
      urgentPulseAnimation.interpolate({
        inputRange: [0, 0.3, 1],
        outputRange: [0.7, 0.3, 0],
      }),
    [urgentPulseAnimation]
  );

  const liveDotOpacity = useMemo(
    () =>
      urgentPulseAnimation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 0.7, 1],
      }),
    [urgentPulseAnimation]
  );

  // "Starting soon" interpolations - subtle bouncing chevron
  const countdownBounce = useMemo(
    () =>
      urgentPulseAnimation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0, 2, 0],
      }),
    [urgentPulseAnimation]
  );

  const countdownOpacity = useMemo(
    () =>
      urgentPulseAnimation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.6, 1, 0.6],
      }),
    [urgentPulseAnimation]
  );

  // Border color always uses primary
  const dynamicBorderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;

  // Determine if we should show pending requests badge (only for creators with pending requests)
  const showPendingBadge = pendingRequestCount > 0;

  // Build accessibility label with status indicators
  let accessibilityLabel = `Match ${dayLabel} at ${timeLabel}`;
  if (isMostWanted) accessibilityLabel += ' - Most Wanted';
  if (isInvited) accessibilityLabel += ' - You are invited';
  if (showPendingBadge)
    accessibilityLabel += ` - ${pendingRequestCount} pending join request${pendingRequestCount > 1 ? 's' : ''}`;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: tierPaletteColors.background,
          borderColor: dynamicBorderColor,
          // Softer shadow for light mode, subtle for dark mode
          shadowColor: isDark ? '#000' : neutral[400],
          shadowOffset: { width: 0, height: isDark ? 2 : 3 },
          shadowOpacity: isDark ? 0.2 : 0.15,
          shadowRadius: isDark ? 8 : 10,
          elevation: isDark ? 3 : 2,
          opacity: isExpired ? 0.7 : 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Pending join requests badge (top-right corner) */}
      {showPendingBadge && <PendingRequestsBadge count={pendingRequestCount} isDark={isDark} />}

      <View style={styles.content}>
        {/* Day label with indicator */}
        <View style={styles.dayLabelRow}>
          {/* Expired indicator icon */}
          {isExpired && (
            <Ionicons
              name="close-circle-outline"
              size={12}
              color={colors.textMuted}
              style={styles.expiredIcon}
            />
          )}
          {/* "Live" indicator for ongoing matches (not shown when expired) */}
          {isOngoing && !isExpired && (
            <View style={styles.liveIndicatorContainer}>
              <Animated.View
                style={[
                  styles.liveRing,
                  {
                    backgroundColor: liveColor,
                    transform: [{ scale: liveRingScale }],
                    opacity: liveRingOpacity,
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.liveDot,
                  {
                    backgroundColor: liveColor,
                    opacity: liveDotOpacity,
                  },
                ]}
              />
            </View>
          )}
          {/* Bouncing chevron for starting soon (not shown when expired) */}
          {isStartingSoon && !isExpired && (
            <Animated.View
              style={[
                styles.countdownIndicator,
                {
                  transform: [{ translateX: countdownBounce }],
                  opacity: countdownOpacity,
                },
              ]}
            >
              <Ionicons name="chevron-forward" size={10} color={soonColor} />
            </Animated.View>
          )}
          {/* Day label - always show */}
          <Text
            size="xs"
            weight="semibold"
            color={
              isExpired
                ? colors.textMuted
                : isOngoing
                  ? liveColor
                  : isStartingSoon
                    ? soonColor
                    : colors.textMuted
            }
            style={styles.dayLabel}
          >
            {dayLabel.toUpperCase()}
          </Text>
        </View>

        {/* Time - prominent */}
        <Text
          size="lg"
          weight="bold"
          color={
            isExpired
              ? colors.textMuted
              : isOngoing
                ? liveColor
                : isStartingSoon
                  ? soonColor
                  : colors.text
          }
          numberOfLines={1}
        >
          {timeLabel}
        </Text>

        {/* Location */}
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.locationText}>
            {locationName}
          </Text>
        </View>

        {/* Bottom row: Participants + Invited indicator */}
        <View style={styles.bottomRow}>
          <ParticipantAvatars match={match} colors={colors} isDark={isDark} t={t} />
          {isInvited && <InvitedIndicator isDark={isDark} />}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
    // Note: overflow NOT hidden to allow corner badges to extend outside
    // Shadow is applied dynamically based on theme in the component
  },

  // Pending requests badge (top-right corner, extends outside card)
  pendingBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    zIndex: 10,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  pendingBadgeText: {
    fontSize: 10,
    lineHeight: 12,
  },

  // Bottom row: avatars + invited indicator
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Invited indicator badge (compact circular badge for bottom-right)
  invitedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  content: {
    padding: spacingPixels[3],
    zIndex: 1,
  },

  dayLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  dayLabel: {
    letterSpacing: 0.5,
    marginBottom: spacingPixels[0.5],
  },

  // "Live" indicator styles for ongoing matches
  liveIndicatorContainer: {
    width: 8,
    height: 8,
    marginRight: spacingPixels[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    // Subtle shadow for depth
    shadowColor: secondary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 2,
  },
  // "Starting soon" countdown indicator
  countdownIndicator: {
    marginRight: spacingPixels[0.5],
  },
  // Expired icon indicator
  expiredIcon: {
    marginRight: spacingPixels[1],
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },

  locationText: {
    marginLeft: spacingPixels[1],
    flex: 1,
  },

  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  avatarWrapper: {
    position: 'relative',
  },

  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  hostBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: base.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },

  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR_SIZE / 2,
  },

  extraCount: {
    borderWidth: 2, // Allow border to be set inline
  },

  spotsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  spotsText: {
    marginLeft: spacingPixels[1],
  },
});

export { MyMatchCard };
export default MyMatchCard;

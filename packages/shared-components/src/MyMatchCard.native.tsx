/**
 * MyMatchCard Component - Compact Card for "My Matches" Section
 *
 * A minimal, reminder-focused card showing only essential info:
 * - Three-tier visual hierarchy based on match desirability:
 *   - Must-Play: Court booked + high reputation creator (90%+) → gold/amber
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
  status,
} from '@rallia/design-system';
import type { MatchWithDetails } from '@rallia/shared-types';
import {
  formatTimeInTimezone,
  getTimeDifferenceFromNow,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
  deriveMatchStatus,
  type MatchTier,
  getMatchTier,
} from '@rallia/shared-utils';
import { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// TIER-BASED GRADIENT PALETTES (using design system tokens)
// =============================================================================

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
  topPlayer: {
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

const CARD_WIDTH = 200;
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
   * The current player's own participation status in this match. Drives the
   * status pill that differentiates confirmed games (joined) from not-yet
   * confirmed ones (pending / requested / waitlisted). Other values render no
   * pill. Pass the raw match_participant_status_enum value.
   */
  participantStatus?: string | null;
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
 * Inline indicator at the top-right of the card (creator view) showing how
 * many players have requested to join. Coral, to distinguish it from the
 * player's own status pill on the left.
 */
const PendingRequestsBadge: React.FC<PendingRequestsBadgeProps> = ({ count, isDark }) => {
  const color = isDark ? secondary[400] : secondary[500];

  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1F` }]}>
      <Ionicons name="person-add-outline" size={11} color={color} />
      <Text size="xs" weight="semibold" color={color}>
        {count > 9 ? '9+' : count}
      </Text>
    </View>
  );
};

// =============================================================================
// PARTICIPANT STATUS PILL (Player view - their own status in the match)
// =============================================================================

// The current player's own participation states we surface as a status pill.
// "Invited" carries no icon — the word already implies the envelope, whereas
// the other icons (checkmark / clock / list) add meaning the label doesn't.
type ParticipantStatusKind = 'joined' | 'pending' | 'requested' | 'waitlisted';

// Display kinds for the pill. A joined game splits on fullness: a full roster
// reads "Confirmed", a not-yet-full one reads "Needs players".
type PillKind = ParticipantStatusKind | 'needs_players';

const STATUS_PILL_CONFIG: Record<
  PillKind,
  { labelKey: TranslationKey; icon?: keyof typeof Ionicons.glyphMap }
> = {
  joined: { labelKey: 'home.myMatchesStatus.confirmed', icon: 'checkmark-circle-outline' },
  needs_players: { labelKey: 'home.myMatchesStatus.needsPlayers', icon: 'people-outline' },
  pending: { labelKey: 'home.myMatchesStatus.invited' },
  requested: { labelKey: 'home.myMatchesStatus.requested', icon: 'time-outline' },
  waitlisted: { labelKey: 'home.myMatchesStatus.waitlisted', icon: 'list-outline' },
};

/** Narrows the raw participant status to the kinds we render a pill for. */
function toPillKind(s: string | null | undefined): ParticipantStatusKind | null {
  return s === 'joined' || s === 'pending' || s === 'requested' || s === 'waitlisted' ? s : null;
}

interface ParticipantStatusPillProps {
  kind: PillKind;
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

/**
 * Pill showing the current player's own status in the match — the signal that
 * differentiates confirmed games (joined) from not-yet-confirmed ones
 * (pending / requested / waitlisted) in the My Games carousel.
 */
const ParticipantStatusPill: React.FC<ParticipantStatusPillProps> = ({ kind, isDark, t }) => {
  const { labelKey, icon } = STATUS_PILL_CONFIG[kind];

  // Colors mirror the viewer-status banners in MatchDetailSheet so the two
  // surfaces stay consistent: invited = primary teal, requested = warning,
  // waitlisted = info. Confirmed has no banner there, so it uses the app's
  // positive green (status.success). A not-full joined game ("needs players")
  // uses warning amber to flag the game still needs people.
  let color: string;
  if (kind === 'joined') {
    color = status.success.DEFAULT;
  } else if (kind === 'pending') {
    color = isDark ? primary[400] : primary[500];
  } else if (kind === 'requested' || kind === 'needs_players') {
    color = status.warning.DEFAULT;
  } else {
    color = status.info.DEFAULT;
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1F` }]}>
      {icon && <Ionicons name={icon} size={11} color={color} />}
      <Text size="xs" weight="semibold" color={color}>
        {t(labelKey)}
      </Text>
    </View>
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
                  borderWidth: 2,
                  borderColor: primary[500],
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
                <Ionicons name="star" size={7} color={base.white} />
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
              borderWidth: 2,
              borderColor: primary[500],
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
  participantStatus = null,
}) => {
  // Calculate participant info early to check for expired state
  const participants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const total = match.format === 'doubles' ? 4 : 2;
  const isFull = participants.length >= total;

  // A full joined game reads "Confirmed"; a joined game still missing players
  // reads "Needs players". Other statuses are unaffected by fullness.
  const rawStatus = toPillKind(participantStatus);
  const pillKind: PillKind | null = rawStatus === 'joined' && !isFull ? 'needs_players' : rawStatus;

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

  // Determine match tier based on court status and participant composition
  const participantsForTier = participants.map(p => ({
    repScore: p.player?.player_reputation?.reputation_score,
    certStatus: (p.player as unknown as Record<string, unknown>)?.sportCertificationStatus as
      | string
      | undefined,
    totalEvents: p.player?.player_reputation?.total_events,
  }));
  const baseTier = getMatchTier(match.court_status, participantsForTier, match.format);
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
  if (isMostWanted) accessibilityLabel += ' - Must-Play';
  if (pillKind === 'joined') accessibilityLabel += ' - Confirmed';
  else if (pillKind === 'needs_players') accessibilityLabel += ' - Needs players';
  else if (pillKind === 'pending') accessibilityLabel += ' - You are invited';
  else if (pillKind === 'requested') accessibilityLabel += ' - Join request pending';
  else if (pillKind === 'waitlisted') accessibilityLabel += ' - Waitlisted';
  if (showPendingBadge)
    accessibilityLabel += ` - ${pendingRequestCount} pending join request${pendingRequestCount > 1 ? 's' : ''}`;

  // Day and time render identically — the day's size, the time's (prominent) color.
  const headerColor = isExpired
    ? colors.textMuted
    : isOngoing
      ? liveColor
      : isStartingSoon
        ? soonColor
        : colors.text;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: tierPaletteColors.background,
          borderColor: dynamicBorderColor,
          opacity: isExpired ? 0.7 : 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.content}>
        {/* Top row: player's own status (left) + pending join requests (right),
            both inline inside the card. */}
        {(pillKind || showPendingBadge) && (
          <View style={styles.topRow}>
            {pillKind ? <ParticipantStatusPill kind={pillKind} isDark={isDark} t={t} /> : <View />}
            {showPendingBadge && (
              <PendingRequestsBadge count={pendingRequestCount} isDark={isDark} />
            )}
          </View>
        )}

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
          {/* Day · time — identical style, day's size + time's color */}
          <Text
            size="sm"
            weight="semibold"
            numberOfLines={1}
            color={headerColor}
            style={styles.dayLabel}
          >
            {dayLabel.toUpperCase()}
          </Text>
          <Text size="sm" weight="semibold" color={headerColor} style={styles.dayTimeDot}>
            ·
          </Text>
          <Text size="sm" weight="semibold" numberOfLines={1} color={headerColor}>
            {timeLabel}
          </Text>
        </View>

        {/* Location */}
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} numberOfLines={1} style={styles.locationText}>
            {locationName}
          </Text>
        </View>

        {/* Bottom row: Participants */}
        <View style={styles.bottomRow}>
          <ParticipantAvatars match={match} colors={colors} isDark={isDark} t={t} />
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

  // Bottom row: avatars
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Top row: status pill (left) + pending-requests indicator (right)
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },

  // Pill shape shared by the status pill and the pending-requests indicator
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.full,
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
    flexShrink: 1,
  },
  dayTimeDot: {
    marginHorizontal: spacingPixels[1],
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

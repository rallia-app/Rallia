/**
 * MatchCard Component - Vibrant & Sporty Design
 *
 * A high-energy, athletic card design with:
 * - Three-tier visual hierarchy based on match desirability:
 *   - Must-Play: Court booked + high reputation creator (90%+) → gold/amber with animated glow
 *   - Ready to Play: Court booked only → secondary/coral tones
 *   - Regular: Default → primary/teal tones
 * - Color bleed effect from accent strip
 * - Pulsing animation for urgent matches (< 3 hours)
 * - Visual player slot indicators
 * - Consistent CTA button colors based on action type
 */

import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Animated, Easing } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
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
  getMatchEndTimeDifferenceFromNow,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
  deriveMatchStatus,
  lightHaptic,
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
  // Must-Play - accent gradient strip (richest shade), primary background
  mostWanted: {
    light: {
      background: primary[50],
      accentStart: accent[700],
      accentEnd: accent[600],
    },
    dark: {
      background: primary[950],
      accentStart: accent[600],
      accentEnd: accent[500],
    },
  },
  // Ready to Play - accent gradient strip (medium shade), primary background
  readyToPlay: {
    light: {
      background: primary[50],
      accentStart: accent[600],
      accentEnd: accent[500],
    },
    dark: {
      background: primary[950],
      accentStart: accent[500],
      accentEnd: accent[400],
    },
  },
  // Top Player - accent gradient strip (lightest shade), primary background
  topPlayer: {
    light: {
      background: primary[50],
      accentStart: accent[500],
      accentEnd: accent[400],
    },
    dark: {
      background: primary[950],
      accentStart: accent[400],
      accentEnd: accent[300],
    },
  },
  // Regular - primary palette
  regular: {
    light: {
      background: primary[50],
      accentStart: primary[500],
      accentEnd: primary[400],
    },
    dark: {
      background: primary[950],
      accentStart: primary[400],
      accentEnd: primary[300],
    },
  },
  // Expired - neutral/gray palette (disabled, past matches)
  expired: {
    light: {
      background: neutral[100],
      accentStart: neutral[400],
      accentEnd: neutral[300],
    },
    dark: {
      background: neutral[900],
      accentStart: neutral[500],
      accentEnd: neutral[400],
    },
  },
} as const;

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_HORIZONTAL_MARGIN = spacingPixels[4]; // 16px each side
const CARD_PADDING = spacingPixels[4]; // 16px
const GRADIENT_STRIP_HEIGHT = 4;

// Slot sizes
const SLOT_SIZE = 32;
const CHIP_BG_ALPHA_LIGHT = '15';
const CHIP_BG_ALPHA_DARK = '30';

// =============================================================================
// TYPES
// =============================================================================

interface TranslationOptions {
  [key: string]: string | number | boolean;
}

export interface MatchCardProps {
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
  /** Current user's player ID (to determine owner/participant status) */
  currentPlayerId?: string;
  /** Optional sport icon element rendered as a watermark background */
  sportIcon?: React.ReactNode;
}

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryLight: string;
  secondary: string;
  secondaryLight: string;
  slotEmpty: string;
  slotEmptyBorder: string;
  avatarPlaceholder: string;
  // Tier-aware accent colors (set based on match tier)
  tierAccent: string;
  tierAccentLight: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Use base.white from design system for consistency

/**
 * Get time display for match date/time
 *
 * Shows intuitive date labels:
 * - "Today" for today's date
 * - "Tomorrow" for tomorrow's date
 * - Weekday name for dates within the next 6 days (e.g., "Wednesday")
 * - "Month Day" for dates further out (e.g., "Jan 15")
 *
 * Time format is locale-aware:
 * - English: 12-hour format (e.g., "2:00 PM - 4:00 PM")
 * - French: 24-hour format (e.g., "14:00 - 16:00")
 */
function getRelativeTimeDisplay(
  dateString: string,
  startTime: string,
  endTime: string,
  timezone: string,
  locale: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): { label: string; isUrgent: boolean } {
  const tz = timezone || 'UTC';

  // Calculate time difference to determine if urgent (within 3 hours)
  const msDiff = getTimeDifferenceFromNow(dateString, startTime, tz);
  const hoursDiff = Math.floor(msDiff / (1000 * 60 * 60));
  const isUrgent = hoursDiff >= 0 && hoursDiff < 3;

  // Get intuitive date label (Today, Tomorrow, Wednesday, or Jan 15)
  const dateResult = formatIntuitiveDateInTimezone(dateString, tz, locale);

  // Use translation for Today/Tomorrow, otherwise use the formatted date
  let dateLabel: string;
  if (dateResult.translationKey) {
    dateLabel = t(dateResult.translationKey);
  } else {
    dateLabel = dateResult.label;
  }

  // Format start time (locale-aware: 12h for English, 24h for French)
  const startResult = formatTimeInTimezone(dateString, startTime, tz, locale);

  // Calculate duration from start and end times
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let durationMin = endH * 60 + endM - (startH * 60 + startM);
  if (durationMin <= 0) durationMin += 24 * 60; // handle midnight crossing
  const durationHours = Math.floor(durationMin / 60);
  const durationRemMin = durationMin % 60;
  const durationStr =
    durationRemMin > 0
      ? `${durationHours}h${durationRemMin.toString().padStart(2, '0')}`
      : `${durationHours}h`;

  const separator = t('common.time.timeSeparator');
  const timeRange = `${startResult.formattedTime}${separator}${durationStr}`;

  return { label: `${dateLabel}${separator}${timeRange}`, isUrgent };
}

/**
 * Get location display string
 */
function getLocationDisplay(match: MatchWithDetails, t: (key: TranslationKey) => string): string {
  if (match.facility?.name) {
    return match.facility.name;
  }
  if (match.location_name) {
    return match.location_name;
  }
  return t('matchDetail.locationTBD');
}

/**
 * Get court display string
 */
function getCourtDisplay(match: MatchWithDetails): string | null {
  if (match.court?.name) {
    return match.court.name;
  }
  return null;
}

/**
 * Calculate player slots info - only counts joined participants
 * Note: Creator is now included in joined participants with is_host=true
 */
function getParticipantInfo(match: MatchWithDetails): {
  current: number;
  total: number;
  spotsLeft: number;
} {
  const total = match.format === 'doubles' ? 4 : 2;
  // Only count joined participants (not requested, pending, waitlisted, left, etc.)
  // Creator is now included as a joined participant with is_host=true
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const current = joinedParticipants.length;
  const spotsLeft = Math.max(0, total - current);
  return { current, total, spotsLeft };
}

function getFeedbackWindowStatus(
  matchDate: string,
  startTime: string,
  endTime: string,
  timezone: string
): { isWithinFeedbackWindow: boolean; isPastFeedbackWindow: boolean } {
  // Use the existing timezone-aware utility to get time difference from end time
  // This properly handles timezone conversion and midnight-spanning matches
  const endTimeDiffMs = getMatchEndTimeDifferenceFromNow(matchDate, startTime, endTime, timezone);

  // If endTimeDiffMs > 0, match hasn't ended yet
  if (endTimeDiffMs > 0) {
    return { isWithinFeedbackWindow: false, isPastFeedbackWindow: false };
  }

  // Match has ended - endTimeDiffMs is negative (time since end)
  const timeSinceEndMs = Math.abs(endTimeDiffMs);
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;

  const isWithinFeedbackWindow = timeSinceEndMs < fortyEightHoursMs;
  const isPastFeedbackWindow = timeSinceEndMs >= fortyEightHoursMs;

  return { isWithinFeedbackWindow, isPastFeedbackWindow };
}

/**
 * Check if we're within the check-in window (10 minutes before start until end)
 * Uses timezone-aware date utilities to properly handle timezones.
 */
function getCheckInWindowStatus(
  matchDate: string,
  startTime: string,
  endTime: string,
  timezone: string
): boolean {
  // Get time difference from start time
  const startTimeDiffMs = getTimeDifferenceFromNow(matchDate, startTime, timezone);
  // Get time difference from end time
  const endTimeDiffMs = getMatchEndTimeDifferenceFromNow(matchDate, startTime, endTime, timezone);

  // Check-in window: 10 minutes before start until end
  const tenMinutesMs = 10 * 60 * 1000;

  // startTimeDiffMs > 0 means start is in the future
  // We want: now >= (start - 10min) AND now < end
  // Which means: startTimeDiffMs <= 10min AND endTimeDiffMs > 0
  const isWithinCheckInWindow = startTimeDiffMs <= tenMinutesMs && endTimeDiffMs > 0;

  return isWithinCheckInWindow;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface PlayerSlotsProps {
  match: MatchWithDetails;
  participantInfo: { current: number; total: number; spotsLeft: number };
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  /** Current user's player ID to check if they're invited */
  currentPlayerId?: string;
  /** Match tier for tier-aware avatar border coloring */
  tier: MatchTier;
}

/**
 * Visual player slot indicators showing filled/empty positions
 */
const PlayerSlots: React.FC<PlayerSlotsProps> = ({
  match,
  participantInfo,
  colors,
  isDark,
  t,
  currentPlayerId,
  tier,
}) => {
  // Tier-aware avatar border color
  const avatarBorderColor = (() => {
    switch (tier) {
      case 'expired':
        return isDark ? neutral[500] : neutral[400];
      default:
        return isDark ? primary[400] : primary[500];
    }
  })();

  // Only include joined participants
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];

  // Identify host and other participants using is_host flag
  const hostParticipant = joinedParticipants.find(p => p.is_host);
  const otherParticipants = joinedParticipants.filter(p => !p.is_host);

  // Check if current user has been invited (pending status)
  const isInvited = currentPlayerId
    ? match.participants?.some(
        p =>
          (p.player_id === currentPlayerId || p.player?.id === currentPlayerId) &&
          p.status === 'pending'
      )
    : false;

  // Check if current user is the creator/host (to show pending requests count)
  const isCreator = currentPlayerId
    ? hostParticipant?.player_id === currentPlayerId ||
      match.created_by_player?.id === currentPlayerId ||
      match.created_by === currentPlayerId
    : false;

  // Count pending join requests (for creators only)
  const pendingRequestsCount = isCreator
    ? (match.participants?.filter(p => p.status === 'requested').length ?? 0)
    : 0;

  const invitedBadgeColor = isDark ? primary[400] : primary[500];
  const pendingBadgeColor = isDark ? secondary[400] : secondary[500];

  // Build slots array
  const slots: Array<{
    filled: boolean;
    avatarUrl?: string | null;
    isHost: boolean;
  }> = [];

  // First slot is always the host
  // Use host participant's profile, fallback to created_by_player for backwards compatibility
  const hostProfile = hostParticipant?.player?.profile ?? match.created_by_player?.profile;
  slots.push({
    filled: true,
    avatarUrl: getProfilePictureUrl(hostProfile?.profile_picture_url),
    isHost: true,
  });

  // Add participant slots (only non-host joined participants)
  // Normalize URLs to use current environment's Supabase URL
  for (let i = 0; i < participantInfo.total - 1; i++) {
    const participant = otherParticipants[i];
    slots.push({
      filled: !!participant,
      avatarUrl: getProfilePictureUrl(participant?.player?.profile?.profile_picture_url),
      isHost: false,
    });
  }

  return (
    <View style={styles.slotsContainer}>
      <View style={styles.slotsRow}>
        {slots.map((slot, index) => (
          <View key={index} style={styles.slotWrapper}>
            <View
              style={[
                styles.slot,
                index > 0 && { marginLeft: -8 }, // Overlap avatars
                slot.filled
                  ? {
                      backgroundColor: slot.avatarUrl
                        ? colors.tierAccent
                        : colors.avatarPlaceholder,
                      borderWidth: 2,
                      borderColor: avatarBorderColor,
                      shadowColor: avatarBorderColor,
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 3,
                    }
                  : {
                      backgroundColor: colors.slotEmpty,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: colors.slotEmptyBorder,
                    },
              ]}
            >
              {slot.filled ? (
                slot.avatarUrl ? (
                  <Image source={{ uri: slot.avatarUrl }} style={styles.slotAvatar} />
                ) : (
                  <Ionicons
                    name="person-outline"
                    size={14}
                    color={isDark ? neutral[400] : neutral[500]}
                  />
                )
              ) : (
                <Ionicons name="add-outline" size={16} color={colors.slotEmptyBorder} />
              )}
            </View>
            {slot.isHost && (
              <View
                style={[
                  styles.hostIndicator,
                  { backgroundColor: isDark ? primary[400] : primary[500] },
                ]}
              >
                <Ionicons name="star" size={8} color={base.white} />
              </View>
            )}
          </View>
        ))}
      </View>
      {/* Invited indicator for players with pending status */}
      {isInvited && (
        <View
          style={[
            styles.invitedBadge,
            {
              backgroundColor: `${invitedBadgeColor}${isDark ? '25' : '15'}`,
              borderColor: invitedBadgeColor,
            },
          ]}
        >
          <Ionicons
            name="mail-outline"
            size={12}
            color={invitedBadgeColor}
            style={styles.invitedIcon}
          />
          <Text size="xs" weight="semibold" color={invitedBadgeColor}>
            {t('match.invited')}
          </Text>
        </View>
      )}
      {/* Pending requests indicator for match creators */}
      {pendingRequestsCount > 0 && (
        <View
          style={[
            styles.invitedBadge,
            {
              backgroundColor: `${pendingBadgeColor}${isDark ? '25' : '15'}`,
              borderColor: pendingBadgeColor,
            },
          ]}
        >
          <Ionicons
            name="person-add-outline"
            size={12}
            color={pendingBadgeColor}
            style={styles.invitedIcon}
          />
          <Text size="xs" weight="semibold" color={pendingBadgeColor}>
            {t('match.pendingRequests', { count: pendingRequestsCount })}
          </Text>
        </View>
      )}
    </View>
  );
};

interface BadgeProps {
  label: string;
  bgColor: string;
  textColor: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Simple badge component with solid background
 */
const Badge: React.FC<BadgeProps> = ({ label, bgColor, textColor, icon }) => (
  <View style={[styles.badge, { backgroundColor: bgColor }]}>
    {icon && <Ionicons name={icon} size={10} color={textColor} style={styles.badgeIcon} />}
    <Text size="xs" weight="semibold" color={textColor}>
      {label}
    </Text>
  </View>
);

interface CardFooterProps {
  match: MatchWithDetails;
  participantInfo: { current: number; total: number; spotsLeft: number };
  colors: ThemeColors;
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  onPress?: () => void;
  currentPlayerId?: string;
}

/**
 * Footer with CTA button
 *
 * CTA Logic (priority order):
 * 1. Check-in CTA (when within check-in window, full game, joined participant, hasn't checked in)
 * 2. Feedback CTA (when match ended, within 48h window, joined participant, hasn't completed feedback)
 * 3. Match has ended → "View" (for everyone - no edit/leave allowed)
 * 4. Match has result → "View Results"
 * 5. Owner (match not ended) → "Edit"
 * 6. User has joined (match not ended) → "Leave"
 * 7. User has pending join request ('requested' status) → "Pending" (disabled)
 * 8. Match is full → "Join Waitlist"
 * 9. Join mode is 'request' → "Ask to Join"
 * 10. Default → "Join"
 *
 * Note: Users with 'pending' status (invited by host) see regular CTAs (Join/Ask to Join/Join Waitlist)
 * so they can accept the invitation through the normal join flow.
 */
const CardFooter: React.FC<CardFooterProps> = ({
  match,
  participantInfo,
  colors,
  isDark,
  t,
  onPress,
  currentPlayerId,
}) => {
  // Check if match is cancelled (use cancelled_at instead of status)
  const isCancelled = !!match.cancelled_at;

  // Derive match status from data (not from status field)
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

  // Check if match has started (start_time has passed in match's timezone)
  // Once started, players can no longer join, leave, or edit the match
  const matchStartDiff = getTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.timezone
  );
  const hasMatchStarted = matchStartDiff < 0;

  // Derive match state from data (not from status field)
  const isFull = participantInfo.spotsLeft === 0;
  const hasResult = !!match.result;

  // User role checks
  const isOwner = currentPlayerId
    ? match.created_by_player?.id === currentPlayerId || match.created_by === currentPlayerId
    : false;

  const userParticipant = currentPlayerId
    ? match.participants?.find(
        p => p.player_id === currentPlayerId || p.player?.id === currentPlayerId
      )
    : undefined;

  const hasJoined = userParticipant?.status === 'joined';
  // 'pending' (invited by host) shows "Accept Invitation" CTA
  const isInvited = userParticipant?.status === 'pending';
  // 'requested' (user requested to join) shows "Pending" CTA
  const hasPendingRequest = userParticipant?.status === 'requested';
  const isWaitlisted = userParticipant?.status === 'waitlisted';

  // Join mode
  const isRequestMode = match.join_mode === 'request';

  // Feedback window status (48h after end time)
  const { isWithinFeedbackWindow } = getFeedbackWindowStatus(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone
  );

  // Check if current player is a joined participant who hasn't completed feedback yet
  const currentPlayerParticipant = currentPlayerId
    ? match.participants?.find(
        p =>
          (p.player_id === currentPlayerId || p.player?.id === currentPlayerId) &&
          p.status === 'joined'
      )
    : undefined;
  const playerHasCompletedFeedback = currentPlayerParticipant?.feedback_completed ?? false;
  const hasScore = !!match.result;

  // Check if the current player still needs to confirm/dispute the score
  // (score exists but not verified/disputed, player hasn't responded yet, player isn't the submitter)
  const scoreNeedsPlayerConfirmation =
    hasScore &&
    !match.result?.is_verified &&
    !match.result?.disputed &&
    match.result?.submitted_by !== currentPlayerId &&
    !match.result?.confirmations?.some(c => c.player_id === currentPlayerId);

  const playerNeedsFeedback =
    hasMatchEnded &&
    isWithinFeedbackWindow &&
    currentPlayerParticipant &&
    (!playerHasCompletedFeedback || !hasScore || scoreNeedsPlayerConfirmation);

  // Check-in window status (10 min before start until end, only for full games)
  const isWithinCheckInWindow = getCheckInWindowStatus(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone
  );
  const playerHasCheckedIn = !!currentPlayerParticipant?.checked_in_at;
  // Check-in is only available for matches with a confirmed location (facility or custom)
  // TBD matches don't have a location to check in at
  const locationAllowsCheckIn =
    match.location_type === 'facility' || match.location_type === 'custom';
  const playerNeedsCheckIn =
    isFull &&
    isWithinCheckInWindow &&
    currentPlayerParticipant &&
    !playerHasCheckedIn &&
    locationAllowsCheckIn;

  const ctaPositive = isDark ? primary[400] : primary[500];
  const ctaDestructive = isDark ? secondary[400] : secondary[500];
  // const ctaAccent = isDark ? accent[400] : accent[500];
  const ctaNeutralBg = isDark ? neutral[700] : neutral[200];
  const ctaNeutralText = colors.text;

  // Check if match is expired (started or ended but not full)
  const isExpired = (isInProgress || hasMatchEnded) && !isFull;

  // Determine button label, style, and icon based on state
  // CTA Color Matrix:
  // - Check-in/Feedback/Join/Ask to Join/Join Waitlist → primary
  // - Edit → accent
  // - Cancel/Leave/Cancelled → secondary
  // - View/View Results/Expired → neutral
  // - Pending/Waitlisted → neutral background + secondary text
  let ctaLabel: string;
  let ctaBgColor: string;
  let ctaTextColor: string;
  let ctaDisabled = false;
  let ctaBorderColor: string | null = null;
  let ctaIcon: keyof typeof Ionicons.glyphMap | null = 'add-circle-outline';

  // Expired match (highest priority) → Always show "View" CTA
  if (isExpired) {
    ctaLabel = t('match.cta.view');
    ctaBgColor = ctaNeutralBg;
    ctaTextColor = ctaNeutralText;
    ctaIcon = 'eye-outline';
  } else if (playerNeedsCheckIn) {
    ctaLabel = t('matchDetail.checkIn');
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
    ctaIcon = 'checkmark-circle-outline';
  } else if (hasJoined && playerHasCheckedIn && !isInProgress && !hasMatchEnded) {
    // Participant has checked in but game hasn't started yet → Show "Checked-in" (success green, disabled look)
    ctaLabel = t('matchDetail.checkedIn');
    ctaBgColor = `${ctaPositive}${isDark ? '30' : '20'}`;
    ctaTextColor = ctaPositive;
    ctaDisabled = true;
    ctaIcon = 'checkmark-circle';
  } else if (playerNeedsFeedback) {
    // Feedback CTA - label and icon vary based on what's still needed
    const needsFeedback = !playerHasCompletedFeedback;
    const needsScore = !hasScore;
    const needsScoreConfirmation = !!scoreNeedsPlayerConfirmation;
    if (needsFeedback && needsScore) {
      // No score submitted yet → need both feedback and score
      ctaLabel = t('matchDetail.provideFeedback');
      ctaIcon = 'star-outline';
    } else if (needsFeedback && needsScoreConfirmation) {
      // Score submitted by someone else, needs confirmation + feedback
      ctaLabel = t('matchDetail.provideFeedbackAndConfirm' as TranslationKey);
      ctaIcon = 'star-outline';
    } else if (needsFeedback) {
      // Score is settled, just needs feedback
      ctaLabel = t('matchDetail.provideFeedbackOnly');
      ctaIcon = 'chatbubble-ellipses-outline';
    } else if (needsScoreConfirmation) {
      // Feedback done, but score needs confirmation
      ctaLabel = t('matchDetail.confirmScore');
      ctaIcon = 'checkmark-circle-outline';
    } else {
      // Feedback done, no score submitted yet → need to register score
      ctaLabel = t('matchDetail.provideScoreOnly');
      ctaIcon = 'trophy-outline';
    }
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
  } else if (isCancelled) {
    // Match is cancelled → Cancelled (danger red, disabled)
    ctaLabel = t('match.cta.cancelled');
    ctaBgColor = `${ctaDestructive}${isDark ? '30' : '20'}`;
    ctaTextColor = ctaDestructive;
    ctaDisabled = true;
    ctaIcon = 'close-circle-outline';
  } else if (hasResult) {
    // Match with results → View Results (primary tint)
    ctaLabel = t('match.cta.viewResults');
    ctaBgColor = `${ctaPositive}${isDark ? '30' : '15'}`;
    ctaTextColor = ctaPositive;
    ctaIcon = 'trophy-outline';
  } else if (hasMatchStarted) {
    // Match has started but no results yet → View (primary tint)
    ctaLabel = t('match.cta.view');
    ctaBgColor = `${ctaPositive}${isDark ? '30' : '15'}`;
    ctaTextColor = ctaPositive;
    ctaIcon = 'eye-outline';
  } else if (isOwner) {
    // Owner (match not ended) → Edit
    ctaLabel = t('match.cta.edit');
    ctaBgColor = `${ctaPositive}${isDark ? '30' : '15'}`;
    ctaTextColor = ctaPositive;
    ctaIcon = 'create-outline';
  } else if (isWaitlisted && isFull) {
    // On Waitlist (match still full) → info/blue style to match the waitlisted banner in MatchDetailSheet
    ctaLabel = t('match.cta.waitlisted');
    ctaBgColor = `${status.info.DEFAULT}15`;
    ctaTextColor = status.info.DEFAULT;
    ctaBorderColor = status.info.DEFAULT;
    ctaIcon = 'list-outline';
  } else if (hasJoined) {
    // Joined → subtle primary tint to encourage staying (leave is available in detail sheet)
    ctaLabel = t('match.cta.view');
    ctaBgColor = `${ctaPositive}${isDark ? '30' : '15'}`;
    ctaTextColor = ctaPositive;
    ctaIcon = 'eye-outline';
  } else if (hasPendingRequest) {
    // Pending → warning/amber style to match the pending approval banner in MatchDetailSheet
    ctaLabel = t('match.cta.pending');
    ctaBgColor = `${status.warning.DEFAULT}15`;
    ctaTextColor = status.warning.DEFAULT;
    ctaBorderColor = status.warning.DEFAULT;
    ctaDisabled = true;
    ctaIcon = 'time-outline';
  } else if (isInvited && !isFull && !isRequestMode) {
    // Invited (pending status) to direct-join match with spots → Accept Invitation (success green)
    ctaLabel = t('match.cta.acceptInvitation');
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
    ctaIcon = 'checkmark-circle-outline';
  } else if (isFull) {
    // Join Waitlist → success green
    ctaLabel = t('match.cta.joinWaitlist');
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
    ctaIcon = 'list-outline';
  } else if (isRequestMode) {
    // Ask to Join → success green
    ctaLabel = t('match.cta.askToJoin');
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
    ctaIcon = 'hand-left-outline';
  } else {
    // Join → success green
    ctaLabel = t('match.cta.join');
    ctaBgColor = ctaPositive;
    ctaTextColor = base.white;
    ctaIcon = 'add-circle-outline';
  }

  // CTA mount bounce for actionable states (Join, Check-in, Feedback, etc.)
  const ctaScaleAnimation = useMemo(() => new Animated.Value(1), []);
  const isActionableCta = !ctaDisabled && ctaBgColor === ctaPositive;

  useEffect(() => {
    if (isActionableCta) {
      ctaScaleAnimation.setValue(0.92);
      Animated.spring(ctaScaleAnimation, {
        toValue: 1,
        useNativeDriver: true,
        speed: 12,
        bounciness: 8,
      }).start();
    } else {
      ctaScaleAnimation.setValue(1);
    }
  }, [isActionableCta, ctaScaleAnimation]);

  const handleCtaPressIn = () => {
    Animated.spring(ctaScaleAnimation, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handleCtaPressOut = () => {
    Animated.spring(ctaScaleAnimation, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  return (
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      {/* CTA Button with bounce animation for actionable states */}
      <Animated.View style={{ flex: 1, transform: [{ scale: ctaScaleAnimation }] }}>
        <TouchableOpacity
          style={[
            styles.ctaButton,
            { backgroundColor: ctaBgColor },
            ctaBorderColor && { borderWidth: 1, borderColor: ctaBorderColor },
            ctaDisabled && styles.ctaButtonDisabled,
          ]}
          onPress={() => {
            lightHaptic();
            onPress?.();
          }}
          onPressIn={handleCtaPressIn}
          onPressOut={handleCtaPressOut}
          activeOpacity={1}
          disabled={ctaDisabled}
        >
          {ctaIcon && (
            <Ionicons name={ctaIcon} size={14} color={ctaTextColor} style={styles.ctaIconLeft} />
          )}
          <Text size="sm" weight="bold" color={ctaTextColor}>
            {ctaLabel}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MatchCard: React.FC<MatchCardProps> = ({
  match,
  onPress,
  isDark,
  t,
  locale,
  currentPlayerId,
  sportIcon,
}) => {
  // Compute participant info early to check for expired state
  const participantInfo = getParticipantInfo(match);
  const isFull = participantInfo.spotsLeft === 0;

  // Derive match status to check for expired state
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
  // Build participant list for tier calculation: all joined participants
  const joinedForTier = match.participants?.filter(p => p.status === 'joined') ?? [];
  const participants = joinedForTier.map(p => ({
    repScore: p.player?.player_reputation?.reputation_score,
    certStatus: (p.player as unknown as Record<string, unknown>)?.sportCertificationStatus as
      | string
      | undefined,
  }));
  const baseTier = getMatchTier(match.court_status, participants, match.format);
  const tier: MatchTier = isExpired ? 'expired' : baseTier;
  const isMostWanted = tier === 'mostWanted';
  const isReadyToPlay = tier === 'readyToPlay';
  const isTopPlayer = tier === 'topPlayer';

  // Animated pulse effect for urgent matches
  const urgentPulseAnimation = useMemo(() => new Animated.Value(0), []);

  // Card press animation - scale down for premium tactile feel
  const cardScaleAnimation = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = () => {
    Animated.spring(cardScaleAnimation, {
      toValue: 0.975,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(cardScaleAnimation, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  // Theme colors with tier-aware accent colors
  const themeColors = isDark ? darkTheme : lightTheme;

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

  const colors: ThemeColors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[400] : primary[600],
      primaryLight: isDark ? primary[900] : primary[50],
      secondary: isDark ? secondary[400] : secondary[500],
      secondaryLight: isDark ? secondary[900] : secondary[50],
      slotEmpty: isDark ? neutral[800] : neutral[100],
      slotEmptyBorder: isDark ? neutral[600] : neutral[300],
      avatarPlaceholder: isDark ? neutral[700] : neutral[200],
      // Tier-aware accent colors for consistent theming
      tierAccent: tierAccentColors.accent,
      tierAccentLight: tierAccentColors.accentLight,
    }),
    [themeColors, isDark, tierAccentColors]
  );

  const chipAlpha = isDark ? CHIP_BG_ALPHA_DARK : CHIP_BG_ALPHA_LIGHT;
  const getChipColors = (baseColor: string) => ({
    bgColor: `${baseColor}${chipAlpha}`,
    textColor: baseColor,
    iconColor: baseColor,
  });

  const chipColors = {
    primary: getChipColors(isDark ? primary[400] : primary[500]),
    secondary: getChipColors(isDark ? secondary[400] : secondary[500]),
    accent: getChipColors(isDark ? accent[400] : accent[500]),
    tier: getChipColors(colors.tierAccent),
  } as const;

  // Computed values (participantInfo and derivedStatus already computed above for expired check)
  const { label: timeLabel, isUrgent } = getRelativeTimeDisplay(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone,
    locale,
    t
  );
  const locationDisplay = getLocationDisplay(match, t);
  const courtDisplay = getCourtDisplay(match);

  // Determine animation type:
  // - "in_progress" = ongoing match = live indicator animation
  // - "isUrgent" (< 3 hours) but not in_progress = starting soon = countdown animation
  const isOngoing = derivedStatus === 'in_progress';
  const isStartingSoon = isUrgent && !isOngoing;
  const liveColor = isDark ? secondary[400] : secondary[500];
  const soonColor = isDark ? accent[400] : accent[500];

  // Start animation when match is urgent or ongoing
  useEffect(() => {
    if (isOngoing || isStartingSoon) {
      const animationDuration = isOngoing ? duration.extraSlow : duration.verySlow; // Faster for live, slower for countdown
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

  // "Live indicator" interpolations for ongoing matches
  // Ring expands outward and fades (toned down for polish)
  const liveRingScale = urgentPulseAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.8],
  });

  const liveRingOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.6, 0.3, 0],
  });

  // Core dot has subtle glow pulse
  const liveDotOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.7, 1],
  });

  // "Starting soon" interpolations - pulsing opacity on time icon
  const countdownOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.5, 1, 0.5],
  });

  // Cost display
  const costDisplay = match.is_court_free
    ? t('match.cost.free')
    : match.estimated_cost
      ? `~$${Math.ceil(match.estimated_cost / participantInfo.total)}`
      : null;

  // Build badges array (new order per spec)
  const badges: Array<{
    key: string;
    label: string;
    bgColor: string;
    textColor: string;
    icon?: keyof typeof Ionicons.glyphMap;
  }> = [];

  // 1. Min Rating (coral/secondary)
  if (match.min_rating_score) {
    badges.push({
      key: 'rating',
      label: match.min_rating_score.label,
      bgColor: chipColors.secondary.bgColor,
      textColor: chipColors.secondary.textColor,
      icon: 'analytics',
    });
  }

  // 2. Top Player + Court Booked badges (only in badge list for mostWanted,
  //    since standalone tiers already show in the corner ribbon)
  if (tier === 'mostWanted') {
    const topPlayerAccent = isDark ? accent[400] : accent[500];
    const topPlayerChip = getChipColors(topPlayerAccent);
    badges.push({
      key: 'topPlayer',
      label: t(
        (match.format === 'doubles'
          ? 'match.tier.topPlayerPlural'
          : 'match.tier.topPlayer') as TranslationKey
      ),
      bgColor: topPlayerChip.bgColor,
      textColor: topPlayerChip.textColor,
      icon: 'star',
    });
    const courtBookedAccent = isDark ? accent[500] : accent[600];
    const courtBookedChip = getChipColors(courtBookedAccent);
    badges.push({
      key: 'courtBooked',
      label: t('match.courtStatus.courtBooked'),
      bgColor: courtBookedChip.bgColor,
      textColor: courtBookedChip.textColor,
      icon: 'checkmark-circle',
    });
  }

  // 4. Player expectation (cyan/primary)
  if (match.player_expectation && match.player_expectation !== 'both') {
    const isCompetitive = match.player_expectation === 'competitive';
    badges.push({
      key: 'playerExpectation',
      label: isCompetitive ? t('matchDetail.competitive') : t('matchDetail.casual'),
      bgColor: chipColors.primary.bgColor,
      textColor: chipColors.primary.textColor,
      icon: isCompetitive ? 'trophy' : 'happy',
    });
  }

  // 5. Cost (cyan/primary)
  if (costDisplay) {
    badges.push({
      key: 'cost',
      label: costDisplay,
      bgColor: chipColors.primary.bgColor,
      textColor: chipColors.primary.textColor,
      icon: match.is_court_free ? 'checkmark-circle' : 'cash-outline',
    });
  }

  // Get dynamic border color based on tier
  const tierPaletteColors = TIER_PALETTES[tier][isDark ? 'dark' : 'light'];
  const dynamicBorderColor = isExpired
    ? isDark
      ? `${neutral[500]}40`
      : `${neutral[400]}20`
    : isDark
      ? `${primary[400]}40`
      : `${primary[500]}20`;

  // Tier ribbon badge config (3 accent shades: lightest → richest)
  const tierRibbon = isMostWanted
    ? {
        label: t('match.tier.mostWanted' as TranslationKey),
        bg: isDark ? accent[600] : accent[700],
      }
    : isReadyToPlay
      ? {
          label: t('match.courtStatus.courtBooked'),
          bg: isDark ? accent[500] : accent[600],
        }
      : isTopPlayer
        ? {
            label: t(
              (match.format === 'doubles'
                ? 'match.tier.topPlayerPlural'
                : 'match.tier.topPlayer') as TranslationKey
            ),
            bg: isDark ? accent[400] : accent[500],
          }
        : null;

  return (
    <Animated.View style={{ transform: [{ scale: cardScaleAnimation }] }}>
      {/* Tier ribbon badge - outside TouchableOpacity to avoid overflow:hidden clipping */}
      {tierRibbon && (
        <View style={[styles.tierRibbon, { backgroundColor: tierRibbon.bg }]}>
          <Text size="xs" weight="bold" color={base.white}>
            {tierRibbon.label}
          </Text>
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: tierPaletteColors.background,
            borderColor: dynamicBorderColor,
          },
        ]}
        onPress={() => {
          lightHaptic();
          onPress?.();
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`Match ${timeLabel} at ${locationDisplay}${isMostWanted ? ' - Must-Play' : isTopPlayer ? (match.format === 'doubles' ? ' - Coveted Players' : ' - Coveted Player') : isReadyToPlay ? ' - Court Booked' : ''}`}
      >
        {/* Sport watermark background */}
        {sportIcon && (
          <View style={styles.sportWatermark} pointerEvents="none">
            {sportIcon}
          </View>
        )}

        {/* Main content */}
        <View style={styles.content}>
          {/* Time & Status row */}
          <View style={styles.topRow}>
            <View style={styles.timeContainer}>
              {/* Animated indicators replace static icons for live/starting-soon states */}
              {isOngoing && !isExpired ? (
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
              ) : isStartingSoon && !isExpired ? (
                <Animated.View style={{ opacity: countdownOpacity }}>
                  <Ionicons name="time" size={16} color={soonColor} />
                </Animated.View>
              ) : (
                <Ionicons
                  name={isExpired ? 'close-circle-outline' : 'calendar-outline'}
                  size={16}
                  color={isExpired ? colors.textMuted : colors.tierAccent}
                />
              )}
              <Text
                size="base"
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
                style={styles.timeText}
                numberOfLines={1}
              >
                {timeLabel}
              </Text>
            </View>
            {/* <StatusBadge {...statusInfo} /> */}
          </View>

          {/* Location row */}
          <View style={styles.locationRow}>
            <Ionicons name="location" size={14} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} numberOfLines={1} style={styles.locationText}>
              {locationDisplay}
              {courtDisplay && ` • ${courtDisplay}`}
            </Text>
          </View>

          {/* Player slots */}
          <PlayerSlots
            match={match}
            participantInfo={participantInfo}
            colors={colors}
            isDark={isDark}
            t={t}
            currentPlayerId={currentPlayerId}
            tier={tier}
          />

          {/* Badges row - horizontal scroll for consistent card height */}
          {badges.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              style={styles.badgesScroll}
              contentContainerStyle={styles.badgesContentContainer}
            >
              {badges.map(badge => (
                <Badge
                  key={badge.key}
                  label={badge.label}
                  bgColor={badge.bgColor}
                  textColor={badge.textColor}
                  icon={badge.icon}
                />
              ))}
            </ScrollView>
          )}

          {/* Footer with CTA */}
          <CardFooter
            match={match}
            participantInfo={participantInfo}
            colors={colors}
            isDark={isDark}
            t={t}
            onPress={onPress}
            currentPlayerId={currentPlayerId}
          />
        </View>

        {/* Scrim + banner AFTER content so they render on top in the paint order */}
        {isExpired && (
          <View
            style={[
              styles.expiredScrim,
              { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.45)' },
            ]}
            pointerEvents="none"
          />
        )}
        {isExpired && (
          <View style={styles.expiredBannerContainer} pointerEvents="none">
            <View
              style={[
                styles.expiredBanner,
                {
                  backgroundColor: isDark ? `${status.error.light}E0` : `${status.error.DEFAULT}E0`,
                },
              ]}
            >
              <Ionicons
                name="close-circle"
                size={14}
                color={base.white}
                style={styles.expiredBannerIcon}
              />
              <Text size="sm" weight="bold" color={base.white}>
                {t('match.status.unfilled')}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // Card container
  card: {
    borderRadius: radiusPixels.xl,
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
    marginBottom: spacingPixels[3],
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },

  // Tier ribbon badge (top-right corner)
  tierRibbon: {
    position: 'absolute',
    top: spacingPixels[3],
    right: 8,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    zIndex: 20,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },

  // Semi-transparent scrim to dim card content for expired matches
  expiredScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },

  // Expired pill banner
  expiredBannerContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 11,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  expiredBannerIcon: {
    marginRight: spacingPixels[1],
  },

  // Sport watermark
  sportWatermark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.12,
    zIndex: 0,
  },

  // Gradient strip
  gradientStrip: {
    height: GRADIENT_STRIP_HEIGHT,
    zIndex: 1,
  },
  gradientStripPremium: {
    height: 6, // Slightly taller for premium cards
  },

  // Content
  content: {
    padding: CARD_PADDING,
    zIndex: 1,
  },

  // Top row (time + status)
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0, // Enable text truncation in flex children
  },
  timeText: {
    marginLeft: spacingPixels[1.5],
    flexShrink: 1,
  },
  // "Live" indicator styles for ongoing matches
  liveIndicatorContainer: {
    width: 10,
    height: 10,
    marginRight: spacingPixels[1.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRing: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    // Subtle shadow for depth
    shadowColor: secondary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
  // Status badge
  statusBadge: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    flexShrink: 0, // Prevent badge from shrinking
  },

  // Location row
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  locationText: {
    marginLeft: spacingPixels[1],
    flex: 1,
  },

  // Player slots
  slotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  slotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slotWrapper: {
    position: 'relative',
    alignItems: 'center',
  },
  slot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slotAvatar: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
  },
  hostIndicator: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  invitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  invitedIcon: {
    marginRight: spacingPixels[1],
  },

  // Badges
  badgesScroll: {
    marginBottom: spacingPixels[3],
  },
  badgesContentContainer: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    // Subtle shadow for badge depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  badgeIcon: {
    marginRight: spacingPixels[1],
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[2],
  },
  costBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1],
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    flex: 1,
    minWidth: 0, // Allow button to shrink if needed
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaIcon: {
    marginLeft: spacingPixels[1],
  },
  ctaIconLeft: {
    marginRight: spacingPixels[1],
  },
});

export default MatchCard;

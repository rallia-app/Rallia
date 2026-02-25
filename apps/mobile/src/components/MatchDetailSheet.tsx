/**
 * Match Detail Bottom Sheet - Complete match profile view
 *
 * This bottom sheet opens when a match card is pressed.
 * It displays comprehensive match information including:
 * - Date/time details
 * - Location with address and distance
 * - All participants with avatars
 * - Host information
 * - Match preferences (format, skill level, gender)
 * - Cost information
 * - Notes
 * - Action buttons (join, share, etc.)
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Linking,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  accent,
  neutral,
  status,
  base,
  duration,
} from '@rallia/design-system';
import {
  lightHaptic,
  mediumHaptic,
  selectionHaptic,
  successHaptic,
  errorHaptic,
  formatTimeInTimezone,
  getTimeDifferenceFromNow,
  getMatchEndTimeDifferenceFromNow,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
  deriveMatchStatus,
} from '@rallia/shared-utils';
import { useMatchDetailSheet } from '../context/MatchDetailSheetContext';
import { useActionsSheet } from '../context/ActionsSheetContext';
import { usePlayerInviteSheet } from '../context/PlayerInviteSheetContext';
import { useFeedbackSheet } from '../context/FeedbackSheetContext';
import {
  useTranslation,
  usePermissions,
  useRequireOnboarding,
  type TranslationKey,
} from '../hooks';
import { useTheme, usePlayer, useMatchActions } from '@rallia/shared-hooks';
import { getMatchChat, getMatchWithDetails } from '@rallia/shared-services';
import { SheetManager } from 'react-native-actions-sheet';
import { shareMatch } from '../utils';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { ConfirmationModal } from './ConfirmationModal';
import { RequesterDetailsModal } from './RequesterDetailsModal';
import { useAppNavigation } from '../navigation';
import type {
  PlayerWithProfile,
  MatchParticipantWithPlayer,
  OpponentForFeedback,
} from '@rallia/shared-types';

// Use base.white from design system for consistency

// =============================================================================
// TYPES & CONSTANTS
// =============================================================================

type MatchTier = 'mostWanted' | 'readyToPlay' | 'regular';

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

// =============================================================================
// TYPES
// =============================================================================

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
  statusOpen: string;
  statusFull: string;
  statusCompleted: string;
  slotEmpty: string;
  slotEmptyBorder: string;
  icon: string;
  iconMuted: string;
  avatarPlaceholder: string;
  // Tier-aware accent colors (set based on match tier)
  tierAccent: string;
  tierAccentLight: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get time display for match date/time
 * Uses the same format as the cards: "Today • 14:00 - 16:00"
 */
function getRelativeTimeDisplay(
  dateString: string,
  startTime: string,
  endTime: string,
  timezone: string,
  locale: string,
  t: (key: TranslationKey, options?: Record<string, string | number | boolean>) => string
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

  // Format time range (locale-aware: 12h for English, 24h for French)
  const startResult = formatTimeInTimezone(dateString, startTime, tz, locale);
  const endResult = formatTimeInTimezone(dateString, endTime, tz, locale);
  const timeRange = `${startResult.formattedTime} - ${endResult.formattedTime}`;
  const separator = t('common.time.timeSeparator');

  return { label: `${dateLabel}${separator}${timeRange}`, isUrgent };
}

/**
 * Format distance in human readable form
 */
function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Check if we're within the 48h feedback window after match end time
 * Uses timezone-aware date utilities to properly handle timezones.
 * Returns: { isWithinFeedbackWindow: boolean, isPastFeedbackWindow: boolean }
 */
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

/**
 * Get participant info - only counts active participants
 * Note: Creator is now included in joined participants with is_host=true
 */
function getParticipantInfo(match: MatchDetailData): {
  current: number;
  total: number;
  spotsLeft: number;
} {
  const total = match.format === 'doubles' ? 4 : 2;
  // Only count joined participants for display (not requested, pending, waitlisted, left, etc.)
  // Creator is now included as a joined participant with is_host=true
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const current = joinedParticipants.length;
  const spotsLeft = Math.max(0, total - current);
  return { current, total, spotsLeft };
}

/**
 * Check if leaving this match will affect the player's reputation.
 *
 * Per the spec, a reputation penalty (-25 points) applies only when ALL conditions are met:
 * 1. Match is full (all spots taken)
 * 2. Match was created more than 24 hours before start time (planned match)
 * 3. Match was NOT edited within 24 hours of start time (no last-minute host changes)
 * 4. Player is leaving within 24 hours of start time
 *
 * @param match - The match data
 * @returns true if leaving will incur a reputation penalty
 */
function willLeaveAffectReputation(match: MatchDetailData): boolean {
  const participantInfo = getParticipantInfo(match);

  // Condition 1: Match must be full
  if (participantInfo.spotsLeft > 0) {
    return false;
  }

  // Calculate match start datetime
  const matchStartDateTime = new Date(`${match.match_date}T${match.start_time}`);
  const now = new Date();

  // Condition 4: Must be within 24 hours of start time
  const hoursUntilMatch = (matchStartDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilMatch >= 24 || hoursUntilMatch < 0) {
    // Not within 24h window, or match already started
    return false;
  }

  // Condition 2: Match must have been created more than 24 hours before start
  if (match.created_at) {
    const createdAt = new Date(match.created_at);
    const hoursFromCreationToStart =
      (matchStartDateTime.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromCreationToStart < 24) {
      // Spontaneous/last-minute match - no penalty
      return false;
    }
  }

  // Condition 3: Match must NOT have been edited within 24 hours of start
  if (match.updated_at) {
    const updatedAt = new Date(match.updated_at);
    const hoursFromUpdateToStart =
      (matchStartDateTime.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromUpdateToStart < 24) {
      // Host made last-minute changes - no penalty for leaving
      return false;
    }
  }

  // All conditions met - leaving will affect reputation
  return true;
}

/**
 * Check if we're within 24 hours of the match start time.
 * Used to prevent certain actions like kicking players too close to game time.
 * Uses timezone-aware date utilities to properly handle timezones.
 *
 * @param match - The match data
 * @returns true if we're within 24 hours of match start
 */
function isWithin24HoursOfStart(match: MatchDetailData): boolean {
  const tz = match.timezone || 'UTC';
  // Get time difference in milliseconds (positive = future, negative = past)
  const msDiff = getTimeDifferenceFromNow(match.match_date, match.start_time, tz);
  const hoursUntilMatch = msDiff / (1000 * 60 * 60);

  // Returns true if match is in the future and within 24 hours
  return hoursUntilMatch >= 0 && hoursUntilMatch < 24;
}

/**
 * Check if cancelling this match will affect the creator's reputation.
 *
 * Per the spec, a reputation penalty (-25 points) applies only when BOTH conditions are met:
 * 1. Match was created more than 24 hours before start time (planned match)
 * 2. Creator is cancelling within 24 hours of start time
 *
 * Note: Unlike leaving, the match fullness is NOT a factor for cancellation penalties.
 *
 * @param match - The match data
 * @returns true if cancelling will incur a reputation penalty
 */
function willCancelAffectReputation(match: MatchDetailData): boolean {
  // Calculate match start datetime
  const matchStartDateTime = new Date(`${match.match_date}T${match.start_time}`);
  const now = new Date();

  // Condition 2: Must be within 24 hours of start time
  const hoursUntilMatch = (matchStartDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilMatch >= 24 || hoursUntilMatch < 0) {
    // Not within 24h window, or match already started
    return false;
  }

  // Condition 1: Match must have been created more than 24 hours before start
  if (match.created_at) {
    const createdAt = new Date(match.created_at);
    const hoursFromCreationToStart =
      (matchStartDateTime.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromCreationToStart < 24) {
      // Spontaneous/last-minute match - no penalty
      return false;
    }
  }

  // All conditions met - cancelling will affect reputation
  return true;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface InfoRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  children: React.ReactNode;
  colors: ThemeColors;
}

const InfoRow: React.FC<InfoRowProps> = ({ icon, iconColor, children, colors }) => (
  <View style={styles.infoRow}>
    {icon != null && (
      <View style={styles.infoIconContainer}>
        <Ionicons name={icon} size={20} color={iconColor || colors.iconMuted} />
      </View>
    )}
    <View style={styles.infoContent}>{children}</View>
  </View>
);

interface BadgeProps {
  label: string;
  bgColor: string;
  textColor: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

const Badge: React.FC<BadgeProps> = ({ label, bgColor, textColor, icon }) => (
  <View style={[styles.badge, { backgroundColor: bgColor }]}>
    {icon && <Ionicons name={icon} size={10} color={textColor} style={styles.badgeIcon} />}
    <Text size="xs" weight="semibold" color={textColor}>
      {label}
    </Text>
  </View>
);

interface ParticipantAvatarProps {
  avatarUrl?: string | null;
  isHost?: boolean;
  isEmpty?: boolean;
  isCheckedIn?: boolean;
  colors: ThemeColors;
  isDark: boolean;
  /** Tier accent color for host badge and filled avatar borders */
  tierAccent?: string;
  /** Tier accent light color for non-host filled avatar borders */
  tierAccentLight?: string;
}

const ParticipantAvatar: React.FC<ParticipantAvatarProps> = ({
  avatarUrl,
  isHost,
  isEmpty,
  isCheckedIn,
  colors,
  isDark,
  tierAccent,
  tierAccentLight,
}) => {
  // Use tier accent colors if provided, otherwise fall back to theme colors
  const hostBorderColor = tierAccent || colors.secondary;
  const filledBorderColor = tierAccentLight || colors.cardBackground;
  const hostBadgeBgColor = tierAccent || colors.secondary;

  return (
    <View style={styles.participantAvatarWrapper}>
      <View
        style={[
          styles.participantAvatar,
          isEmpty
            ? {
                backgroundColor: colors.slotEmpty,
                borderWidth: 2,
                borderColor: colors.slotEmptyBorder,
              }
            : {
                backgroundColor: avatarUrl ? hostBorderColor : colors.avatarPlaceholder,
                borderWidth: 2.5,
                borderColor: hostBorderColor,
                shadowColor: hostBorderColor,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 3,
              },
        ]}
      >
        {!isEmpty && avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.participantAvatarImage} />
        ) : !isEmpty ? (
          <Ionicons name="person-outline" size={18} color={isDark ? neutral[400] : neutral[500]} />
        ) : (
          <Ionicons name="add-outline" size={20} color={colors.slotEmptyBorder} />
        )}
      </View>
      {isHost && (
        <View style={[styles.hostBadge, { backgroundColor: hostBadgeBgColor }]}>
          <Ionicons name="star" size={8} color={base.white} />
        </View>
      )}
      {isCheckedIn && (
        <View style={[styles.checkedInBadge, { backgroundColor: status.success.DEFAULT }]}>
          <Ionicons name="checkmark-outline" size={8} color={base.white} />
        </View>
      )}
    </View>
  );
};

interface CheckInButtonProps {
  playerId: string | undefined;
  matchId: string | undefined;
  checkIn: (params: { playerId: string; latitude: number; longitude: number }) => void;
  isCheckingIn: boolean;
  successThemeColors: {
    primary: string;
    primaryForeground: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    buttonTextInactive: string;
    text: string;
    textMuted: string;
    border: string;
    background: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: Record<string, string | number | boolean>) => string;
}

/**
 * Check-in button with local loading state for better UX.
 * The loading state starts immediately when pressed (during location fetch)
 * rather than waiting for the mutation to start.
 */
const CheckInButton: React.FC<CheckInButtonProps> = ({
  playerId,
  matchId,
  checkIn,
  isCheckingIn,
  successThemeColors,
  isDark,
  t,
}) => {
  const toast = useToast();
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const handleCheckIn = async () => {
    mediumHaptic();
    if (!playerId || !matchId) return;

    setIsGettingLocation(true);

    try {
      const Location = await import('expo-location');

      // Try to get high accuracy location with a 5-second timeout
      // If it times out, fall back to last known location
      let position: Awaited<ReturnType<typeof Location.getCurrentPositionAsync>> | null = null;

      const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000));
      const locationPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      position = await Promise.race([locationPromise, timeoutPromise]);

      // If high accuracy timed out, try balanced (faster)
      if (!position) {
        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      checkIn({
        playerId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (error) {
      errorHaptic();
      toast.error(t('matchDetail.checkInLocationError'));
    } finally {
      setIsGettingLocation(false);
    }
  };

  const isLoading = isGettingLocation || isCheckingIn;

  return (
    <Button
      variant="primary"
      onPress={handleCheckIn}
      style={styles.actionButton}
      themeColors={successThemeColors}
      isDark={isDark}
      loading={isLoading}
      disabled={isLoading}
      leftIcon={<Ionicons name="checkmark-circle-outline" size={18} color={base.white} />}
    >
      {t('matchDetail.checkIn')}
    </Button>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const MatchDetailSheet: React.FC = () => {
  const { sheetRef, closeSheet, selectedMatch, updateSelectedMatch, handleSheetDismiss } =
    useMatchDetailSheet();
  const { openSheetForEdit } = useActionsSheet();
  const { openSheet: openInviteSheet } = usePlayerInviteSheet();
  const { openSheet: openFeedbackSheet } = useFeedbackSheet();
  const { guardAction } = useRequireOnboarding();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { player } = usePlayer();
  const { location: locationPermission } = usePermissions();
  const isDark = theme === 'dark';
  const toast = useToast();
  const playerId = player?.id;
  const navigation = useAppNavigation();

  // Navigate to player profile or open auth sheet if not signed in / onboarding incomplete.
  const handleParticipantProfilePress = useCallback(
    (targetPlayerId: string) => {
      closeSheet();
      if (!guardAction()) return;
      navigation.navigate('PlayerProfile', { playerId: targetPlayerId });
    },
    [closeSheet, guardAction, navigation]
  );

  // Confirmation modal states
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingParticipantId, setRejectingParticipantId] = useState<string | null>(null);
  const [showCancelRequestModal, setShowCancelRequestModal] = useState(false);
  const [showKickModal, setShowKickModal] = useState(false);
  const [kickingParticipantId, setKickingParticipantId] = useState<string | null>(null);
  const [showCancelInviteModal, setShowCancelInviteModal] = useState(false);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [acceptingRequestId, setAcceptingRequestId] = useState<string | null>(null);

  // Collapse/expand state for pending requests
  const [showAllRequests, setShowAllRequests] = useState(false);

  // Collapse/expand state for invitations
  const [showAllInvitations, setShowAllInvitations] = useState(false);

  // Requester details modal state
  const [selectedRequester, setSelectedRequester] = useState<MatchParticipantWithPlayer | null>(
    null
  );
  const [showRequesterModal, setShowRequesterModal] = useState(false);

  // Match conversation state (for chat button)
  const [matchConversationId, setMatchConversationId] = useState<string | null>(null);

  // Fetch match conversation when match changes
  useEffect(() => {
    let isMounted = true;

    const fetchMatchConversation = async () => {
      if (selectedMatch?.id) {
        const conversation = await getMatchChat(selectedMatch.id);
        if (isMounted) {
          setMatchConversationId(conversation?.id ?? null);
        }
      } else if (isMounted) {
        setMatchConversationId(null);
      }
    };

    fetchMatchConversation();

    return () => {
      isMounted = false;
    };
  }, [selectedMatch?.id]);

  // Animated pulse effect for live/urgent time indicators
  const urgentPulseAnimation = useMemo(() => new Animated.Value(0), []);

  // Match actions hook
  const {
    joinMatch,
    leaveMatch,
    cancelMatch,
    acceptRequest,
    rejectRequest,
    cancelRequest,
    kickParticipant,
    cancelInvite,
    resendInvite,
    checkIn,
    isJoining,
    isLeaving,
    isCancelling,
    isAccepting,
    isRejecting,
    isCancellingRequest,
    isKicking,
    isCancellingInvite,
    isCheckingIn,
  } = useMatchActions(selectedMatch?.id, {
    onJoinSuccess: result => {
      successHaptic();
      closeSheet();
      if (result.status === 'joined') {
        toast.success(t('matchActions.joinSuccess'));
      } else if (result.status === 'waitlisted') {
        toast.success(t('matchActions.waitlistSuccess'));
      } else {
        toast.success(t('matchActions.requestSent'));
      }
    },
    onJoinError: error => {
      errorHaptic();
      // Handle specific error types with user-friendly messages
      if (error.message === 'GENDER_MISMATCH') {
        toast.error(t('matchActions.genderMismatch'));
      } else {
        toast.error(error.message);
      }
    },
    onLeaveSuccess: () => {
      successHaptic();
      setShowLeaveModal(false);
      closeSheet();
      toast.success(t('matchActions.leaveSuccess'));
    },
    onLeaveError: error => {
      errorHaptic();
      setShowLeaveModal(false);
      toast.error(error.message);
    },
    onCancelSuccess: () => {
      successHaptic();
      setShowCancelModal(false);
      closeSheet();
      toast.success(t('matchActions.cancelSuccess'));
    },
    onCancelError: error => {
      errorHaptic();
      setShowCancelModal(false);
      toast.error(error.message);
    },
    onAcceptSuccess: participant => {
      successHaptic();
      setAcceptingRequestId(null);
      if (selectedMatch) {
        updateSelectedMatch({
          ...selectedMatch,
          participants: selectedMatch.participants?.map(p =>
            p.id === participant.id ? { ...p, status: participant.status } : p
          ),
        });
      }
      toast.success(t('matchActions.acceptSuccess'));
    },
    onAcceptError: error => {
      errorHaptic();
      setAcceptingRequestId(null);
      toast.error(error.message);
    },
    onRejectSuccess: participant => {
      successHaptic();
      setShowRejectModal(false);
      setRejectingParticipantId(null);
      if (selectedMatch) {
        updateSelectedMatch({
          ...selectedMatch,
          participants: selectedMatch?.participants?.map(p =>
            p.id === participant.id ? { ...p, status: participant.status } : p
          ),
        });
      }
      toast.success(t('matchActions.rejectSuccess'));
    },
    onRejectError: error => {
      errorHaptic();
      setShowRejectModal(false);
      setRejectingParticipantId(null);
      toast.error(error.message);
    },
    onCancelRequestSuccess: () => {
      successHaptic();
      setShowCancelRequestModal(false);
      closeSheet();
      toast.success(t('matchActions.cancelRequestSuccess'));
    },
    onCancelRequestError: error => {
      errorHaptic();
      setShowCancelRequestModal(false);
      toast.error(error.message);
    },
    onKickSuccess: participant => {
      successHaptic();
      setShowKickModal(false);
      setKickingParticipantId(null);
      if (selectedMatch) {
        updateSelectedMatch({
          ...selectedMatch,
          participants: selectedMatch.participants?.map(p =>
            p.id === participant.id ? { ...p, status: participant.status } : p
          ),
        });
      }
      toast.success(t('matchActions.kickSuccess'));
    },
    onKickError: error => {
      errorHaptic();
      setShowKickModal(false);
      setKickingParticipantId(null);
      toast.error(error.message);
    },
    onCancelInviteSuccess: participant => {
      successHaptic();
      setShowCancelInviteModal(false);
      setCancellingInvitationId(null);
      if (selectedMatch) {
        updateSelectedMatch({
          ...selectedMatch,
          participants: selectedMatch.participants?.map(p =>
            p.id === participant.id ? { ...p, status: participant.status } : p
          ),
        });
      }
      toast.success(t('matchActions.cancelInviteSuccess'));
    },
    onCancelInviteError: error => {
      errorHaptic();
      setShowCancelInviteModal(false);
      setCancellingInvitationId(null);
      toast.error(error.message);
    },
    onResendInviteSuccess: participant => {
      successHaptic();
      setResendingInvitationId(null);
      if (selectedMatch) {
        updateSelectedMatch({
          ...selectedMatch,
          participants: selectedMatch.participants?.map(p =>
            p.id === participant.id ? { ...p, status: participant.status } : p
          ),
        });
      }
      toast.success(t('matchActions.resendInviteSuccess'));
    },
    onResendInviteError: error => {
      errorHaptic();
      setResendingInvitationId(null);
      toast.error(error.message);
    },
    onCheckInSuccess: () => {
      successHaptic();
      // Update the local match state to show checked-in status
      if (selectedMatch && playerId) {
        const updatedParticipants = selectedMatch.participants?.map(p =>
          p.player_id === playerId ? { ...p, checked_in_at: new Date().toISOString() } : p
        );
        updateSelectedMatch({
          ...selectedMatch,
          participants: updatedParticipants,
        });
      }
      toast.success(t('matchDetail.checkInSuccess'));
    },
    onCheckInError: result => {
      errorHaptic();
      if (result.error === 'too_far') {
        toast.error(t('matchDetail.checkInTooFar'));
      } else if (result.error === 'no_location') {
        toast.error(t('matchDetail.checkInNoLocation'));
      } else if (result.error === 'already_checked_in') {
        // Already checked in - just refresh the UI
        toast.info(t('matchDetail.alreadyCheckedIn'));
      } else {
        toast.error(t('matchDetail.checkInError'));
      }
    },
  });

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ThemeColors>(
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
      statusOpen: status.success.DEFAULT,
      statusFull: status.warning.DEFAULT,
      statusCompleted: status.info.DEFAULT,
      slotEmpty: isDark ? neutral[800] : neutral[100],
      slotEmptyBorder: isDark ? neutral[600] : neutral[300],
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      avatarPlaceholder: isDark ? neutral[700] : neutral[200],
      // Default tier accent colors (will be overridden by actual tier after early return)
      tierAccent: isDark ? primary[400] : primary[500],
      tierAccentLight: isDark ? primary[700] : primary[200],
    }),
    [themeColors, isDark]
  );

  // Single snap point at 98% - sheet opens directly at this height to ensure footer actions are visible
  const snapPoints = useMemo(() => ['95%'], []);

  // Backdrop
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  // Handle close sheet with haptic
  const handleCloseSheet = useCallback(() => {
    selectionHaptic();
    closeSheet();
  }, [closeSheet]);

  // Handle register score (from match detail during feedback window)
  const handleRegisterScore = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    SheetManager.show('register-match-score', {
      payload: {
        match: selectedMatch,
        onSuccess: async () => {
          const refreshed = await getMatchWithDetails(selectedMatch.id);
          if (refreshed) updateSelectedMatch(refreshed as MatchDetailData);
        },
      },
    });
  }, [selectedMatch, updateSelectedMatch]);

  // Handle share - uses rich message with match details and deep link
  const handleShare = useCallback(async () => {
    if (!selectedMatch) return;
    lightHaptic();
    try {
      await shareMatch(selectedMatch, { t, locale });
    } catch {
      // Silently handle errors
    }
  }, [selectedMatch, t, locale]);

  // Handle opening the match chat conversation
  const handleOpenChat = useCallback(() => {
    if (!matchConversationId || !selectedMatch) return;

    // Guard action: require auth and onboarding to access chat
    if (!guardAction()) {
      closeSheet();
      return;
    }

    lightHaptic();
    closeSheet();

    // Generate chat title from match info (sport name + date)
    const dateResult = formatIntuitiveDateInTimezone(
      selectedMatch.match_date,
      selectedMatch.timezone,
      locale
    );
    const dateLabel = dateResult.translationKey ? t(dateResult.translationKey) : dateResult.label;
    const chatTitle = selectedMatch.sport?.name
      ? `${selectedMatch.sport.name} - ${dateLabel}`
      : t('matchDetail.title');

    // Short delay so navigation runs after sheet close animation.
    // Navigate to the Chat conversation screen (full screen, no tabs)
    setTimeout(() => {
      navigation.navigate('ChatConversation', {
        conversationId: matchConversationId,
        title: chatTitle,
      });
    }, 100);
  }, [matchConversationId, selectedMatch, guardAction, closeSheet, locale, t, navigation]);

  // Handle join match
  const handleJoinMatch = useCallback(() => {
    if (!selectedMatch) return;
    // Guard action: if user is not authenticated or not onboarded,
    // close this sheet and open auth/onboarding sheet
    if (!guardAction()) {
      closeSheet();
      return;
    }
    mediumHaptic();
    joinMatch(playerId!);
  }, [selectedMatch, guardAction, closeSheet, playerId, joinMatch]);

  // Handle leave match - opens confirmation modal
  const handleLeaveMatch = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    setShowLeaveModal(true);
  }, [selectedMatch]);

  // Confirm leave match
  const handleConfirmLeave = useCallback(() => {
    if (!playerId) return;
    leaveMatch(playerId);
  }, [playerId, leaveMatch]);

  // Handle cancel match - opens confirmation modal (host only)
  const handleCancelMatch = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    setShowCancelModal(true);
  }, [selectedMatch]);

  // Confirm cancel match
  const handleConfirmCancel = useCallback(() => {
    if (!playerId) return;
    cancelMatch(playerId);
  }, [playerId, cancelMatch]);

  // Handle accept join request (host only)
  const handleAcceptRequest = useCallback(
    (participantId: string) => {
      if (!selectedMatch || !playerId) return;
      lightHaptic();
      setAcceptingRequestId(participantId);
      acceptRequest({ participantId, hostId: playerId });
    },
    [selectedMatch, playerId, acceptRequest]
  );

  // Handle reject join request - opens confirmation modal (host only)
  const handleRejectRequest = useCallback(
    (participantId: string) => {
      if (!selectedMatch) return;
      mediumHaptic();
      setRejectingParticipantId(participantId);
      setShowRejectModal(true);
    },
    [selectedMatch]
  );

  // Confirm reject request
  const handleConfirmReject = useCallback(() => {
    if (!playerId || !rejectingParticipantId) return;
    rejectRequest({ participantId: rejectingParticipantId, hostId: playerId });
  }, [playerId, rejectingParticipantId, rejectRequest]);

  // Handle cancel request - opens confirmation modal (requester only)
  const handleCancelRequest = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    setShowCancelRequestModal(true);
  }, [selectedMatch]);

  // Confirm cancel request
  const handleConfirmCancelRequest = useCallback(() => {
    if (!playerId) return;
    cancelRequest(playerId);
  }, [playerId, cancelRequest]);

  // Handle edit match - opens the match creation wizard in edit mode
  const handleEditMatch = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    closeSheet(); // Close the detail sheet first
    openSheetForEdit(selectedMatch); // Open actions sheet in edit mode
  }, [selectedMatch, closeSheet, openSheetForEdit]);

  // Handle invite players - opens the player invite sheet
  const handleInvitePlayers = useCallback(() => {
    if (!selectedMatch || !playerId) return;
    lightHaptic();
    // Statuses that should be excluded from invite search:
    // - pending: Already has an active invitation
    // - requested: Already has an active join request
    // - joined: Already in the match
    // - waitlisted: Already on the waitlist
    // - kicked: Host removed them (shouldn't re-invite)
    // Statuses that CAN be re-invited: declined, left, refused, cancelled
    const excludeStatuses = ['pending', 'requested', 'joined', 'waitlisted', 'kicked'];
    const existingParticipantIds = [
      selectedMatch.created_by, // Host always excluded
      ...((selectedMatch.participants
        ?.filter(p => excludeStatuses.includes(p.status ?? ''))
        .map(p => p.player_id)
        .filter(Boolean) as string[]) ?? []),
    ];
    openInviteSheet(selectedMatch.id, selectedMatch.sport_id, playerId, existingParticipantIds);
  }, [selectedMatch, playerId, openInviteSheet]);

  // Handle view requester details - opens modal instead of navigating
  const handleViewRequesterDetails = useCallback((participant: MatchParticipantWithPlayer) => {
    lightHaptic();
    setSelectedRequester(participant);
    setShowRequesterModal(true);
  }, []);

  // Handle close requester modal
  const handleCloseRequesterModal = useCallback(() => {
    setShowRequesterModal(false);
    // Clear selected requester after animation
    setTimeout(() => {
      setSelectedRequester(null);
    }, 300);
  }, []);

  // Handle accept from requester modal
  const handleAcceptFromModal = useCallback(
    (participantId: string) => {
      handleAcceptRequest(participantId);
      handleCloseRequesterModal();
    },
    [handleAcceptRequest, handleCloseRequesterModal]
  );

  // Handle reject from requester modal
  const handleRejectFromModal = useCallback(
    (participantId: string) => {
      setRejectingParticipantId(participantId);
      handleCloseRequesterModal();
      setShowRejectModal(true);
    },
    [handleCloseRequesterModal]
  );

  // Handle kick participant - opens confirmation modal (host only)
  const handleKickParticipant = useCallback(
    (participantId: string) => {
      if (!selectedMatch) return;
      mediumHaptic();
      setKickingParticipantId(participantId);
      setShowKickModal(true);
    },
    [selectedMatch]
  );

  // Confirm kick participant
  const handleConfirmKick = useCallback(() => {
    if (!playerId || !kickingParticipantId) return;
    kickParticipant({ participantId: kickingParticipantId, hostId: playerId });
  }, [playerId, kickingParticipantId, kickParticipant]);

  // Handle cancel invite - opens confirmation modal (host only)
  const handleCancelInvite = useCallback(
    (participantId: string) => {
      if (!selectedMatch) return;
      mediumHaptic();
      setCancellingInvitationId(participantId);
      setShowCancelInviteModal(true);
    },
    [selectedMatch]
  );

  // Confirm cancel invite
  const handleConfirmCancelInvite = useCallback(() => {
    if (!playerId || !cancellingInvitationId) return;
    cancelInvite({ participantId: cancellingInvitationId, hostId: playerId });
  }, [playerId, cancellingInvitationId, cancelInvite]);

  // Handle resend invite - direct action (no confirmation needed)
  const handleResendInvite = useCallback(
    (participantId: string) => {
      if (!selectedMatch || !playerId) return;
      lightHaptic();
      setResendingInvitationId(participantId);
      resendInvite({ participantId, hostId: playerId });
    },
    [selectedMatch, playerId, resendInvite]
  );

  // Handle open in maps
  const handleOpenMaps = useCallback(() => {
    if (!selectedMatch) return;
    selectionHaptic();

    const address = selectedMatch.facility?.address || selectedMatch.location_address;
    const lat = selectedMatch.facility?.latitude;
    const lng = selectedMatch.facility?.longitude;

    let url: string;
    if (lat && lng) {
      // Use coordinates if available
      url =
        Platform.select({
          ios: `maps:0,0?q=${lat},${lng}`,
          android: `geo:${lat},${lng}?q=${lat},${lng}`,
        }) || `https://maps.google.com/?q=${lat},${lng}`;
    } else if (address) {
      // Fall back to address search
      const encodedAddress = encodeURIComponent(address);
      url =
        Platform.select({
          ios: `maps:0,0?q=${encodedAddress}`,
          android: `geo:0,0?q=${encodedAddress}`,
        }) || `https://maps.google.com/?q=${encodedAddress}`;
    } else {
      return; // No location data available
    }

    Linking.openURL(url).catch(() => {
      // Silently handle errors
    });
  }, [selectedMatch]);

  // Compute isCreator early for hasAnyBadges check (must be before early return for hooks rules)
  const isCreatorEarly = playerId === selectedMatch?.created_by;

  // Check if any badges should be displayed (must be before early return for hooks rules)
  const hasAnyBadges = useMemo(() => {
    if (!selectedMatch) return false;
    return (
      selectedMatch.court_status === 'reserved' ||
      (selectedMatch.player_expectation && selectedMatch.player_expectation !== 'both') ||
      (selectedMatch.min_rating_score && selectedMatch.min_rating_score.label) ||
      !!selectedMatch.preferred_opponent_gender ||
      selectedMatch.join_mode === 'request' ||
      (isCreatorEarly && !!selectedMatch.visibility) // Show visibility badge for creators
    );
  }, [selectedMatch, isCreatorEarly]);

  // Compute match status for animation (must be before early return for hooks rules)
  const derivedStatusForAnimation = useMemo(() => {
    if (!selectedMatch) return null;
    return deriveMatchStatus({
      cancelled_at: selectedMatch.cancelled_at,
      match_date: selectedMatch.match_date,
      start_time: selectedMatch.start_time,
      end_time: selectedMatch.end_time,
      timezone: selectedMatch.timezone,
      result: selectedMatch.result,
    });
  }, [selectedMatch]);

  const isUrgentForAnimation = useMemo(() => {
    if (!selectedMatch) return false;
    const { isUrgent } = getRelativeTimeDisplay(
      selectedMatch.match_date,
      selectedMatch.start_time,
      selectedMatch.end_time,
      selectedMatch.timezone,
      locale,
      t
    );
    return isUrgent;
  }, [selectedMatch, locale, t]);

  const isOngoingForAnimation = derivedStatusForAnimation === 'in_progress';
  const isStartingSoonForAnimation = isUrgentForAnimation && !isOngoingForAnimation;

  // Start animation when match is urgent or ongoing (must be before early return for hooks rules)
  React.useEffect(() => {
    if (isOngoingForAnimation || isStartingSoonForAnimation) {
      const animationDuration = isOngoingForAnimation ? duration.extraSlow : duration.verySlow;
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
  }, [isOngoingForAnimation, isStartingSoonForAnimation, urgentPulseAnimation]);

  // Animation interpolations (must be before early return for hooks rules)
  const liveRingScale = urgentPulseAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.5],
  });

  const liveRingOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.8, 0.4, 0],
  });

  const liveDotOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.7, 1],
  });

  const countdownBounce = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 3, 0],
  });

  const countdownOpacity = urgentPulseAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.6, 1, 0.6],
  });

  // Render nothing if no match is selected
  if (!selectedMatch) {
    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        index={0}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        onDismiss={handleSheetDismiss}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      >
        <View style={styles.emptyContent} />
      </BottomSheetModal>
    );
  }

  // Computed values
  const match = selectedMatch;
  const participantInfo = getParticipantInfo(match);

  // Determine match tier and get tier-specific accent colors
  const creatorReputationScore = match.created_by_player?.reputation_score;
  const tier = getMatchTier(match.court_status, creatorReputationScore);

  // All tiers use primary accent colors (tier differentiation is via ribbon badge on cards)
  const tierAccent = isDark ? primary[400] : primary[500];
  const tierAccentLight = isDark ? primary[700] : primary[200];

  // Live/urgent indicator colors
  const liveColor = isDark ? secondary[400] : secondary[500];
  const soonColor = isDark ? accent[400] : accent[500];

  const { label: timeLabel, isUrgent } = getRelativeTimeDisplay(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone,
    locale,
    t
  );
  const distanceDisplay = formatDistance(match.distance_meters);
  const creatorProfile = match.created_by_player?.profile;
  const creatorName =
    `${creatorProfile?.first_name || ''} ${creatorProfile?.last_name || ''}`.trim() ||
    creatorProfile?.display_name ||
    t('matchDetail.host');
  const isFull = participantInfo.spotsLeft === 0;
  const isCreator = playerId === match.created_by;
  // Check if user is an active participant (not left, declined, refused, or kicked)
  // Note: 'pending' (invited by host) is NOT included - invited players should see regular CTAs
  const activeStatuses = ['joined', 'requested', 'waitlisted'];
  const isParticipant =
    match.participants?.some(
      p => p.player_id === playerId && activeStatuses.includes(p.status ?? '')
    ) || isCreator;
  // Check if user has a pending join request (for showing "Cancel Request" button)
  const hasPendingRequest = match.participants?.some(
    p => p.player_id === playerId && p.status === 'requested'
  );
  // Check if user is invited by host (pending status = invitation awaiting response)
  const isInvited = match.participants?.some(
    p => p.player_id === playerId && p.status === 'pending'
  );
  // Check if user is waitlisted (for showing waitlisted banner)
  const isWaitlisted = match.participants?.some(
    p => p.player_id === playerId && p.status === 'waitlisted'
  );

  // Derive match status from attributes instead of using denormalized status field
  const derivedStatus = deriveMatchStatus({
    cancelled_at: match.cancelled_at,
    match_date: match.match_date,
    start_time: match.start_time,
    end_time: match.end_time,
    timezone: match.timezone,
    result: match.result,
  });
  const isCancelled = derivedStatus === 'cancelled';
  const isInProgress = derivedStatus === 'in_progress';
  const hasMatchEnded = derivedStatus === 'completed';
  const hasResult = !!match.result;

  // Check if match is expired (started or ended but not full)
  const isExpired = (isInProgress || hasMatchEnded) && !isFull;

  // Determine animation type for time indicator:
  // - isInProgress = live indicator
  // - isUrgent (< 3 hours) but not in_progress = starting soon
  const isOngoing = derivedStatus === 'in_progress';
  const isStartingSoon = isUrgent && !isOngoing;

  // Check if start time has passed
  const startTimeDiffMs = getTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.timezone
  );
  const hasStartTimePassed = startTimeDiffMs < 0;

  // Check if we're within 24h of match start (to prevent kicking players)
  const cannotKickWithin24h = isWithin24HoursOfStart(match);

  // Feedback window status (48h after end time)
  const { isWithinFeedbackWindow } = getFeedbackWindowStatus(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone
  );

  // Check if current player is a joined participant who hasn't completed feedback yet
  const currentPlayerParticipant = match.participants?.find(
    p => p.player_id === playerId && p.status === 'joined'
  );
  const playerHasCompletedFeedback = currentPlayerParticipant?.feedback_completed ?? false;
  const playerNeedsFeedback =
    hasMatchEnded &&
    isWithinFeedbackWindow &&
    currentPlayerParticipant &&
    !playerHasCompletedFeedback;

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
  // Also requires location permission to be granted for geolocation verification
  const locationAllowsCheckIn =
    match.location_type === 'facility' || match.location_type === 'custom';
  const hasLocationPermission = locationPermission === 'granted';
  const playerNeedsCheckIn =
    isFull &&
    isWithinCheckInWindow &&
    currentPlayerParticipant &&
    !playerHasCheckedIn &&
    locationAllowsCheckIn &&
    hasLocationPermission;

  // Build participant avatars list
  const participantAvatars: Array<{
    key: string;
    participantId?: string;
    playerId?: string;
    avatarUrl?: string | null;
    isHost: boolean;
    isEmpty: boolean;
    name?: string;
    isCheckedIn?: boolean;
  }> = [];

  // Get joined participants and identify host using is_host flag
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const hostParticipant = joinedParticipants.find(p => p.is_host);
  const otherJoinedParticipants = joinedParticipants.filter(p => !p.is_host);

  // Host first - use host participant's profile, fallback to created_by_player for backwards compatibility
  const hostProfile = hostParticipant?.player?.profile ?? creatorProfile;
  const hostName =
    hostProfile?.display_name ||
    (hostProfile?.first_name && hostProfile?.last_name
      ? `${hostProfile.first_name} ${hostProfile.last_name}`
      : hostProfile?.first_name) ||
    creatorName;
  participantAvatars.push({
    key: 'host',
    avatarUrl: getProfilePictureUrl(hostProfile?.profile_picture_url),
    playerId: match.created_by,
    isHost: true,
    isEmpty: false,
    name: hostName.split(' ')[0],
    isCheckedIn: !!hostParticipant?.checked_in_at,
  });

  // Other participants (joined, excluding host)
  // Normalize URLs to use current environment's Supabase URL
  otherJoinedParticipants.forEach((p, i) => {
    const participantFullName =
      p.player?.profile?.display_name ||
      (p.player?.profile?.first_name && p.player?.profile?.last_name
        ? `${p.player.profile.first_name} ${p.player.profile.last_name}`
        : p.player?.profile?.first_name) ||
      '';
    const participantFirstName = participantFullName.split(' ')[0];
    participantAvatars.push({
      key: p.id || `participant-${i}`,
      participantId: p.id,
      playerId: p.player_id,
      avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
      isHost: false,
      isEmpty: false,
      name: participantFirstName,
      isCheckedIn: !!p.checked_in_at,
    });
  });

  // Empty slots
  for (let i = 0; i < participantInfo.spotsLeft; i++) {
    participantAvatars.push({
      key: `empty-${i}`,
      avatarUrl: null,
      isHost: false,
      isEmpty: true,
    });
  }

  // Pending join requests (for host to accept/reject)
  // Normalize URLs to use current environment's Supabase URL
  const pendingRequests =
    match.participants
      ?.filter(p => p.status === 'requested')
      .map(p => {
        const fullName =
          `${p.player?.profile?.first_name || ''} ${p.player?.profile?.last_name || ''}`.trim() ||
          p.player?.profile?.display_name ||
          t('matchDetail.host');
        // Get sport rating info if available (label and value)
        const playerWithRating = p.player as PlayerWithProfile | undefined;
        const ratingLabel = playerWithRating?.sportRatingLabel;
        const ratingValue = playerWithRating?.sportRatingValue;
        // Display value if available, otherwise fall back to label
        const ratingDisplay =
          ratingValue !== undefined && ratingValue !== null ? ratingValue.toFixed(1) : ratingLabel;
        return {
          id: p.id,
          playerId: p.player_id,
          name: fullName.split(' ')[0], // Show only first name
          avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
          ratingLabel,
          ratingValue,
          ratingDisplay,
          participant: p as MatchParticipantWithPlayer, // Store full participant for modal
        };
      }) ?? [];

  // Pending invitations (host sent invite, awaiting response) - for host only
  const pendingInvitations =
    match.participants
      ?.filter(p => p.status === 'pending')
      .map(p => {
        const fullName =
          `${p.player?.profile?.first_name || ''} ${p.player?.profile?.last_name || ''}`.trim() ||
          p.player?.profile?.display_name ||
          t('matchDetail.host');
        return {
          id: p.id,
          playerId: p.player_id,
          name: fullName.split(' ')[0], // Show only first name
          fullName,
          avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
        };
      }) ?? [];

  // Declined invitations (invitee declined) - for host only
  const declinedInvitations =
    match.participants
      ?.filter(p => p.status === 'declined')
      .map(p => {
        const fullName =
          `${p.player?.profile?.first_name || ''} ${p.player?.profile?.last_name || ''}`.trim() ||
          p.player?.profile?.display_name ||
          t('matchDetail.host');
        return {
          id: p.id,
          playerId: p.player_id,
          name: fullName.split(' ')[0], // Show only first name
          fullName,
          avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
        };
      }) ?? [];

  // Combined invitations for display
  const allInvitations = [...pendingInvitations, ...declinedInvitations];

  // Cost display
  const costDisplay = match.is_court_free
    ? t('matchDetail.free')
    : match.estimated_cost
      ? `$${Math.ceil(match.estimated_cost / participantInfo.total)} ${t('matchDetail.perPerson')}`
      : null;

  // Location display
  const facilityName = match.facility?.name || match.location_name;
  const courtName = match.court?.name;
  const address = match.facility?.address || match.location_address;

  // Determine action button(s)
  // Logic priority:
  // 1. Match has results → Show "View Results" info (no actions)
  // 2. Match has ended (no results) → Show "Match Ended" info (no actions)
  // 3. Creator (match not ended) → Edit + Cancel buttons
  // 4. Participant (match not ended) → Leave button
  // 5. Match is full → Disabled "Full" button
  // 6. Request mode → "Request to Join" button
  // 7. Default → "Join Now" button
  const renderActionButtons = () => {
    // CTA colors matching MatchCreationWizard (nextButton): same buttonActive / primary as wizard
    // - Positive (Join/Check-in/Feedback): primary (teal) – primary[500] dark / primary[600] light
    // - Destructive (Leave/Cancel): secondary (coral)
    // - Edit: accent (amber)
    // - Pending/Waitlisted: neutral bg with secondary text
    const ctaPositive = isDark ? primary[500] : primary[600];
    const ctaDestructive = isDark ? secondary[400] : secondary[500];
    const ctaAccent = isDark ? accent[400] : accent[500];

    // Prepare theme colors for Button component – match MatchCreationWizard nextButton
    const successThemeColors = {
      primary: ctaPositive,
      primaryForeground: base.white,
      buttonActive: ctaPositive,
      buttonInactive: neutral[300],
      buttonTextActive: base.white,
      buttonTextInactive: neutral[500],
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      background: colors.cardBackground,
    };

    // Accent theme colors for edit actions
    const accentThemeColors = {
      primary: ctaAccent,
      primaryForeground: base.white,
      buttonActive: ctaAccent,
      buttonInactive: neutral[300],
      buttonTextActive: base.white,
      buttonTextInactive: neutral[500],
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      background: colors.cardBackground,
    };

    // Destructive button theme colors for cancel/leave - secondary (coral)
    const destructiveThemeColors = {
      primary: ctaDestructive,
      primaryForeground: base.white,
      buttonActive: ctaDestructive,
      buttonInactive: neutral[300],
      buttonTextActive: base.white,
      buttonTextInactive: neutral[500],
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      background: colors.cardBackground,
    };

    // Warning/pending state theme colors - neutral bg with secondary text (matching MatchCard)
    const warningThemeColors = {
      primary: ctaDestructive,
      primaryForeground: base.white,
      buttonActive: isDark ? neutral[700] : neutral[200],
      buttonInactive: neutral[300],
      buttonTextActive: ctaDestructive,
      buttonTextInactive: neutral[500],
      text: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
      background: colors.cardBackground,
    };

    // Match is cancelled → Show cancelled info, no actions available
    if (isCancelled) {
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
          <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
            {t('matchDetail.matchCancelled')}
          </Text>
        </View>
      );
    }

    // Match has results → Show "Match completed" unless current player still needs to give feedback
    if (hasResult && match.result) {
      if (isWithinFeedbackWindow && playerNeedsFeedback && currentPlayerParticipant) {
        return (
          <Button
            variant="primary"
            onPress={() => {
              mediumHaptic();
              const opponents: OpponentForFeedback[] = (match.participants ?? [])
                .filter(p => p.player_id !== playerId && p.status === 'joined')
                .map(p => {
                  const profile = p.player?.profile;
                  const firstName = profile?.first_name || '';
                  const lastName = profile?.last_name || '';
                  const displayName = profile?.display_name;
                  const name = displayName || firstName || 'Player';
                  const fullName = displayName || `${firstName} ${lastName}`.trim() || 'Player';
                  return {
                    participantId: p.id,
                    playerId: p.player_id,
                    name,
                    fullName,
                    avatarUrl: profile?.profile_picture_url || null,
                    hasExistingFeedback: false,
                  };
                });
              openFeedbackSheet(match.id, playerId!, currentPlayerParticipant.id, opponents);
            }}
            style={styles.actionButton}
            themeColors={successThemeColors}
            isDark={isDark}
            leftIcon={<Ionicons name="star-outline" size={18} color={base.white} />}
          >
            {t('matchDetail.provideFeedback')}
          </Button>
        );
      }
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="trophy-outline" size={20} color={colors.textMuted} />
          <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
            {t('matchDetail.matchCompleted')}
          </Text>
        </View>
      );
    }

    // Match is expired - start time passed but not full
    if ((isInProgress || hasMatchEnded) && !isFull) {
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="time-outline" size={20} color={colors.textMuted} />
          <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
            {t('matchDetail.matchExpired')}
          </Text>
        </View>
      );
    }

    // Match has ended - show feedback CTA or completion status based on conditions
    if (hasMatchEnded) {
      // Within 48h window
      if (isWithinFeedbackWindow) {
        // No result yet + participant + full → Show Register score (and optionally Provide Feedback)
        if (!hasResult && currentPlayerParticipant && isFull) {
          return (
            <>
              <Button
                variant="primary"
                onPress={handleRegisterScore}
                style={styles.actionButton}
                themeColors={successThemeColors}
                isDark={isDark}
                leftIcon={<Ionicons name="trophy-outline" size={18} color={base.white} />}
              >
                {t('matchDetail.registerScore')}
              </Button>
              {playerNeedsFeedback && (
                <Button
                  variant="primary"
                  onPress={() => {
                    mediumHaptic();
                    const opponents: OpponentForFeedback[] = (match.participants ?? [])
                      .filter(p => p.player_id !== playerId && p.status === 'joined')
                      .map(p => {
                        const profile = p.player?.profile;
                        const firstName = profile?.first_name || '';
                        const lastName = profile?.last_name || '';
                        const displayName = profile?.display_name;
                        const name = displayName || firstName || 'Player';
                        const fullName =
                          displayName || `${firstName} ${lastName}`.trim() || 'Player';
                        return {
                          participantId: p.id,
                          playerId: p.player_id,
                          name,
                          fullName,
                          avatarUrl: profile?.profile_picture_url || null,
                          hasExistingFeedback: false,
                        };
                      });
                    openFeedbackSheet(match.id, playerId!, currentPlayerParticipant.id, opponents);
                  }}
                  style={styles.actionButton}
                  themeColors={successThemeColors}
                  isDark={isDark}
                  leftIcon={<Ionicons name="star-outline" size={18} color={base.white} />}
                >
                  {t('matchDetail.provideFeedback')}
                </Button>
              )}
            </>
          );
        }
        // Current player needs to provide feedback (but can't register score) → Show CTA button
        if (playerNeedsFeedback && currentPlayerParticipant) {
          return (
            <Button
              variant="primary"
              onPress={() => {
                mediumHaptic();
                const opponents: OpponentForFeedback[] = (match.participants ?? [])
                  .filter(p => p.player_id !== playerId && p.status === 'joined')
                  .map(p => {
                    const profile = p.player?.profile;
                    const firstName = profile?.first_name || '';
                    const lastName = profile?.last_name || '';
                    const displayName = profile?.display_name;
                    const name = displayName || firstName || 'Player';
                    const fullName = displayName || `${firstName} ${lastName}`.trim() || 'Player';
                    return {
                      participantId: p.id,
                      playerId: p.player_id,
                      name,
                      fullName,
                      avatarUrl: profile?.profile_picture_url || null,
                      hasExistingFeedback: false,
                    };
                  });
                openFeedbackSheet(match.id, playerId!, currentPlayerParticipant.id, opponents);
              }}
              style={styles.actionButton}
              themeColors={successThemeColors}
              isDark={isDark}
              leftIcon={<Ionicons name="star-outline" size={18} color={base.white} />}
            >
              {t('matchDetail.provideFeedback')}
            </Button>
          );
        }
        // Feedback completed or not a participant → Show "completed" message
        return (
          <View style={styles.matchEndedContainer}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.textMuted} />
            <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
              {t('matchDetail.matchCompleted')}
            </Text>
          </View>
        );
      }

      // Past 48h window → Show "closed" message
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
          <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
            {t('matchDetail.matchClosed')}
          </Text>
        </View>
      );
    }

    // Check-in window (10 min before start until end, full game only)
    // Show check-in CTA if player hasn't checked in, otherwise show "in progress"
    if (playerNeedsCheckIn) {
      return (
        <CheckInButton
          playerId={playerId}
          matchId={selectedMatch?.id}
          checkIn={checkIn}
          isCheckingIn={isCheckingIn}
          successThemeColors={successThemeColors}
          isDark={isDark}
          t={t}
        />
      );
    }

    // Match is in progress → Show in-progress info, limited actions
    if (isInProgress) {
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="play-circle-outline" size={20} color={status.warning.DEFAULT} />
          <Text
            size="sm"
            weight="medium"
            color={status.warning.DEFAULT}
            style={styles.matchEndedText}
          >
            {t('matchDetail.matchInProgress')}
          </Text>
        </View>
      );
    }

    // Creator has checked in but game hasn't started yet → Show "You are checked-in"
    if (isCreator && playerHasCheckedIn && !isInProgress && !hasMatchEnded) {
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="checkmark-circle" size={20} color={ctaPositive} />
          <Text size="sm" weight="medium" color={ctaPositive} style={styles.matchEndedText}>
            {t('matchDetail.checkedIn')}
          </Text>
        </View>
      );
    }

    // Host: Edit + Cancel buttons (only if match hasn't ended and creator hasn't checked in)
    if (isCreator) {
      return (
        <>
          <Button
            variant="primary"
            onPress={handleEditMatch}
            style={styles.actionButton}
            themeColors={accentThemeColors}
            isDark={isDark}
            leftIcon={<Ionicons name="create-outline" size={18} color={base.white} />}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="primary"
            onPress={handleCancelMatch}
            style={styles.cancelButton}
            themeColors={destructiveThemeColors}
            isDark={isDark}
            loading={isCancelling}
            leftIcon={<Ionicons name="close-circle-outline" size={18} color={base.white} />}
          >
            {t('matches.cancelMatch')}
          </Button>
        </>
      );
    }

    // User has pending request: Cancel Request button (warning accent, disabled look)
    if (hasPendingRequest) {
      return (
        <Button
          variant="primary"
          onPress={handleCancelRequest}
          style={styles.actionButton}
          themeColors={warningThemeColors}
          isDark={isDark}
          loading={isCancellingRequest}
          leftIcon={<Ionicons name="close-outline" size={18} color={ctaDestructive} />}
        >
          {t('matchActions.cancelRequest')}
        </Button>
      );
    }

    // User is invited (pending status) to direct-join match with spots: Accept Invitation button (success green)
    // For request-mode or full matches, invited users see regular CTAs (Ask to Join / Join Waitlist)
    if (isInvited && !isFull && match.join_mode !== 'request') {
      return (
        <Button
          variant="primary"
          onPress={handleJoinMatch}
          style={styles.actionButton}
          themeColors={successThemeColors}
          isDark={isDark}
          loading={isJoining}
          disabled={isJoining}
          leftIcon={<Ionicons name="checkmark-circle-outline" size={18} color={base.white} />}
        >
          {t('match.cta.acceptInvitation')}
        </Button>
      );
    }

    // Waitlisted user: Show Leave Waitlist only if match is still full (warning accent)
    if (isWaitlisted && isFull) {
      return (
        <Button
          variant="primary"
          onPress={handleLeaveMatch}
          style={styles.actionButton}
          themeColors={warningThemeColors}
          isDark={isDark}
          loading={isLeaving}
          leftIcon={<Ionicons name="exit-outline" size={18} color={ctaDestructive} />}
        >
          {t('matchActions.leaveWaitlist')}
        </Button>
      );
    }

    // Waitlisted user and spot opened up: Show Join/Request button (success green)
    if (isWaitlisted && !isFull) {
      if (match.join_mode === 'request') {
        return (
          <Button
            variant="primary"
            onPress={handleJoinMatch}
            style={styles.actionButton}
            themeColors={successThemeColors}
            isDark={isDark}
            loading={isJoining}
            disabled={isJoining}
            leftIcon={<Ionicons name="hand-left-outline" size={18} color={base.white} />}
          >
            {t('matchDetail.requestToJoin')}
          </Button>
        );
      }
      // Direct join
      return (
        <Button
          variant="primary"
          onPress={handleJoinMatch}
          style={styles.actionButton}
          themeColors={successThemeColors}
          isDark={isDark}
          loading={isJoining}
          disabled={isJoining}
          leftIcon={<Ionicons name="add-circle-outline" size={18} color={base.white} />}
        >
          {t('matchDetail.joinNow')}
        </Button>
      );
    }

    // Participant has checked in but game hasn't started yet → Show "Checked-in" text
    if (isParticipant && playerHasCheckedIn && !isInProgress) {
      return (
        <View style={styles.matchEndedContainer}>
          <Ionicons name="checkmark-circle" size={20} color={ctaPositive} />
          <Text size="sm" weight="medium" color={ctaPositive} style={styles.matchEndedText}>
            {t('matchDetail.checkedIn')}
          </Text>
        </View>
      );
    }

    // Participant (not host, joined): Leave button (danger red)
    if (isParticipant) {
      return (
        <Button
          variant="primary"
          onPress={handleLeaveMatch}
          style={styles.actionButton}
          themeColors={destructiveThemeColors}
          isDark={isDark}
          loading={isLeaving}
          leftIcon={<Ionicons name="log-out-outline" size={18} color={base.white} />}
        >
          {t('matches.leaveMatch')}
        </Button>
      );
    }

    // Match is full - offer to join waitlist (success green)
    if (isFull) {
      return (
        <Button
          variant="primary"
          onPress={handleJoinMatch}
          style={styles.actionButton}
          themeColors={successThemeColors}
          isDark={isDark}
          loading={isJoining}
          disabled={isJoining}
          leftIcon={<Ionicons name="list-outline" size={18} color={base.white} />}
        >
          {t('matchActions.joinWaitlist')}
        </Button>
      );
    }

    // Request to join mode (success green)
    if (match.join_mode === 'request') {
      return (
        <Button
          variant="primary"
          onPress={handleJoinMatch}
          style={styles.actionButton}
          themeColors={successThemeColors}
          isDark={isDark}
          loading={isJoining}
          disabled={isJoining}
          leftIcon={<Ionicons name="hand-left-outline" size={18} color={base.white} />}
        >
          {t('matchDetail.requestToJoin')}
        </Button>
      );
    }

    // Direct join (success green)
    return (
      <Button
        variant="primary"
        onPress={handleJoinMatch}
        style={styles.actionButton}
        themeColors={successThemeColors}
        isDark={isDark}
        loading={isJoining}
        disabled={isJoining}
        leftIcon={<Ionicons name="add-circle-outline" size={18} color={base.white} />}
      >
        {t('matchDetail.joinNow')}
      </Button>
    );
  };

  // Check if location is tappable (has coordinates or address)
  const hasLocationData = !!(
    match.facility?.latitude ||
    match.facility?.address ||
    match.location_address
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      onDismiss={handleSheetDismiss}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
    >
      {/* Header with close button */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleSection}>
            {/* Match Date/Time - same format as cards with live/urgent indicators */}
            <View style={styles.dateRow}>
              {/* "Live" indicator for ongoing matches (not shown when expired) */}
              {isOngoing && !isExpired && (
                <View style={styles.liveIndicatorContainer}>
                  {/* Expanding ring that fades out */}
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
                  {/* Solid core dot */}
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
                  <Ionicons name="chevron-forward" size={16} color={soonColor} />
                </Animated.View>
              )}
              <Ionicons
                name={
                  isExpired
                    ? 'close-circle-outline'
                    : isOngoing
                      ? 'radio'
                      : isStartingSoon
                        ? 'time'
                        : 'calendar-outline'
                }
                size={20}
                color={
                  isExpired
                    ? colors.textMuted
                    : isOngoing
                      ? liveColor
                      : isStartingSoon
                        ? soonColor
                        : tierAccent
                }
                style={styles.calendarIcon}
              />
              <Text
                size="xl"
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
              >
                {timeLabel}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleCloseSheet}
              style={styles.closeButton}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <BottomSheetScrollView
        style={styles.sheetContent}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Pending Request Banner - shown to requesters with pending status */}
        {hasPendingRequest && !isCreator && (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: status.warning.DEFAULT + '15',
                borderColor: status.warning.DEFAULT,
              },
            ]}
          >
            <Ionicons name="time-outline" size={18} color={status.warning.DEFAULT} />
            <Text
              size="sm"
              weight="medium"
              color={status.warning.DEFAULT}
              style={styles.pendingBannerText}
            >
              {t('matchActions.requestPending')}
            </Text>
          </View>
        )}

        {/* Waitlisted Banner - shown to waitlisted users */}
        {isWaitlisted && !isCreator && (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: isFull
                  ? status.info.DEFAULT + '15'
                  : (isDark ? primary[400] : primary[500]) + '15',
                borderColor: isFull ? status.info.DEFAULT : isDark ? primary[400] : primary[500],
              },
            ]}
          >
            <Ionicons
              name={isFull ? 'list-outline' : 'checkmark-circle-outline'}
              size={18}
              color={isFull ? status.info.DEFAULT : isDark ? primary[400] : primary[500]}
            />
            <Text
              size="sm"
              weight="medium"
              color={isFull ? status.info.DEFAULT : isDark ? primary[400] : primary[500]}
              style={styles.pendingBannerText}
            >
              {isFull ? t('matchActions.waitlistedInfo') : t('matchActions.spotOpenedUp')}
            </Text>
          </View>
        )}

        {/* Match Info Grid - Moved up for context */}
        {hasAnyBadges && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="information-circle-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.title')}
              </Text>
            </View>
            <View style={styles.badgesGrid}>
              {/* Min rating - secondary (coral) */}
              {match.min_rating_score && match.min_rating_score.label && (
                <Badge
                  label={match.min_rating_score.label}
                  bgColor={isDark ? `${secondary[400]}30` : `${secondary[500]}15`}
                  textColor={isDark ? secondary[400] : secondary[500]}
                  icon="analytics"
                />
              )}

              {/* Court Booked badge - accent (gold) */}
              {(tier === 'mostWanted' || tier === 'readyToPlay') && (
                <Badge
                  label={t('match.courtStatus.courtBooked')}
                  bgColor={isDark ? `${accent[400]}30` : `${accent[500]}15`}
                  textColor={isDark ? accent[400] : accent[500]}
                  icon="checkmark-circle"
                />
              )}

              {/* Player expectation - primary (cyan) */}
              {match.player_expectation && match.player_expectation !== 'both' && (
                <Badge
                  label={
                    match.player_expectation === 'competitive'
                      ? t('matchDetail.competitive')
                      : t('matchDetail.casual')
                  }
                  bgColor={isDark ? `${primary[400]}30` : `${primary[500]}15`}
                  textColor={isDark ? primary[400] : primary[500]}
                  icon={match.player_expectation === 'competitive' ? 'trophy' : 'happy'}
                />
              )}

              {/* Gender preference - neutral style for filter info */}
              {match.preferred_opponent_gender && (
                <Badge
                  label={
                    match.preferred_opponent_gender === 'male'
                      ? t('match.gender.menOnly')
                      : match.preferred_opponent_gender === 'female'
                        ? t('match.gender.womenOnly')
                        : t('match.gender.other')
                  }
                  bgColor={isDark ? neutral[800] : neutral[100]}
                  textColor={isDark ? neutral[300] : neutral[600]}
                  icon={match.preferred_opponent_gender === 'male' ? 'male' : 'female'}
                />
              )}

              {/* Join mode - primary (cyan) */}
              {match.join_mode === 'request' && (
                <Badge
                  label={t('match.joinMode.request')}
                  bgColor={isDark ? `${primary[400]}30` : `${primary[500]}15`}
                  textColor={isDark ? primary[400] : primary[500]}
                  icon="hand-left"
                />
              )}

              {/* Visibility badge - only visible to creator */}
              {isCreator && match.visibility && (
                <Badge
                  label={
                    match.visibility === 'public'
                      ? t('matchCreation.fields.visibilityPublic')
                      : t('matchCreation.fields.visibilityPrivate')
                  }
                  bgColor={
                    match.visibility === 'public'
                      ? isDark
                        ? `${primary[400]}25`
                        : `${primary[500]}15`
                      : isDark
                        ? `${neutral[600]}40`
                        : `${neutral[500]}20`
                  }
                  textColor={
                    match.visibility === 'public'
                      ? isDark
                        ? primary[400]
                        : primary[600]
                      : isDark
                        ? neutral[300]
                        : neutral[600]
                  }
                  icon={match.visibility === 'public' ? 'globe-outline' : 'lock-closed'}
                />
              )}
            </View>
          </View>
        )}

        {/* Participants Section - with host inline (marked with star) */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderTitleRow}>
              <Ionicons name="people-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.participants')} ({participantInfo.current}/{participantInfo.total})
              </Text>
            </View>
            {currentPlayerParticipant && matchConversationId && (
              <TouchableOpacity
                onPress={handleOpenChat}
                style={styles.participantsSectionChatButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chatbubble-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.participantsRow}>
            {participantAvatars.map((p, _index) => (
              <View key={p.key} style={styles.participantWithLabel}>
                <View style={styles.participantAvatarWithAction}>
                  <TouchableOpacity
                    onPress={() => {
                      if (!p.isEmpty && p.playerId) {
                        handleParticipantProfilePress(p.playerId);
                      }
                    }}
                    activeOpacity={p.isEmpty ? 1 : 0.7}
                    disabled={p.isEmpty}
                  >
                    <ParticipantAvatar
                      avatarUrl={p.avatarUrl}
                      isHost={p.isHost}
                      isEmpty={p.isEmpty}
                      isCheckedIn={p.isCheckedIn}
                      colors={colors}
                      isDark={isDark}
                      tierAccent={tierAccent}
                      tierAccentLight={tierAccentLight}
                    />
                  </TouchableOpacity>
                  {/* Kick button for host to remove joined participants (not for host avatar, not for empty slots, not if match ended, in progress, or within 24h of start) */}
                  {isCreator &&
                    !p.isHost &&
                    !p.isEmpty &&
                    p.participantId &&
                    !hasMatchEnded &&
                    !isInProgress &&
                    !cannotKickWithin24h && (
                      <TouchableOpacity
                        style={[
                          styles.kickButton,
                          { backgroundColor: isDark ? secondary[400] : secondary[500] },
                        ]}
                        onPress={() => handleKickParticipant(p.participantId!)}
                        disabled={isKicking}
                        activeOpacity={0.7}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Ionicons name="close-outline" size={10} color={base.white} />
                      </TouchableOpacity>
                    )}
                </View>
                {/* Show name for all non-empty participants */}
                {!p.isEmpty && p.name && (
                  <Text
                    size="xs"
                    color={colors.textMuted}
                    style={styles.participantLabel}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                )}
              </View>
            ))}
          </View>
          {participantInfo.spotsLeft > 0 && (
            <Text size="sm" weight="medium" color={colors.statusOpen} style={styles.spotsText}>
              {participantInfo.spotsLeft === 1
                ? t('match.slots.oneLeft')
                : t('match.slots.left', { count: participantInfo.spotsLeft })}
            </Text>
          )}

          {/* Invite Players Button - only visible to host when spots available and match not ended or in progress */}
          {isCreator &&
            participantInfo.spotsLeft > 0 &&
            !hasMatchEnded &&
            !isCancelled &&
            !isInProgress && (
              <TouchableOpacity
                style={[
                  styles.invitePlayersButton,
                  {
                    backgroundColor: colors.primaryLight,
                    borderColor: colors.primary,
                  },
                ]}
                onPress={handleInvitePlayers}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add" size={18} color={colors.primary} />
                <Text
                  size="sm"
                  weight="medium"
                  color={colors.primary}
                  style={styles.inviteButtonText}
                >
                  {t('matchCreation.invite.title')}
                </Text>
              </TouchableOpacity>
            )}

          {/* Pending Requests Section - only visible to host */}
          {isCreator && pendingRequests.length > 0 && !isCancelled && !hasStartTimePassed && (
            <View style={styles.pendingRequestsSection}>
              <View style={styles.pendingRequestsHeader}>
                <Text
                  size="sm"
                  weight="semibold"
                  color={colors.secondary}
                  style={styles.pendingRequestsTitle}
                >
                  {t('matchActions.pendingRequests')} ({pendingRequests.length})
                </Text>
                {isFull && (
                  <View
                    style={[styles.matchFullBadge, { backgroundColor: status.info.DEFAULT + '20' }]}
                  >
                    <Ionicons name="information-circle" size={12} color={status.info.DEFAULT} />
                    <Text
                      size="xs"
                      weight="medium"
                      color={status.info.DEFAULT}
                      style={styles.matchFullBadgeText}
                    >
                      {t('matchActions.matchFullCannotAccept')}
                    </Text>
                  </View>
                )}
                {isInProgress && (
                  <View
                    style={[
                      styles.matchFullBadge,
                      { backgroundColor: status.warning.DEFAULT + '20' },
                    ]}
                  >
                    <Ionicons name="play-circle-outline" size={12} color={status.warning.DEFAULT} />
                    <Text
                      size="xs"
                      weight="medium"
                      color={status.warning.DEFAULT}
                      style={styles.matchFullBadgeText}
                    >
                      {t('matchDetail.matchInProgress')}
                    </Text>
                  </View>
                )}
              </View>
              {(showAllRequests ? pendingRequests : pendingRequests.slice(0, 3)).map(request => (
                <View
                  key={request.id}
                  style={[
                    styles.pendingRequestInfo,
                    {
                      backgroundColor: themeColors.muted,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radiusPixels.md,
                      paddingHorizontal: spacingPixels[3],
                      paddingVertical: spacingPixels[2.5],
                    },
                  ]}
                >
                  <View style={styles.pendingRequestContent}>
                    <View
                      style={[styles.pendingRequestAvatar, { backgroundColor: colors.primary }]}
                    >
                      {request.avatarUrl ? (
                        <Image
                          source={{ uri: request.avatarUrl }}
                          style={styles.pendingRequestAvatarImage}
                        />
                      ) : (
                        <Ionicons name="person-outline" size={16} color={base.white} />
                      )}
                    </View>
                    <View style={styles.pendingRequestNameContainer}>
                      <Text
                        size="sm"
                        weight="medium"
                        color={colors.text}
                        numberOfLines={1}
                        style={styles.pendingRequestName}
                      >
                        {request.name}
                      </Text>
                      {request.ratingDisplay && (
                        <View
                          style={[
                            styles.pendingRequestRatingBadge,
                            { backgroundColor: colors.primaryLight },
                          ]}
                        >
                          <Ionicons
                            name="analytics"
                            size={10}
                            color={colors.primary}
                            style={styles.pendingRequestRatingIcon}
                          />
                          <Text size="xs" weight="medium" color={colors.primary}>
                            {request.ratingDisplay}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.pendingRequestActions}>
                    <TouchableOpacity
                      style={[styles.viewDetailsButton, { backgroundColor: colors.primaryLight }]}
                      onPress={() =>
                        request.participant && handleViewRequesterDetails(request.participant)
                      }
                      activeOpacity={0.7}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    >
                      <Ionicons name="eye-outline" size={18} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.requestActionButton,
                        styles.acceptButton,
                        {
                          backgroundColor:
                            acceptingRequestId === request.id || isFull || isInProgress
                              ? neutral[400]
                              : isDark
                                ? primary[400]
                                : primary[500],
                        },
                      ]}
                      onPress={() => request.id && handleAcceptRequest(request.id)}
                      disabled={
                        acceptingRequestId === request.id || isRejecting || isFull || isInProgress
                      }
                      activeOpacity={0.7}
                    >
                      <Ionicons name="checkmark-outline" size={18} color={base.white} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.requestActionButton,
                        styles.rejectButton,
                        { backgroundColor: isDark ? secondary[400] : secondary[500] },
                      ]}
                      onPress={() => request.id && handleRejectRequest(request.id)}
                      disabled={isAccepting || isRejecting}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close-outline" size={18} color={base.white} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {/* Show more/less toggle when there are more than 3 requests */}
              {pendingRequests.length > 3 && (
                <TouchableOpacity
                  style={styles.showMoreButton}
                  onPress={() => {
                    lightHaptic();
                    setShowAllRequests(!showAllRequests);
                  }}
                  activeOpacity={0.7}
                >
                  <Text size="sm" weight="medium" color={colors.primary}>
                    {showAllRequests
                      ? t('common.showLess')
                      : t('matchActions.showMoreRequests', {
                          count: pendingRequests.length - 3,
                        })}
                  </Text>
                  <Ionicons
                    name={showAllRequests ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.primary}
                    style={styles.showMoreIcon}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Invitations Section - only visible to host */}
          {isCreator && allInvitations.length > 0 && !isCancelled && !hasStartTimePassed && (
            <View style={styles.pendingRequestsSection}>
              <View style={styles.pendingRequestsHeader}>
                <Text
                  size="sm"
                  weight="semibold"
                  color={colors.primary}
                  style={styles.pendingRequestsTitle}
                >
                  {t('matchActions.invitations')} ({allInvitations.length})
                </Text>
              </View>
              {(showAllInvitations ? allInvitations : allInvitations.slice(0, 3)).map(
                invitation => {
                  const isPending = pendingInvitations.some(p => p.id === invitation.id);
                  const statusColor = isPending ? status.warning.DEFAULT : neutral[400];
                  const statusLabel = isPending
                    ? t('matchActions.participantStatus.pending')
                    : t('matchActions.participantStatus.declined');

                  return (
                    <View
                      key={invitation.id}
                      style={[
                        styles.pendingRequestInfo,
                        {
                          backgroundColor: themeColors.muted,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radiusPixels.md,
                          paddingHorizontal: spacingPixels[3],
                          paddingVertical: spacingPixels[2.5],
                        },
                      ]}
                    >
                      <View style={styles.pendingRequestContent}>
                        <View
                          style={[styles.pendingRequestAvatar, { backgroundColor: colors.primary }]}
                        >
                          {invitation.avatarUrl ? (
                            <Image
                              source={{ uri: invitation.avatarUrl }}
                              style={styles.pendingRequestAvatarImage}
                            />
                          ) : (
                            <Ionicons name="person-outline" size={16} color={base.white} />
                          )}
                        </View>
                        <View style={styles.pendingRequestNameContainer}>
                          <Text
                            size="sm"
                            weight="medium"
                            color={colors.text}
                            numberOfLines={1}
                            style={styles.pendingRequestName}
                          >
                            {invitation.name}
                          </Text>
                          <View
                            style={[
                              styles.pendingRequestRatingBadge,
                              { backgroundColor: statusColor + '20' },
                            ]}
                          >
                            <Ionicons
                              name={isPending ? 'time-outline' : 'close-circle-outline'}
                              size={10}
                              color={statusColor}
                              style={styles.pendingRequestRatingIcon}
                            />
                            <Text size="xs" weight="medium" color={statusColor}>
                              {statusLabel}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View style={styles.pendingRequestActions}>
                        {isPending ? (
                          <>
                            {/* Resend button for pending invitations */}
                            <TouchableOpacity
                              style={[
                                styles.requestActionButton,
                                {
                                  backgroundColor:
                                    resendingInvitationId === invitation.id ||
                                    isCancellingInvite ||
                                    isInProgress
                                      ? neutral[400]
                                      : colors.primary,
                                },
                              ]}
                              onPress={() => invitation.id && handleResendInvite(invitation.id)}
                              disabled={
                                resendingInvitationId === invitation.id ||
                                isCancellingInvite ||
                                isInProgress
                              }
                              activeOpacity={0.7}
                            >
                              <Ionicons name="refresh" size={18} color={base.white} />
                            </TouchableOpacity>
                            {/* Cancel button for pending invitations */}
                            <TouchableOpacity
                              style={[
                                styles.requestActionButton,
                                { backgroundColor: isDark ? secondary[400] : secondary[500] },
                              ]}
                              onPress={() => invitation.id && handleCancelInvite(invitation.id)}
                              disabled={
                                resendingInvitationId === invitation.id || isCancellingInvite
                              }
                              activeOpacity={0.7}
                            >
                              <Ionicons name="close-outline" size={18} color={base.white} />
                            </TouchableOpacity>
                          </>
                        ) : (
                          /* Resend button for declined invitations */
                          <TouchableOpacity
                            style={[
                              styles.requestActionButton,
                              {
                                backgroundColor:
                                  resendingInvitationId === invitation.id ||
                                  isCancellingInvite ||
                                  isInProgress
                                    ? neutral[400]
                                    : colors.primary,
                              },
                            ]}
                            onPress={() => invitation.id && handleResendInvite(invitation.id)}
                            disabled={
                              resendingInvitationId === invitation.id ||
                              isCancellingInvite ||
                              isInProgress
                            }
                            activeOpacity={0.7}
                          >
                            <Ionicons name="refresh" size={18} color={base.white} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                }
              )}
              {/* Show more/less toggle when there are more than 3 invitations */}
              {allInvitations.length > 3 && (
                <TouchableOpacity
                  style={styles.showMoreButton}
                  onPress={() => {
                    lightHaptic();
                    setShowAllInvitations(!showAllInvitations);
                  }}
                  activeOpacity={0.7}
                >
                  <Text size="sm" weight="medium" color={colors.primary}>
                    {showAllInvitations
                      ? t('common.showLess')
                      : t('matchActions.showMoreInvitations', {
                          count: allInvitations.length - 3,
                        })}
                  </Text>
                  <Ionicons
                    name={showAllInvitations ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.primary}
                    style={styles.showMoreIcon}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Location Section - Tappable to open maps */}
        <TouchableOpacity
          style={[styles.section, { borderBottomColor: colors.border }]}
          onPress={hasLocationData ? handleOpenMaps : undefined}
          activeOpacity={hasLocationData ? 0.7 : 1}
          disabled={!hasLocationData}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="location-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('matchDetail.location')}
            </Text>
          </View>
          <View style={styles.locationRow}>
            <View style={[styles.infoRow, { flex: 1, minWidth: 0 }]}>
              <View style={styles.infoContent}>
                <Text size="base" weight="semibold" color={colors.text}>
                  {facilityName || t('matchDetail.locationTBD')}
                  {courtName && ` - ${courtName}`}
                </Text>
                {address && (
                  <Text size="sm" color={colors.textMuted} style={styles.addressText}>
                    {address}
                  </Text>
                )}
                {distanceDisplay && (
                  <Text
                    size="sm"
                    weight="medium"
                    color={colors.primary}
                    style={styles.distanceText}
                  >
                    {distanceDisplay} {t('matchDetail.away')}
                  </Text>
                )}
              </View>
            </View>
            {hasLocationData && (
              <View style={styles.locationChevron}>
                <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Cost Section */}
        {costDisplay && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name={match.is_court_free ? 'checkmark-circle-outline' : 'cash-outline'}
                size={20}
                color={match.is_court_free ? status.success.DEFAULT : colors.iconMuted}
              />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.estimatedCost')}
              </Text>
            </View>
            <InfoRow colors={colors}>
              <View>
                <Text size="sm" color={colors.textMuted}>
                  {t('matchDetail.courtEstimatedCost')}
                </Text>
                <Text
                  size="base"
                  weight="semibold"
                  color={match.is_court_free ? status.success.DEFAULT : colors.text}
                >
                  {costDisplay}
                </Text>
              </View>
            </InfoRow>
          </View>
        )}

        {/* Score Section - when match has a result */}
        {hasResult &&
          match.result &&
          (() => {
            const rawResult = Array.isArray(match.result) ? match.result[0] : match.result;
            const result = rawResult as {
              team1_score?: number | null;
              team2_score?: number | null;
              is_verified?: boolean | null;
              disputed?: boolean | null;
              submitted_by?: string | null;
              sets?: Array<{ set_number: number; team1_score: number; team2_score: number }>;
            };
            const team1Sets = result.team1_score ?? 0;
            const team2Sets = result.team2_score ?? 0;
            const setsList = result.sets;
            const isVerified = result.is_verified === true;
            const isDisputed = result.disputed === true;
            const statusKey = isDisputed
              ? 'matchDetail.scoreDisputed'
              : isVerified
                ? 'matchDetail.scoreVerified'
                : 'matchDetail.scorePendingConfirmation';
            const statusIcon = isDisputed
              ? 'warning-outline'
              : isVerified
                ? 'checkmark-circle-outline'
                : 'time-outline';
            const isCurrentUserTeam1 = !!(
              playerId &&
              result.submitted_by &&
              playerId === result.submitted_by
            );
            const useYourTeamLabels = !!playerId && !!result.submitted_by;
            const isSingles = match.format === 'singles';
            const yourScore = isCurrentUserTeam1 ? team1Sets : team2Sets;
            const oppScore = isCurrentUserTeam1 ? team2Sets : team1Sets;
            const leftLabel = useYourTeamLabels
              ? isSingles
                ? t('matchDetail.you')
                : t('matchDetail.yourTeam')
              : t('matchDetail.team1');
            const rightLabel = useYourTeamLabels
              ? isSingles
                ? t('matchDetail.opponent')
                : t('matchDetail.opponents')
              : t('matchDetail.team2');
            return (
              <View style={[styles.section, { borderBottomColor: colors.border }]}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="trophy-outline" size={20} color={colors.iconMuted} />
                  <Text
                    size="base"
                    weight="semibold"
                    color={colors.text}
                    style={styles.sectionTitle}
                  >
                    {t('matchDetail.registerScore')}
                  </Text>
                </View>
                <View style={styles.scoreSectionContent}>
                  <View style={styles.scoreSectionRow}>
                    <Text size="sm" weight="medium" color={colors.textMuted}>
                      {leftLabel}
                    </Text>
                    <Text size="lg" weight="bold" color={colors.text}>
                      {useYourTeamLabels
                        ? `${yourScore} – ${oppScore}`
                        : `${team1Sets} – ${team2Sets}`}
                    </Text>
                    <Text size="sm" weight="medium" color={colors.textMuted}>
                      {rightLabel}
                    </Text>
                  </View>
                  {setsList && setsList.length > 0 && (
                    <Text size="sm" color={colors.textMuted} style={styles.scoreSetsText}>
                      {setsList
                        .sort((a, b) => a.set_number - b.set_number)
                        .map(s =>
                          useYourTeamLabels && !isCurrentUserTeam1
                            ? `${s.team2_score}-${s.team1_score}`
                            : `${s.team1_score}-${s.team2_score}`
                        )
                        .join(', ')}
                    </Text>
                  )}
                  <View style={styles.scoreSectionStatusRow}>
                    <Ionicons name={statusIcon} size={18} color={colors.textMuted} />
                    <Text size="sm" color={colors.textMuted} style={styles.scoreSectionStatusText}>
                      {t(statusKey)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })()}

        {/* Notes Section */}
        {match.notes && (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="document-text-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.notes')}
              </Text>
            </View>
            <Text size="sm" color={colors.textMuted} style={styles.notesText}>
              "{match.notes}"
            </Text>
          </View>
        )}
      </BottomSheetScrollView>

      {/* Sticky Action Footer */}
      <View
        style={[
          styles.stickyFooter,
          {
            backgroundColor: colors.cardBackground,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View style={styles.actionButtonsContainer}>{renderActionButtons()}</View>
        {startTimeDiffMs >= 0 && (
          <TouchableOpacity
            style={[
              styles.shareButton,
              isCreator && styles.shareButtonCompact,
              {
                backgroundColor: isDark ? secondary[500] : secondary[500],
                shadowColor: secondary[600],
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 4,
                elevation: 4,
              },
            ]}
            onPress={handleShare}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social" size={18} color={base.white} />
            {!isCreator && (
              <Text size="sm" weight="semibold" color={base.white} numberOfLines={1}>
                {t('matchDetail.inviteFriends')}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Leave Match Confirmation Modal */}
      <ConfirmationModal
        visible={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        onConfirm={handleConfirmLeave}
        title={t('matchActions.leaveConfirmTitle')}
        message={t('matchActions.leaveConfirmMessage')}
        additionalInfo={
          selectedMatch && willLeaveAffectReputation(selectedMatch)
            ? t('matchActions.leaveReputationWarning')
            : undefined
        }
        confirmLabel={t('matches.leaveMatch')}
        cancelLabel={t('common.cancel')}
        destructive
        isLoading={isLeaving}
      />

      {/* Cancel Match Confirmation Modal */}
      <ConfirmationModal
        visible={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleConfirmCancel}
        title={t('matchActions.cancelConfirmTitle')}
        message={t('matchActions.cancelConfirmMessage', {
          count: participantInfo.current,
        })}
        additionalInfo={(() => {
          const warnings: string[] = [];
          // Add reputation warning if applicable
          if (selectedMatch && willCancelAffectReputation(selectedMatch)) {
            warnings.push(t('matchActions.cancelReputationWarning'));
          }
          // Add participant notification warning if there are other participants
          if (participantInfo.current > 1) {
            warnings.push(
              t('matchActions.cancelWarning', {
                count: participantInfo.current - 1,
              })
            );
          }
          return warnings.length > 0 ? warnings.join('\n\n') : undefined;
        })()}
        confirmLabel={t('matches.cancelMatch')}
        cancelLabel={t('common.goBack')}
        destructive
        isLoading={isCancelling}
      />

      {/* Reject Request Confirmation Modal */}
      <ConfirmationModal
        visible={showRejectModal}
        onClose={() => {
          setShowRejectModal(false);
          setRejectingParticipantId(null);
        }}
        onConfirm={handleConfirmReject}
        title={t('matchActions.rejectConfirmTitle')}
        message={t('matchActions.rejectConfirmMessage')}
        confirmLabel={t('matchActions.rejectRequest')}
        cancelLabel={t('common.cancel')}
        destructive
        isLoading={isRejecting}
      />

      {/* Cancel Request Confirmation Modal (for requesters) */}
      <ConfirmationModal
        visible={showCancelRequestModal}
        onClose={() => setShowCancelRequestModal(false)}
        onConfirm={handleConfirmCancelRequest}
        title={t('matchActions.cancelRequestConfirmTitle')}
        message={t('matchActions.cancelRequestConfirmMessage')}
        confirmLabel={t('matchActions.cancelRequest')}
        cancelLabel={t('common.goBack')}
        destructive
        isLoading={isCancellingRequest}
      />

      {/* Requester Details Modal */}
      <RequesterDetailsModal
        visible={showRequesterModal}
        onClose={handleCloseRequesterModal}
        participant={selectedRequester}
        onAccept={handleAcceptFromModal}
        onReject={handleRejectFromModal}
        isLoading={isAccepting || isRejecting}
        isMatchFull={isFull}
        isMatchInProgress={isInProgress}
      />

      {/* Kick Participant Confirmation Modal */}
      <ConfirmationModal
        visible={showKickModal}
        onClose={() => {
          setShowKickModal(false);
          setKickingParticipantId(null);
        }}
        onConfirm={handleConfirmKick}
        title={t('matchActions.kickConfirmTitle')}
        message={t('matchActions.kickConfirmMessage')}
        confirmLabel={t('matchActions.kickParticipant')}
        cancelLabel={t('common.cancel')}
        destructive
        isLoading={isKicking}
      />

      {/* Cancel Invitation Confirmation Modal */}
      <ConfirmationModal
        visible={showCancelInviteModal}
        onClose={() => {
          setShowCancelInviteModal(false);
          setCancellingInvitationId(null);
        }}
        onConfirm={handleConfirmCancelInvite}
        title={t('matchActions.cancelInviteConfirmTitle')}
        message={t('matchActions.cancelInviteConfirmMessage')}
        confirmLabel={t('matchActions.cancelInvite')}
        cancelLabel={t('common.cancel')}
        destructive
        isLoading={isCancellingInvite}
      />
    </BottomSheetModal>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
  },
  // Live indicator styles for ongoing matches
  liveIndicatorContainer: {
    width: 12,
    height: 12,
    marginRight: spacingPixels[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // Subtle shadow for depth
    shadowColor: secondary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
  // "Starting soon" countdown indicator
  countdownIndicator: {
    marginRight: spacingPixels[0.5],
  },
  sheetContent: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacingPixels[4],
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[5],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[1],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  pendingBannerText: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },
  emptyContent: {
    flex: 1,
  },

  // Header
  header: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitleSection: {
    flex: 1,
    marginRight: spacingPixels[3],
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarIcon: {
    marginRight: spacingPixels[2],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  closeButton: {
    padding: spacingPixels[1],
  },

  // Sections
  section: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  sectionHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    marginLeft: spacingPixels[2],
  },
  participantsSectionChatButton: {
    padding: spacingPixels[1],
    marginLeft: spacingPixels[2],
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoIconContainer: {
    width: spacingPixels[8],
    alignItems: 'center',
    paddingTop: spacingPixels[0.5],
  },
  infoContent: {
    flex: 1,
  },
  addressText: {
    marginTop: spacingPixels[1],
  },
  distanceText: {
    marginTop: spacingPixels[1],
  },

  // Participants
  participantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[3],
  },
  participantWithLabel: {
    alignItems: 'center',
  },
  participantLabel: {
    marginTop: spacingPixels[1],
    maxWidth: 50,
    textAlign: 'center',
  },
  participantAvatarWrapper: {
    position: 'relative',
  },
  participantAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  participantAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  hostBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: base.white,
  },
  checkedInBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: base.white,
  },
  participantAvatarWithAction: {
    position: 'relative',
  },
  kickButton: {
    position: 'absolute',
    top: 0,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotsText: {
    marginTop: spacingPixels[3],
  },
  invitePlayersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  inviteButtonText: {
    // No additional styles needed
  },

  // Pending requests (host only)
  pendingRequestsSection: {
    marginTop: spacingPixels[4],
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  pendingRequestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  pendingRequestsTitle: {
    // No margin bottom - now handled by header gap
  },
  matchFullBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  matchFullBadgeText: {
    marginLeft: spacingPixels[1],
  },
  pendingRequestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  pendingRequestContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  pendingRequestAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
    overflow: 'hidden',
  },
  pendingRequestAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  pendingRequestNameContainer: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  pendingRequestName: {
    flexShrink: 1,
  },
  pendingRequestRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    flexShrink: 0,
  },
  pendingRequestRatingIcon: {
    marginRight: spacingPixels[0.5],
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  showMoreIcon: {
    marginLeft: spacingPixels[1],
  },
  pendingRequestActions: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginLeft: spacingPixels[2],
  },
  requestActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewDetailsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    // Background color set dynamically
  },
  rejectButton: {
    // Background color set dynamically
  },
  requestActionLoading: {
    width: 18,
    height: 18,
  },

  // Location row (tappable)
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationChevron: {
    marginLeft: spacingPixels[2],
    marginRight: spacingPixels[1],
    flexShrink: 0,
  },

  // Badges
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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

  // Notes
  notesText: {
    fontStyle: 'italic',
    lineHeight: 20,
  },

  // Sticky Footer
  stickyFooter: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    gap: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  actionButtonsContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: spacingPixels[2],
    minWidth: 0, // Allow shrinking
  },
  // Footer buttons: same pattern as MatchCreationWizard nextButton – paddingVertical, no fixed height, so content is not clipped
  actionButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  cancelButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    flexShrink: 0,
  },
  shareButtonCompact: {
    paddingHorizontal: 0,
    width: spacingPixels[12],
    paddingVertical: spacingPixels[4],
    alignSelf: 'stretch',
    gap: 0,
  },
  matchEndedContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[2],
  },
  matchEndedText: {
    textAlign: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  scoreStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Score section (in scroll view) – aligned with other section content
  scoreSectionContent: {
    marginTop: 0,
  },
  scoreSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  scoreSetsText: {
    marginTop: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  scoreSectionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
  },
  scoreSectionStatusText: {
    marginLeft: spacingPixels[2],
  },
});

export default MatchDetailSheet;

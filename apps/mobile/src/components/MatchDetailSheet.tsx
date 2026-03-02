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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Image,
  Linking,
  Platform,
  Animated as RNAnimated,
  Easing,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import MapView, { Marker } from 'react-native-maps';
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
  warningHaptic,
  formatTimeInTimezone,
  getTimeDifferenceFromNow,
  getMatchEndTimeDifferenceFromNow,
  formatIntuitiveDateInTimezone,
  getProfilePictureUrl,
  deriveMatchStatus,
  getMatchTier,
  HIGH_REPUTATION_THRESHOLD,
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
import {
  useTheme,
  usePlayer,
  useMatchActions,
  usePlayerReputation,
  useConfirmMatchScore,
  useDisputeMatchScore,
} from '@rallia/shared-hooks';
import {
  getMatchChat,
  getMatchWithDetails,
  TIER_COLORS,
  getTierForScore,
  getTierConfig,
  MIN_EVENTS_FOR_PUBLIC,
} from '@rallia/shared-services';
import { SheetManager } from 'react-native-actions-sheet';
import { shareMatch } from '../utils';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { ConfirmationModal } from './ConfirmationModal';
import { SportIcon } from './SportIcon';
import { useAppNavigation } from '../navigation';
import type { PlayerWithProfile, OpponentForFeedback } from '@rallia/shared-types';

// Use base.white from design system for consistency

// =============================================================================
// TYPES & CONSTANTS
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
function getDateTimeParts(
  dateString: string,
  startTime: string,
  endTime: string,
  timezone: string,
  locale: string,
  t: (key: TranslationKey, options?: Record<string, string | number | boolean>) => string
): { dateLabel: string; startTimeLabel: string; durationLabel: string; isUrgent: boolean } {
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
  const durationLabel =
    durationRemMin > 0
      ? `${durationHours}h${durationRemMin.toString().padStart(2, '0')}`
      : `${durationHours}h`;

  return { dateLabel, startTimeLabel: startResult.formattedTime, durationLabel, isUrgent };
}

/**
 * Format milliseconds into a clean countdown with seconds.
 * >= 1h  → "1:30:05"
 * < 1h   → "12:45"
 * < 1m   → "0:32"
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, '0');
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
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
 * Graduated penalty applies when ALL conditions are met:
 * 1. Match is full (all spots taken)
 * 2. Court is reserved (court_status = 'reserved')
 * 3. Match was created more than 24 hours before start time (planned match)
 * 4. Match was NOT explicitly edited by host within 24 hours of NOW (no recent host changes)
 * 5. Player is leaving within 24 hours of start time
 *
 * Note: cooling-off (joined <1h ago) is checked server-side only.
 *
 * @param match - The match data
 * @returns true if leaving will likely incur a reputation penalty
 */
function willLeaveAffectReputation(match: MatchDetailData): boolean {
  const participantInfo = getParticipantInfo(match);

  // Condition 1: Match must be full
  if (participantInfo.spotsLeft > 0) {
    return false;
  }

  // Condition 2: Court must be reserved
  if (match.court_status !== 'reserved') {
    return false;
  }

  // Use timezone-aware calculation
  const tz = match.timezone || 'UTC';
  const msUntilMatch = getTimeDifferenceFromNow(match.match_date, match.start_time, tz);
  const hoursUntilMatch = msUntilMatch / (1000 * 60 * 60);

  // Condition 5: Must be within 24 hours of start time
  if (hoursUntilMatch >= 24) {
    return false;
  }

  // Condition 3: Match must have been created more than 24 hours before start
  if (match.created_at) {
    const createdAt = new Date(match.created_at);
    const matchStartMs = Date.now() + msUntilMatch;
    const hoursFromCreationToStart = (matchStartMs - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromCreationToStart < 24) {
      return false;
    }
  }

  // Condition 4: Match must NOT have been explicitly edited by host within 24 hours of NOW
  if (match.host_edited_at) {
    const hostEditedAt = new Date(match.host_edited_at);
    const hoursSinceEdit = (Date.now() - hostEditedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceEdit < 24) {
      return false;
    }
  }

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
 * Graduated penalty applies when ALL conditions are met:
 * 1. Court is reserved (court_status = 'reserved')
 * 2. Match was created more than 24 hours before start time (planned match)
 * 3. There are other joined participants
 * 4. Creator is cancelling within 24 hours of start time
 *
 * Note: cooling-off (created <1h ago) is checked server-side only.
 *
 * @param match - The match data
 * @returns true if cancelling will likely incur a reputation penalty
 */
function willCancelAffectReputation(match: MatchDetailData): boolean {
  // Condition 1: Court must be reserved
  if (match.court_status !== 'reserved') {
    return false;
  }

  // Condition 3: Must have other joined participants
  const participantInfo = getParticipantInfo(match);
  if (participantInfo.current <= 1) {
    return false;
  }

  // Use timezone-aware calculation
  const tz = match.timezone || 'UTC';
  const msUntilMatch = getTimeDifferenceFromNow(match.match_date, match.start_time, tz);
  const hoursUntilMatch = msUntilMatch / (1000 * 60 * 60);

  // Condition 4: Must be within 24 hours of start time
  if (hoursUntilMatch >= 24) {
    return false;
  }

  // Condition 2: Match must have been created more than 24 hours before start
  if (match.created_at) {
    const createdAt = new Date(match.created_at);
    const matchStartMs = Date.now() + msUntilMatch;
    const hoursFromCreationToStart = (matchStartMs - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursFromCreationToStart < 24) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

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
  isMostWanted?: boolean;
  certificationStatus?: 'self_declared' | 'certified' | 'disputed';
  colors: ThemeColors;
  isDark: boolean;
  /** Tier accent color for host badge and filled avatar borders */
  tierAccent?: string;
  /** Tier accent light color for non-host filled avatar borders */
  tierAccentLight?: string;
}

const MOST_WANTED_COLOR = '#5B21B6'; // violet-800 (matching platinum tier)
const CERTIFICATION_BADGE_COLORS: Record<
  'self_declared' | 'certified' | 'disputed',
  { bg: string; icon: string }
> = {
  self_declared: { bg: '#FFC107', icon: 'help-circle' },
  certified: { bg: '#4CAF50', icon: 'checkmark-circle' },
  disputed: { bg: '#F44336', icon: 'alert-circle' },
};

// Badge positions stacked on the left side, following the avatar circle curve.
// Avatar is 44x44, badge is 14x14. Bottom-left is the anchor; badges stack upward.
// Ordered bottom-to-top so index 0 = bottom-left, index 1 = above, index 2 = highest.
const BADGE_STACK: Array<{ top: number; left: number }> = [
  { top: 38, left: 4 }, // bottom (curve toward center)
  { top: 27, left: -5 }, // lower-left (curving outward)
  { top: 12, left: -7 }, // mid-left (widest point)
  { top: -1, left: 0 }, // upper-left (curve inward)
];

const BADGE_SIZE = 18;

const ParticipantAvatar: React.FC<ParticipantAvatarProps> = ({
  avatarUrl,
  isHost,
  isEmpty,
  isCheckedIn,
  isMostWanted,
  certificationStatus,
  colors,
  isDark,
  tierAccent,
  tierAccentLight: _tierAccentLight,
}) => {
  // Use tier accent colors if provided, otherwise fall back to theme colors
  const hostBorderColor = tierAccent || colors.secondary;
  // Build badge list in display order (top to bottom along left edge)
  const badges: Array<{ key: string; icon: string; size: number; bg: string }> = [];
  if (isHost) {
    badges.push({
      key: 'host',
      icon: 'star',
      size: 10,
      bg: tierAccent || colors.secondary,
    });
  }
  if (isMostWanted && !isEmpty) {
    badges.push({
      key: 'mostWanted',
      icon: 'ribbon',
      size: 10,
      bg: MOST_WANTED_COLOR,
    });
  }
  if (certificationStatus && certificationStatus !== 'self_declared' && !isEmpty) {
    const certColors = CERTIFICATION_BADGE_COLORS[certificationStatus];
    badges.push({
      key: 'certification',
      icon: certColors.icon,
      size: 10,
      bg: certColors.bg,
    });
  }
  if (isCheckedIn) {
    badges.push({
      key: 'checkedIn',
      icon: 'checkmark-outline',
      size: 10,
      bg: status.success.DEFAULT,
    });
  }

  return (
    <View style={styles.participantAvatarWrapper}>
      <View
        style={[
          styles.participantAvatar,
          isEmpty
            ? {
                backgroundColor: colors.slotEmpty,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.slotEmptyBorder,
              }
            : {
                backgroundColor: avatarUrl ? hostBorderColor : colors.avatarPlaceholder,
                borderWidth: 1.5,
                borderColor: primary[500],
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
      {badges.map((badge, index) => {
        const pos = BADGE_STACK[index];
        if (!pos) return null;
        return (
          <View
            key={badge.key}
            style={[
              styles.avatarBadge,
              { top: pos.top, left: pos.left, backgroundColor: badge.bg },
            ]}
          >
            <Ionicons
              name={badge.icon as ComponentProps<typeof Ionicons>['name']}
              size={badge.size}
              color={base.white}
            />
          </View>
        );
      })}
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
  const {
    sheetRef,
    closeSheet,
    openSheet,
    selectedMatch,
    updateSelectedMatch,
    handleSheetDismiss,
  } = useMatchDetailSheet();
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
  const { display: _creatorReputationDisplay } = usePlayerReputation(
    selectedMatch?.created_by_player?.id
  );
  const creatorReputationDisplay = _creatorReputationDisplay;

  // Ref to hold the match that should reopen after navigating back from PlayerProfile
  const pendingReopenRef = useRef<MatchDetailData | null>(null);

  // Listen for navigation state changes to reopen the sheet when returning from PlayerProfile or ChatConversation
  useEffect(() => {
    const unsubscribe = navigation.addListener('state', () => {
      if (!pendingReopenRef.current) return;

      const rootState = navigation.getState();
      const isOverlayScreenVisible = rootState.routes.some(
        r => r.name === 'PlayerProfile' || r.name === 'ChatConversation'
      );

      if (!isOverlayScreenVisible) {
        const matchToReopen = pendingReopenRef.current;
        pendingReopenRef.current = null;
        // Delay so the back animation completes before the sheet presents
        setTimeout(() => {
          openSheet(matchToReopen);
        }, 300);
      }
    });

    return unsubscribe;
  }, [navigation, openSheet]);

  // Navigate to player profile or open auth sheet if not signed in / onboarding incomplete.
  // Saves the current match so the sheet reopens automatically when navigating back.
  const handleParticipantProfilePress = useCallback(
    (targetPlayerId: string) => {
      lightHaptic();
      pendingReopenRef.current = selectedMatch;
      closeSheet();
      if (!guardAction()) {
        pendingReopenRef.current = null;
        return;
      }
      navigation.navigate('PlayerProfile', { playerId: targetPlayerId });
    },
    [closeSheet, guardAction, navigation, selectedMatch]
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
  const [showDeclineInviteModal, setShowDeclineInviteModal] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [acceptingRequestId, setAcceptingRequestId] = useState<string | null>(null);

  // Score confirm/dispute
  const confirmMutation = useConfirmMatchScore();
  const disputeMutation = useDisputeMatchScore();
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  // Collapse/expand state for pending requests
  const [showAllRequests, setShowAllRequests] = useState(false);

  // Collapse/expand state for invitations
  const [showAllInvitations, setShowAllInvitations] = useState(false);

  const [showBadgeInfo, setShowBadgeInfo] = useState(false);

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
  const urgentPulseAnimation = useMemo(() => new RNAnimated.Value(0), []);

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
    declineInvite,
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
    isDecliningInvite,
    isCheckingIn,
  } = useMatchActions(selectedMatch?.id, {
    matchData: selectedMatch ?? undefined,
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
    onDeclineInviteSuccess: () => {
      successHaptic();
      setShowDeclineInviteModal(false);
      closeSheet();
      toast.success(t('matchActions.declineInviteSuccess'));
    },
    onDeclineInviteError: error => {
      errorHaptic();
      setShowDeclineInviteModal(false);
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
      primaryLight: isDark ? primary[900] : primary[100],
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
  // Dismisses the detail sheet while the score sheet is open, then reopens it after
  const handleRegisterScore = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    const matchRef = selectedMatch;
    closeSheet();
    setTimeout(() => {
      SheetManager.show('register-match-score', {
        payload: {
          match: matchRef,
          onSuccess: async () => {
            const refreshed = await getMatchWithDetails(matchRef.id);
            openSheet((refreshed ?? matchRef) as MatchDetailData);
          },
          onDismiss: () => {
            openSheet(matchRef);
          },
        },
      });
    }, 100);
  }, [selectedMatch, closeSheet, openSheet]);

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

  // Handle confirming a score
  const handleConfirmScore = useCallback(async () => {
    if (!selectedMatch?.result || !playerId) return;
    const raw = Array.isArray(selectedMatch.result)
      ? selectedMatch.result[0]
      : selectedMatch.result;
    const resObj = raw as { id: string };
    mediumHaptic();
    try {
      await confirmMutation.mutateAsync({ matchResultId: resObj.id, playerId });
      successHaptic();
      toast.success(t('matchDetail.scoreConfirmed'));
      const refreshed = await getMatchWithDetails(selectedMatch.id);
      if (refreshed) updateSelectedMatch(refreshed as MatchDetailData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already processed')) {
        // Score was already confirmed/verified — refresh the UI silently
        warningHaptic();
        toast.info(t('matchDetail.scoreAlreadyProcessed'));
        const refreshed = await getMatchWithDetails(selectedMatch.id);
        if (refreshed) updateSelectedMatch(refreshed as MatchDetailData);
      } else {
        errorHaptic();
        toast.error(t('matchDetail.confirmScoreError'));
      }
    }
  }, [playerId, selectedMatch, confirmMutation, toast, t, updateSelectedMatch]);

  // Handle disputing a score - opens confirmation modal
  const handleDisputeScore = useCallback(() => {
    mediumHaptic();
    setShowDisputeModal(true);
  }, []);

  // Confirm dispute score
  const handleConfirmDispute = useCallback(async () => {
    if (!selectedMatch?.result || !playerId) return;
    const raw = Array.isArray(selectedMatch.result)
      ? selectedMatch.result[0]
      : selectedMatch.result;
    const resObj = raw as { id: string };
    try {
      await disputeMutation.mutateAsync({
        matchResultId: resObj.id,
        playerId,
      });
      successHaptic();
      setShowDisputeModal(false);
      toast.warning(t('matchDetail.scoreDisputedSuccess'));
      const refreshed = await getMatchWithDetails(selectedMatch.id);
      if (refreshed) updateSelectedMatch(refreshed as MatchDetailData);
    } catch {
      errorHaptic();
      toast.error(t('matchDetail.disputeScoreError'));
    }
  }, [playerId, selectedMatch, disputeMutation, toast, t, updateSelectedMatch]);

  // Handle opening feedback sheet for the current player
  const handleOpenFeedback = useCallback(() => {
    if (!selectedMatch || !playerId) return;
    const participant = selectedMatch.participants?.find(
      p => p.player_id === playerId && p.status === 'joined'
    );
    if (!participant) return;
    mediumHaptic();
    const opponents: OpponentForFeedback[] = (selectedMatch.participants ?? [])
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
          hasExistingReport: false,
        };
      });
    openFeedbackSheet(selectedMatch.id, playerId, participant.id, opponents);
  }, [selectedMatch, playerId, openFeedbackSheet]);

  // Handle opening the match chat conversation
  const handleOpenChat = useCallback(() => {
    if (!matchConversationId || !selectedMatch) return;

    // Guard action: require auth and onboarding to access chat
    if (!guardAction()) {
      closeSheet();
      return;
    }

    lightHaptic();
    pendingReopenRef.current = selectedMatch;
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

  // Handle decline invitation - opens confirmation modal (invitee only)
  const handleDeclineInvite = useCallback(() => {
    if (!selectedMatch) return;
    mediumHaptic();
    setShowDeclineInviteModal(true);
  }, [selectedMatch]);

  // Confirm decline invitation
  const handleConfirmDeclineInvite = useCallback(() => {
    if (!playerId) return;
    declineInvite(playerId);
  }, [playerId, declineInvite]);

  // Handle open in maps
  const handleOpenMaps = useCallback(() => {
    if (!selectedMatch) return;
    selectionHaptic();

    const address = selectedMatch.facility?.address || selectedMatch.location_address;
    const lat = selectedMatch.facility?.latitude ?? selectedMatch.custom_latitude;
    const lng = selectedMatch.facility?.longitude ?? selectedMatch.custom_longitude;

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
    const { isUrgent } = getDateTimeParts(
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
      const pulseAnim = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(urgentPulseAnimation, {
            toValue: 1,
            duration: animationDuration,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: true,
          }),
          RNAnimated.timing(urgentPulseAnimation, {
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

  // Score confirmation progress (how many joined players have confirmed)
  // Must be before early return to satisfy React hooks rules
  const scoreConfirmProgress = useMemo(() => {
    if (!selectedMatch) return null;
    const result = selectedMatch.result;
    if (!result) return null;
    const raw = Array.isArray(result) ? result[0] : result;
    const resObj = raw as {
      id: string;
      is_verified?: boolean | null;
      submitted_by?: string | null;
      confirmations?: Array<{ player_id: string; action: string }> | null;
    };
    const joinedPlayers = selectedMatch.participants?.filter(p => p.status === 'joined') ?? [];
    const total = joinedPlayers.length;
    if (total === 0) return null;
    if (resObj.is_verified) return { confirmed: total, total };
    // Count: submitter (1) + individual confirmations (only 'confirmed', not 'disputed')
    const individualConfirmations =
      resObj.confirmations?.filter(c => c.action === 'confirmed').length ?? 0;
    const confirmed = (resObj.submitted_by ? 1 : 0) + individualConfirmations;
    return { confirmed, total };
  }, [selectedMatch]);

  // Live countdown that ticks every second when match is starting soon
  // Must be before early return to satisfy React hooks rules
  const [countdownMs, setCountdownMs] = useState(0);

  useEffect(() => {
    if (!selectedMatch || !isStartingSoonForAnimation) {
      return;
    }
    const compute = () =>
      getTimeDifferenceFromNow(
        selectedMatch.match_date,
        selectedMatch.start_time,
        selectedMatch.timezone
      );
    // Fire immediately at 0ms, then every second
    const interval = setInterval(() => setCountdownMs(compute()), 1000);
    const immediate = setTimeout(() => setCountdownMs(compute()), 0);
    return () => {
      clearInterval(interval);
      clearTimeout(immediate);
    };
  }, [isStartingSoonForAnimation, selectedMatch]);

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

  // Determine match tier: check all joined participants
  const joinedForTier = match.participants?.filter(p => p.status === 'joined') ?? [];
  const participantsForTier = joinedForTier.map(p => ({
    repScore: p.player?.player_reputation?.reputation_score,
    certStatus: (p.player as PlayerWithProfile | undefined)?.sportCertificationStatus,
  }));
  const tier = getMatchTier(match.court_status, participantsForTier, match.format);

  // All tiers use primary accent colors (tier differentiation is via ribbon badge on cards)
  const tierAccent = isDark ? primary[400] : primary[500];
  const tierAccentLight = isDark ? primary[700] : primary[200];

  // Live/urgent indicator colors
  const liveColor = isDark ? secondary[400] : secondary[500];
  const soonColor = isDark ? accent[400] : accent[500];

  const { dateLabel, startTimeLabel, durationLabel, isUrgent } = getDateTimeParts(
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

  // Extract result object for score confirmation checks
  const resultObj = match.result
    ? ((Array.isArray(match.result) ? match.result[0] : match.result) as {
        id: string;
        is_verified?: boolean | null;
        disputed?: boolean | null;
        submitted_by?: string | null;
        confirmations?: Array<{ player_id: string; action: string }> | null;
      })
    : null;

  // Check if match is expired (started or ended but not full)
  const isExpired = (isInProgress || hasMatchEnded) && !isFull;

  // Determine animation type for time indicator:
  // - isInProgress = live indicator
  // - isUrgent (< 3 hours) but not in_progress = starting soon
  const isOngoing = derivedStatus === 'in_progress';
  const isStartingSoon = isUrgent && !isOngoing;

  // countdownLabel is computed from countdownMs state (hook lives before early return)
  const countdownLabel =
    isStartingSoon && countdownMs > 0
      ? t('matchDetail.startsIn', { time: formatCountdown(countdownMs) })
      : null;

  // Format label for header
  const formatLabel =
    match.format === 'doubles'
      ? t('match.format.doubles' as TranslationKey)
      : t('match.format.singles' as TranslationKey);

  // Sport display name for header
  const sportDisplayName = match.sport?.display_name || match.sport?.name;

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

  const playerNeedsFeedbackOrScore =
    hasMatchEnded &&
    isWithinFeedbackWindow &&
    currentPlayerParticipant &&
    (!playerHasCompletedFeedback || !hasResult);

  // Check if current player needs to confirm/dispute a score submitted by someone else
  // Excludes players who have already responded (confirmed or disputed)
  const playerAlreadyResponded = !!resultObj?.confirmations?.some(c => c.player_id === playerId);
  const scoreNeedsConfirmation =
    !!resultObj &&
    !resultObj.is_verified &&
    !resultObj.disputed &&
    !!resultObj.submitted_by &&
    resultObj.submitted_by !== playerId &&
    !playerAlreadyResponded &&
    !!currentPlayerParticipant;

  // Both score confirmation and feedback are pending
  const needsScoreConfirmAndFeedback =
    scoreNeedsConfirmation && isWithinFeedbackWindow && !playerHasCompletedFeedback;

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
    isMostWanted?: boolean;
    certificationStatus?: 'self_declared' | 'certified' | 'disputed';
  }> = [];

  // Helper to get the certification status for a player's rating
  const getCertificationStatus = (
    player: PlayerWithProfile | undefined | null
  ): 'self_declared' | 'certified' | 'disputed' | undefined => {
    return (player as PlayerWithProfile | undefined)?.sportCertificationStatus;
  };

  // Helper to check if a player has platinum-tier reputation (90%+)
  const getIsMostWanted = (player: PlayerWithProfile | undefined | null): boolean => {
    const score =
      (player as PlayerWithProfile | undefined)?.player_reputation?.reputation_score ?? 0;
    return score >= HIGH_REPUTATION_THRESHOLD;
  };

  // Get joined participants and identify host using is_host flag
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const hostParticipant = joinedParticipants.find(p => p.is_host);
  const otherJoinedParticipants = joinedParticipants.filter(p => !p.is_host);

  // Host first - use host participant's profile, fallback to created_by_player for backwards compatibility
  const hostProfile = hostParticipant?.player?.profile ?? creatorProfile;
  const hostName = hostProfile?.first_name || hostProfile?.display_name || creatorName;
  const hostPlayer = hostParticipant?.player ?? match.created_by_player;
  participantAvatars.push({
    key: 'host',
    avatarUrl: getProfilePictureUrl(hostProfile?.profile_picture_url),
    playerId: match.created_by,
    isHost: true,
    isEmpty: false,
    name: hostName,
    isCheckedIn: !!hostParticipant?.checked_in_at,
    isMostWanted: getIsMostWanted(hostPlayer),
    certificationStatus: getCertificationStatus(hostPlayer),
  });

  // Other participants (joined, excluding host)
  // Normalize URLs to use current environment's Supabase URL
  otherJoinedParticipants.forEach((p, i) => {
    const participantFirstName =
      p.player?.profile?.first_name || p.player?.profile?.display_name || '';
    participantAvatars.push({
      key: p.id || `participant-${i}`,
      participantId: p.id,
      playerId: p.player_id,
      avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
      isHost: false,
      isEmpty: false,
      name: participantFirstName,
      isCheckedIn: !!p.checked_in_at,
      isMostWanted: getIsMostWanted(p.player),
      certificationStatus: getCertificationStatus(p.player),
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
        // Compute reputation tier from joined data (RLS ensures is_public=true)
        const repScore = playerWithRating?.player_reputation?.reputation_score;
        const repTier = repScore != null ? getTierForScore(repScore, MIN_EVENTS_FOR_PUBLIC) : null;
        const repTierConfig = repTier && repTier !== 'unknown' ? getTierConfig(repTier) : null;
        const repTierPalette =
          repTier && repTier !== 'unknown'
            ? TIER_COLORS[repTier as keyof typeof TIER_COLORS]
            : null;
        return {
          id: p.id,
          playerId: p.player_id,
          name: fullName.split(' ')[0], // Show only first name
          avatarUrl: getProfilePictureUrl(p.player?.profile?.profile_picture_url),
          ratingLabel,
          ratingValue,
          ratingDisplay,
          certificationStatus: playerWithRating?.sportCertificationStatus,
          repTierConfig,
          repTierPalette,
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
  const isCourtFree = !!match.is_court_free;
  const hasCostData = isCourtFree || !!match.estimated_cost;
  const totalCost = match.estimated_cost ?? 0;
  const perPlayerCost =
    participantInfo.total > 0 ? Math.ceil(totalCost / participantInfo.total) : 0;

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

    // Match has results → Show confirm/dispute, feedback, or "completed"
    if (hasResult && match.result) {
      // Non-submitter with unverified, undisputed score → show confirm/dispute buttons
      if (scoreNeedsConfirmation) {
        return (
          <>
            <Button
              variant="primary"
              onPress={handleDisputeScore}
              style={styles.actionButton}
              themeColors={warningThemeColors}
              isDark={isDark}
              loading={disputeMutation.isPending}
              leftIcon={<Ionicons name="flag-outline" size={18} color={ctaDestructive} />}
            >
              {t('matchDetail.disputeScore')}
            </Button>
            <Button
              variant="primary"
              onPress={handleConfirmScore}
              style={styles.actionButton}
              themeColors={successThemeColors}
              isDark={isDark}
              loading={confirmMutation.isPending}
              leftIcon={<Ionicons name="checkmark-circle-outline" size={18} color={base.white} />}
            >
              {t('matchDetail.confirmScore')}
            </Button>
          </>
        );
      }
      // Player already responded (confirmed/disputed) but score not fully resolved (waiting for others in doubles)
      if (playerAlreadyResponded && !resultObj?.is_verified && !resultObj?.disputed) {
        if (isWithinFeedbackWindow && !playerHasCompletedFeedback && currentPlayerParticipant) {
          // Still needs feedback - show feedback button
          return (
            <Button
              variant="primary"
              onPress={handleOpenFeedback}
              style={styles.actionButton}
              themeColors={successThemeColors}
              isDark={isDark}
              leftIcon={
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={base.white} />
              }
            >
              {t('matchDetail.provideFeedbackOnly')}
            </Button>
          );
        }
        // All done — show "match completed" status
        return (
          <View style={styles.matchEndedContainer}>
            <Ionicons name="trophy-outline" size={20} color={colors.textMuted} />
            <Text size="sm" weight="medium" color={colors.textMuted} style={styles.matchEndedText}>
              {t('matchDetail.matchCompleted')}
            </Text>
          </View>
        );
      }
      if (isWithinFeedbackWindow && !playerHasCompletedFeedback && currentPlayerParticipant) {
        return (
          <Button
            variant="primary"
            onPress={handleOpenFeedback}
            style={styles.actionButton}
            themeColors={successThemeColors}
            isDark={isDark}
            leftIcon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={base.white} />}
          >
            {t('matchDetail.provideFeedbackOnly')}
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

    // Match has ended - show feedback/score CTAs or completion status based on conditions
    if (hasMatchEnded) {
      // Within 48h window
      if (isWithinFeedbackWindow) {
        // Participant with pending actions → Show appropriate CTA button(s)
        if (playerNeedsFeedbackOrScore && currentPlayerParticipant && isFull) {
          return (
            <>
              {/* Save score button (when score is missing) */}
              {!hasResult && (
                <Button
                  variant="primary"
                  onPress={handleRegisterScore}
                  style={styles.actionButton}
                  themeColors={successThemeColors}
                  isDark={isDark}
                  leftIcon={<Ionicons name="trophy-outline" size={18} color={base.white} />}
                >
                  {t('matchDetail.provideScoreOnly')}
                </Button>
              )}
              {/* Register feedback button (when feedback is missing) */}
              {!playerHasCompletedFeedback && (
                <Button
                  variant="primary"
                  onPress={handleOpenFeedback}
                  style={styles.actionButton}
                  themeColors={successThemeColors}
                  isDark={isDark}
                  leftIcon={
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={base.white} />
                  }
                >
                  {t('matchDetail.provideFeedbackOnly')}
                </Button>
              )}
            </>
          );
        }
        // Feedback/score completed or not a participant → Show "completed" message
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
          themeColors={destructiveThemeColors}
          isDark={isDark}
          loading={isCancellingRequest}
          leftIcon={<Ionicons name="close-circle-outline" size={18} color={base.white} />}
        >
          {t('matchActions.cancelRequest')}
        </Button>
      );
    }

    // User is invited (pending status): show Accept/Join + Decline buttons
    if (isInvited) {
      // Determine primary CTA based on match state
      let primaryLabel: string;
      let primaryIcon: string;
      if (isFull) {
        primaryLabel = t('matchActions.joinWaitlist');
        primaryIcon = 'list-outline';
      } else if (match.join_mode === 'request') {
        primaryLabel = t('matchDetail.requestToJoin');
        primaryIcon = 'hand-left-outline';
      } else {
        primaryLabel = t('match.cta.acceptInvitation');
        primaryIcon = 'checkmark-circle-outline';
      }

      return (
        <>
          <Button
            variant="primary"
            onPress={handleDeclineInvite}
            style={styles.cancelButton}
            themeColors={destructiveThemeColors}
            isDark={isDark}
            loading={isDecliningInvite}
            leftIcon={<Ionicons name="close-circle-outline" size={18} color={base.white} />}
          >
            {t('matchActions.declineInvite')}
          </Button>
          <Button
            variant="primary"
            onPress={handleJoinMatch}
            style={styles.actionButton}
            themeColors={successThemeColors}
            isDark={isDark}
            loading={isJoining}
            disabled={isJoining}
            leftIcon={
              <Ionicons
                name={primaryIcon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={base.white}
              />
            }
          >
            {primaryLabel}
          </Button>
        </>
      );
    }

    // Waitlisted user: Show Leave Waitlist only if match is still full (destructive red)
    if (isWaitlisted && isFull) {
      return (
        <Button
          variant="primary"
          onPress={handleLeaveMatch}
          style={styles.actionButton}
          themeColors={destructiveThemeColors}
          isDark={isDark}
          loading={isLeaving}
          leftIcon={<Ionicons name="exit-outline" size={18} color={base.white} />}
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
  // Support both facility coordinates and custom location coordinates
  const hasLocationData = !!(
    match.facility?.latitude ||
    match.custom_latitude ||
    match.facility?.address ||
    match.location_address
  );

  const hasCoordinates = !!(
    (match.facility?.latitude && match.facility?.longitude) ||
    (match.custom_latitude && match.custom_longitude)
  );

  // Resolved coordinates: prefer facility, fall back to custom location
  const resolvedLatitude = match.facility?.latitude ?? match.custom_latitude;
  const resolvedLongitude = match.facility?.longitude ?? match.custom_longitude;

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
      {/* Header with sport name, format, and close button */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerRight}>
            {/* Spacer to balance close button for centering */}
            <View style={styles.closeButton}>
              <View style={{ width: 24 }} />
            </View>
          </View>
          <View style={styles.headerTitleSection}>
            {sportDisplayName ? (
              <View style={styles.headerTitleRow}>
                <SportIcon
                  sportName={match.sport?.name || 'tennis'}
                  size={20}
                  color={colors.primary}
                />
                <Text size="xl" weight="bold" color={colors.text}>
                  {sportDisplayName}
                </Text>
                <View
                  style={[
                    styles.headerFormatBadge,
                    { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15` },
                  ]}
                >
                  <Text size="xs" weight="semibold" color={isDark ? primary[400] : primary[500]}>
                    {formatLabel}
                  </Text>
                </View>
              </View>
            ) : (
              <Text size="xl" weight="bold" color={colors.text} style={{ textAlign: 'center' }}>
                {t('matchDetail.title')}
              </Text>
            )}
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

        {/* Invited Banner - shown to invited users */}
        {isInvited && !isCreator && (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: (isDark ? primary[400] : primary[500]) + '15',
                borderColor: isDark ? primary[400] : primary[500],
              },
            ]}
          >
            <Ionicons name="mail-outline" size={18} color={isDark ? primary[400] : primary[500]} />
            <Text
              size="sm"
              weight="medium"
              color={isDark ? primary[400] : primary[500]}
              style={styles.pendingBannerText}
            >
              {t('matchDetail.invitedBanner')}
            </Text>
          </View>
        )}

        {/* Date & Time Section */}
        <Animated.View
          entering={FadeInDown.delay(50).springify()}
          style={[styles.section, { borderBottomColor: colors.border }]}
        >
          <View style={styles.sectionHeader}>
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
                      : colors.iconMuted
              }
            />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('matchDetail.dateAndTime')}
            </Text>
          </View>
          <View
            style={[
              styles.dateTimeCard,
              {
                backgroundColor:
                  isOngoing && !isExpired
                    ? isDark
                      ? `${secondary[500]}14`
                      : `${secondary[500]}0A`
                    : isStartingSoon && !isExpired
                      ? isDark
                        ? `${accent[500]}14`
                        : `${accent[500]}0A`
                      : isExpired || isCancelled
                        ? isDark
                          ? `${neutral[500]}14`
                          : `${neutral[500]}0A`
                        : isDark
                          ? `${primary[500]}14`
                          : `${primary[500]}0A`,
                borderColor:
                  isOngoing && !isExpired
                    ? isDark
                      ? `${secondary[500]}40`
                      : `${secondary[500]}26`
                    : isStartingSoon && !isExpired
                      ? isDark
                        ? `${accent[500]}40`
                        : `${accent[500]}26`
                      : isExpired || isCancelled
                        ? isDark
                          ? `${neutral[500]}40`
                          : `${neutral[500]}26`
                        : isDark
                          ? `${primary[500]}40`
                          : `${primary[500]}26`,
              },
            ]}
          >
            {/* Status badge */}
            {isOngoing && !isExpired && (
              <View
                style={[
                  styles.dateTimeBadge,
                  { backgroundColor: isDark ? `${secondary[500]}30` : `${secondary[500]}18` },
                ]}
              >
                <View style={styles.liveIndicatorContainer}>
                  <RNAnimated.View
                    style={[
                      styles.liveRing,
                      {
                        backgroundColor: liveColor,
                        transform: [{ scale: liveRingScale }],
                        opacity: liveRingOpacity,
                      },
                    ]}
                  />
                  <RNAnimated.View
                    style={[
                      styles.liveDot,
                      {
                        backgroundColor: liveColor,
                        opacity: liveDotOpacity,
                      },
                    ]}
                  />
                </View>
                <Text size="sm" weight="bold" color={liveColor}>
                  {t('matchDetail.live')}
                </Text>
              </View>
            )}
            {isStartingSoon && !isExpired && (
              <View
                style={[
                  styles.dateTimeBadge,
                  { backgroundColor: isDark ? `${accent[500]}30` : `${accent[500]}18` },
                ]}
              >
                <RNAnimated.View
                  style={{
                    transform: [{ translateX: countdownBounce }],
                    opacity: countdownOpacity,
                  }}
                >
                  <Ionicons name="chevron-forward" size={14} color={soonColor} />
                </RNAnimated.View>
                <Text size="sm" weight="bold" color={soonColor}>
                  {countdownLabel || t('matchDetail.startingSoon')}
                </Text>
              </View>
            )}
            {/* Three-column layout */}
            <View style={styles.dateTimeMain}>
              <View style={styles.dateTimeColumn}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('matches.date')}
                </Text>
                <Text
                  size="lg"
                  weight="bold"
                  color={
                    isExpired || isCancelled
                      ? colors.textMuted
                      : isOngoing
                        ? liveColor
                        : isStartingSoon
                          ? soonColor
                          : colors.textSecondary
                  }
                  style={styles.dateTimeValue}
                >
                  {dateLabel}
                </Text>
              </View>
              <View style={styles.dateTimeDivider}>
                <View
                  style={[
                    styles.dateTimeDividerLine,
                    { backgroundColor: isDark ? neutral[600] : neutral[300] },
                  ]}
                />
              </View>
              <View style={styles.dateTimeColumn}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('matchDetail.startTime')}
                </Text>
                <Text
                  size="lg"
                  weight="bold"
                  color={
                    isExpired || isCancelled
                      ? colors.textMuted
                      : isOngoing
                        ? liveColor
                        : isStartingSoon
                          ? soonColor
                          : colors.textSecondary
                  }
                  style={styles.dateTimeValue}
                >
                  {startTimeLabel}
                </Text>
              </View>
              <View style={styles.dateTimeDivider}>
                <View
                  style={[
                    styles.dateTimeDividerLine,
                    { backgroundColor: isDark ? neutral[600] : neutral[300] },
                  ]}
                />
              </View>
              <View style={styles.dateTimeColumn}>
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('matchDetail.duration')}
                </Text>
                <Text
                  size="lg"
                  weight="bold"
                  color={
                    isExpired || isCancelled
                      ? colors.textMuted
                      : isOngoing
                        ? liveColor
                        : isStartingSoon
                          ? soonColor
                          : colors.textSecondary
                  }
                  style={styles.dateTimeValue}
                >
                  {durationLabel}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Score Section - promoted to top for completed matches */}
        {hasResult &&
          match.result &&
          (() => {
            const rawResult = Array.isArray(match.result) ? match.result[0] : match.result;
            const result = rawResult as {
              team1_score?: number | null;
              team2_score?: number | null;
              winning_team?: number | null;
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
            // Determine which side the current user is on:
            // - Use team_number if available (currently unused by RPCs)
            // - Fall back to submitted_by convention (submitter = team 1)
            const currentUserTeamNumber = currentPlayerParticipant?.team_number;
            const isCurrentUserTeam1 =
              currentUserTeamNumber != null
                ? currentUserTeamNumber === 1
                : !!(playerId && result.submitted_by && playerId === result.submitted_by);
            const isParticipantInMatch = !!currentPlayerParticipant;
            const isSingles = match.format === 'singles';
            const leftScore = isCurrentUserTeam1 ? team1Sets : team2Sets;
            const rightScore = isCurrentUserTeam1 ? team2Sets : team1Sets;

            // Build team labels using participant first names
            // Singles: "Name" vs "Name" (current user on left if participant)
            // Doubles: "Name & Name" vs "Name & Name"
            const getName = (p: (typeof joinedParticipants)[number]) =>
              p.player?.profile?.first_name || p.player?.profile?.display_name || '';
            let leftLabel: string;
            let rightLabel: string;
            if (isSingles) {
              if (isParticipantInMatch) {
                const me = joinedParticipants.find(p => p.player_id === playerId);
                const opponent = joinedParticipants.find(p => p.player_id !== playerId);
                leftLabel = (me && getName(me)) || t('matchDetail.team1');
                rightLabel = (opponent && getName(opponent)) || t('matchDetail.team2');
              } else {
                const [p1, p2] = joinedParticipants;
                leftLabel = (p1 && getName(p1)) || t('matchDetail.team1');
                rightLabel = (p2 && getName(p2)) || t('matchDetail.team2');
              }
            } else {
              // Doubles: group by team_number if available, otherwise fall back to generic labels
              const hasTeamNumbers = joinedParticipants.some(p => p.team_number != null);
              if (hasTeamNumbers) {
                const getTeamNames = (teamNum: number) =>
                  joinedParticipants
                    .filter(p => p.team_number === teamNum)
                    .map(getName)
                    .filter(Boolean);
                const leftTeamNum = isParticipantInMatch ? (isCurrentUserTeam1 ? 1 : 2) : 1;
                const rightTeamNum = leftTeamNum === 1 ? 2 : 1;
                const leftNames = getTeamNames(leftTeamNum);
                const rightNames = getTeamNames(rightTeamNum);
                leftLabel = leftNames.length > 0 ? leftNames.join(' & ') : t('matchDetail.team1');
                rightLabel =
                  rightNames.length > 0 ? rightNames.join(' & ') : t('matchDetail.team2');
              } else {
                leftLabel = t('matchDetail.team1');
                rightLabel = t('matchDetail.team2');
              }
            }

            const winningTeam = result.winning_team;
            const currentUserWon = isParticipantInMatch
              ? (isCurrentUserTeam1 && winningTeam === 1) ||
                (!isCurrentUserTeam1 && winningTeam === 2)
              : null;
            const currentUserLost = isParticipantInMatch
              ? (isCurrentUserTeam1 && winningTeam === 2) ||
                (!isCurrentUserTeam1 && winningTeam === 1)
              : null;

            const winColor = status.success.DEFAULT;
            const loseColor = isDark ? secondary[400] : secondary[500];
            const drawColor = isDark ? accent[400] : accent[500];
            const leftScoreColor = isParticipantInMatch
              ? currentUserWon
                ? winColor
                : currentUserLost
                  ? loseColor
                  : drawColor
              : colors.text;
            const rightScoreColor = isParticipantInMatch
              ? currentUserLost
                ? winColor
                : currentUserWon
                  ? loseColor
                  : drawColor
              : colors.text;

            const scoreboardBg = isParticipantInMatch
              ? currentUserWon
                ? isDark
                  ? 'rgba(5, 150, 105, 0.12)'
                  : 'rgba(5, 150, 105, 0.06)'
                : currentUserLost
                  ? isDark
                    ? 'rgba(237, 106, 109, 0.12)'
                    : 'rgba(237, 106, 109, 0.06)'
                  : isDark
                    ? 'rgba(245, 158, 11, 0.12)'
                    : 'rgba(245, 158, 11, 0.06)'
              : isDark
                ? neutral[800]
                : neutral[50];
            const scoreboardBorder = isParticipantInMatch
              ? currentUserWon
                ? isDark
                  ? 'rgba(5, 150, 105, 0.25)'
                  : 'rgba(5, 150, 105, 0.15)'
                : currentUserLost
                  ? isDark
                    ? 'rgba(237, 106, 109, 0.25)'
                    : 'rgba(237, 106, 109, 0.15)'
                  : isDark
                    ? 'rgba(245, 158, 11, 0.25)'
                    : 'rgba(245, 158, 11, 0.15)'
              : colors.border;

            const trophyColor = isParticipantInMatch
              ? currentUserWon
                ? isDark
                  ? accent[400]
                  : accent[500]
                : colors.iconMuted
              : colors.iconMuted;
            const trophyIcon = isParticipantInMatch && currentUserWon ? 'trophy' : 'trophy-outline';

            const statusBadgeBg = isDisputed
              ? isDark
                ? 'rgba(237, 106, 109, 0.15)'
                : 'rgba(237, 106, 109, 0.1)'
              : isVerified
                ? isDark
                  ? 'rgba(5, 150, 105, 0.15)'
                  : 'rgba(5, 150, 105, 0.1)'
                : isDark
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(245, 158, 11, 0.1)';
            const statusBadgeTextColor = isDisputed
              ? isDark
                ? secondary[300]
                : secondary[600]
              : isVerified
                ? isDark
                  ? status.success.light
                  : status.success.dark
                : isDark
                  ? accent[300]
                  : accent[600];
            const statusIcon: keyof typeof Ionicons.glyphMap = isDisputed
              ? 'warning-outline'
              : isVerified
                ? 'checkmark-circle'
                : 'time-outline';
            const statusKey = isDisputed
              ? 'matchDetail.scoreDisputed'
              : isVerified
                ? 'matchDetail.scoreVerified'
                : 'matchDetail.scorePendingConfirmation';

            // Number of players still needing to confirm (for singular/plural translation)
            const remaining = scoreConfirmProgress
              ? scoreConfirmProgress.total - scoreConfirmProgress.confirmed
              : match.format === 'doubles'
                ? 3
                : 1;

            return (
              <Animated.View
                entering={FadeInDown.delay(50).springify()}
                style={[styles.section, { borderBottomColor: colors.border }]}
              >
                <View style={styles.sectionHeader}>
                  <Ionicons name={trophyIcon} size={20} color={trophyColor} />
                  <Text
                    size="base"
                    weight="semibold"
                    color={colors.text}
                    style={styles.sectionTitle}
                  >
                    {t('matchDetail.registerScore')}
                  </Text>
                </View>

                <View style={styles.scoreboardCardWrapper}>
                  <View
                    style={[
                      styles.scoreboardCardBg,
                      { backgroundColor: scoreboardBg, borderColor: scoreboardBorder },
                    ]}
                  />
                  <View style={styles.scoreboardCardContent}>
                    <View style={styles.scoreboardMain}>
                      <View style={styles.scoreboardTeam}>
                        <Text size="sm" weight="semibold" color={colors.textMuted}>
                          {leftLabel}
                        </Text>
                        <Text
                          size={30}
                          weight="bold"
                          color={leftScoreColor}
                          style={styles.scoreboardTeamScore}
                        >
                          {leftScore}
                        </Text>
                      </View>
                      <View style={styles.scoreboardDivider}>
                        <View
                          style={[
                            styles.scoreboardDividerLine,
                            { backgroundColor: isDark ? neutral[600] : neutral[300] },
                          ]}
                        />
                      </View>
                      <View style={styles.scoreboardTeam}>
                        <Text size="sm" weight="semibold" color={colors.textMuted}>
                          {rightLabel}
                        </Text>
                        <Text
                          size={30}
                          weight="bold"
                          color={rightScoreColor}
                          style={styles.scoreboardTeamScore}
                        >
                          {rightScore}
                        </Text>
                      </View>
                    </View>

                    {setsList && setsList.length > 0 && (
                      <View style={styles.scoreboardSets}>
                        {setsList
                          .sort((a, b) => a.set_number - b.set_number)
                          .map(s => {
                            const s1 =
                              isParticipantInMatch && !isCurrentUserTeam1
                                ? s.team2_score
                                : s.team1_score;
                            const s2 =
                              isParticipantInMatch && !isCurrentUserTeam1
                                ? s.team1_score
                                : s.team2_score;
                            const leftWonSet = s1 > s2;
                            const pillBg = leftWonSet
                              ? isDark
                                ? 'rgba(5, 150, 105, 0.15)'
                                : 'rgba(5, 150, 105, 0.1)'
                              : isDark
                                ? 'rgba(237, 106, 109, 0.15)'
                                : 'rgba(237, 106, 109, 0.1)';
                            const pillBorder = leftWonSet
                              ? isDark
                                ? 'rgba(5, 150, 105, 0.3)'
                                : 'rgba(5, 150, 105, 0.2)'
                              : isDark
                                ? 'rgba(237, 106, 109, 0.3)'
                                : 'rgba(237, 106, 109, 0.2)';
                            const pillTextColor = leftWonSet
                              ? isDark
                                ? status.success.light
                                : status.success.dark
                              : isDark
                                ? secondary[300]
                                : secondary[600];
                            return (
                              <View
                                key={s.set_number}
                                style={[
                                  styles.scoreboardSetPill,
                                  { backgroundColor: pillBg, borderColor: pillBorder },
                                ]}
                              >
                                <Text size="xs" weight="semibold" color={pillTextColor}>
                                  {`${s1}-${s2}`}
                                </Text>
                              </View>
                            );
                          })}
                      </View>
                    )}

                    {/* Status badge + confirmation progress */}
                    <View style={styles.scoreboardStatusRow}>
                      <View
                        style={[styles.scoreboardStatusBadge, { backgroundColor: statusBadgeBg }]}
                      >
                        <Ionicons name={statusIcon} size={14} color={statusBadgeTextColor} />
                        <Text
                          size="xs"
                          weight="semibold"
                          color={statusBadgeTextColor}
                          style={styles.scoreboardStatusText}
                        >
                          {t(statusKey, { count: remaining })}
                        </Text>
                      </View>
                      {scoreConfirmProgress && !isVerified && !isDisputed && (
                        <Text size="xs" weight="medium" color={colors.textMuted}>
                          {t('matchDetail.scoreConfirmProgress', {
                            confirmed: scoreConfirmProgress.confirmed,
                            total: scoreConfirmProgress.total,
                            count: scoreConfirmProgress.confirmed,
                          })}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              </Animated.View>
            );
          })()}

        {/* Match Info Grid - Moved up for context */}
        {hasAnyBadges && (
          <Animated.View
            entering={FadeInDown.delay(100).springify()}
            style={[styles.section, { borderBottomColor: colors.border }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="information-circle-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.preferences')}
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

              {/* Top Player badge - accent (lightest shade) */}
              {(tier === 'topPlayer' || tier === 'mostWanted') && (
                <Badge
                  label={t(
                    (match.format === 'doubles'
                      ? 'match.tier.topPlayerPlural'
                      : 'match.tier.topPlayer') as TranslationKey
                  )}
                  bgColor={isDark ? `${accent[400]}30` : `${accent[500]}15`}
                  textColor={isDark ? accent[400] : accent[500]}
                  icon="star"
                />
              )}

              {/* Court Booked badge - accent (medium shade) */}
              {(tier === 'mostWanted' || tier === 'readyToPlay') && (
                <Badge
                  label={t('match.courtStatus.courtBooked')}
                  bgColor={isDark ? `${accent[500]}30` : `${accent[600]}15`}
                  textColor={isDark ? accent[500] : accent[600]}
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

              {/* Gender preference - primary (cyan) */}
              {match.preferred_opponent_gender && (
                <Badge
                  label={
                    match.preferred_opponent_gender === 'male'
                      ? t('match.gender.menOnly')
                      : match.preferred_opponent_gender === 'female'
                        ? t('match.gender.womenOnly')
                        : t('match.gender.other')
                  }
                  bgColor={isDark ? `${primary[400]}30` : `${primary[500]}15`}
                  textColor={isDark ? primary[400] : primary[500]}
                  icon={
                    match.preferred_opponent_gender === 'male'
                      ? 'male'
                      : match.preferred_opponent_gender === 'female'
                        ? 'female'
                        : 'transgender'
                  }
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
                        ? `${primary[400]}30`
                        : `${primary[500]}15`
                      : isDark
                        ? `${neutral[600]}40`
                        : `${neutral[500]}20`
                  }
                  textColor={
                    match.visibility === 'public'
                      ? isDark
                        ? primary[400]
                        : primary[500]
                      : isDark
                        ? neutral[300]
                        : neutral[600]
                  }
                  icon={match.visibility === 'public' ? 'globe-outline' : 'lock-closed'}
                />
              )}
            </View>
          </Animated.View>
        )}

        {/* Participants Section - with host inline (marked with star) */}
        <Animated.View
          entering={FadeInDown.delay(150).springify()}
          style={[styles.section, { borderBottomColor: colors.border }]}
        >
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderTitleRow}>
              <Ionicons name="people-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.participants')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  lightHaptic();
                  setShowBadgeInfo(true);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.badgeInfoButton}
              >
                <Ionicons name="information-circle-outline" size={18} color={colors.iconMuted} />
              </TouchableOpacity>
            </View>
            {currentPlayerParticipant && matchConversationId && (
              <TouchableOpacity
                onPress={handleOpenChat}
                style={styles.participantsSectionChatButton}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                <Text size="sm" weight="medium" color={colors.primary}>
                  {t('matchDetail.chat')}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.participantsRow}>
            {participantAvatars.map((p, index) => (
              <Animated.View
                key={p.key}
                entering={FadeInDown.delay(100 + index * 60).springify()}
                style={styles.participantWithLabel}
              >
                <View style={styles.participantAvatarWithAction}>
                  <TouchableOpacity
                    onPress={() => {
                      if (!p.isEmpty && p.playerId) {
                        handleParticipantProfilePress(p.playerId);
                      }
                    }}
                    activeOpacity={p.isEmpty ? 1 : 0.85}
                    disabled={p.isEmpty}
                  >
                    <ParticipantAvatar
                      avatarUrl={p.avatarUrl}
                      isHost={p.isHost}
                      isEmpty={p.isEmpty}
                      isCheckedIn={p.isCheckedIn}
                      isMostWanted={p.isMostWanted}
                      certificationStatus={p.certificationStatus}
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
                        <Ionicons name="close-outline" size={12} color={base.white} />
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
              </Animated.View>
            ))}
          </View>

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

          {/* Share Match Button - visible to all users when match hasn't started */}
          {startTimeDiffMs >= 0 && !isCancelled && !hasMatchEnded && (
            <TouchableOpacity
              style={[
                styles.invitePlayersButton,
                {
                  backgroundColor: isDark ? `${secondary[500]}15` : `${secondary[500]}10`,
                  borderColor: isDark ? secondary[400] : secondary[500],
                },
              ]}
              onPress={handleShare}
              activeOpacity={0.7}
            >
              <Ionicons
                name="share-social"
                size={18}
                color={isDark ? secondary[400] : secondary[500]}
              />
              <Text
                size="sm"
                weight="medium"
                color={isDark ? secondary[400] : secondary[500]}
                style={styles.inviteButtonText}
              >
                {t('matchDetail.share')}
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
                      backgroundColor: isDark ? neutral[800] : neutral[50],
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radiusPixels.xl,
                      padding: spacingPixels[3],
                    },
                  ]}
                >
                  <View style={styles.pendingRequestContent}>
                    <TouchableOpacity
                      onPress={() =>
                        request.playerId && handleParticipantProfilePress(request.playerId)
                      }
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.pendingRequestAvatar,
                          {
                            backgroundColor: colors.primary,
                            borderColor: isDark ? primary[400] : primary[500],
                          },
                        ]}
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
                    </TouchableOpacity>
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
                      {request.ratingDisplay &&
                        (() => {
                          const reqCertColors =
                            request.certificationStatus &&
                            request.certificationStatus !== 'self_declared'
                              ? CERTIFICATION_BADGE_COLORS[request.certificationStatus]
                              : null;
                          const reqBadgeBg = reqCertColors
                            ? `${reqCertColors.bg}25`
                            : isDark
                              ? `${primary[400]}30`
                              : `${primary[500]}15`;
                          const reqBadgeText = reqCertColors
                            ? reqCertColors.bg
                            : isDark
                              ? primary[400]
                              : primary[500];
                          const reqBadgeIcon = reqCertColors
                            ? (reqCertColors.icon as keyof typeof Ionicons.glyphMap)
                            : 'analytics';
                          return (
                            <View
                              style={[
                                styles.pendingRequestRatingBadge,
                                { backgroundColor: reqBadgeBg },
                              ]}
                            >
                              <Ionicons
                                name={reqBadgeIcon}
                                size={10}
                                color={reqBadgeText}
                                style={styles.pendingRequestRatingIcon}
                              />
                              <Text size="xs" weight="medium" color={reqBadgeText}>
                                {request.ratingDisplay}
                              </Text>
                            </View>
                          );
                        })()}
                      {request.repTierPalette && request.repTierConfig && (
                        <View
                          style={[
                            styles.pendingRequestRatingBadge,
                            {
                              backgroundColor: isDark
                                ? request.repTierPalette.text
                                : request.repTierPalette.background,
                            },
                          ]}
                        >
                          <Ionicons
                            name={request.repTierConfig.icon as keyof typeof Ionicons.glyphMap}
                            size={10}
                            color={
                              isDark
                                ? request.repTierPalette.background
                                : request.repTierPalette.text
                            }
                            style={styles.pendingRequestRatingIcon}
                          />
                          <Text
                            size="xs"
                            weight="medium"
                            color={
                              isDark
                                ? request.repTierPalette.background
                                : request.repTierPalette.text
                            }
                          >
                            {request.repTierConfig.label}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.pendingRequestActions}>
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
                      <Ionicons name="checkmark-outline" size={16} color={base.white} />
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
                      <Ionicons name="close-outline" size={16} color={base.white} />
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
                          backgroundColor: isDark ? neutral[800] : neutral[50],
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radiusPixels.xl,
                          padding: spacingPixels[3],
                        },
                      ]}
                    >
                      <View style={styles.pendingRequestContent}>
                        <TouchableOpacity
                          onPress={() =>
                            invitation.playerId &&
                            handleParticipantProfilePress(invitation.playerId)
                          }
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.pendingRequestAvatar,
                              {
                                backgroundColor: colors.primary,
                                borderColor: isDark ? primary[400] : primary[500],
                              },
                            ]}
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
                        </TouchableOpacity>
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
                                      : isDark
                                        ? primary[400]
                                        : primary[500],
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
                              <Ionicons name="refresh" size={16} color={base.white} />
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
                              <Ionicons name="close-outline" size={16} color={base.white} />
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
                                    : isDark
                                      ? primary[400]
                                      : primary[500],
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
                            <Ionicons name="refresh" size={16} color={base.white} />
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
        </Animated.View>

        {/* Hosted By Section - Shows host info with reputation */}
        <Animated.View
          entering={FadeInDown.delay(200).springify()}
          style={[styles.section, { borderBottomColor: colors.border }]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="person-circle-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('matchDetail.hostedBy')}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.hostedByCard,
              { backgroundColor: isDark ? neutral[800] : neutral[50], borderColor: colors.border },
            ]}
            onPress={() => match.created_by && handleParticipantProfilePress(match.created_by)}
            activeOpacity={0.7}
          >
            <View style={styles.hostedByRow}>
              <View style={[styles.hostedByAvatar, { borderColor: tierAccent }]}>
                {getProfilePictureUrl(creatorProfile?.profile_picture_url) ? (
                  <Image
                    source={{ uri: getProfilePictureUrl(creatorProfile?.profile_picture_url)! }}
                    style={styles.hostedByAvatarImage}
                  />
                ) : (
                  <View
                    style={[
                      styles.hostedByAvatarPlaceholder,
                      { backgroundColor: colors.avatarPlaceholder },
                    ]}
                  >
                    <Ionicons
                      name="person-outline"
                      size={20}
                      color={isDark ? neutral[400] : neutral[500]}
                    />
                  </View>
                )}
              </View>
              <View style={styles.hostedByInfo}>
                <Text size="base" weight="semibold" color={colors.text}>
                  {creatorName}
                </Text>
                <View style={styles.hostedByReputationRow}>
                  {(() => {
                    const creatorPlayer = match.created_by_player as PlayerWithProfile | undefined;
                    const ratingValue = creatorPlayer?.sportRatingValue;
                    const ratingLabel = creatorPlayer?.sportRatingLabel;
                    const ratingDisplay =
                      ratingValue !== undefined && ratingValue !== null
                        ? ratingValue.toFixed(1)
                        : ratingLabel;
                    if (!ratingDisplay) return null;
                    const certStatus = creatorPlayer?.sportCertificationStatus;
                    const certBadgeColors =
                      certStatus && certStatus !== 'self_declared'
                        ? CERTIFICATION_BADGE_COLORS[certStatus]
                        : null;
                    const badgeBg = certBadgeColors
                      ? `${certBadgeColors.bg}25`
                      : isDark
                        ? `${primary[400]}30`
                        : `${primary[500]}15`;
                    const badgeTextColor = certBadgeColors
                      ? certBadgeColors.bg
                      : isDark
                        ? primary[400]
                        : primary[500];
                    const badgeIcon = certBadgeColors
                      ? (certBadgeColors.icon as keyof typeof Ionicons.glyphMap)
                      : 'analytics';
                    return (
                      <View style={[styles.hostedByRatingBadge, { backgroundColor: badgeBg }]}>
                        <Ionicons name={badgeIcon} size={12} color={badgeTextColor} />
                        <Text size="xs" weight="semibold" color={badgeTextColor}>
                          {ratingDisplay}
                        </Text>
                      </View>
                    );
                  })()}
                  {creatorReputationDisplay.isVisible &&
                    (() => {
                      const tierKey = creatorReputationDisplay.tier as keyof typeof TIER_COLORS;
                      const tierPalette = TIER_COLORS[tierKey] ?? TIER_COLORS.unknown;
                      return (
                        <View
                          style={[
                            styles.hostedByTierBadge,
                            { backgroundColor: isDark ? tierPalette.text : tierPalette.background },
                          ]}
                        >
                          <Ionicons
                            name={
                              creatorReputationDisplay.tierIcon as keyof typeof Ionicons.glyphMap
                            }
                            size={12}
                            color={isDark ? tierPalette.background : tierPalette.text}
                          />
                          <Text
                            size="xs"
                            weight="semibold"
                            color={isDark ? tierPalette.background : tierPalette.text}
                          >
                            {creatorReputationDisplay.tierLabel}
                          </Text>
                        </View>
                      );
                    })()}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconMuted} />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Location Section - Tappable to open maps */}
        <Animated.View
          entering={FadeInDown.delay(250).springify()}
          style={[styles.section, { borderBottomColor: colors.border }]}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="location-outline" size={20} color={colors.iconMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('matchDetail.location')}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.locationCard,
              { backgroundColor: isDark ? neutral[800] : neutral[50], borderColor: colors.border },
            ]}
            onPress={hasLocationData ? handleOpenMaps : undefined}
            activeOpacity={hasLocationData ? 0.7 : 1}
            disabled={!hasLocationData}
          >
            <View style={styles.locationRow}>
              <View
                style={{ flexDirection: 'row', alignItems: 'flex-start', flex: 1, minWidth: 0 }}
              >
                <View style={{ flex: 1 }}>
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
            {hasCoordinates && (
              <View style={[styles.mapContainer, { borderColor: colors.border }]}>
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    latitude: resolvedLatitude!,
                    longitude: resolvedLongitude!,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  toolbarEnabled={false}
                  moveOnMarkerPress={false}
                  pointerEvents="none"
                  userInterfaceStyle={isDark ? 'dark' : 'light'}
                  liteMode={Platform.OS === 'android'}
                >
                  <Marker
                    coordinate={{
                      latitude: resolvedLatitude!,
                      longitude: resolvedLongitude!,
                    }}
                  >
                    <View
                      style={[
                        styles.glassMarkerContainer,
                        { shadowColor: isDark ? primary[400] : primary[600] },
                      ]}
                    >
                      {/* Glow ring */}
                      <View
                        style={[
                          styles.glassMarkerGlow,
                          { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}20` },
                        ]}
                      >
                        {/* Glass body */}
                        <View
                          style={[
                            styles.glassMarkerBody,
                            {
                              backgroundColor: isDark ? `${primary[400]}B3` : `${primary[500]}CC`,
                              borderColor: isDark ? `${base.white}30` : `${base.white}60`,
                            },
                          ]}
                        >
                          {/* Specular highlight */}
                          <View
                            style={[
                              styles.glassMarkerHighlight,
                              { backgroundColor: isDark ? `${base.white}15` : `${base.white}30` },
                            ]}
                          />
                          <SportIcon
                            sportName={match.sport?.name || 'tennis'}
                            size={16}
                            color={base.white}
                          />
                        </View>
                      </View>
                      {/* Bottom dot */}
                      <View
                        style={[
                          styles.glassMarkerDot,
                          {
                            backgroundColor: isDark ? primary[300] : primary[500],
                            shadowColor: isDark ? primary[300] : primary[500],
                          },
                        ]}
                      />
                    </View>
                  </Marker>
                </MapView>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Cost Section */}
        {hasCostData && (
          <Animated.View
            entering={FadeInDown.delay(300).springify()}
            style={[styles.section, { borderBottomColor: colors.border }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.estimatedCost')}
              </Text>
            </View>
            {isCourtFree ? (
              <View
                style={[
                  styles.costCard,
                  {
                    backgroundColor: isDark ? 'rgba(5, 150, 105, 0.12)' : 'rgba(5, 150, 105, 0.06)',
                    borderColor: isDark ? 'rgba(5, 150, 105, 0.25)' : 'rgba(5, 150, 105, 0.15)',
                  },
                ]}
              >
                <View style={styles.costFreeContent}>
                  <Ionicons name="checkmark-circle" size={22} color={status.success.DEFAULT} />
                  <Text
                    size="lg"
                    weight="bold"
                    color={isDark ? status.success.light : status.success.dark}
                    style={styles.costFreeText}
                  >
                    {t('matchDetail.free')}
                  </Text>
                </View>
              </View>
            ) : (
              <View
                style={[
                  styles.costCard,
                  {
                    backgroundColor: isDark ? `${primary[500]}14` : `${primary[500]}0A`,
                    borderColor: isDark ? `${primary[500]}40` : `${primary[500]}26`,
                  },
                ]}
              >
                <View style={styles.costCardMain}>
                  {/* Total cost */}
                  <View style={styles.costCardColumn}>
                    <Text size="sm" weight="semibold" color={colors.textMuted}>
                      {t('matchDetail.totalCost')}
                    </Text>
                    <Text
                      size="xl"
                      weight="bold"
                      color={colors.textSecondary}
                      style={styles.costAmount}
                    >
                      ${totalCost}
                    </Text>
                  </View>

                  {/* Divider */}
                  <View style={styles.costCardDivider}>
                    <View
                      style={[
                        styles.costCardDividerLine,
                        { backgroundColor: isDark ? neutral[600] : neutral[300] },
                      ]}
                    />
                  </View>

                  {/* Per player cost */}
                  <View style={styles.costCardColumn}>
                    <Text size="sm" weight="semibold" color={colors.textMuted}>
                      {t('matchDetail.perPlayerCost')}
                    </Text>
                    <Text size={30} weight="bold" color={colors.primary} style={styles.costAmount}>
                      ${perPlayerCost}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </Animated.View>
        )}

        {/* Score Section removed from here - now rendered above preferences when hasResult */}

        {/* Notes Section */}
        {match.notes && (
          <Animated.View
            entering={FadeInDown.delay(350).springify()}
            style={[styles.section, { borderBottomColor: colors.border }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="document-text-outline" size={20} color={colors.iconMuted} />
              <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
                {t('matchDetail.notes')}
              </Text>
            </View>
            <View
              style={[
                styles.notesBlockquote,
                {
                  borderLeftColor: isDark ? primary[400] : primary[300],
                  backgroundColor: isDark ? `${primary[500]}08` : `${primary[500]}05`,
                },
              ]}
            >
              <Text size="sm" color={colors.textMuted} style={styles.notesText}>
                {match.notes}
              </Text>
            </View>
          </Animated.View>
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
          needsScoreConfirmAndFeedback && { flexDirection: 'column' },
        ]}
      >
        {/* Feedback row when both score confirmation and feedback are pending */}
        {needsScoreConfirmAndFeedback && (
          <Button
            variant="primary"
            onPress={handleOpenFeedback}
            style={styles.actionButtonFullWidth}
            themeColors={{
              primary: isDark ? primary[500] : primary[600],
              primaryForeground: base.white,
              buttonActive: isDark ? primary[500] : primary[600],
              buttonInactive: neutral[300],
              buttonTextActive: base.white,
              buttonTextInactive: neutral[500],
              text: colors.text,
              textMuted: colors.textMuted,
              border: colors.border,
              background: colors.cardBackground,
            }}
            isDark={isDark}
            leftIcon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={base.white} />}
          >
            {t('matchDetail.provideFeedbackOnly')}
          </Button>
        )}
        <View
          style={[
            styles.actionButtonsContainer,
            needsScoreConfirmAndFeedback && styles.actionButtonsContainerColumn,
          ]}
        >
          {/* Cap at 2 CTA buttons to prevent layout overflow */}
          {React.Children.toArray(renderActionButtons()).slice(0, 2)}
        </View>
      </View>

      {/* Leave Match / Leave Waitlist Confirmation Modal */}
      <ConfirmationModal
        visible={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        onConfirm={handleConfirmLeave}
        title={
          isWaitlisted
            ? t('matchActions.leaveWaitlistConfirmTitle')
            : t('matchActions.leaveConfirmTitle')
        }
        message={
          isWaitlisted
            ? t('matchActions.leaveWaitlistConfirmMessage')
            : t('matchActions.leaveConfirmMessage')
        }
        additionalInfo={
          !isWaitlisted && selectedMatch && willLeaveAffectReputation(selectedMatch)
            ? t('matchActions.leaveReputationWarning')
            : undefined
        }
        confirmLabel={isWaitlisted ? t('matchActions.leaveWaitlist') : t('matches.leaveMatch')}
        cancelLabel={t('common.cancel')}
        destructive={!isWaitlisted}
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

      {/* Decline Invitation Confirmation Modal */}
      <ConfirmationModal
        visible={showDeclineInviteModal}
        onClose={() => setShowDeclineInviteModal(false)}
        onConfirm={handleConfirmDeclineInvite}
        title={t('matchActions.declineInviteConfirmTitle')}
        message={t('matchActions.declineInviteConfirmMessage')}
        confirmLabel={t('matchActions.declineInvite')}
        cancelLabel={t('common.goBack')}
        destructive
        isLoading={isDecliningInvite}
      />

      {/* Dispute Score Confirmation Modal */}
      <ConfirmationModal
        visible={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        onConfirm={handleConfirmDispute}
        title={t('matchDetail.disputeConfirmTitle')}
        message={t('matchDetail.disputeConfirmMessage')}
        confirmLabel={t('matchDetail.disputeScore')}
        cancelLabel={t('common.cancel')}
        destructive
        isLoading={disputeMutation.isPending}
      />

      {/* Badge Info Modal */}
      <Modal
        visible={showBadgeInfo}
        transparent
        animationType="fade"
        onRequestClose={() => {
          lightHaptic();
          setShowBadgeInfo(false);
        }}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback
          onPress={() => {
            lightHaptic();
            setShowBadgeInfo(false);
          }}
        >
          <View style={styles.badgeInfoBackdrop}>
            <TouchableWithoutFeedback>
              <View style={[styles.badgeInfoModal, { backgroundColor: colors.cardBackground }]}>
                <Text
                  size="lg"
                  weight="semibold"
                  style={[styles.badgeInfoTitle, { color: colors.text }]}
                >
                  {t('matchDetail.badgeInfoTitle')}
                </Text>

                <View style={styles.badgeInfoRow}>
                  <View
                    style={[
                      styles.badgeInfoIcon,
                      { backgroundColor: isDark ? primary[400] : primary[500] },
                    ]}
                  >
                    <Ionicons name="star" size={10} color={base.white} />
                  </View>
                  <View style={styles.badgeInfoTextContainer}>
                    <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                      {t('matchDetail.badgeHost')}
                    </Text>
                    <Text size="xs" lineHeight="tight" style={{ color: colors.textMuted }}>
                      {t('matchDetail.badgeHostDesc')}
                    </Text>
                  </View>
                </View>

                <View style={styles.badgeInfoRow}>
                  <View style={[styles.badgeInfoIcon, { backgroundColor: MOST_WANTED_COLOR }]}>
                    <Ionicons name="ribbon" size={10} color={base.white} />
                  </View>
                  <View style={styles.badgeInfoTextContainer}>
                    <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                      {t('matchDetail.badgeMostWanted')}
                    </Text>
                    <Text size="xs" lineHeight="tight" style={{ color: colors.textMuted }}>
                      {t('matchDetail.badgeMostWantedDesc')}
                    </Text>
                  </View>
                </View>

                <View style={styles.badgeInfoRow}>
                  <View
                    style={[
                      styles.badgeInfoIcon,
                      { backgroundColor: CERTIFICATION_BADGE_COLORS.certified.bg },
                    ]}
                  >
                    <Ionicons
                      name={
                        CERTIFICATION_BADGE_COLORS.certified.icon as keyof typeof Ionicons.glyphMap
                      }
                      size={10}
                      color={base.white}
                    />
                  </View>
                  <View style={styles.badgeInfoTextContainer}>
                    <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                      {t('matchDetail.badgeCertified')}
                    </Text>
                    <Text size="xs" lineHeight="tight" style={{ color: colors.textMuted }}>
                      {t('matchDetail.badgeCertifiedDesc')}
                    </Text>
                  </View>
                </View>

                <View style={styles.badgeInfoRow}>
                  <View
                    style={[
                      styles.badgeInfoIcon,
                      { backgroundColor: CERTIFICATION_BADGE_COLORS.disputed.bg },
                    ]}
                  >
                    <Ionicons
                      name={
                        CERTIFICATION_BADGE_COLORS.disputed.icon as keyof typeof Ionicons.glyphMap
                      }
                      size={10}
                      color={base.white}
                    />
                  </View>
                  <View style={styles.badgeInfoTextContainer}>
                    <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                      {t('matchDetail.badgeDisputed')}
                    </Text>
                    <Text size="xs" lineHeight="tight" style={{ color: colors.textMuted }}>
                      {t('matchDetail.badgeDisputedDesc')}
                    </Text>
                  </View>
                </View>

                <View style={[styles.badgeInfoRow, { marginBottom: 0 }]}>
                  <View style={[styles.badgeInfoIcon, { backgroundColor: status.success.DEFAULT }]}>
                    <Ionicons name="checkmark-outline" size={10} color={base.white} />
                  </View>
                  <View style={styles.badgeInfoTextContainer}>
                    <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                      {t('matchDetail.badgeCheckedIn')}
                    </Text>
                    <Text size="xs" lineHeight="tight" style={{ color: colors.textMuted }}>
                      {t('matchDetail.badgeCheckedInDesc')}
                    </Text>
                  </View>
                </View>

                <View style={styles.badgeInfoButtonContainer}>
                  <TouchableOpacity
                    onPress={() => {
                      lightHaptic();
                      setShowBadgeInfo(false);
                    }}
                    style={[styles.badgeInfoCloseButton, { borderColor: colors.border }]}
                    activeOpacity={0.7}
                  >
                    <Text
                      size="base"
                      weight="medium"
                      style={{ color: colors.text, textAlign: 'center' }}
                    >
                      {t('common.close')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
    marginTop: spacingPixels[4],
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    padding: spacingPixels[1],
    marginLeft: spacingPixels[2],
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
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  participantAvatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarBadge: {
    position: 'absolute',
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
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
  invitePlayersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[1],
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
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
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
    width: 30,
    height: 30,
    borderRadius: 15,
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
  locationCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationChevron: {
    marginLeft: spacingPixels[2],
    marginRight: spacingPixels[1],
    flexShrink: 0,
  },
  mapContainer: {
    marginTop: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapView: {
    width: '100%',
    height: 150,
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
    alignItems: 'stretch',
  },
  actionButtonsContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: spacingPixels[2],
    minWidth: 0, // Allow shrinking
  },
  actionButtonsContainerColumn: {
    flex: 0,
    flexDirection: 'row',
    width: '100%',
  },
  actionButtonFullWidth: {
    width: '100%',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
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
    gap: spacingPixels[1],
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
  matchEndedContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    gap: spacingPixels[2],
  },
  matchEndedText: {
    textAlign: 'center',
  },
  // Cost section – breakdown card
  costCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    alignItems: 'center',
  },
  costCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[5],
  },
  costCardColumn: {
    alignItems: 'center',
    minWidth: 72,
  },
  costAmount: {
    marginTop: spacingPixels[1],
    lineHeight: 40,
  },
  costCardDivider: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[4],
  },
  costCardDividerLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
  costFreeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  costFreeText: {
    textAlign: 'center',
  },
  // Date & time section – breakdown card
  dateTimeCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  dateTimeMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[5],
  },
  dateTimeColumn: {
    alignItems: 'center',
    minWidth: 60,
  },
  dateTimeValue: {
    marginTop: spacingPixels[1],
  },
  dateTimeDivider: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  dateTimeDividerLine: {
    width: 1,
    height: 32,
    borderRadius: 0.5,
  },
  dateTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  // Score section – scoreboard card
  scoreboardCardWrapper: {
    position: 'relative',
  },
  scoreboardCardBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  scoreboardCardContent: {
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    alignItems: 'center',
  },
  scoreboardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[5],
  },
  scoreboardTeam: {
    alignItems: 'center',
    minWidth: 72,
  },
  scoreboardTeamScore: {
    marginTop: spacingPixels[1],
    lineHeight: 40,
  },
  scoreboardDivider: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[5],
  },
  scoreboardDividerLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
  scoreboardSets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
  scoreboardSetPill: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  scoreboardStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  scoreboardStatusText: {
    marginLeft: spacingPixels[1.5],
  },
  // Badge info modal (follows ConfirmationModal design)
  badgeInfoButton: {
    marginLeft: spacingPixels[1],
  },
  badgeInfoBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
  },
  badgeInfoModal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radiusPixels.xl,
    paddingTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  badgeInfoTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  badgeInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  badgeInfoIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  badgeInfoTextContainer: {
    flex: 1,
  },
  badgeInfoButtonContainer: {
    marginTop: spacingPixels[4],
  },
  badgeInfoCloseButton: {
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: 1,
  },
  // Header sport + format row
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  headerFormatBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  // Hosted By section
  hostedByCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
  },
  hostedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  hostedByAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
  },
  hostedByAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  hostedByAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostedByInfo: {
    flex: 1,
    minWidth: 0,
  },
  hostedByRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[0.5],
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  hostedByReputationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[0.5],
  },
  hostedByTierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[0.5],
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  // Participant pressable (for avatar scale feel)
  participantPressable: {
    // TouchableOpacity handles opacity; this provides a subtle transform base
  },
  // Score confirmation progress row
  scoreboardStatusRow: {
    alignItems: 'center',
    marginTop: spacingPixels[3],
    gap: spacingPixels[1.5],
  },
  // Custom map marker
  glassMarkerContainer: {
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  glassMarkerGlow: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassMarkerBody: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glassMarkerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  glassMarkerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 3,
  },
  // Notes blockquote
  notesBlockquote: {
    borderLeftWidth: 3,
    borderRadius: radiusPixels.md,
    paddingLeft: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    paddingRight: spacingPixels[3],
  },
});

export default MatchDetailSheet;

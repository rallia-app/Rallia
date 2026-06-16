/**
 * TournamentDetail Screen
 *
 * Read-only summary plus organizer/registrant action affordances.
 *
 * V1: hero, format/schedule/visibility cards, "Coming soon" placeholder.
 * V2: open/close registration (organizer), self-register/withdraw
 *     (registrant), registrations count.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1, §V2
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Platform,
  Pressable,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  accent,
  neutral,
  secondary,
  duration,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic, getHumanName } from '@rallia/shared-utils';
import {
  useTheme,
  useTournament,
  useTournamentRegistrations,
  useMyTournamentRegistration,
  useOpenTournamentRegistration,
  useCloseTournamentRegistration,
  useRegisterForTournament,
  useWithdrawFromTournament,
  useRemoveTournamentRegistration,
  useApproveTournamentRegistration,
  useTournamentInvitePreview,
  useJoinTournamentViaInvite,
  useTournamentMatches,
  useGenerateTournamentBracket,
  useCancelTournament,
  useArchiveTournament,
  useProfilesByIds,
  useTournamentParticipants,
  useSports,
  useAuth,
} from '@rallia/shared-hooks';
import type { Enums, Tables } from '@rallia/shared-types';
import { getTierConfig, getTournamentChat } from '@rallia/shared-services';
import type {
  PlayerSearchResult,
  ReputationDisplay,
  ReputationTier,
} from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import { useActionsSheet } from '../context';
import { ConfirmationModal } from '../components/ConfirmationModal';
import PlayerCard from '../features/community/components/PlayerCard';
import { ChampionCard } from '../features/tournaments/components/ChampionCard';
import type { RootStackParamList } from '../navigation';

type TournamentDetailRoute = RouteProp<RootStackParamList, 'TournamentDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type Status = Enums<'tournament_status'>;
type Visibility = Enums<'tournament_visibility'>;
type RegistrationMode = Enums<'tournament_registration_mode'>;
type BracketType = Enums<'bracket_type'>;
type EntryFormat = Enums<'entry_format'>;
type MatchFormat = Enums<'match_format'>;

const VISIBILITY_LABEL_KEY: Record<Visibility, string> = {
  private: 'tournamentDetail.values.private',
  public: 'tournamentDetail.values.public',
  community: 'tournamentDetail.values.community',
};
const REG_MODE_LABEL_KEY: Record<RegistrationMode, string> = {
  open: 'tournamentDetail.values.open',
  approval: 'tournamentDetail.values.approval',
  invite_only: 'tournamentDetail.values.inviteOnly',
};
const BRACKET_TYPE_LABEL_KEY: Record<BracketType, string> = {
  single_elimination: 'tournamentDetail.values.singleElimination',
  double_elimination: 'tournamentDetail.values.doubleElimination',
};
const ENTRY_FORMAT_LABEL_KEY: Record<EntryFormat, string> = {
  singles: 'tournamentDetail.values.singles',
  doubles: 'tournamentDetail.values.doubles',
  mixed_doubles: 'tournamentDetail.values.mixedDoubles',
};
const MATCH_FORMAT_LABEL_KEY: Record<MatchFormat, string> = {
  one_set: 'tournamentDetail.values.oneSet',
  two_of_three: 'tournamentDetail.values.twoOfThree',
  three_of_five: 'tournamentDetail.values.threeOfFive',
  pickleball_to_11: 'tournamentDetail.values.pickleballTo11',
  pickleball_to_15: 'tournamentDetail.values.pickleballTo15',
  pickleball_to_21: 'tournamentDetail.values.pickleballTo21',
};

const STATUS_TONE: Record<Status, 'neutral' | 'positive' | 'active' | 'muted'> = {
  draft: 'neutral',
  registration_open: 'positive',
  registration_closed: 'neutral',
  in_progress: 'active',
  completed: 'muted',
  cancelled: 'muted',
  archived: 'muted',
};

interface ScreenColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  statusNeutralBg: string;
  statusNeutralText: string;
  statusPositiveBg: string;
  statusPositiveText: string;
  statusActiveBg: string;
  statusActiveText: string;
  statusMutedBg: string;
  statusMutedText: string;
  cancelledBg: string;
  cancelledBorder: string;
  cancelledText: string;
  highlightBg: string;
  highlightBorder: string;
  secondaryHighlightBg: string;
  secondaryHighlightBorder: string;
  secondaryAccent: string;
  secondaryAccentBg: string;
  championBg: string;
  championText: string;
  danger: string;
  dangerBg: string;
}

// =============================================================================

const InfoRow: React.FC<{ label: string; value: string; colors: ScreenColors }> = ({
  label,
  value,
  colors,
}) => (
  <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
    <Text size="sm" color={colors.textMuted}>
      {label}
    </Text>
    <Text size="base" weight="semibold" color={colors.text}>
      {value}
    </Text>
  </View>
);

const Section: React.FC<{ title: string; children: React.ReactNode; colors: ScreenColors }> = ({
  title,
  children,
  colors,
}) => (
  <View style={styles.section}>
    <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
      {title.toUpperCase()}
    </Text>
    <View
      style={[styles.card, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      {children}
    </View>
  </View>
);

const StatusBadge: React.FC<{
  status: Status;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ status, colors, t }) => {
  const tone = STATUS_TONE[status];
  const bg =
    tone === 'positive'
      ? colors.statusPositiveBg
      : tone === 'active'
        ? colors.statusActiveBg
        : tone === 'muted'
          ? colors.statusMutedBg
          : colors.statusNeutralBg;
  const fg =
    tone === 'positive'
      ? colors.statusPositiveText
      : tone === 'active'
        ? colors.statusActiveText
        : tone === 'muted'
          ? colors.statusMutedText
          : colors.statusNeutralText;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(`tournamentDetail.status.${status}`)}
      </Text>
    </View>
  );
};

/**
 * Live "in progress" chip with a pulsing dot, mirroring the ongoing-match
 * indicator in MatchCard (coral/red `secondary` palette, expanding ring +
 * core glow).
 */
const LiveBadge: React.FC<{ label: string; isDark: boolean }> = ({ label, isDark }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const liveColor = isDark ? secondary[400] : secondary[500];

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: duration.extraSlow,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.6, 0.3, 0] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.7, 1] });

  return (
    <View
      style={[styles.liveBadge, { backgroundColor: `${secondary[500]}${isDark ? '30' : '1f'}` }]}
    >
      <View style={styles.liveIndicatorContainer}>
        <Animated.View
          style={[
            styles.liveRing,
            { backgroundColor: liveColor, transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
        <Animated.View
          style={[styles.liveDot, { backgroundColor: liveColor, opacity: dotOpacity }]}
        />
      </View>
      <Text size="xs" weight="bold" color={liveColor}>
        {label}
      </Text>
    </View>
  );
};

// =============================================================================
// DASHBOARD COMPONENTS
// =============================================================================

const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'people-outline',
  'git-network-outline',
  'trophy-outline',
];

/** Draft → Registration → Play → Done lifecycle pipeline. */
const LifecycleStepper: React.FC<{
  stepIndex: number;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ stepIndex, colors, t }) => {
  const labels = [
    t('tournamentDetail.dashboard.steps.draft'),
    t('tournamentDetail.dashboard.steps.registration'),
    t('tournamentDetail.dashboard.steps.play'),
    t('tournamentDetail.dashboard.steps.done'),
  ];
  return (
    <View style={styles.stepperRow}>
      {labels.map((label, i) => {
        const done = i < stepIndex;
        const active = i === stepIndex;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <View
                style={[
                  styles.stepperConnector,
                  { backgroundColor: i <= stepIndex ? colors.primary : colors.border },
                ]}
              />
            )}
            <View style={styles.stepperStep}>
              <View
                style={[
                  styles.stepperDot,
                  {
                    backgroundColor: active ? colors.statusActiveBg : 'transparent',
                    borderColor: active || done ? colors.primary : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={done ? 'checkmark' : STEP_ICONS[i]}
                  size={14}
                  color={active || done ? colors.primary : colors.textMuted}
                />
              </View>
              <Text
                size="xs"
                weight={active ? 'semibold' : 'regular'}
                color={active ? colors.primary : colors.textMuted}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
};

const StatTile: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  colors: ScreenColors;
}> = ({ icon, value, label, colors }) => (
  <View
    style={[
      styles.statTile,
      { backgroundColor: colors.cardBackground, borderColor: colors.border },
    ]}
  >
    <Ionicons name={icon} size={18} color={colors.primary} />
    <Text size="lg" weight="bold" color={colors.text}>
      {value}
    </Text>
    <Text size="xs" color={colors.textMuted} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

/**
 * Primary-tinted callout used as the organizer's "what's next" card and the
 * participant's register CTA: icon circle, title, description, optional CTA.
 */
const DashboardCtaCard: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  buttonLabel?: string;
  buttonIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
  /** Coral "leave" tone (plain card + coral button) — used for withdraw. */
  destructive?: boolean;
  /** Primary (default) or secondary palette for card tint and CTA button. */
  accent?: 'primary' | 'secondary';
  colors: ScreenColors;
  testID?: string;
}> = ({
  icon,
  title,
  description,
  buttonLabel,
  buttonIcon,
  onPress,
  disabled,
  destructive,
  accent = 'primary',
  colors,
  testID,
}) => {
  const cardBg = destructive
    ? colors.cardBackground
    : accent === 'secondary'
      ? colors.secondaryHighlightBg
      : colors.highlightBg;
  const cardBorder = destructive
    ? colors.border
    : accent === 'secondary'
      ? colors.secondaryHighlightBorder
      : colors.highlightBorder;
  const iconBg = destructive
    ? colors.dangerBg
    : accent === 'secondary'
      ? colors.secondaryAccentBg
      : colors.statusActiveBg;
  const iconColor = destructive
    ? colors.danger
    : accent === 'secondary'
      ? colors.secondaryAccent
      : colors.primary;
  const buttonBg = destructive
    ? colors.danger
    : accent === 'secondary'
      ? colors.secondaryAccent
      : colors.primary;

  return (
    <View
      style={[styles.section, styles.ctaCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
    >
      <View style={styles.ctaCardHeader}>
        <View style={[styles.ctaCardIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <View style={styles.ctaCardTextBlock}>
          <Text size="base" weight="bold" color={colors.text}>
            {title}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.ctaCardDescription}>
            {description}
          </Text>
        </View>
      </View>
      {buttonLabel && onPress && (
        <TouchableOpacity
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.7}
          style={[
            styles.primaryButton,
            { backgroundColor: buttonBg },
            disabled && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          testID={testID}
        >
          {buttonIcon && <Ionicons name={buttonIcon} size={20} color="#ffffff" />}
          <Text size="base" weight="semibold" color="#ffffff">
            {buttonLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// Mirror PlayerDirectory: derive reputation display straight from the row,
// no extra API call. Hidden unless the player's reputation is public.
function reputationDisplayFor(player: PlayerSearchResult): ReputationDisplay | undefined {
  if (!player.reputation_tier || !player.reputation_is_public) return undefined;
  const tier = player.reputation_tier as ReputationTier;
  const cfg = getTierConfig(tier);
  return {
    tier,
    score: player.reputation_score ?? 100,
    isVisible: player.reputation_is_public,
    tierLabel: cfg.label,
    tierColor: cfg.color,
    tierIcon: cfg.icon,
  };
}

/** Registered players rendered with the shared community PlayerCard.
 *  onRemovePress is set only when the caller may remove registrants
 *  (organizer, pre-bracket); the organizer's own row never shows it. */
const ParticipantsSection: React.FC<{
  players: PlayerSearchResult[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onRemovePress?: (player: PlayerSearchResult) => void;
  currentUserId?: string;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ players, onPlayerPress, onRemovePress, currentUserId, colors, t }) => {
  return (
    <View>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
        {t('tournamentDetail.dashboard.participants.title')}
      </Text>
      {players.length === 0 ? (
        <View style={styles.participantEmpty}>
          <Text size="sm" color={colors.textMuted}>
            {t('tournamentDetail.dashboard.participants.empty')}
          </Text>
        </View>
      ) : (
        players.map(player => (
          <PlayerCard
            key={player.id}
            player={player}
            onPress={onPlayerPress}
            reputationDisplay={reputationDisplayFor(player)}
            showActivity={false}
            trailingAction={
              onRemovePress && player.id !== currentUserId
                ? {
                    icon: 'person-remove-outline',
                    accessibilityLabel: t('tournamentDetail.dashboard.participants.removeLabel', {
                      name: getHumanName(player, ''),
                    }),
                    onPress: onRemovePress,
                  }
                : undefined
            }
          />
        ))
      )}
    </View>
  );
};

type PendingRequestRow = {
  player: PlayerSearchResult;
  registrationId: string;
  version: number;
};

/** Organizer-only approval queue (approval-mode tournaments, pre-bracket).
 *  One PlayerCard per pending registration with Approve / Decline actions.
 *  Display data is reused from the enriched participants list; the registration
 *  row supplies id + version for the optimistic-locked RPCs. */
const PendingRequestsSection: React.FC<{
  rows: PendingRequestRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onApprove: (registrationId: string, version: number) => void;
  onDecline: (player: PlayerSearchResult) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onApprove, onDecline, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
        {t('tournamentDetail.dashboard.pendingRequests.title', {
          count: String(rows.length),
        })}
      </Text>
      {rows.map(({ player, registrationId, version }) => (
        <PlayerCard
          key={registrationId}
          player={player}
          onPress={onPlayerPress}
          reputationDisplay={reputationDisplayFor(player)}
          showActivity={false}
          trailingActions={[
            {
              icon: 'checkmark-circle',
              color: colors.statusPositiveText,
              accessibilityLabel: t('tournamentDetail.dashboard.pendingRequests.approveLabel', {
                name: getHumanName(player, ''),
              }),
              onPress: () => onApprove(registrationId, version),
            },
            {
              icon: 'close-circle',
              color: colors.danger,
              accessibilityLabel: t('tournamentDetail.dashboard.pendingRequests.declineLabel', {
                name: getHumanName(player, ''),
              }),
              onPress: () => onDecline(player),
            },
          ]}
        />
      ))}
    </View>
  );
};

// =============================================================================

export const TournamentDetail: React.FC = () => {
  const { params } = useRoute<TournamentDetailRoute>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;

  const {
    data: directTournament,
    isLoading,
    isError,
    refetch,
  } = useTournament(params.tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(params.tournamentId);
  const { data: myRegistration } = useMyTournamentRegistration(params.tournamentId, userId);
  const { sports } = useSports();
  const { openSheetForTournamentEdit } = useActionsSheet();

  // Invite-token fallback: when the direct fetch comes back empty (private
  // tournament, caller not yet registered → RLS hides the row), a valid
  // token still renders the page via the preview RPC.
  const invitePreviewEnabled = !!params.inviteToken && !isLoading && !directTournament;
  const {
    data: invitePreview,
    isLoading: invitePreviewLoading,
    isError: inviteInvalid,
  } = useTournamentInvitePreview(params.inviteToken, invitePreviewEnabled);
  const tournament = directTournament ?? invitePreview?.tournament ?? null;

  const isOrganizer = !!tournament && !!userId && tournament.organizer_id === userId;
  const myActiveRegistration =
    myRegistration &&
    (myRegistration.status === 'registered' || myRegistration.status === 'pending')
      ? myRegistration
      : null;

  // Tournament chat (trigger-managed conversation). RLS only returns it to
  // participants, so an existing id doubles as the access check.
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const isChatMember = isOrganizer || myRegistration?.status === 'registered';
  useEffect(() => {
    let isMounted = true;
    if (!userId || !isChatMember) {
      setChatConversationId(null);
      return;
    }
    getTournamentChat(params.tournamentId).then(conversation => {
      if (isMounted) setChatConversationId(conversation?.id ?? null);
    });
    return () => {
      isMounted = false;
    };
  }, [params.tournamentId, userId, isChatMember]);

  const handleOpenChat = useCallback(() => {
    if (!chatConversationId || !tournament) return;
    lightHaptic();
    navigation.navigate('ChatConversation', {
      conversationId: chatConversationId,
      title: tournament.name,
    });
  }, [chatConversationId, tournament, navigation]);
  // RLS hides other players' registrations on private tournaments, so the
  // token preview supplies the count until the caller registers.
  const activeCount = directTournament ? registrations.length : (invitePreview?.activeCount ?? 0);

  const showError = useCallback(
    (errMsg: string, fallbackKey: TranslationKey) => {
      const lower = errMsg.toLowerCase();
      // Partner codes come first: partner_already_registered and
      // partner_sport_mismatch contain the bare codes as substrings.
      const key: TranslationKey = lower.includes('partner_already_registered')
        ? 'tournamentDetail.errors.partnerAlreadyRegistered'
        : lower.includes('partner_sport_mismatch')
          ? 'tournamentDetail.errors.partnerSportMismatch'
          : lower.includes('partner_required')
            ? 'tournamentDetail.errors.partnerRequired'
            : lower.includes('partner_invalid') || lower.includes('partner_not_allowed')
              ? 'tournamentDetail.errors.partnerInvalid'
              : lower.includes('invite_invalid')
                ? 'tournamentDetail.errors.inviteInvalid'
                : lower.includes('sport_mismatch')
                  ? 'tournamentDetail.errors.sportMismatch'
                  : lower.includes('tournament_full')
                    ? 'tournamentDetail.errors.tournamentFull'
                    : lower.includes('already_registered')
                      ? 'tournamentDetail.errors.alreadyRegistered'
                      : lower.includes('not_invited')
                        ? 'tournamentDetail.errors.notInvited'
                        : lower.includes('optimistic_lock')
                          ? 'tournamentDetail.errors.lockConflict'
                          : lower.includes('start_passed')
                            ? 'tournamentDetail.errors.startPassed'
                            : lower.includes('withdraw_not_allowed')
                              ? 'tournamentDetail.errors.withdrawClosed'
                              : lower.includes('registration_removed')
                                ? 'tournamentDetail.errors.registrationRemoved'
                                : lower.includes('approve_not_allowed')
                                  ? 'tournamentDetail.errors.approveNotAllowed'
                                  : lower.includes('remove_not_allowed')
                                    ? 'tournamentDetail.errors.removeNotAllowed'
                                    : lower.includes('registration_not_found')
                                      ? 'tournamentDetail.errors.lockConflict'
                                      : lower.includes('tournament_reg_closed') ||
                                          lower.includes('reg_closed')
                                        ? 'tournamentDetail.errors.regClosed'
                                        : fallbackKey;
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  const open = useOpenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.openFailed'),
  });
  const close = useCloseTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.closeFailed'),
  });
  const register = useRegisterForTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.registerFailed'),
  });
  const joinViaInvite = useJoinTournamentViaInvite({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.inviteLanding.joinedToast'));
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'registered',
      });
    },
    onError: e => {
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'error',
        errorCode: e.message,
      });
      showError(e.message, 'tournamentDetail.errors.registerFailed');
    },
  });
  const registerPending = register.isPending || joinViaInvite.isPending;
  const withdraw = useWithdrawFromTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed'),
  });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PlayerSearchResult | null>(null);
  const insets = useSafeAreaInsets();

  // Decline reuses the remove RPC (sets 'disqualified'); the ref lets the
  // shared mutation callbacks pick decline- vs remove-flavored copy.
  const declineModeRef = useRef(false);

  const removeRegistrant = useRemoveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      setRemoveTarget(null);
      toast.success(
        t(
          declineModeRef.current
            ? 'tournamentDetail.declineModal.success'
            : 'tournamentDetail.removeModal.success'
        )
      );
    },
    onError: e => {
      setRemoveTarget(null);
      showError(
        e.message,
        declineModeRef.current
          ? 'tournamentDetail.errors.declineFailed'
          : 'tournamentDetail.errors.removeFailed'
      );
    },
  });

  const approveRegistrant = useApproveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.dashboard.pendingRequests.approvedToast'));
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.approveFailed'),
  });

  const cancel = useCancelTournament({
    onSuccess: () => {
      successHaptic();
      setShowCancelModal(false);
      setCancelReason('');
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('not_cancellable')
        ? 'tournamentDetail.cancelModal.errorNotCancellable'
        : msg.includes('optimistic_lock')
          ? 'tournamentDetail.cancelModal.errorLockConflict'
          : 'tournamentDetail.cancelModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const archive = useArchiveTournament({
    onSuccess: () => {
      successHaptic();
      setShowArchiveModal(false);
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('not_archivable')
        ? 'tournamentDetail.archiveModal.errorNotArchivable'
        : msg.includes('optimistic_lock')
          ? 'tournamentDetail.archiveModal.errorLockConflict'
          : 'tournamentDetail.archiveModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const generateBracket = useGenerateTournamentBracket({
    onSuccess: () => successHaptic(),
    onError: e => {
      const lower = e.message.toLowerCase();
      const key: TranslationKey = lower.includes('insufficient_participants')
        ? 'tournamentDetail.generateBracketErrors.insufficientParticipants'
        : lower.includes('bracket_already_generated')
          ? 'tournamentDetail.generateBracketErrors.alreadyGenerated'
          : lower.includes('tournament_not_draft')
            ? 'tournamentDetail.generateBracketErrors.wrongStatus'
            : 'tournamentDetail.generateBracketErrors.generic';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const onOpen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    open.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, open]);

  const onClose = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    close.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, close]);

  const isDoubles = !!tournament && tournament.entry_format !== 'singles';

  // Invite-only invitees land a 'pending' row the organizer never approves —
  // they accept it themselves (tournament_register flips pending → registered).
  // Distinct from approval-mode pending, which is passive (await organizer).
  const isInvitePending =
    !!myActiveRegistration &&
    myActiveRegistration.status === 'pending' &&
    tournament?.registration_mode === 'invite_only';

  const onRegister = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Accepting an existing pending invite flips it via tournament_register
    // (join-via-invite is idempotent on a pending row and wouldn't confirm it);
    // a fresh invitee with only a share link redeems the token. Organizers and
    // direct registrants take the normal path. Doubles routes through the
    // partner picker first in every case.
    const inviteToken = !isOrganizer && !isInvitePending ? params.inviteToken : undefined;
    if (isDoubles) {
      void SheetManager.show('tournament-partner-picker', {
        payload: {
          sportId: tournament.sport_id,
          onPick: partner => {
            if (inviteToken) {
              joinViaInvite.mutate({
                token: inviteToken,
                tournamentId: tournament.id,
                partnerId: partner.id,
              });
            } else {
              register.mutate({ tournamentId: tournament.id, partnerId: partner.id });
            }
          },
        },
      });
      return;
    }
    if (inviteToken) {
      joinViaInvite.mutate({ token: inviteToken, tournamentId: tournament.id });
      return;
    }
    register.mutate({ tournamentId: tournament.id });
  }, [
    tournament,
    isDoubles,
    isInvitePending,
    register,
    joinViaInvite,
    params.inviteToken,
    isOrganizer,
  ]);

  const onWithdraw = useCallback(() => {
    if (!tournament || !myActiveRegistration) return;
    lightHaptic();
    withdraw.mutate({
      registrationId: myActiveRegistration.id,
      versionWas: myActiveRegistration.version,
      tournamentId: tournament.id,
    });
  }, [tournament, myActiveRegistration, withdraw]);

  const onGenerateBracket = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    generateBracket.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, generateBracket]);

  // Bracket: only fetch when the bracket has been generated (status >= in_progress).
  const bracketStatuses: ReadonlyArray<Enums<'tournament_status'>> = [
    'registration_closed',
    'in_progress',
    'completed',
    'archived',
  ];
  const shouldFetchBracket = !!tournament && bracketStatuses.includes(tournament.status);
  const { data: matches = [] } = useTournamentMatches(
    shouldFetchBracket ? tournament?.id : undefined
  );

  // Map registration_id → seed number (1-indexed). The order matches the
  // RPC's seeding criteria so the labels here line up with the bracket.
  const seedByRegId = useMemo(() => {
    const map = new Map<string, number>();
    [...registrations]
      .sort((a, b) => {
        const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const ta = new Date(a.registered_at).getTime();
        const tb = new Date(b.registered_at).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      })
      .forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [registrations]);

  // Map registration_id → member user ids (captain first, partner second for
  // doubles), used to decide whether the caller can tap into a bracket match.
  const membersByRegId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of registrations) {
      map.set(r.id, r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]);
    }
    return map;
  }, [registrations]);

  // Batch-fetch player profiles so the bracket and players list can render
  // real names; includes the organizer for the hero byline.
  const userIds = useMemo(
    () => [
      ...registrations.flatMap(r =>
        r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]
      ),
      ...(tournament ? [tournament.organizer_id] : []),
    ],
    [registrations, tournament]
  );
  const { data: profiles } = useProfilesByIds(userIds);
  const nameByRegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of registrations) {
      const p = profiles?.[r.user_id];
      // Always use first (+ last). display_name is intentionally ignored
      // per the app-wide convention in @rallia/shared-utils/getHumanName.
      const name = p ? getHumanName(p, '') : '';
      // Doubles entries render as a pair label ("Alex & Sam") everywhere the
      // registration is shown: bracket slots, champion, opponent, score sheet.
      const partner = r.partner_user_id ? profiles?.[r.partner_user_id] : undefined;
      const partnerName = partner ? getHumanName(partner, '') : '';
      const label = partnerName && name ? `${name} & ${partnerName}` : name;
      if (label) map.set(r.id, label);
    }
    return map;
  }, [registrations, profiles]);

  // Seed-ordered participants enriched with rating/reputation/online, fetched
  // server-side so the Players tab renders full community PlayerCards.
  const { data: participantPlayers = [] } = useTournamentParticipants(params.tournamentId);

  // Registrant removal is a pre-bracket organizer tool; participant rows map
  // back to their registration (id + version) through user_id.
  const canRemoveRegistrants =
    isOrganizer &&
    (tournament?.status === 'registration_open' || tournament?.status === 'registration_closed');

  const registrationByUserId = useMemo(() => {
    const map = new Map<string, (typeof registrations)[number]>();
    for (const r of registrations) {
      map.set(r.user_id, r);
      // Removing either member of a doubles pair removes the whole entry.
      if (r.partner_user_id) map.set(r.partner_user_id, r);
    }
    return map;
  }, [registrations]);

  // Enriched participant cards keyed by player id, for the pending queue.
  const participantById = useMemo(() => {
    const map = new Map<string, PlayerSearchResult>();
    for (const p of participantPlayers) map.set(p.id, p);
    return map;
  }, [participantPlayers]);

  // Registered list excludes pending approvals — those render in PendingRequestsSection.
  const registeredParticipantPlayers = useMemo(
    () => participantPlayers.filter(p => registrationByUserId.get(p.id)?.status !== 'pending'),
    [participantPlayers, registrationByUserId]
  );

  // Organizer approval queue: one entry per pending registration, enriched with
  // the captain's participant card. Same pre-bracket + organizer gate as remove.
  const pendingRequestRows = useMemo<PendingRequestRow[]>(() => {
    if (!canRemoveRegistrants) return [];
    const rows: PendingRequestRow[] = [];
    for (const r of registrations) {
      if (r.status !== 'pending') continue;
      const player = participantById.get(r.user_id);
      if (player) rows.push({ player, registrationId: r.id, version: r.version });
    }
    return rows;
  }, [registrations, participantById, canRemoveRegistrants]);

  const handleRemovePress = useCallback((player: PlayerSearchResult) => {
    lightHaptic();
    setRemoveTarget(player);
  }, []);

  // Decline a pending request reuses the remove confirmation modal, but with
  // decline-flavored copy and the disqualify-is-terminal warning.
  const removeTargetIsPending = useMemo(
    () => (removeTarget ? registrationByUserId.get(removeTarget.id)?.status === 'pending' : false),
    [removeTarget, registrationByUserId]
  );

  const confirmRemove = useCallback(() => {
    if (!tournament || !removeTarget) return;
    const reg = registrationByUserId.get(removeTarget.id);
    if (!reg) {
      setRemoveTarget(null);
      warningHaptic();
      toast.error(t('tournamentDetail.errors.lockConflict'));
      return;
    }
    declineModeRef.current = reg.status === 'pending';
    removeRegistrant.mutate({
      registrationId: reg.id,
      versionWas: reg.version,
      tournamentId: tournament.id,
    });
  }, [tournament, removeTarget, registrationByUserId, removeRegistrant, toast, t]);

  const handleApprovePress = useCallback(
    (registrationId: string, version: number) => {
      if (!tournament || approveRegistrant.isPending) return;
      lightHaptic();
      approveRegistrant.mutate({
        registrationId,
        versionWas: version,
        tournamentId: tournament.id,
      });
    },
    [tournament, approveRegistrant]
  );

  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!tournament) return;
      lightHaptic();
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: tournament.sport_id,
      });
    },
    [navigation, tournament]
  );

  // ---------------------------------------------------------------------------
  // Dashboard-derived state
  // ---------------------------------------------------------------------------

  const organizerName = useMemo(() => {
    if (!tournament) return '';
    const p = profiles?.[tournament.organizer_id];
    return p ? getHumanName(p, '') : '';
  }, [profiles, tournament]);

  // Doubles: the other member of the caller's pair, for the hero label.
  const myPartnerName = useMemo(() => {
    if (!myActiveRegistration?.partner_user_id || !userId) return '';
    const otherId =
      myActiveRegistration.user_id === userId
        ? myActiveRegistration.partner_user_id
        : myActiveRegistration.user_id;
    const p = profiles?.[otherId];
    return p ? getHumanName(p, '') : '';
  }, [myActiveRegistration, userId, profiles]);

  const myRegId = myActiveRegistration?.id ?? null;

  const totalRounds = useMemo(
    () => matches.reduce((max, m) => Math.max(max, m.round_number), 0),
    [matches]
  );

  const championName = useMemo(() => {
    if (!totalRounds) return null;
    const final = matches.find(m => m.round_number === totalRounds && m.winner_registration_id);
    if (!final?.winner_registration_id) return null;
    return (
      nameByRegId.get(final.winner_registration_id) ??
      `Seed ${seedByRegId.get(final.winner_registration_id) ?? '?'}`
    );
  }, [matches, totalRounds, nameByRegId, seedByRegId]);

  // Playable games only — bye/phantom slots auto-advance and are never played.
  const matchProgress = useMemo(() => {
    const real = matches.filter(m => !m.player1_is_bye && !m.player2_is_bye);
    return { done: real.filter(m => !!m.winner_registration_id).length, total: real.length };
  }, [matches]);

  const myNextMatch = useMemo(() => {
    if (!myRegId) return null;
    return (
      matches
        .filter(
          m =>
            m.status === 'pending' &&
            !m.player1_is_bye &&
            !m.player2_is_bye &&
            (m.player1_registration_id === myRegId || m.player2_registration_id === myRegId)
        )
        .sort((a, b) => a.round_number - b.round_number)[0] ?? null
    );
  }, [matches, myRegId]);

  const myBracketState = useMemo<'next' | 'waiting' | 'eliminated' | 'champion' | null>(() => {
    if (!myRegId || tournament?.status !== 'in_progress') return null;
    if (myNextMatch) {
      return myNextMatch.player1_registration_id && myNextMatch.player2_registration_id
        ? 'next'
        : 'waiting';
    }
    const mine = matches.filter(
      m => m.player1_registration_id === myRegId || m.player2_registration_id === myRegId
    );
    if (mine.some(m => m.winner_registration_id && m.winner_registration_id !== myRegId)) {
      return 'eliminated';
    }
    const final = matches.find(m => m.round_number === totalRounds);
    return final?.winner_registration_id === myRegId ? 'champion' : 'waiting';
  }, [myRegId, tournament?.status, myNextMatch, matches, totalRounds]);

  const myOpponentLabel = useMemo(() => {
    if (!myNextMatch || !myRegId) return null;
    const oppId =
      myNextMatch.player1_registration_id === myRegId
        ? myNextMatch.player2_registration_id
        : myNextMatch.player1_registration_id;
    if (!oppId) return null;
    return nameByRegId.get(oppId) ?? `Seed ${seedByRegId.get(oppId) ?? '?'}`;
  }, [myNextMatch, myRegId, nameByRegId, seedByRegId]);

  // Flashscore-style content tabs (Overview / Bracket / Players / Details)
  const [activeTabIdx, setActiveTabIdx] = useState(0);

  const handleBracketMatchTap = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      const team1 = membersByRegId.get(p1RegId);
      const team2 = membersByRegId.get(p2RegId);
      if (!team1?.length || !team2?.length || !tournament) return;
      lightHaptic();
      SheetManager.show('tournament-link-match', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          sportId: tournament.sport_id,
          entryFormat: tournament.entry_format,
          team1UserIds: team1,
          team2UserIds: team2,
        },
      });
    },
    [membersByRegId, tournament]
  );

  // Organizer-only: record an authoritative result for a stalled/disputed
  // bracket match via the structured set-entry sheet.
  const handleOrganizerOverride = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      if (!tournament) return;
      lightHaptic();
      const sportName = sports.find(s => s.id === tournament.sport_id)?.name;
      SheetManager.show('tournament-record-score', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          player1RegId: p1RegId,
          player2RegId: p2RegId,
          player1Name: nameByRegId.get(p1RegId) ?? `Seed ${seedByRegId.get(p1RegId) ?? '?'}`,
          player2Name: nameByRegId.get(p2RegId) ?? `Seed ${seedByRegId.get(p2RegId) ?? '?'}`,
          isPickleball: sportName === 'pickleball',
          onSuccess: () => {
            successHaptic();
          },
        },
      });
    },
    [tournament, sports, nameByRegId, seedByRegId]
  );

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ScreenColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[500] : primary[600],
      statusNeutralBg: isDark ? neutral[700] : neutral[200],
      statusNeutralText: isDark ? neutral[100] : neutral[700],
      statusPositiveBg: isDark ? '#16a34a30' : '#dcfce7',
      statusPositiveText: isDark ? '#86efac' : '#15803d',
      statusActiveBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      statusActiveText: isDark ? primary[300] : primary[700],
      statusMutedBg: isDark ? neutral[800] : neutral[100],
      statusMutedText: isDark ? neutral[400] : neutral[500],
      cancelledBg: isDark ? '#7c2d1230' : '#fef3c7',
      cancelledBorder: isDark ? '#f59e0b' : '#fbbf24',
      cancelledText: isDark ? '#fbbf24' : '#92400e',
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      secondaryHighlightBg: isDark ? secondary[950] : secondary[50],
      secondaryHighlightBorder: isDark ? `${secondary[400]}40` : `${secondary[500]}20`,
      secondaryAccent: isDark ? secondary[400] : secondary[500],
      secondaryAccentBg: isDark ? `${secondary[500]}30` : `${secondary[500]}20`,
      championBg: isDark ? `${accent[400]}25` : `${accent[500]}15`,
      championText: isDark ? accent[400] : accent[600],
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
    }),
    [themeColors, isDark]
  );

  // Organizer admin actions surfaced via the header "⋯" overflow menu.
  const adminActions = useMemo(() => {
    const s = tournament?.status;
    // Details are only editable before registration closes (draft / open).
    const canEdit = s === 'draft' || s === 'registration_open';
    // Links can be shared ahead of opening — they redeem once registration opens.
    const canInvite = s === 'draft' || s === 'registration_open';
    const canCancel =
      s === 'draft' ||
      s === 'registration_open' ||
      s === 'registration_closed' ||
      s === 'in_progress';
    const canArchive = s === 'completed' || s === 'cancelled';
    const enabled = isOrganizer && (canEdit || canInvite || canCancel || canArchive);
    return { canEdit, canInvite, canCancel, canArchive, enabled };
  }, [isOrganizer, tournament?.status]);

  // Creation-success handoff: land here with openInviteSheet=true and the
  // invite sheet opens once, after the screen settles. The param is cleared
  // inside the timeout — clearing it synchronously re-runs this effect and
  // the cleanup would cancel the timer before it fires.
  useEffect(() => {
    if (!params.openInviteSheet || !isOrganizer || !tournament) return;
    const { id: tournamentId, name: tournamentName } = tournament;
    const timer = setTimeout(() => {
      navigation.setParams({ openInviteSheet: undefined });
      void SheetManager.show('tournament-invite', {
        payload: { tournamentId, tournamentName },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [params.openInviteSheet, isOrganizer, tournament, navigation]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: adminActions.enabled
        ? () => (
            <TouchableOpacity
              onPress={() => {
                lightHaptic();
                setShowActionsMenu(true);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('tournamentDetail.sections.manage')}
              style={styles.headerMenuButton}
              testID="tournament-overflow-menu"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, adminActions.enabled, colors.text, t]);

  const sport = useMemo(
    () => sports.find(s => s.id === tournament?.sport_id),
    [sports, tournament]
  );

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  if (isLoading || (invitePreviewEnabled && invitePreviewLoading)) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" color={colors.textMuted} style={styles.centeredText}>
            {t('tournamentDetail.loading')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('tournamentDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!tournament) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidTitle')
              : t('tournamentDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidDescription')
              : t('tournamentDetail.notFoundDescription')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const daysToStart = Math.round(
    (new Date(tournament.start_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000
  );
  const spotsLeft = Math.max(0, tournament.max_participants - activeCount);
  const isLive = tournament.status === 'in_progress';
  const isFinished = tournament.status === 'completed' || tournament.status === 'archived';
  // Cancellation survives archival (status flips to 'archived', cancelled_at stays set),
  // so drive cancelled-state UI off the timestamp, not the live status.
  const wasCancelled = tournament.status === 'cancelled' || tournament.cancelled_at != null;
  const stepIndex =
    tournament.status === 'draft'
      ? 0
      : tournament.status === 'registration_open' || tournament.status === 'registration_closed'
        ? 1
        : isLive
          ? 2
          : 3;
  const startTileValue = isLive
    ? t('tournamentDetail.dashboard.stats.live')
    : isFinished
      ? t('tournamentDetail.dashboard.stats.ended')
      : daysToStart > 0
        ? t('tournamentDetail.dashboard.stats.startsInDays').replace('{n}', String(daysToStart))
        : daysToStart === 0
          ? t('tournamentDetail.dashboard.stats.startsToday')
          : new Date(tournament.start_date).toLocaleDateString(locale, {
              month: 'short',
              day: 'numeric',
            });
  const myMatchP1 = myNextMatch?.player1_registration_id ?? null;
  const myMatchP2 = myNextMatch?.player2_registration_id ?? null;
  const registerCloseHint = tournament.registration_closes_at
    ? t('tournamentList.registerBy').replace(
        '{date}',
        formatDate(tournament.registration_closes_at)
      )
    : null;

  const showBracketTab = shouldFetchBracket && matches.length > 0;
  const showPlayersTab = tournament.status !== 'draft';
  const tabs: Array<{ key: 'overview' | 'bracket' | 'players' | 'details'; label: string }> = [
    { key: 'overview', label: t('tournamentDetail.tabs.overview') },
    ...(showBracketTab
      ? [{ key: 'bracket' as const, label: t('tournamentDetail.tabs.bracket') }]
      : []),
    ...(showPlayersTab
      ? [{ key: 'players' as const, label: t('tournamentDetail.tabs.players') }]
      : []),
    { key: 'details', label: t('tournamentDetail.tabs.details') },
  ];
  const currentTabIdx = Math.min(activeTabIdx, tabs.length - 1);
  const currentTabKey = tabs[currentTabIdx].key;
  const playersTabIdx = tabs.findIndex(tab => tab.key === 'players');

  const goToTab = (idx: number) => {
    void lightHaptic();
    setActiveTabIdx(idx);
  };

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={styles.screenScrollContent}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* Hero */}
        <View style={styles.heroFixed}>
          <View
            style={[
              styles.heroCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.heroTopRow}>
              {isLive ? (
                <LiveBadge label={t('tournamentDetail.status.in_progress')} isDark={isDark} />
              ) : (
                <StatusBadge status={tournament.status} colors={colors} t={t} />
              )}
            </View>

            <Text size="2xl" weight="bold" color={colors.text} style={styles.heroTitle}>
              {tournament.name}
            </Text>
            {tournament.description ? (
              <Text
                size="sm"
                color={colors.textMuted}
                style={styles.heroDescription}
                numberOfLines={2}
              >
                {tournament.description}
              </Text>
            ) : null}

            <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

            <View style={styles.heroMetaRows}>
              <View style={styles.heroMetaRow}>
                <View style={[styles.heroMetaIcon, { backgroundColor: colors.statusActiveBg }]}>
                  <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                </View>
                <Text size="sm" weight="medium" color={colors.text} style={styles.heroMetaText}>
                  {formatDate(tournament.start_date)} – {formatDate(tournament.end_date)}
                </Text>
              </View>
              {tournament.venue_name ? (
                <View style={styles.heroMetaRow}>
                  <View style={[styles.heroMetaIcon, { backgroundColor: colors.statusMutedBg }]}>
                    <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  </View>
                  <Text
                    size="sm"
                    color={colors.textMuted}
                    numberOfLines={1}
                    style={styles.heroMetaText}
                  >
                    {tournament.venue_name}
                  </Text>
                </View>
              ) : null}
              {organizerName ? (
                <View style={styles.heroMetaRow}>
                  <View style={[styles.heroMetaIcon, { backgroundColor: colors.statusMutedBg }]}>
                    <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                  </View>
                  <Text
                    size="sm"
                    color={colors.textMuted}
                    numberOfLines={1}
                    style={styles.heroMetaText}
                  >
                    {t('tournamentDetail.dashboard.organizedBy').replace('{name}', organizerName)}
                  </Text>
                </View>
              ) : null}
            </View>

            {!isOrganizer &&
              myActiveRegistration &&
              tournament.status !== 'cancelled' &&
              tournament.status !== 'archived' && (
                <View style={[styles.heroRegistered, { backgroundColor: colors.statusPositiveBg }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.statusPositiveText} />
                  <Text size="sm" weight="semibold" color={colors.statusPositiveText}>
                    {myActiveRegistration.status === 'pending'
                      ? isInvitePending
                        ? t('tournamentDetail.actions.invitePendingLabel')
                        : t('tournamentDetail.actions.registrationPendingLabel')
                      : myPartnerName
                        ? t('tournamentDetail.actions.registeredWithPartnerLabel').replace(
                            '{name}',
                            myPartnerName
                          )
                        : t('tournamentDetail.actions.registeredLabel')}
                  </Text>
                </View>
              )}

            {chatConversationId && (
              <TouchableOpacity
                onPress={handleOpenChat}
                activeOpacity={0.8}
                style={[styles.heroChatButton, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t('tournamentDetail.chat.open')}
              >
                <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
                <Text size="sm" weight="semibold" color={colors.primary}>
                  {t('tournamentDetail.chat.open')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Sticky tab bar */}
        <View style={[styles.tabTrackSticky, { backgroundColor: colors.background }]}>
          <View style={[styles.tabTrack, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
            {tabs.map((tab, i) => {
              const selected = i === currentTabIdx;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => goToTab(i)}
                  activeOpacity={0.8}
                  style={[
                    styles.tabPill,
                    selected && [
                      styles.tabPillActive,
                      { backgroundColor: isDark ? darkTheme.card : lightTheme.card },
                    ],
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  testID={`tournament-tab-${tab.key}`}
                >
                  <Text
                    size="sm"
                    weight={selected ? 'semibold' : 'medium'}
                    color={selected ? colors.primary : colors.textMuted}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ============================ OVERVIEW ============================ */}
        {currentTabKey === 'overview' && (
          <View style={styles.tabContent}>
            {/* Cancelled-state notice (shown immediately under hero) */}
            {wasCancelled && (
              <View
                style={[
                  styles.section,
                  styles.cancelledNotice,
                  { backgroundColor: colors.cancelledBg, borderColor: colors.cancelledBorder },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={20} color={colors.cancelledText} />
                <View style={{ flex: 1 }}>
                  <Text size="sm" weight="semibold" color={colors.cancelledText}>
                    {t('tournamentDetail.cancelledNotice.title')}
                  </Text>
                  {tournament.cancelled_reason ? (
                    <Text size="xs" color={colors.cancelledText}>
                      {t('tournamentDetail.cancelledNotice.reason').replace(
                        '{reason}',
                        tournament.cancelled_reason
                      )}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            {/* Lifecycle pipeline */}
            {!wasCancelled && (
              <View
                style={[
                  styles.section,
                  styles.stepperCard,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <LifecycleStepper stepIndex={stepIndex} colors={colors} t={t} />
              </View>
            )}

            {/* Champion banner */}
            {championName && !wasCancelled && <ChampionCard name={championName} colors={colors} />}

            {isOrganizer && pendingRequestRows.length > 0 && (
              <DashboardCtaCard
                icon="hourglass-outline"
                title={t('tournamentDetail.dashboard.pendingRequestsCta.title')}
                description={t('tournamentDetail.dashboard.pendingRequestsCta.description').replace(
                  '{count}',
                  String(pendingRequestRows.length)
                )}
                buttonLabel={t('tournamentDetail.dashboard.pendingRequestsCta.review')}
                buttonIcon="people-outline"
                onPress={() => playersTabIdx >= 0 && goToTab(playersTabIdx)}
                accent="secondary"
                colors={colors}
                testID="cta-pending-requests"
              />
            )}

            {/* Organizer: what's next */}
            {isOrganizer && tournament.status === 'draft' && (
              <DashboardCtaCard
                icon="rocket-outline"
                title={t('tournamentDetail.dashboard.nextStep.draftTitle')}
                description={t('tournamentDetail.dashboard.nextStep.draftDescription')}
                buttonLabel={
                  open.isPending
                    ? t('tournamentDetail.actions.opening')
                    : t('tournamentDetail.actions.openRegistration')
                }
                buttonIcon="lock-open-outline"
                onPress={onOpen}
                disabled={open.isPending}
                colors={colors}
                testID="cta-open-registration"
              />
            )}
            {isOrganizer && tournament.status === 'registration_open' && (
              <DashboardCtaCard
                icon="people-outline"
                title={t('tournamentDetail.dashboard.nextStep.openTitle')}
                description={t('tournamentDetail.dashboard.nextStep.openDescription')
                  .replace('{count}', String(activeCount))
                  .replace('{max}', String(tournament.max_participants))}
                buttonLabel={
                  close.isPending
                    ? t('tournamentDetail.actions.closing')
                    : t('tournamentDetail.actions.closeRegistration')
                }
                buttonIcon="lock-closed-outline"
                onPress={onClose}
                disabled={close.isPending}
                colors={colors}
                testID="cta-close-registration"
              />
            )}
            {isOrganizer && tournament.status === 'registration_closed' && (
              <DashboardCtaCard
                icon="git-network-outline"
                title={t('tournamentDetail.dashboard.nextStep.closedTitle')}
                description={t('tournamentDetail.dashboard.nextStep.closedDescription').replace(
                  '{count}',
                  String(activeCount)
                )}
                buttonLabel={
                  generateBracket.isPending
                    ? t('tournamentDetail.actions.generating')
                    : t('tournamentDetail.actions.generateBracket')
                }
                buttonIcon="git-network-outline"
                onPress={onGenerateBracket}
                disabled={generateBracket.isPending}
                colors={colors}
                testID="cta-generate-bracket"
              />
            )}
            {isOrganizer && isLive && (
              <DashboardCtaCard
                icon="play-outline"
                title={t('tournamentDetail.dashboard.nextStep.liveTitle')}
                description={t('tournamentDetail.dashboard.nextStep.liveDescription')
                  .replace('{done}', String(matchProgress.done))
                  .replace('{total}', String(matchProgress.total))}
                colors={colors}
              />
            )}

            {/* Participant: register CTA */}
            {!isOrganizer && tournament.status === 'registration_open' && !myActiveRegistration && (
              <DashboardCtaCard
                icon="person-add-outline"
                title={
                  spotsLeft > 0
                    ? t('tournamentDetail.dashboard.registerCta.title')
                    : t('tournamentDetail.dashboard.registerCta.full')
                }
                description={
                  spotsLeft > 0
                    ? [
                        t(
                          isDoubles
                            ? 'tournamentDetail.dashboard.registerCta.spotsLeftTeams'
                            : 'tournamentDetail.dashboard.registerCta.spotsLeft'
                        ).replace('{n}', String(spotsLeft)),
                        registerCloseHint,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t('tournamentDetail.dashboard.registerCta.fullDescription')
                }
                buttonLabel={
                  spotsLeft > 0
                    ? registerPending
                      ? t('tournamentDetail.actions.registering')
                      : t('tournamentDetail.actions.register')
                    : undefined
                }
                buttonIcon="person-add-outline"
                onPress={spotsLeft > 0 ? onRegister : undefined}
                disabled={registerPending}
                colors={colors}
                testID="cta-register"
              />
            )}

            {/* Organizer: add myself as a player */}
            {isOrganizer && tournament.status === 'registration_open' && !myActiveRegistration && (
              <DashboardCtaCard
                icon="person-add-outline"
                title={t('tournamentDetail.dashboard.addMyselfCta.title')}
                description={t('tournamentDetail.dashboard.addMyselfCta.description')}
                buttonLabel={
                  register.isPending
                    ? t('tournamentDetail.actions.registering')
                    : t('tournamentDetail.actions.addMyself')
                }
                buttonIcon="person-add-outline"
                onPress={onRegister}
                disabled={register.isPending}
                colors={colors}
                testID="cta-add-myself"
              />
            )}

            {/* Registered (any persona): withdraw card — only while registration is open */}
            {/* Invite-only invitee: accept the pending invitation (organizer
                never approves it — the invitee confirms it themselves). */}
            {isInvitePending && (
              <DashboardCtaCard
                icon="mail-open-outline"
                title={t('tournamentDetail.dashboard.inviteCta.title')}
                description={t(
                  isDoubles
                    ? 'tournamentDetail.dashboard.inviteCta.descriptionDoubles'
                    : 'tournamentDetail.dashboard.inviteCta.description'
                )}
                buttonLabel={
                  registerPending
                    ? t('tournamentDetail.actions.accepting')
                    : t('tournamentDetail.actions.acceptInvite')
                }
                buttonIcon="checkmark-circle-outline"
                onPress={onRegister}
                disabled={registerPending}
                testID="cta-accept-invite"
                colors={colors}
              />
            )}

            {myActiveRegistration && tournament.status === 'registration_open' && (
              <DashboardCtaCard
                icon="checkmark-circle-outline"
                title={
                  myActiveRegistration.status === 'pending'
                    ? isInvitePending
                      ? t('tournamentDetail.dashboard.withdrawCta.titleInvited')
                      : t('tournamentDetail.dashboard.withdrawCta.titlePending')
                    : isDoubles
                      ? t('tournamentDetail.dashboard.withdrawCta.titleTeam')
                      : t('tournamentDetail.dashboard.withdrawCta.title')
                }
                description={
                  myActiveRegistration.status === 'pending'
                    ? isInvitePending
                      ? t('tournamentDetail.dashboard.withdrawCta.descriptionInvited')
                      : t('tournamentDetail.dashboard.withdrawCta.descriptionPending')
                    : isDoubles
                      ? t('tournamentDetail.dashboard.withdrawCta.descriptionTeam')
                      : t('tournamentDetail.dashboard.withdrawCta.description')
                }
                buttonLabel={
                  withdraw.isPending
                    ? t('tournamentDetail.actions.withdrawing')
                    : t('tournamentDetail.actions.withdraw')
                }
                buttonIcon="exit-outline"
                onPress={onWithdraw}
                disabled={withdraw.isPending}
                testID="cta-withdraw"
                destructive
                colors={colors}
              />
            )}

            {/* Participant: my next game */}
            {!isOrganizer && myBracketState && (
              <View style={styles.section}>
                <Text
                  size="xs"
                  weight="semibold"
                  color={colors.textMuted}
                  style={styles.sectionTitle}
                >
                  {t('tournamentDetail.dashboard.myMatch.title').toUpperCase()}
                </Text>
                {myBracketState === 'next' && myNextMatch && myMatchP1 && myMatchP2 ? (
                  <TouchableOpacity
                    onPress={() => handleBracketMatchTap(myNextMatch.id, myMatchP1, myMatchP2)}
                    activeOpacity={0.7}
                    style={[
                      styles.card,
                      styles.myMatchCard,
                      { backgroundColor: colors.highlightBg, borderColor: colors.primary },
                    ]}
                    accessibilityRole="button"
                  >
                    <View style={styles.myMatchMain}>
                      <Text size="lg" weight="bold" color={colors.text}>
                        {t('tournamentDetail.dashboard.myMatch.vs').replace(
                          '{name}',
                          myOpponentLabel ?? '?'
                        )}
                      </Text>
                      <Text size="xs" color={colors.textMuted}>
                        {roundLabel(myNextMatch.round_number, totalRounds, t)} ·{' '}
                        {t('tournamentDetail.dashboard.myMatch.hint')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.primary} />
                  </TouchableOpacity>
                ) : (
                  <View
                    style={[
                      styles.card,
                      styles.myMatchCard,
                      { backgroundColor: colors.cardBackground, borderColor: colors.border },
                    ]}
                  >
                    <Ionicons
                      name={
                        myBracketState === 'eliminated'
                          ? 'flag-outline'
                          : myBracketState === 'champion'
                            ? 'trophy-outline'
                            : 'hourglass-outline'
                      }
                      size={18}
                      color={colors.textMuted}
                    />
                    <Text size="sm" color={colors.textMuted} style={styles.myMatchStateText}>
                      {t(
                        myBracketState === 'eliminated'
                          ? 'tournamentDetail.dashboard.myMatch.eliminated'
                          : myBracketState === 'champion'
                            ? 'tournamentDetail.dashboard.myMatch.champion'
                            : 'tournamentDetail.dashboard.myMatch.waiting'
                      )}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Stats */}
            <View style={[styles.section, styles.statsRow]}>
              <StatTile
                icon="people-outline"
                value={`${activeCount}/${tournament.max_participants}`}
                label={t('tournamentDetail.dashboard.stats.registered')}
                colors={colors}
              />
              {(isLive || isFinished) && !wasCancelled && (
                <StatTile
                  icon="checkmark-done-outline"
                  value={`${matchProgress.done}/${matchProgress.total}`}
                  label={t('tournamentDetail.dashboard.stats.games')}
                  colors={colors}
                />
              )}
              <StatTile
                icon="calendar-outline"
                value={startTileValue}
                label={t('tournamentDetail.dashboard.stats.start')}
                colors={colors}
              />
            </View>
          </View>
        )}

        {/* ============================ BRACKET ============================= */}
        {currentTabKey === 'bracket' && showBracketTab && (
          <View style={styles.tabContent}>
            <BracketSection
              matches={matches}
              seedByRegId={seedByRegId}
              nameByRegId={nameByRegId}
              membersByRegId={membersByRegId}
              currentUserId={userId}
              isOrganizer={isOrganizer}
              onMatchPress={handleBracketMatchTap}
              onOrganizerOverride={handleOrganizerOverride}
              colors={colors}
              t={t}
              showTitle={false}
            />
          </View>
        )}

        {/* ============================ PLAYERS ============================= */}
        {currentTabKey === 'players' && showPlayersTab && (
          <View style={styles.playersTabContent}>
            <PendingRequestsSection
              rows={pendingRequestRows}
              onPlayerPress={handlePlayerPress}
              onApprove={handleApprovePress}
              onDecline={handleRemovePress}
              colors={colors}
              t={t}
            />
            <ParticipantsSection
              players={registeredParticipantPlayers}
              onPlayerPress={handlePlayerPress}
              onRemovePress={canRemoveRegistrants ? handleRemovePress : undefined}
              currentUserId={userId}
              colors={colors}
              t={t}
            />
          </View>
        )}

        {/* ============================ DETAILS ============================= */}
        {currentTabKey === 'details' && (
          <View style={styles.tabContent}>
            <Section title={t('tournamentDetail.dashboard.details')} colors={colors}>
              <InfoRow
                label={t('tournamentDetail.labels.startDate')}
                value={formatDate(tournament.start_date)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.endDate')}
                value={formatDate(tournament.end_date)}
                colors={colors}
              />
              {tournament.registration_closes_at &&
                (tournament.status === 'draft' || tournament.status === 'registration_open') && (
                  <InfoRow
                    label={t('tournamentDetail.labels.registrationCloses')}
                    value={formatDate(tournament.registration_closes_at)}
                    colors={colors}
                  />
                )}
              <InfoRow
                label={t('tournamentDetail.labels.bracketSize')}
                value={String(tournament.max_participants)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.bracketType')}
                value={t(BRACKET_TYPE_LABEL_KEY[tournament.bracket_type] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.entryFormat')}
                value={t(ENTRY_FORMAT_LABEL_KEY[tournament.entry_format] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.matchFormat')}
                value={t(MATCH_FORMAT_LABEL_KEY[tournament.match_format] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.visibility')}
                value={t(VISIBILITY_LABEL_KEY[tournament.visibility] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('tournamentDetail.labels.registrationMode')}
                value={t(REG_MODE_LABEL_KEY[tournament.registration_mode] as TranslationKey)}
                colors={colors}
              />
            </Section>
          </View>
        )}
      </ScrollView>

      {/* Organizer admin overflow menu (anchored under the header "⋯") */}
      <Modal
        visible={showActionsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionsMenu(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setShowActionsMenu(false)}>
          <View
            style={[
              styles.menuCard,
              {
                top: insets.top + (Platform.OS === 'ios' ? 44 : 56),
                backgroundColor: colors.cardBackground,
                borderColor: colors.border,
              },
            ]}
          >
            {adminActions.canEdit && (
              <MenuItem
                icon="create-outline"
                label={t('tournamentDetail.actions.editDetails')}
                testID="menu-edit-details"
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  openSheetForTournamentEdit({
                    id: tournament.id,
                    version: tournament.version,
                    status: tournament.status,
                    name: tournament.name,
                    description: tournament.description,
                    visibility: tournament.visibility,
                    startDate: tournament.start_date,
                    endDate: tournament.end_date,
                    maxParticipants: tournament.max_participants,
                    matchFormat: tournament.match_format,
                    sport: {
                      id: tournament.sport_id,
                      name: sport?.name ?? '',
                      display_name: sport?.display_name ?? '',
                    },
                  });
                }}
                colors={colors}
              />
            )}
            {adminActions.canInvite && (
              <MenuItem
                icon="share-social-outline"
                label={t('tournamentDetail.actions.invitePlayers')}
                testID="menu-invite-players"
                showDivider={adminActions.canEdit}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  void SheetManager.show('tournament-invite', {
                    payload: { tournamentId: tournament.id, tournamentName: tournament.name },
                  });
                }}
                colors={colors}
              />
            )}
            {adminActions.canCancel && (
              <MenuItem
                icon="close-circle-outline"
                label={t('tournamentDetail.actions.cancelTournament')}
                testID="menu-cancel-tournament"
                destructive
                showDivider={adminActions.canEdit || adminActions.canInvite}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowCancelModal(true);
                }}
                colors={colors}
              />
            )}
            {adminActions.canArchive && (
              <MenuItem
                icon="archive-outline"
                label={t('tournamentDetail.actions.archiveTournament')}
                testID="menu-archive-tournament"
                showDivider={adminActions.canEdit || adminActions.canCancel}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowArchiveModal(true);
                }}
                colors={colors}
              />
            )}
          </View>
        </Pressable>
      </Modal>

      <ConfirmationModal
        visible={showCancelModal && !!tournament}
        title={t('tournamentDetail.cancelModal.title')}
        message={t('tournamentDetail.cancelModal.description')}
        confirmLabel={t('tournamentDetail.cancelModal.confirm')}
        cancelLabel={t('tournamentDetail.cancelModal.keepIt')}
        confirmTestID="confirm-cancel-tournament"
        destructive
        isLoading={cancel.isPending}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          if (!tournament) return;
          cancel.mutate({
            tournamentId: tournament.id,
            reason: cancelReason.trim(),
            versionWas: tournament.version,
          });
        }}
        extraContent={
          <TextInput
            style={[
              styles.reasonInput,
              {
                backgroundColor: colors.statusMutedBg,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('tournamentDetail.cancelModal.reasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            maxLength={300}
            editable={!cancel.isPending}
          />
        }
      />

      <ConfirmationModal
        visible={showArchiveModal && !!tournament}
        title={t('tournamentDetail.archiveModal.title')}
        message={t('tournamentDetail.archiveModal.description')}
        confirmLabel={t('tournamentDetail.archiveModal.confirm')}
        cancelLabel={t('tournamentDetail.archiveModal.keepIt')}
        confirmTestID="confirm-archive-tournament"
        isLoading={archive.isPending}
        onClose={() => setShowArchiveModal(false)}
        onConfirm={() => {
          if (!tournament) return;
          archive.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
        }}
      />

      <ConfirmationModal
        visible={!!removeTarget && !!tournament}
        title={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.title'
            : 'tournamentDetail.removeModal.title'
        )}
        message={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.message'
            : 'tournamentDetail.removeModal.message',
          { name: removeTarget ? getHumanName(removeTarget, '') : '' }
        )}
        confirmLabel={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.confirm'
            : 'tournamentDetail.removeModal.confirm'
        )}
        cancelLabel={t(
          removeTargetIsPending
            ? 'tournamentDetail.declineModal.keepIt'
            : 'tournamentDetail.removeModal.keepIt'
        )}
        destructive
        isLoading={removeRegistrant.isPending}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </SafeAreaView>
  );
};

type MatchRow = Tables<'tournament_matches'>;

const roundLabel = (
  round: number,
  totalRounds: number,
  t: (k: TranslationKey) => string
): string => {
  if (round === totalRounds) return t('tournamentDetail.bracket.final');
  if (round === totalRounds - 1) return t('tournamentDetail.bracket.semifinal');
  if (round === totalRounds - 2) return t('tournamentDetail.bracket.quarterfinal');
  return t('tournamentDetail.bracket.round').replace('{n}', String(round));
};

const slotLabel = (
  regId: string | null,
  isBye: boolean,
  isPhantom: boolean,
  seedByRegId: Map<string, number>,
  nameByRegId: Map<string, string>,
  t: (k: TranslationKey) => string
): string => {
  if (isPhantom) return t('tournamentDetail.bracket.phantom');
  if (isBye) return t('tournamentDetail.bracket.bye');
  if (!regId) return t('tournamentDetail.bracket.tbd');
  const name = nameByRegId.get(regId);
  if (name) return name;
  const seed = seedByRegId.get(regId);
  return seed !== undefined ? `Seed ${seed}` : t('tournamentDetail.bracket.tbd');
};

type SlotKind = 'player' | 'bye' | 'tbd' | 'phantom';

const slotKind = (regId: string | null, isBye: boolean, isPhantom: boolean): SlotKind => {
  if (isPhantom) return 'phantom';
  if (isBye) return 'bye';
  if (!regId) return 'tbd';
  return 'player';
};

// The bracket score is a free-form string the organizer types ("e.g., 6-4
// 6-2"). We split it into per-set pairs in written order; the caller orients
// each set onto the right player's row using the known match winner.
const parseScoreSets = (score: string | null): Array<{ a: number; b: number }> => {
  if (!score) return [];
  const sets: Array<{ a: number; b: number }> = [];
  const re = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(score)) !== null) {
    sets.push({ a: parseInt(m[1], 10), b: parseInt(m[2], 10) });
  }
  return sets;
};

const BracketSection: React.FC<{
  matches: MatchRow[];
  seedByRegId: Map<string, number>;
  nameByRegId: Map<string, string>;
  membersByRegId: Map<string, string[]>;
  currentUserId: string | undefined;
  isOrganizer: boolean;
  onMatchPress: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  onOrganizerOverride: (tournamentMatchId: string, p1RegId: string, p2RegId: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
  showTitle?: boolean;
}> = ({
  matches,
  seedByRegId,
  nameByRegId,
  membersByRegId,
  currentUserId,
  isOrganizer,
  onMatchPress,
  onOrganizerOverride,
  colors,
  t,
  showTitle = true,
}) => {
  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round_number), 0);
  const byRound = new Map<number, MatchRow[]>();
  for (const m of matches) {
    const arr = byRound.get(m.round_number) ?? [];
    arr.push(m);
    byRound.set(m.round_number, arr);
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b);

  // Flashscore-style round pager: open on the first round still being played.
  const [selectedIdx, setSelectedIdx] = useState(() => {
    const idx = roundNumbers.findIndex(r =>
      (byRound.get(r) ?? []).some(
        m => !m.winner_registration_id && !(m.player1_is_bye && m.player2_is_bye)
      )
    );
    return idx === -1 ? Math.max(0, roundNumbers.length - 1) : idx;
  });
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  // Snap to the selected page once the pager is measured (no animation).
  useEffect(() => {
    if (pageWidth > 0) {
      pagerRef.current?.scrollTo({ x: selectedIdx * pageWidth, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth]);

  const goToRound = (idx: number) => {
    void lightHaptic();
    setSelectedIdx(idx);
    pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
  };

  const onPagerSettle = (offsetX: number) => {
    if (pageWidth <= 0) return;
    const idx = Math.min(roundNumbers.length - 1, Math.max(0, Math.round(offsetX / pageWidth)));
    if (idx !== selectedIdx) setSelectedIdx(idx);
  };

  // Round is "complete" once every real (non-bye) game has a winner — used to
  // mark the chip with a check and drive the per-round progress pill.
  const roundProgress = (round: number) => {
    const real = (byRound.get(round) ?? []).filter(m => !(m.player1_is_bye && m.player2_is_bye));
    const done = real.filter(m => m.winner_registration_id).length;
    return { done, total: real.length, complete: real.length > 0 && done === real.length };
  };

  // Final-round winner → celebratory champion header at the top of the bracket.
  const finalMatch = matches.find(m => m.round_number === totalRounds && m.winner_registration_id);
  const championRegId = finalMatch?.winner_registration_id ?? null;
  const championName = championRegId
    ? (nameByRegId.get(championRegId) ?? `Seed ${seedByRegId.get(championRegId) ?? '?'}`)
    : null;

  const renderMatch = (m: MatchRow) => {
    const isPhantom = m.player1_is_bye && m.player2_is_bye && m.winner_registration_id === null;
    const winnerSlot = !m.winner_registration_id
      ? 0
      : m.winner_registration_id === m.player1_registration_id
        ? 1
        : m.winner_registration_id === m.player2_registration_id
          ? 2
          : 0;
    const isFinalRound = m.round_number === totalRounds;

    const p1Members = m.player1_registration_id
      ? (membersByRegId.get(m.player1_registration_id) ?? [])
      : [];
    const p2Members = m.player2_registration_id
      ? (membersByRegId.get(m.player2_registration_id) ?? [])
      : [];
    const callerIsParticipant =
      !!currentUserId && (p1Members.includes(currentUserId) || p2Members.includes(currentUserId));
    const isPlayable =
      m.status === 'pending' &&
      !m.player1_is_bye &&
      !m.player2_is_bye &&
      !!m.player1_registration_id &&
      !!m.player2_registration_id;
    // Organizers record results (override); non-organizer
    // participants link their own played match.
    const canOrganizerOverride = isPlayable && isOrganizer;
    const canParticipantAttach = isPlayable && callerIsParticipant && !isOrganizer;
    const isTappable = canOrganizerOverride || canParticipantAttach;

    const isLive = m.status === 'in_progress';
    const isDisputed = m.status === 'disputed';

    const headerRight = isLive ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.statusActiveBg }]}>
        <View style={[styles.bmLiveDot, { backgroundColor: colors.primary }]} />
        <Text size="xs" weight="bold" color={colors.primary}>
          {t('tournamentDetail.bracket.live')}
        </Text>
      </View>
    ) : isDisputed ? (
      <View style={[styles.bmStatusPill, { backgroundColor: colors.cancelledBg }]}>
        <Ionicons name="alert-circle" size={12} color={colors.cancelledText} />
        <Text size="xs" weight="bold" color={colors.cancelledText}>
          {t('tournamentDetail.bracket.disputed')}
        </Text>
      </View>
    ) : null;

    // Per-player set scores: each set's games sit on that player's own row, the
    // set-winner's number bolded per column. The raw string has no fixed player
    // order, so we orient it by the known match winner — whichever side took
    // more sets is the winner's — then map onto rows. A winner with no parseable
    // score gets a check instead.
    const sets = parseScoreSets(m.score);
    const aWins = sets.filter(s => s.a > s.b).length;
    const bWins = sets.filter(s => s.b > s.a).length;
    const winnerOnSideA = aWins >= bWins;
    const winnerGames = sets.map(s => (winnerOnSideA ? s.a : s.b));
    const loserGames = sets.map(s => (winnerOnSideA ? s.b : s.a));
    const p1Games =
      winnerSlot === 1 ? winnerGames : winnerSlot === 2 ? loserGames : sets.map(s => s.a);
    const p2Games =
      winnerSlot === 2 ? winnerGames : winnerSlot === 1 ? loserGames : sets.map(s => s.b);
    const cells1 = p1Games.map((v, i) => ({ value: v, won: v > p2Games[i] }));
    const cells2 = p2Games.map((v, i) => ({ value: v, won: v > p1Games[i] }));

    const statusStrip =
      isLive || isDisputed ? <View style={styles.bmStatusStrip}>{headerRight}</View> : null;

    const matchInner = (
      <>
        {statusStrip}
        <BracketPlayerRow
          label={slotLabel(
            m.player1_registration_id,
            m.player1_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player1_registration_id ? seedByRegId.get(m.player1_registration_id) : undefined}
          kind={slotKind(m.player1_registration_id, m.player1_is_bye, isPhantom)}
          isWinner={winnerSlot === 1}
          isFinalWinner={winnerSlot === 1 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells1}
          showCheck={winnerSlot === 1 && sets.length === 0}
          colors={colors}
        />
        <View style={[styles.bmRowDivider, { backgroundColor: colors.border }]} />
        <BracketPlayerRow
          label={slotLabel(
            m.player2_registration_id,
            m.player2_is_bye,
            isPhantom,
            seedByRegId,
            nameByRegId,
            t
          )}
          seed={m.player2_registration_id ? seedByRegId.get(m.player2_registration_id) : undefined}
          kind={slotKind(m.player2_registration_id, m.player2_is_bye, isPhantom)}
          isWinner={winnerSlot === 2}
          isFinalWinner={winnerSlot === 2 && isFinalRound}
          decided={winnerSlot !== 0}
          cells={cells2}
          showCheck={winnerSlot === 2 && sets.length === 0}
          colors={colors}
        />
      </>
    );

    if (isTappable && m.player1_registration_id && m.player2_registration_id) {
      const p1RegId = m.player1_registration_id;
      const p2RegId = m.player2_registration_id;
      const handlePress = canOrganizerOverride
        ? () => onOrganizerOverride(m.id, p1RegId, p2RegId)
        : () => onMatchPress(m.id, p1RegId, p2RegId);
      const a11yLabel = canOrganizerOverride
        ? t('tournamentDetail.bracket.overrideMatch')
        : t('tournamentDetail.bracket.linkMatch');
      const ctaLabel = canOrganizerOverride
        ? t('tournamentDetail.bracket.recordResult')
        : t('tournamentDetail.bracket.addResult');
      return (
        <TouchableOpacity
          key={m.id}
          onPress={handlePress}
          activeOpacity={0.7}
          style={[
            styles.bmCard,
            styles.bmCardPlayable,
            { backgroundColor: colors.cardBackground, borderColor: colors.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          testID="bracket-playable-match"
        >
          {matchInner}
          <View
            style={[
              styles.bmFooter,
              { backgroundColor: colors.highlightBg, borderTopColor: colors.border },
            ]}
          >
            <Ionicons
              name={canOrganizerOverride ? 'create-outline' : 'add-circle-outline'}
              size={16}
              color={colors.primary}
            />
            <Text size="sm" weight="semibold" color={colors.primary} style={styles.bmFooterLabel}>
              {ctaLabel}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <View
        key={m.id}
        style={[
          styles.bmCard,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {matchInner}
      </View>
    );
  };

  // Each pair of sibling matches feeds one match in the next round — group them
  // with a connector + chevron that advances the pager, mirroring a real tree.
  const renderRoundPage = (round: number, roundIdx: number) => {
    const roundMatches = (byRound.get(round) ?? []).sort(
      (a, b) => a.match_position - b.match_position
    );
    const hasNextRound = roundIdx < roundNumbers.length - 1;
    const pairs: MatchRow[][] = [];
    for (let i = 0; i < roundMatches.length; i += 2) {
      pairs.push(roundMatches.slice(i, i + 2));
    }
    return (
      <View key={round} style={[styles.bracketPage, { width: pageWidth }]}>
        {pairs.map(pair => (
          <View key={pair[0].id} style={styles.bmPair}>
            <View style={styles.bmPairCards}>{pair.map(renderMatch)}</View>
            {hasNextRound && pair.length === 2 && (
              <View style={styles.bmConnector}>
                <View style={[styles.bmConnectorSpine, { backgroundColor: colors.border }]} />
                <View style={[styles.bmConnectorArm, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  onPress={() => goToRound(roundIdx + 1)}
                  activeOpacity={0.7}
                  style={[
                    styles.bmConnectorBtn,
                    { backgroundColor: colors.statusMutedBg, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={roundLabel(roundNumbers[roundIdx + 1], totalRounds, t)}
                >
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  const sel = roundProgress(roundNumbers[selectedIdx] ?? totalRounds);

  return (
    <View style={styles.section}>
      {showTitle && (
        <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionTitle}>
          {t('tournamentDetail.bracket.sectionTitle').toUpperCase()}
        </Text>
      )}

      {/* Round selector chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bracketChipsRow}
      >
        {roundNumbers.map((round, idx) => {
          const selected = idx === selectedIdx;
          const { complete } = roundProgress(round);
          return (
            <TouchableOpacity
              key={round}
              onPress={() => goToRound(idx)}
              activeOpacity={0.85}
              style={[
                styles.bracketChip,
                {
                  backgroundColor: selected ? colors.primary : colors.cardBackground,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              {complete && (
                <Ionicons
                  name="checkmark-circle"
                  size={13}
                  color={selected ? '#ffffff' : colors.primary}
                />
              )}
              <Text
                size="xs"
                weight={selected ? 'semibold' : 'medium'}
                color={selected ? '#ffffff' : colors.textMuted}
              >
                {roundLabel(round, totalRounds, t)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Selected-round header with progress */}
      <View style={styles.bmRoundHeader}>
        <Text size="base" weight="bold" color={colors.text}>
          {roundLabel(roundNumbers[selectedIdx] ?? totalRounds, totalRounds, t)}
        </Text>
        {sel.total > 0 && (
          <View style={[styles.bmProgressPill, { backgroundColor: colors.statusMutedBg }]}>
            <Ionicons
              name={sel.complete ? 'checkmark-done' : 'ellipse-outline'}
              size={12}
              color={sel.complete ? colors.statusPositiveText : colors.textMuted}
            />
            <Text size="xs" weight="semibold" color={colors.textMuted}>
              {t('tournamentDetail.bracket.gamesProgress')
                .replace('{done}', String(sel.done))
                .replace('{total}', String(sel.total))}
            </Text>
          </View>
        )}
      </View>

      {/* Round pager — swipe or tap a chip to slide between rounds */}
      <View style={styles.bmPager} onLayout={e => setPageWidth(e.nativeEvent.layout.width)}>
        {pageWidth > 0 && (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => onPagerSettle(e.nativeEvent.contentOffset.x)}
          >
            {roundNumbers.map((round, roundIdx) => renderRoundPage(round, roundIdx))}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const BracketPlayerRow: React.FC<{
  label: string;
  seed?: number;
  kind: SlotKind;
  isWinner: boolean;
  isFinalWinner: boolean;
  decided: boolean;
  cells: Array<{ value: number; won: boolean }>;
  showCheck: boolean;
  colors: ScreenColors;
}> = ({ label, seed, kind, isWinner, isFinalWinner, decided, cells, showCheck, colors }) => {
  const isPlayer = kind === 'player';
  const isLoser = decided && isPlayer && !isWinner;
  const winnerColor = isFinalWinner ? colors.championText : colors.primary;
  // Winner: bright + bold. Loser: muted. Undecided / non-player: neutral.
  const nameColor = !isPlayer || isLoser ? colors.textMuted : colors.text;
  // Within the score column, the set-winner's number is emphasized per column.
  const wonColor = isFinalWinner ? colors.championText : colors.text;

  return (
    <View style={styles.bmRow}>
      {isFinalWinner && (
        <Ionicons name="trophy" size={14} color={colors.championText} style={styles.bmRowCrown} />
      )}
      <View style={styles.bmNameWrap}>
        <Text
          size="sm"
          weight={isWinner ? 'bold' : 'medium'}
          color={nameColor}
          numberOfLines={1}
          style={styles.bmNameText}
        >
          {label}
        </Text>
        {isPlayer && seed !== undefined && (
          <Text size="xs" weight="medium" color={colors.textMuted}>
            ({seed})
          </Text>
        )}
      </View>
      {cells.length > 0 ? (
        <View style={styles.bmSetRow}>
          {cells.map((c, i) => (
            <Text
              key={i}
              size="sm"
              weight={c.won ? 'bold' : 'regular'}
              color={c.won ? wonColor : colors.textMuted}
              style={styles.bmSetCell}
            >
              {c.value}
            </Text>
          ))}
        </View>
      ) : showCheck ? (
        <Ionicons name="checkmark" size={16} color={winnerColor} style={styles.bmScore} />
      ) : null}
    </View>
  );
};

/** Row inside the header "⋯" overflow menu. */
const MenuItem: React.FC<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  showDivider?: boolean;
  colors: ScreenColors;
  testID?: string;
}> = ({ label, icon, onPress, destructive, showDivider, colors, testID }) => {
  const fg = destructive ? colors.danger : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      testID={testID}
      style={[
        styles.menuItem,
        showDivider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={fg} />
      <Text size="base" weight="medium" color={fg}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  centeredSubtext: { marginTop: spacingPixels[2], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  heroFixed: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[5],
    paddingBottom: spacingPixels[4],
  },
  heroCard: {
    borderRadius: radiusPixels['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  screenScroll: {
    flex: 1,
  },
  screenScrollContent: {
    flexGrow: 1,
  },
  tabTrackSticky: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[1],
    paddingBottom: spacingPixels[2],
  },
  tabTrack: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
  },
  tabPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    borderRadius: 10,
  },
  tabPillActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  // Players tab: no horizontal padding — PlayerCard supplies its own 16px
  // side margins so the cards align with the rest of the app.
  playersTabContent: {
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  liveIndicatorContainer: {
    width: 10,
    height: 10,
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
    shadowColor: secondary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
  heroTitle: {
    marginBottom: spacingPixels[1.5],
    lineHeight: 30,
  },
  heroDescription: {
    lineHeight: 20,
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionTitle: {
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heroMetaRows: {
    gap: spacingPixels[2.5],
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  heroMetaIcon: {
    width: 28,
    height: 28,
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMetaText: {
    flex: 1,
  },
  stepperCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperStep: {
    alignItems: 'center',
    gap: spacingPixels[1],
    width: 72,
  },
  stepperDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperConnector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginTop: 15,
    marginHorizontal: -spacingPixels[3],
  },
  ctaCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
  },
  ctaCardHeader: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  ctaCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCardTextBlock: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  ctaCardDescription: {
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  participantEmpty: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  pendingSection: {
    marginBottom: spacingPixels[4],
  },
  pendingSectionTitle: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  myMatchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderWidth: 1.5,
  },
  myMatchMain: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  myMatchStateText: {
    flex: 1,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  headerMenuButton: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  menuBackdrop: {
    flex: 1,
  },
  menuCard: {
    position: 'absolute',
    right: spacingPixels[3],
    minWidth: 210,
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacingPixels[1],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
  },
  heroChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginTop: spacingPixels[3],
  },
  heroRegistered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[4],
  },
  bracketChipsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingBottom: spacingPixels[3],
  },
  bracketChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  bmRoundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
    paddingHorizontal: spacingPixels[1],
  },
  bmProgressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  bmPager: {
    minHeight: 1,
  },
  bracketPage: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[1],
    paddingHorizontal: spacingPixels[1],
  },
  bmPair: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: spacingPixels[5],
  },
  bmPairCards: {
    flex: 1,
    gap: spacingPixels[2],
  },
  bmConnector: {
    width: 48,
  },
  bmConnectorSpine: {
    position: 'absolute',
    left: 8,
    top: '25%',
    bottom: '25%',
    width: 2,
    borderRadius: 1,
  },
  bmConnectorArm: {
    position: 'absolute',
    left: 8,
    top: '50%',
    width: 16,
    height: 2,
    marginTop: -1,
  },
  bmConnectorBtn: {
    position: 'absolute',
    right: 0,
    top: '50%',
    width: 30,
    height: 30,
    marginTop: -15,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bmCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  bmCardPlayable: {
    borderWidth: 1.5,
  },
  bmStatusStrip: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
  },
  bmStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  bmLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  bmRowCrown: {
    marginRight: -spacingPixels[1],
  },
  bmRowDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacingPixels[3],
  },
  bmNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
  },
  bmNameText: {
    flexShrink: 1,
  },
  bmScore: {
    minWidth: 18,
    textAlign: 'right',
  },
  bmSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  bmSetCell: {
    minWidth: 14,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  bmFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bmFooterLabel: {
    flex: 1,
  },
  cancelledNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    fontSize: 15,
    minHeight: 72,
    marginBottom: spacingPixels[4],
    textAlignVertical: 'top',
  },
});

export default TournamentDetail;

/**
 * LeagueDetail Screen
 *
 * Read-only summary plus organizer/member action affordances (V6 slice).
 * UI aligned with TournamentDetail: hero, sticky tabs, dashboard CTAs.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V6
 */

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  neutral,
  secondary,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic, getHumanName } from '@rallia/shared-utils';
import {
  useTheme,
  useAuth,
  useLeague,
  useLeagueMembers,
  useMyLeagueMembership,
  useLeagueSeasons,
  useJoinLeague,
  useApproveLeagueMember,
  useAcceptLeagueInvite,
  useRevokeLeagueInvite,
  useLeaveLeague,
  useRemoveLeagueMember,
  useSuspendLeagueMember,
  useReinstateLeagueMember,
  useOpenSeason,
  useCloseSeason,
  useSeasonSessions,
  useSeasonRankings,
  useSeasonMembers,
  useMySeasonMembership,
  useEnrollInSeason,
  useWithdrawFromSeason,
  usePublishSession,
  useProfilesByIds,
} from '@rallia/shared-hooks';
import { SheetManager } from 'react-native-actions-sheet';
import { isLeagueOrganizer } from '@rallia/shared-services';
import type {
  LeagueMemberWithProfile,
  PlayerProfile,
  PlayerSearchResult,
  SeasonMemberWithProfile,
} from '@rallia/shared-services';
import type { Enums } from '@rallia/shared-types';

import PlayerCard from '../features/community/components/PlayerCard';
import { useTranslation, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'LeagueDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type LeagueStatus = Enums<'league_status'>;
type JoinMode = Enums<'tournament_registration_mode'>;
type Visibility = Enums<'tournament_visibility'>;
type SeasonStatus = Enums<'season_status'>;
type SessionStatus = Enums<'session_status'>;

const JOIN_MODE_KEY: Record<JoinMode, string> = {
  open: 'leagueDetail.values.open',
  approval: 'leagueDetail.values.approval',
  invite_only: 'leagueDetail.values.inviteOnly',
};
const VISIBILITY_KEY: Record<Visibility, string> = {
  private: 'leagueDetail.values.private',
  public: 'leagueDetail.values.public',
  community: 'leagueDetail.values.community',
};
const LEAGUE_STATUS_KEY: Record<LeagueStatus, string> = {
  active: 'leagueDetail.status.active',
  paused: 'leagueDetail.status.paused',
  closed: 'leagueDetail.status.closed',
};
const LEAGUE_STATUS_TONE: Record<LeagueStatus, 'positive' | 'neutral' | 'muted'> = {
  active: 'positive',
  paused: 'neutral',
  closed: 'muted',
};
const SEASON_STATUS_KEY: Record<SeasonStatus, string> = {
  draft: 'leagueDetail.seasonStatus.draft',
  open: 'leagueDetail.seasonStatus.open',
  closed: 'leagueDetail.seasonStatus.closed',
};
const SESSION_STATUS_KEY: Record<SessionStatus, string> = {
  draft: 'leagueDetail.sessionStatus.draft',
  published: 'leagueDetail.sessionStatus.published',
  in_progress: 'leagueDetail.sessionStatus.inProgress',
  completed: 'leagueDetail.sessionStatus.completed',
  cancelled: 'leagueDetail.sessionStatus.cancelled',
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
  highlightBg: string;
  highlightBorder: string;
  secondaryHighlightBg: string;
  secondaryHighlightBorder: string;
  secondaryAccent: string;
  secondaryAccentBg: string;
  danger: string;
  dangerBg: string;
}

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

const LeagueStatusBadge: React.FC<{
  status: LeagueStatus;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ status, colors, t }) => {
  const tone = LEAGUE_STATUS_TONE[status];
  const bg =
    tone === 'positive'
      ? colors.statusPositiveBg
      : tone === 'muted'
        ? colors.statusMutedBg
        : colors.statusNeutralBg;
  const fg =
    tone === 'positive'
      ? colors.statusPositiveText
      : tone === 'muted'
        ? colors.statusMutedText
        : colors.statusNeutralText;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {t(LEAGUE_STATUS_KEY[status] as TranslationKey)}
      </Text>
    </View>
  );
};

const STEP_ICONS: ReadonlyArray<keyof typeof Ionicons.glyphMap> = [
  'create-outline',
  'calendar-outline',
  'tennisball-outline',
  'trophy-outline',
];

const LifecycleStepper: React.FC<{
  stepIndex: number;
  colors: ScreenColors;
  t: (k: TranslationKey) => string;
}> = ({ stepIndex, colors, t }) => {
  const labels = [
    t('leagueDetail.dashboard.steps.setup'),
    t('leagueDetail.dashboard.steps.season'),
    t('leagueDetail.dashboard.steps.play'),
    t('leagueDetail.dashboard.steps.done'),
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

const DashboardCtaCard: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  buttonLabel?: string;
  buttonIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
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
  accent = 'primary',
  colors,
  testID,
}) => {
  const cardBg = accent === 'secondary' ? colors.secondaryHighlightBg : colors.highlightBg;
  const cardBorder =
    accent === 'secondary' ? colors.secondaryHighlightBorder : colors.highlightBorder;
  const iconBg = accent === 'secondary' ? colors.secondaryAccentBg : colors.statusActiveBg;
  const iconColor = accent === 'secondary' ? colors.secondaryAccent : colors.primary;
  const buttonBg = accent === 'secondary' ? colors.secondaryAccent : colors.primary;

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

function memberToPlayer(member: {
  user_id: string;
  profile?: PlayerProfile | null;
}): PlayerSearchResult {
  const profile = member.profile;
  return {
    id: member.user_id,
    first_name: profile?.first_name ?? '',
    last_name: profile?.last_name ?? '',
    display_name: null,
    profile_picture_url: profile?.profile_picture_url ?? null,
    city: null,
    gender: null,
    rating: null,
    latitude: null,
    longitude: null,
    distance_meters: null,
    reputation_tier: null,
    reputation_score: null,
    reputation_is_public: false,
    last_seen_at: null,
  };
}

type PendingMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
};

const PendingMembersSection: React.FC<{
  rows: PendingMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onApprove: (memberId: string, version: number) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onApprove, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
        {t('leagueDetail.dashboard.pendingRequests.title', { count: String(rows.length) })}
      </Text>
      {rows.map(({ player, memberId, version }) => (
        <PlayerCard
          key={memberId}
          player={player}
          onPress={onPlayerPress}
          showActivity={false}
          trailingActions={[
            {
              icon: 'checkmark-circle',
              color: colors.statusPositiveText,
              accessibilityLabel: t('leagueDetail.dashboard.pendingRequests.approveLabel', {
                name: getHumanName(player, ''),
              }),
              onPress: () => onApprove(memberId, version),
            },
          ]}
        />
      ))}
    </View>
  );
};

const InvitedMembersSection: React.FC<{
  rows: PendingMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onRevoke: (memberId: string, version: number) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onRevoke, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
        {t('leagueDetail.dashboard.invited.title', { count: String(rows.length) })}
      </Text>
      {rows.map(({ player, memberId, version }) => (
        <PlayerCard
          key={memberId}
          player={player}
          onPress={onPlayerPress}
          showActivity={false}
          trailingActions={[
            {
              icon: 'close-circle',
              color: colors.danger,
              accessibilityLabel: t('leagueDetail.dashboard.invited.revokeLabel', {
                name: getHumanName(player, ''),
              }),
              onPress: () => onRevoke(memberId, version),
            },
          ]}
        />
      ))}
    </View>
  );
};

type ManageMemberRow = {
  player: PlayerSearchResult;
  memberId: string;
  version: number;
  userId: string;
};

const MembersSection: React.FC<{
  rows: ManageMemberRow[];
  ownerId: string;
  onPlayerPress: (player: PlayerSearchResult) => void;
  organizerActions?: {
    onSuspend: (memberId: string, version: number, name: string) => void;
    onRemove: (memberId: string, version: number, name: string) => void;
  };
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, ownerId, onPlayerPress, organizerActions, colors, t }) => (
  <View>
    <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
      {t('leagueDetail.dashboard.members.title')}
    </Text>
    {rows.length === 0 ? (
      <View style={styles.participantEmpty}>
        <Text size="sm" color={colors.textMuted}>
          {t('leagueDetail.noMembers')}
        </Text>
      </View>
    ) : (
      rows.map(({ player, memberId, version, userId }) => {
        const name = getHumanName(player, '');
        return (
          <PlayerCard
            key={memberId}
            player={player}
            onPress={onPlayerPress}
            showActivity={false}
            trailingActions={
              organizerActions && userId !== ownerId
                ? [
                    {
                      icon: 'pause-circle-outline',
                      color: colors.textMuted,
                      accessibilityLabel: t('leagueDetail.dashboard.members.suspendLabel', {
                        name,
                      }),
                      onPress: () => organizerActions.onSuspend(memberId, version, name),
                    },
                    {
                      icon: 'remove-circle-outline',
                      color: colors.danger,
                      accessibilityLabel: t('leagueDetail.dashboard.members.removeLabel', { name }),
                      onPress: () => organizerActions.onRemove(memberId, version, name),
                    },
                  ]
                : undefined
            }
          />
        );
      })
    )}
  </View>
);

const SuspendedMembersSection: React.FC<{
  rows: ManageMemberRow[];
  onPlayerPress: (player: PlayerSearchResult) => void;
  onReinstate: (memberId: string, version: number, name: string) => void;
  onRemove: (memberId: string, version: number, name: string) => void;
  colors: ScreenColors;
  t: (k: TranslationKey, options?: Record<string, string>) => string;
}> = ({ rows, onPlayerPress, onReinstate, onRemove, colors, t }) => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.pendingSection}>
      <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.pendingSectionTitle}>
        {t('leagueDetail.dashboard.members.suspendedTitle', { count: String(rows.length) })}
      </Text>
      {rows.map(({ player, memberId, version }) => {
        const name = getHumanName(player, '');
        return (
          <PlayerCard
            key={memberId}
            player={player}
            onPress={onPlayerPress}
            showActivity={false}
            trailingActions={[
              {
                icon: 'play-circle-outline',
                color: colors.statusPositiveText,
                accessibilityLabel: t('leagueDetail.dashboard.members.reinstateLabel', { name }),
                onPress: () => onReinstate(memberId, version, name),
              },
              {
                icon: 'remove-circle-outline',
                color: colors.danger,
                accessibilityLabel: t('leagueDetail.dashboard.members.removeLabel', { name }),
                onPress: () => onRemove(memberId, version, name),
              },
            ]}
          />
        );
      })}
    </View>
  );
};

export const LeagueDetail: React.FC = () => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const navigation = useNavigation<NavigationProp>();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const route = useRoute<Route>();
  const { leagueId } = route.params;
  const isDark = theme === 'dark';

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
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      secondaryHighlightBg: isDark ? secondary[950] : secondary[50],
      secondaryHighlightBorder: isDark ? `${secondary[400]}40` : `${secondary[500]}20`,
      secondaryAccent: isDark ? secondary[400] : secondary[500],
      secondaryAccentBg: isDark ? `${secondary[500]}30` : `${secondary[500]}20`,
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
    }),
    [themeColors, isDark]
  );

  const { data: league, isLoading, isError, refetch: refetchLeague } = useLeague(leagueId);
  const { data: members = [], refetch: refetchMembers } = useLeagueMembers(leagueId);
  const {
    data: myMembership,
    isFetched: membershipFetched,
    refetch: refetchMembership,
  } = useMyLeagueMembership(leagueId, userId);
  const { data: seasons = [], refetch: refetchSeasons } = useLeagueSeasons(leagueId);
  const { data: profiles } = useProfilesByIds(league ? [league.organizer_id] : []);

  const isOrganizer = league ? isLeagueOrganizer(league, userId) : false;
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!league || !membershipFetched || viewedRef.current) return;
    viewedRef.current = true;
    const userRole = isOrganizer
      ? 'organizer'
      : myMembership?.status === 'active'
        ? 'member'
        : myMembership?.status === 'pending'
          ? 'pending'
          : 'visitor';
    Analytics.leagueViewed({ leagueId: league.id, userRole });
  }, [league, membershipFetched, isOrganizer, myMembership?.status, leagueId]);

  const canJoin =
    !!userId &&
    !!league &&
    league.status === 'active' &&
    !isOrganizer &&
    (!myMembership || myMembership.status === 'inactive');

  const [activeTabIdx, setActiveTabIdx] = useState(0);

  const invalidateAll = useCallback(() => {
    void refetchLeague();
    void refetchMembers();
    void refetchMembership();
    void refetchSeasons();
  }, [refetchLeague, refetchMembers, refetchMembership, refetchSeasons]);

  const { mutate: joinLeague, isPending: isJoining } = useJoinLeague(leagueId, {
    onSuccess: m => {
      successHaptic();
      toast.success(
        m.status === 'pending' ? t('leagueDetail.joinPending') : t('leagueDetail.joinSuccess')
      );
      if (m.status === 'pending') {
        Analytics.leagueMemberPendingAnalytics({ leagueId });
      } else {
        Analytics.leagueMemberJoinedAnalytics({ leagueId, viaInvite: false });
      }
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const { mutate: approveMember, isPending: isApproving } = useApproveLeagueMember(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.memberApproved'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const { mutate: acceptInvite, isPending: isAccepting } = useAcceptLeagueInvite(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.inviteAccepted'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const { mutate: revokeInvite, isPending: isRevoking } = useRevokeLeagueInvite(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.inviteRevoked'));
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const onMemberLifecycleError = useCallback(
    (e: Error) => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
    [toast, t]
  );

  const { mutate: leaveLeagueMut, isPending: isLeaving } = useLeaveLeague(leagueId, {
    onError: onMemberLifecycleError,
  });

  const { mutate: removeMemberMut, isPending: isRemovingMember } = useRemoveLeagueMember(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.memberRemoved'));
      invalidateAll();
    },
    onError: onMemberLifecycleError,
  });

  const { mutate: suspendMemberMut, isPending: isSuspendingMember } = useSuspendLeagueMember(
    leagueId,
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.memberSuspended'));
        invalidateAll();
      },
      onError: onMemberLifecycleError,
    }
  );

  const { mutate: reinstateMemberMut, isPending: isReinstatingMember } = useReinstateLeagueMember(
    leagueId,
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.memberReinstated'));
        invalidateAll();
      },
      onError: onMemberLifecycleError,
    }
  );

  const { mutate: openSeasonMut, isPending: isOpeningSeason } = useOpenSeason(leagueId, {
    onSuccess: season => {
      successHaptic();
      toast.success(t('leagueDetail.seasonOpened'));
      Analytics.seasonOpenedAnalytics({ leagueId, seasonId: season.id });
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  // Pending self-requests (await organizer approval) vs organizer invites
  // (await the player accepting).
  const pendingRequests = useMemo(
    () => members.filter(m => m.status === 'pending' && !m.invited_by),
    [members]
  );
  const invitedMembers = useMemo(
    () => members.filter(m => m.status === 'pending' && !!m.invited_by),
    [members]
  );
  const activeMembers = useMemo(() => members.filter(m => m.status === 'active'), [members]);
  const suspendedMembers = useMemo(() => members.filter(m => m.status === 'suspended'), [members]);

  const pendingMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? pendingRequests.map(m => ({
            player: memberToPlayer(m),
            memberId: m.id,
            version: m.version,
          }))
        : [],
    [pendingRequests, isOrganizer]
  );

  const invitedMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? invitedMembers.map(m => ({
            player: memberToPlayer(m),
            memberId: m.id,
            version: m.version,
          }))
        : [],
    [invitedMembers, isOrganizer]
  );

  const activeMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      activeMembers.map(m => ({
        player: memberToPlayer(m),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [activeMembers]
  );
  const suspendedMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      suspendedMembers.map(m => ({
        player: memberToPlayer(m),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [suspendedMembers]
  );

  const openSeason = useMemo(() => seasons.find(s => s.status === 'open'), [seasons]);
  const draftSeasons = useMemo(() => seasons.filter(s => s.status === 'draft'), [seasons]);

  const { data: seasonSessions = [] } = useSeasonSessions(openSeason?.id);

  const openSeasonId = openSeason?.id;
  const { data: seasonRoster = [] } = useSeasonMembers(openSeasonId);
  const { data: mySeasonMembership } = useMySeasonMembership(openSeasonId, userId);
  const isEnrolledInSeason = mySeasonMembership?.status === 'enrolled';
  const canParticipateInSeason = isOrganizer || myMembership?.status === 'active';

  const { mutate: enrollSeasonMut, isPending: isEnrollingSeason } = useEnrollInSeason(
    openSeasonId ?? '',
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.roster.enrolled'));
      },
      onError: e => {
        warningHaptic();
        toast.error(e.message || t('leagueDetail.errors.generic'));
      },
    }
  );

  const { mutate: withdrawSeasonMut, isPending: isWithdrawingSeason } = useWithdrawFromSeason(
    openSeasonId ?? '',
    {
      onSuccess: () => {
        lightHaptic();
        toast.success(t('leagueDetail.roster.withdrew'));
      },
      onError: e => {
        warningHaptic();
        toast.error(e.message || t('leagueDetail.errors.generic'));
      },
    }
  );

  const handleWithdrawSeason = useCallback(() => {
    Alert.alert(
      t('leagueDetail.roster.leaveConfirmTitle'),
      t('leagueDetail.roster.leaveConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.roster.leave'),
          style: 'destructive',
          onPress: () => withdrawSeasonMut(),
        },
      ]
    );
  }, [t, withdrawSeasonMut]);

  // Standings come from the open season, else the most recent closed one.
  const rankingSeason = useMemo(
    () => openSeason ?? seasons.find(s => s.status === 'closed') ?? null,
    [openSeason, seasons]
  );
  const { data: rankings = [] } = useSeasonRankings(rankingSeason?.id);

  const { mutate: closeSeasonMut, isPending: isClosingSeason } = useCloseSeason(leagueId, {
    onSuccess: season => {
      successHaptic();
      toast.success(t('leagueDetail.seasonClosed'));
      Analytics.seasonClosedAnalytics({ leagueId, seasonId: season.id });
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('leagueDetail.errors.generic'));
    },
  });

  const { mutate: publishSessionMut, isPending: isPublishingSession } = usePublishSession(
    openSeason?.id ?? '',
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.sessions.published'));
      },
      onError: e => {
        warningHaptic();
        toast.error(e.message || t('leagueDetail.errors.generic'));
      },
    }
  );

  const stepIndex = useMemo(() => {
    if (openSeason) return 2;
    if (draftSeasons.length > 0) return 1;
    if (seasons.length > 0 && seasons.every(s => s.status === 'closed')) return 3;
    return 0;
  }, [openSeason, draftSeasons.length, seasons]);

  const organizerName = useMemo(() => {
    if (!league) return '';
    const profile = profiles?.[league.organizer_id];
    return profile ? getHumanName(profile, '') : '';
  }, [league, profiles]);

  const formatDate = useCallback(
    (isoOrDate: string | Date): string => {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    },
    [locale]
  );

  const formatDateTime = useCallback(
    (isoOrDate: string | Date): string => {
      const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
      return d.toLocaleString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    },
    [locale]
  );

  const currentSeasonLabel = openSeason
    ? openSeason.name
    : (draftSeasons[0]?.name ?? t('leagueDetail.dashboard.stats.noSeason'));

  const sessionPill = useCallback(
    (status: SessionStatus) => {
      const positive = status === 'published' || status === 'in_progress';
      const muted = status === 'completed' || status === 'cancelled';
      return {
        bg: positive
          ? colors.statusPositiveBg
          : muted
            ? colors.statusMutedBg
            : colors.statusNeutralBg,
        fg: positive
          ? colors.statusPositiveText
          : muted
            ? colors.statusMutedText
            : colors.statusNeutralText,
      };
    },
    [colors]
  );

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('leagueDetail.tabs.overview') },
      { key: 'members' as const, label: t('leagueDetail.tabs.members') },
      { key: 'seasons' as const, label: t('leagueDetail.tabs.seasons') },
      { key: 'sessions' as const, label: t('leagueDetail.tabs.sessions') },
      { key: 'details' as const, label: t('leagueDetail.tabs.details') },
    ],
    [t]
  );
  const currentTabIdx = Math.min(activeTabIdx, tabs.length - 1);
  const currentTabKey = tabs[currentTabIdx].key;
  const membersTabIdx = tabs.findIndex(tab => tab.key === 'members');
  const seasonsTabIdx = tabs.findIndex(tab => tab.key === 'seasons');

  const goToTab = useCallback((idx: number) => {
    void lightHaptic();
    setActiveTabIdx(idx);
  }, []);

  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!league) return;
      lightHaptic();
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: league.sport_id,
      });
    },
    [navigation, league]
  );

  const handleApprovePress = useCallback(
    (memberId: string, version: number) => {
      if (isApproving) return;
      lightHaptic();
      approveMember({ memberId, versionWas: version });
    },
    [approveMember, isApproving]
  );

  const handleRevokePress = useCallback(
    (memberId: string, version: number) => {
      if (isRevoking) return;
      warningHaptic();
      revokeInvite({ memberId, versionWas: version });
    },
    [revokeInvite, isRevoking]
  );

  const handleLeavePress = useCallback(() => {
    if (isLeaving) return;
    Alert.alert(
      t('leagueDetail.confirm.leaveTitle'),
      t('leagueDetail.confirm.leaveMessage', { name: league?.name ?? '' }),
      [
        { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.confirm.leaveConfirm'),
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            leaveLeagueMut(undefined, {
              onSuccess: () => {
                successHaptic();
                toast.success(t('leagueDetail.leftLeague'));
                invalidateAll();
              },
            });
          },
        },
      ]
    );
  }, [isLeaving, leaveLeagueMut, t, toast, league?.name, invalidateAll]);

  const handleCancelRequestPress = useCallback(() => {
    if (isLeaving) return;
    Alert.alert(
      t('leagueDetail.confirm.cancelRequestTitle'),
      t('leagueDetail.confirm.cancelRequestMessage', { name: league?.name ?? '' }),
      [
        { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.confirm.cancelRequestConfirm'),
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            leaveLeagueMut(undefined, {
              onSuccess: () => {
                successHaptic();
                toast.success(t('leagueDetail.requestCancelled'));
                invalidateAll();
              },
            });
          },
        },
      ]
    );
  }, [isLeaving, leaveLeagueMut, t, toast, league?.name, invalidateAll]);

  const handleRemoveMemberPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isRemovingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.removeTitle', { name }),
        t('leagueDetail.confirm.removeMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.removeConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              removeMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isRemovingMember, removeMemberMut, t]
  );

  const handleSuspendMemberPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isSuspendingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.suspendTitle', { name }),
        t('leagueDetail.confirm.suspendMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.suspendConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              suspendMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isSuspendingMember, suspendMemberMut, t]
  );

  const handleReinstateMemberPress = useCallback(
    (memberId: string, version: number) => {
      if (isReinstatingMember) return;
      lightHaptic();
      reinstateMemberMut({ memberId, versionWas: version });
    },
    [isReinstatingMember, reinstateMemberMut]
  );

  const handleInvitePress = useCallback(() => {
    if (!league) return;
    lightHaptic();
    const exclude = members
      .filter(m => m.status === 'active' || m.status === 'pending' || m.status === 'suspended')
      .map(m => m.user_id);
    void SheetManager.show('league-invite-players', {
      payload: {
        leagueId,
        leagueName: league.name,
        sportId: league.sport_id,
        excludeUserIds: exclude,
      },
    });
  }, [league, members, leagueId]);

  const handleOpenCreateSeason = useCallback(() => {
    lightHaptic();
    void SheetManager.show('create-season', { payload: { leagueId } });
  }, [leagueId]);

  const handleOpenCreateSession = useCallback(() => {
    if (!openSeason) return;
    lightHaptic();
    void SheetManager.show('create-session', {
      payload: { seasonId: openSeason.id, leagueId },
    });
  }, [openSeason, leagueId]);

  const handlePublishSession = useCallback(
    (sessionId: string, version: number) => {
      if (isPublishingSession) return;
      lightHaptic();
      publishSessionMut({ sessionId, versionWas: version });
    },
    [publishSessionMut, isPublishingSession]
  );

  const handleOpenSession = useCallback(
    (sessionId: string, name: string) => {
      lightHaptic();
      navigation.navigate('SessionDetail', { sessionId, leagueId, sessionName: name });
    },
    [navigation, leagueId]
  );

  if (isLoading) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text size="sm" color={colors.textMuted} style={styles.centeredText}>
            {t('leagueDetail.loading')}
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
            {t('leagueDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetchLeague()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('leagueDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!league) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('leagueDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {t('leagueDetail.notFoundDescription')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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
              <LeagueStatusBadge status={league.status} colors={colors} t={t} />
            </View>

            <Text size="2xl" weight="bold" color={colors.text} style={styles.heroTitle}>
              {league.name}
            </Text>
            {league.description ? (
              <Text
                size="sm"
                color={colors.textMuted}
                style={styles.heroDescription}
                numberOfLines={2}
              >
                {league.description}
              </Text>
            ) : null}

            <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />

            <View style={styles.heroMetaRows}>
              <View style={styles.heroMetaRow}>
                <View style={[styles.heroMetaIcon, { backgroundColor: colors.statusActiveBg }]}>
                  <Ionicons name="eye-outline" size={14} color={colors.primary} />
                </View>
                <Text size="sm" weight="medium" color={colors.text} style={styles.heroMetaText}>
                  {t(VISIBILITY_KEY[league.visibility] as TranslationKey)} ·{' '}
                  {t(JOIN_MODE_KEY[league.join_mode] as TranslationKey)}
                </Text>
              </View>
              <View style={styles.heroMetaRow}>
                <View style={[styles.heroMetaIcon, { backgroundColor: colors.statusMutedBg }]}>
                  <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                </View>
                <Text size="sm" color={colors.textMuted} style={styles.heroMetaText}>
                  {t('leagueDetail.hero.membersCount').replace(
                    '{count}',
                    String(activeMembers.length)
                  )}
                </Text>
              </View>
              {league.venue_name ? (
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
                    {league.venue_name}
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
                    {t('leagueDetail.dashboard.organizedBy').replace('{name}', organizerName)}
                  </Text>
                </View>
              ) : null}
            </View>

            {!isOrganizer && myMembership?.status === 'pending' && myMembership.invited_by && (
              <TouchableOpacity
                onPress={() => {
                  lightHaptic();
                  acceptInvite();
                }}
                disabled={isAccepting}
                style={[styles.heroRegistered, { backgroundColor: colors.primary }]}
                testID="cta-accept-invite"
              >
                <Ionicons name="mail-open-outline" size={18} color="#ffffff" />
                <Text size="sm" weight="semibold" color="#ffffff">
                  {isAccepting ? t('leagueDetail.accepting') : t('leagueDetail.acceptInvite')}
                </Text>
              </TouchableOpacity>
            )}
            {!isOrganizer && myMembership?.status === 'pending' && !myMembership.invited_by && (
              <>
                <View
                  style={[styles.heroRegistered, { backgroundColor: colors.secondaryHighlightBg }]}
                >
                  <Ionicons name="hourglass-outline" size={18} color={colors.secondaryAccent} />
                  <Text size="sm" weight="semibold" color={colors.secondaryAccent}>
                    {t('leagueDetail.membershipPending')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleCancelRequestPress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-cancel-request"
                >
                  <Text size="sm" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.cancelRequest')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            {!isOrganizer && myMembership?.status === 'active' && (
              <>
                <View style={[styles.heroRegistered, { backgroundColor: colors.statusPositiveBg }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.statusPositiveText} />
                  <Text size="sm" weight="semibold" color={colors.statusPositiveText}>
                    {t('leagueDetail.memberActive')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleLeavePress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-leave-league"
                >
                  <Text size="sm" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.leaveLeague')}
                  </Text>
                </TouchableOpacity>
              </>
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
                  testID={`league-tab-${tab.key}`}
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

        {/* Overview */}
        {currentTabKey === 'overview' && (
          <View style={styles.tabContent}>
            <View
              style={[
                styles.section,
                styles.stepperCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <LifecycleStepper stepIndex={stepIndex} colors={colors} t={t} />
            </View>

            {isOrganizer && pendingMemberRows.length > 0 && (
              <DashboardCtaCard
                icon="hourglass-outline"
                title={t('leagueDetail.dashboard.pendingRequestsCta.title')}
                description={t('leagueDetail.dashboard.pendingRequestsCta.description').replace(
                  '{count}',
                  String(pendingMemberRows.length)
                )}
                buttonLabel={t('leagueDetail.dashboard.pendingRequestsCta.review')}
                buttonIcon="people-outline"
                onPress={() => membersTabIdx >= 0 && goToTab(membersTabIdx)}
                accent="secondary"
                colors={colors}
                testID="cta-pending-members"
              />
            )}

            {canJoin && (
              <DashboardCtaCard
                icon="person-add-outline"
                title={t('leagueDetail.dashboard.joinCta.title')}
                description={t('leagueDetail.dashboard.joinCta.description')}
                buttonLabel={
                  isJoining ? t('leagueDetail.actions.joining') : t('leagueDetail.actions.join')
                }
                buttonIcon="person-add-outline"
                onPress={() => {
                  lightHaptic();
                  joinLeague();
                }}
                disabled={isJoining}
                colors={colors}
                testID="cta-join-league"
              />
            )}

            {isOrganizer && seasons.length === 0 && (
              <DashboardCtaCard
                icon="calendar-outline"
                title={t('leagueDetail.dashboard.createSeasonCta.title')}
                description={t('leagueDetail.dashboard.createSeasonCta.description')}
                buttonLabel={t('leagueDetail.dashboard.createSeasonCta.button')}
                buttonIcon="add-outline"
                onPress={() => seasonsTabIdx >= 0 && goToTab(seasonsTabIdx)}
                colors={colors}
                testID="cta-create-season-overview"
              />
            )}

            {isOrganizer && draftSeasons.length > 0 && !openSeason && (
              <DashboardCtaCard
                icon="lock-open-outline"
                title={t('leagueDetail.dashboard.openSeasonCta.title').replace(
                  '{name}',
                  draftSeasons[0].name
                )}
                description={t('leagueDetail.dashboard.openSeasonCta.description').replace(
                  '{name}',
                  draftSeasons[0].name
                )}
                buttonLabel={
                  isOpeningSeason
                    ? t('leagueDetail.actions.openingSeason')
                    : t('leagueDetail.actions.openSeason')
                }
                buttonIcon="lock-open-outline"
                onPress={() => {
                  lightHaptic();
                  openSeasonMut({
                    seasonId: draftSeasons[0].id,
                    versionWas: draftSeasons[0].version,
                  });
                }}
                disabled={isOpeningSeason}
                colors={colors}
                testID="cta-open-season"
              />
            )}

            <View style={[styles.section, styles.statsRow]}>
              <StatTile
                icon="people-outline"
                value={String(activeMembers.length)}
                label={t('leagueDetail.dashboard.stats.members')}
                colors={colors}
              />
              <StatTile
                icon="calendar-outline"
                value={String(seasons.length)}
                label={t('leagueDetail.dashboard.stats.seasons')}
                colors={colors}
              />
              <StatTile
                icon="flag-outline"
                value={currentSeasonLabel}
                label={t('leagueDetail.dashboard.stats.currentSeason')}
                colors={colors}
              />
            </View>

            {rankingSeason && rankings.length > 0 && (
              <Section
                title={t('leagueDetail.standings.title').replace('{name}', rankingSeason.name)}
                colors={colors}
              >
                <View
                  style={[
                    styles.standingRow,
                    styles.standingHeader,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingRank}
                  >
                    #
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingName}
                  >
                    {t('leagueDetail.standings.player')}
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingWl}
                  >
                    {t('leagueDetail.standings.wl')}
                  </Text>
                  <Text
                    size="xs"
                    weight="semibold"
                    color={colors.textMuted}
                    style={styles.standingPts}
                  >
                    {t('leagueDetail.standings.pts')}
                  </Text>
                </View>
                {rankings.slice(0, 12).map((r, i) => (
                  <View
                    key={r.id}
                    style={[
                      styles.standingRow,
                      i < Math.min(rankings.length, 12) - 1 && {
                        borderBottomColor: colors.border,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Text
                      size="sm"
                      weight="semibold"
                      color={colors.text}
                      style={styles.standingRank}
                    >
                      {r.rank ?? i + 1}
                    </Text>
                    <Text
                      size="sm"
                      color={colors.text}
                      numberOfLines={1}
                      style={styles.standingName}
                    >
                      {r.profile
                        ? getHumanName(r.profile, t('leagueDetail.unknownMember'))
                        : t('leagueDetail.unknownMember')}
                    </Text>
                    <Text size="sm" color={colors.textMuted} style={styles.standingWl}>
                      {r.wins}-{r.losses}
                    </Text>
                    <Text size="sm" weight="bold" color={colors.text} style={styles.standingPts}>
                      {r.points}
                    </Text>
                  </View>
                ))}
              </Section>
            )}
          </View>
        )}

        {/* Members */}
        {currentTabKey === 'members' && (
          <View style={styles.playersTabContent}>
            {isOrganizer && (
              <TouchableOpacity
                onPress={handleInvitePress}
                style={[
                  styles.primaryButton,
                  styles.inviteButton,
                  { backgroundColor: colors.primary },
                ]}
                testID="cta-invite-players"
              >
                <Ionicons name="person-add-outline" size={20} color="#ffffff" />
                <Text size="base" weight="semibold" color="#ffffff">
                  {t('leagueDetail.invitePlayers.button')}
                </Text>
              </TouchableOpacity>
            )}
            <PendingMembersSection
              rows={pendingMemberRows}
              onPlayerPress={handlePlayerPress}
              onApprove={handleApprovePress}
              colors={colors}
              t={t}
            />
            <InvitedMembersSection
              rows={invitedMemberRows}
              onPlayerPress={handlePlayerPress}
              onRevoke={handleRevokePress}
              colors={colors}
              t={t}
            />
            <MembersSection
              rows={activeMemberRows}
              ownerId={league.organizer_id}
              onPlayerPress={handlePlayerPress}
              organizerActions={
                isOrganizer
                  ? { onSuspend: handleSuspendMemberPress, onRemove: handleRemoveMemberPress }
                  : undefined
              }
              colors={colors}
              t={t}
            />
            {isOrganizer && (
              <SuspendedMembersSection
                rows={suspendedMemberRows}
                onPlayerPress={handlePlayerPress}
                onReinstate={handleReinstateMemberPress}
                onRemove={handleRemoveMemberPress}
                colors={colors}
                t={t}
              />
            )}
          </View>
        )}

        {/* Seasons */}
        {currentTabKey === 'seasons' && (
          <View style={styles.tabContent}>
            <Section title={t('leagueDetail.sections.seasons')} colors={colors}>
              {seasons.length === 0 ? (
                <View style={styles.participantEmpty}>
                  <Text size="sm" color={colors.textMuted}>
                    {t('leagueDetail.noSeasons')}
                  </Text>
                </View>
              ) : (
                seasons.map(s => {
                  const statusBg =
                    s.status === 'open'
                      ? colors.statusPositiveBg
                      : s.status === 'draft'
                        ? colors.statusNeutralBg
                        : colors.statusMutedBg;
                  const statusFg =
                    s.status === 'open'
                      ? colors.statusPositiveText
                      : s.status === 'draft'
                        ? colors.statusNeutralText
                        : colors.statusMutedText;
                  return (
                    <View
                      key={s.id}
                      style={[styles.seasonCard, { borderBottomColor: colors.border }]}
                    >
                      <View style={styles.seasonCardHeader}>
                        <View style={styles.seasonCardInfo}>
                          <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
                            {s.name}
                          </Text>
                          <Text size="xs" color={colors.textMuted}>
                            {formatDate(s.start_date)} – {formatDate(s.end_date)}
                          </Text>
                        </View>
                        <View style={[styles.seasonStatusPill, { backgroundColor: statusBg }]}>
                          <Text size="xs" weight="semibold" color={statusFg}>
                            {t(SEASON_STATUS_KEY[s.status] as TranslationKey)}
                          </Text>
                        </View>
                      </View>
                      {isOrganizer && s.status === 'draft' && (
                        <TouchableOpacity
                          onPress={() => {
                            lightHaptic();
                            openSeasonMut({ seasonId: s.id, versionWas: s.version });
                          }}
                          disabled={isOpeningSeason}
                          testID="cta-open-season"
                          style={[styles.seasonCtaButton, { borderColor: colors.primary }]}
                        >
                          <Text size="sm" weight="semibold" color={colors.primary}>
                            {t('leagueDetail.actions.openSeason')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {isOrganizer && s.status === 'open' && (
                        <TouchableOpacity
                          onPress={() => {
                            warningHaptic();
                            closeSeasonMut({ seasonId: s.id, versionWas: s.version });
                          }}
                          disabled={isClosingSeason}
                          testID="cta-close-season"
                          style={[styles.seasonCtaButton, { borderColor: colors.danger }]}
                        >
                          <Text size="sm" weight="semibold" color={colors.danger}>
                            {isClosingSeason
                              ? t('leagueDetail.actions.closingSeason')
                              : t('leagueDetail.actions.closeSeason')}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })
              )}
            </Section>

            {openSeason && (
              <Section title={t('leagueDetail.roster.title')} colors={colors}>
                {seasonRoster.length === 0 ? (
                  <View style={styles.participantEmpty}>
                    <Text size="sm" color={colors.textMuted}>
                      {t('leagueDetail.roster.empty')}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text
                      size="xs"
                      weight="semibold"
                      color={colors.textMuted}
                      style={styles.pendingSectionTitle}
                    >
                      {t('leagueDetail.roster.count', { count: String(seasonRoster.length) })}
                    </Text>
                    {seasonRoster.map(m => (
                      <PlayerCard
                        key={m.id}
                        player={memberToPlayer(m)}
                        onPress={handlePlayerPress}
                        showActivity={false}
                      />
                    ))}
                  </>
                )}
                {canParticipateInSeason &&
                  (isEnrolledInSeason ? (
                    <TouchableOpacity
                      onPress={handleWithdrawSeason}
                      disabled={isWithdrawingSeason}
                      testID="cta-leave-season"
                      style={[styles.seasonCtaButton, { borderColor: colors.danger }]}
                    >
                      <Text size="sm" weight="semibold" color={colors.danger}>
                        {isWithdrawingSeason
                          ? t('leagueDetail.roster.leaving')
                          : t('leagueDetail.roster.leave')}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        lightHaptic();
                        enrollSeasonMut();
                      }}
                      disabled={isEnrollingSeason}
                      testID="cta-enroll-season"
                      style={[styles.seasonCtaButton, { borderColor: colors.primary }]}
                    >
                      <Text size="sm" weight="semibold" color={colors.primary}>
                        {isEnrollingSeason
                          ? t('leagueDetail.roster.enrolling')
                          : t('leagueDetail.roster.enroll')}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </Section>
            )}

            {isOrganizer && (
              <TouchableOpacity
                onPress={handleOpenCreateSeason}
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                testID="cta-create-season"
              >
                <Ionicons name="add-outline" size={20} color="#ffffff" />
                <Text size="base" weight="semibold" color="#ffffff">
                  {t('leagueDetail.createSeason.submit')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Sessions */}
        {currentTabKey === 'sessions' && (
          <View style={styles.tabContent}>
            {!openSeason ? (
              <Section title={t('leagueDetail.sessions.title')} colors={colors}>
                <View style={styles.participantEmpty}>
                  <Text size="sm" color={colors.textMuted} style={styles.sessionEmptyText}>
                    {t('leagueDetail.sessions.needOpenSeason')}
                  </Text>
                </View>
              </Section>
            ) : (
              <>
                <Section title={t('leagueDetail.sessions.title')} colors={colors}>
                  {seasonSessions.length === 0 ? (
                    <View style={styles.participantEmpty}>
                      <Text size="sm" color={colors.textMuted}>
                        {t('leagueDetail.sessions.empty')}
                      </Text>
                    </View>
                  ) : (
                    seasonSessions.map(s => {
                      const pill = sessionPill(s.status);
                      return (
                        <TouchableOpacity
                          key={s.id}
                          onPress={() => handleOpenSession(s.id, s.name)}
                          activeOpacity={0.7}
                          style={[styles.seasonRow, { borderBottomColor: colors.border }]}
                          testID={`session-row-${s.id}`}
                        >
                          <View style={styles.seasonRowMain}>
                            <Text size="base" weight="semibold" color={colors.text}>
                              {s.name}
                            </Text>
                            <Text size="xs" color={colors.textMuted}>
                              {formatDateTime(s.scheduled_at)}
                            </Text>
                          </View>
                          <View style={styles.seasonRowActions}>
                            <View style={[styles.seasonStatusPill, { backgroundColor: pill.bg }]}>
                              <Text size="xs" weight="semibold" color={pill.fg}>
                                {t(SESSION_STATUS_KEY[s.status] as TranslationKey)}
                              </Text>
                            </View>
                            {isOrganizer && s.status === 'draft' && (
                              <TouchableOpacity
                                onPress={() => handlePublishSession(s.id, s.version)}
                                disabled={isPublishingSession}
                                testID="cta-publish-session"
                                style={[styles.seasonActionButton, { borderColor: colors.primary }]}
                              >
                                <Text size="sm" weight="semibold" color={colors.primary}>
                                  {t('leagueDetail.sessions.publish')}
                                </Text>
                              </TouchableOpacity>
                            )}
                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </Section>

                {isOrganizer && (
                  <TouchableOpacity
                    onPress={handleOpenCreateSession}
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    testID="cta-create-session"
                  >
                    <Ionicons name="add-outline" size={20} color="#ffffff" />
                    <Text size="base" weight="semibold" color="#ffffff">
                      {t('leagueDetail.sessions.submit')}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {/* Details */}
        {currentTabKey === 'details' && (
          <View style={styles.tabContent}>
            <Section title={t('leagueDetail.tabs.details')} colors={colors}>
              <InfoRow
                label={t('leagueDetail.labels.visibility')}
                value={t(VISIBILITY_KEY[league.visibility] as TranslationKey)}
                colors={colors}
              />
              <InfoRow
                label={t('leagueDetail.labels.joinMode')}
                value={t(JOIN_MODE_KEY[league.join_mode] as TranslationKey)}
                colors={colors}
              />
              {league.venue_name ? (
                <InfoRow
                  label={t('leagueDetail.labels.venue')}
                  value={league.venue_name}
                  colors={colors}
                />
              ) : null}
              {league.description ? (
                <InfoRow
                  label={t('leagueDetail.labels.description')}
                  value={league.description}
                  colors={colors}
                />
              ) : null}
              {(league.min_rating != null || league.max_rating != null) && (
                <InfoRow
                  label={t('leagueDetail.labels.ratingRange')}
                  value={
                    league.min_rating != null && league.max_rating != null
                      ? `${league.min_rating} – ${league.max_rating}`
                      : league.min_rating != null
                        ? `≥ ${league.min_rating}`
                        : `≤ ${league.max_rating}`
                  }
                  colors={colors}
                />
              )}
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
  screenScroll: { flex: 1 },
  screenScrollContent: { flexGrow: 1 },
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
  heroTitle: {
    marginBottom: spacingPixels[1.5],
    lineHeight: 30,
  },
  heroDescription: { lineHeight: 20 },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  heroMetaRows: { gap: spacingPixels[2.5] },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  heroMetaIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMetaText: { flex: 1 },
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
  heroTextAction: {
    alignSelf: 'center',
    paddingVertical: spacingPixels[2],
    marginTop: spacingPixels[2],
  },
  section: { marginBottom: spacingPixels[5] },
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
  stepperCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperStep: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  stepperDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperConnector: {
    height: 2,
    flex: 0.4,
    marginTop: 13,
    borderRadius: 1,
  },
  ctaCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    gap: spacingPixels[4],
  },
  ctaCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  ctaCardDescription: { lineHeight: 19 },
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
  pendingSection: { marginBottom: spacingPixels[4] },
  pendingSectionTitle: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
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
  inviteButton: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonRowMain: { flex: 1, gap: spacingPixels[0.5] },
  seasonRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  seasonStatusPill: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  seasonActionButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
  },
  seasonCard: {
    padding: spacingPixels[4],
    gap: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  seasonCardInfo: { flex: 1, gap: spacingPixels[0.5] },
  seasonCtaButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingVertical: spacingPixels[2.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2.5],
  },
  standingHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  standingRank: { width: 28 },
  standingName: { flex: 1 },
  standingWl: { width: 56, textAlign: 'right' },
  standingPts: { width: 44, textAlign: 'right' },
  sessionEmptyText: {
    textAlign: 'center',
  },
});

export default LeagueDetail;

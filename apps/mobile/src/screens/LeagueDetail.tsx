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
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
  TextInput,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  primary,
  neutral,
  secondary,
} from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  formatPrice,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import {
  useTheme,
  useAuth,
  useLeague,
  useLeagueMembers,
  useMyLeagueMembership,
  useMyLeagueWaitlistStatus,
  useLeagueWaitlist,
  useLeagueSeasons,
  useJoinLeague,
  useJoinLeagueViaInvite,
  useLeagueInvitePreview,
  useApproveLeagueMember,
  useAcceptLeagueInvite,
  useRevokeLeagueInvite,
  useLeaveLeague,
  useRemoveLeagueMember,
  useSuspendLeagueMember,
  useReinstateLeagueMember,
  usePauseLeague,
  useResumeLeague,
  useCloseLeague,
  useSeasonFeeQuote,
  useEventEarnings,
  useCreateSeasonEnrollmentPayment,
  useRefundSeasonEnrollment,
  leagueKeys,
  useOpenSeason,
  useCloseSeason,
  useCancelSeason,
  useSeasonSessions,
  useSeasonRankings,
  useSeasonMembers,
  useMySeasonMembership,
  useSeasonReceiptUrl,
  useEnrollInSeason,
  useWithdrawFromSeason,
  useRemoveSeasonMember,
  usePublishSession,
  useProfilesByIds,
  usePlayersRatingReputation,
  useMyPayoutAccount,
  tournamentKeys,
} from '@rallia/shared-hooks';
import { SheetManager } from 'react-native-actions-sheet';
import { useStripe } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  isLeagueOrganizer,
  getMyPayoutAccount,
  TournamentPaymentError,
  supabase,
} from '@rallia/shared-services';
import type { PlayerSearchResult, Season, SeasonMemberWithProfile } from '@rallia/shared-services';

import { ConfirmationModal } from '#/components/ConfirmationModal';

import ParticipantRow from '../components/ParticipantRow';
import UnderlineTabBar, { type UnderlineTabItem } from '../components/UnderlineTabBar';
import { EventDetailTabBar } from '../features/events/components/EventDetailChrome';
import { styles } from '../features/leagues/detail/detailStyles';
import { DetailsTab } from '../features/leagues/detail/DetailsTab';
import { MembersTab } from '../features/leagues/detail/MembersTab';
import { OverviewTab } from '../features/leagues/detail/OverviewTab';
import { SeasonsTab } from '../features/leagues/detail/SeasonsTab';
import { SessionsTab } from '../features/leagues/detail/SessionsTab';
import {
  DashboardCtaCard,
  HeroChip,
  InfoRow,
  InvitedMembersSection,
  JOIN_ERROR_KEYS,
  JOIN_MODE_KEY,
  JOIN_VIA_INVITE_ERROR_KEYS,
  LabeledBlock,
  LeagueDetailSkeleton,
  LeagueStatusBadge,
  LifecycleStepper,
  MATCH_FORMAT_KEY,
  MembersSection,
  OverviewActionRow,
  OverviewInfoRow,
  PendingMembersSection,
  SEASON_ERROR_KEYS,
  SEASON_STATUS_KEY,
  SESSION_STATUS_KEY,
  Section,
  StatSegment,
  SuspendedMembersSection,
  VISIBILITY_KEY,
  estimateSeasonRefundCents,
  formatRatingRange,
  memberToPlayer,
  readRules,
  seasonRefundPolicyLine,
  seasonRefundZeroReason,
} from '../features/leagues/detail/components';
import type {
  ManageMemberRow,
  MembersSegment,
  PendingMemberRow,
  ScreenColors,
  SessionStatus,
} from '../features/leagues/detail/components';
import type { LeagueEditData } from '../features/leagues';
import { LeagueBanner } from '../features/leagues/components/LeagueBanner';
import { useTranslation, useRequireOnboarding, type TranslationKey } from '../hooks';
import { rpcErrorMessage } from '../utils/rpcErrorMessage';
import * as Analytics from '../services/analytics';
import type { RootStackParamList } from '../navigation';

type Route = RouteProp<RootStackParamList, 'LeagueDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const LeagueDetail: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigation = useNavigation<NavigationProp>();
  const { session } = useAuth();
  const userId = session?.user?.id;
  // The page reads for everyone, signed out included; the actions that change
  // state route through here first and open auth/onboarding when needed.
  const { guardAction } = useRequireOnboarding();
  const route = useRoute<Route>();
  const { leagueId, inviteToken: inviteTokenParam } = route.params;
  const isDark = theme === 'dark';
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const { data: directLeague, isLoading, isError, refetch: refetchLeague } = useLeague(leagueId);

  // Invite-token fallback: when the direct fetch comes back empty (private
  // league, caller not yet a member → RLS hides the row), a valid token still
  // renders the page via the preview RPC. Members/seasons stay empty until the
  // join lands — the screen degrades to an overview + join CTA.
  const invitePreviewEnabled = !!inviteTokenParam && !isLoading && !directLeague;
  const {
    data: invitePreview,
    isLoading: invitePreviewLoading,
    isError: inviteInvalid,
  } = useLeagueInvitePreview(inviteTokenParam, invitePreviewEnabled);
  const league = directLeague ?? invitePreview?.league ?? null;

  const { data: members = [], refetch: refetchMembers } = useLeagueMembers(leagueId);
  const {
    data: myMembership,
    isFetched: membershipFetched,
    refetch: refetchMembership,
  } = useMyLeagueMembership(leagueId, userId);
  const { data: seasons = [], refetch: refetchSeasons } = useLeagueSeasons(leagueId);
  const { data: profiles } = useProfilesByIds(league ? [league.organizer_id] : []);

  const isOrganizer = league ? isLeagueOrganizer(league, userId) : false;

  // Queue state: a queued joiner holds a 'pending' membership PLUS a waitlist
  // row — the row is what distinguishes "waiting for a seat" from "waiting for
  // approval", and it carries the place in line.
  const isPendingSelfRequest = myMembership?.status === 'pending' && !myMembership.invited_by;
  const { data: myQueueStatus } = useMyLeagueWaitlistStatus(leagueId, userId, isPendingSelfRequest);
  const { data: waitlistEntries = [] } = useLeagueWaitlist(leagueId, isOrganizer);
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

  // Deliberately not gated on userId: a signed-out visitor sees the Join CTA
  // like anyone else, and the guard on press turns it into the sign-in prompt.
  // Hiding it instead left the page with no action at all.
  const canJoin =
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
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.errors.generic', JOIN_ERROR_KEYS));
    },
  });

  // Arrived via a share link and not yet in: the CTA redeems the token instead
  // of calling league_join, so an organizer link keeps its skeleton-key power.
  const inviteToken = !isOrganizer ? inviteTokenParam : undefined;
  const joinViaInvite = useJoinLeagueViaInvite({
    onSuccess: m => {
      successHaptic();
      toast.success(
        m.status === 'pending' ? t('leagueDetail.joinPending') : t('leagueDetail.joinSuccess')
      );
      Analytics.leagueInviteRedeemed({ leagueId, result: 'joined' });
      if (m.status === 'pending') {
        Analytics.leagueMemberPendingAnalytics({ leagueId });
      } else {
        Analytics.leagueMemberJoinedAnalytics({ leagueId, viaInvite: true });
      }
      invalidateAll();
    },
    onError: e => {
      warningHaptic();
      Analytics.leagueInviteRedeemed({ leagueId, result: 'error', errorCode: e.message });
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.errors.generic', JOIN_VIA_INVITE_ERROR_KEYS));
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
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          LEAGUE_FULL: 'leagueDetail.joinErrors.leagueFull',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
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
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          NOT_INVITED: 'leagueDetail.joinErrors.notInvited',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
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
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          NOT_REVOCABLE: 'leagueDetail.memberErrors.notRevocable',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
  });

  const onMemberLifecycleError = useCallback(
    (e: Error) => {
      warningHaptic();
      toast.error(
        rpcErrorMessage(e, t, 'leagueDetail.errors.generic', {
          ORGANIZER_CANNOT_LEAVE: 'leagueDetail.memberErrors.organizerImmune',
          CANNOT_REMOVE_ORGANIZER: 'leagueDetail.memberErrors.organizerImmune',
          CANNOT_SUSPEND_ORGANIZER: 'leagueDetail.memberErrors.organizerImmune',
          MEMBER_NOT_FOUND: 'leagueDetail.memberErrors.memberNotFound',
        })
      );
    },
    [toast, t]
  );

  const { mutate: leaveLeagueMut, isPending: isLeaving } = useLeaveLeague(leagueId, {
    onError: onMemberLifecycleError,
  });

  // Rejecting a join request is the same RPC as removing a member (it accepts a
  // 'pending' row); only the confirmation the organizer gets differs.
  const isRejectingRequest = useRef(false);

  const { mutate: removeMemberMut, isPending: isRemovingMember } = useRemoveLeagueMember(leagueId, {
    onSuccess: () => {
      successHaptic();
      toast.success(
        t(
          isRejectingRequest.current ? 'leagueDetail.requestRejected' : 'leagueDetail.memberRemoved'
        )
      );
      isRejectingRequest.current = false;
      invalidateAll();
    },
    onError: e => {
      isRejectingRequest.current = false;
      onMemberLifecycleError(e);
    },
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

  // Organizer payout onboarding. The paid unit is the season, so an organizer
  // needs a card-capable Stripe Express account before a paid season can open.
  // Surface the row whenever any season carries a fee — including a draft the
  // organizer set a price on but hasn't opened yet, which is exactly when they
  // need to onboard (season_open raises PAYOUTS_SETUP_REQUIRED otherwise). The
  // account, and both edge functions, are per-organizer not per-event, so this
  // is the same flow tournaments use.
  const hasPaidSeason = useMemo(() => seasons.some(s => (s.entry_fee_cents ?? 0) > 0), [seasons]);
  const { data: payoutAccount } = useMyPayoutAccount(userId, isOrganizer && hasPaidSeason);

  const handleStripeOnboard = useCallback(
    async (businessType: 'individual' | 'company') => {
      try {
        const { data, error } = await supabase.functions.invoke('player-stripe-onboard', {
          body: { businessType },
        });
        if (error || !data?.url) throw new Error(error?.message);
        // Custom scheme (not the https return_url) so ASWebAuthenticationSession
        // auto-dismisses on the callback — the web /stripe-connect-return page
        // bounces Stripe's https return to this scheme.
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          'rallia://stripe-connect-return'
        );
        if (result.type === 'success' && userId) {
          // stripe-connect-webhook flips the mirror asynchronously (usually
          // well under 30 s); poll it so the payout badge updates without the
          // user leaving and reopening the screen.
          successHaptic();
          toast.info(t('leagueDetail.payments.payoutSyncWait'));
          void (async () => {
            for (let attempt = 0; attempt < 10; attempt++) {
              const status = await qc
                .fetchQuery({
                  queryKey: tournamentKeys.myPayoutAccount(userId),
                  queryFn: getMyPayoutAccount,
                  staleTime: 0,
                })
                .catch(() => null);
              if (status?.chargesEnabled) {
                successHaptic();
                toast.success(t('leagueDetail.payments.payoutsConnectedToast'));
                return;
              }
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          })();
        }
      } catch {
        warningHaptic();
        toast.error(t('leagueDetail.payments.onboardingError'));
      }
    },
    [qc, t, toast, userId]
  );

  // Ask individual vs company, then kick off onboarding. Shared by the payout
  // row and the season-open guard error path.
  const promptOnboardBusinessType = useCallback(() => {
    Alert.alert(
      t('leagueDetail.payments.payoutsSetupTitle'),
      t('leagueDetail.payments.payoutsSetupBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.payments.onboardTypeIndividual'),
          onPress: () => void handleStripeOnboard('individual'),
        },
        {
          text: t('leagueDetail.payments.onboardTypeBusiness'),
          onPress: () => void handleStripeOnboard('company'),
        },
      ]
    );
  }, [t, handleStripeOnboard]);

  // Post-onboarding: open the Stripe Express dashboard when ready, or resume
  // onboarding when unfinished. The webhook refreshes status, so invalidate on
  // return. player-stripe-manage makes several sequential Stripe calls before
  // returning the link, so the row shows a transient state and blocks re-taps.
  const [isOpeningPayoutDashboard, setIsOpeningPayoutDashboard] = useState(false);
  const handleManagePayouts = useCallback(async () => {
    if (isOpeningPayoutDashboard) return;
    setIsOpeningPayoutDashboard(true);
    try {
      const { data, error } = await supabase.functions.invoke('player-stripe-manage');
      if (error || !data?.url) throw new Error(error?.message);
      await WebBrowser.openAuthSessionAsync(data.url, 'rallia://stripe-connect-return');
      if (userId) {
        void qc.invalidateQueries({ queryKey: tournamentKeys.myPayoutAccount(userId) });
      }
    } catch {
      warningHaptic();
      toast.error(t('leagueDetail.payments.manageError'));
    }
    setIsOpeningPayoutDashboard(false);
  }, [qc, t, toast, userId, isOpeningPayoutDashboard]);

  const { mutate: openSeasonMut, isPending: isOpeningSeason } = useOpenSeason(leagueId, {
    onSuccess: season => {
      successHaptic();
      toast.success(t('leagueDetail.seasonOpened'));
      Analytics.seasonOpenedAnalytics({ leagueId, seasonId: season.id });
      invalidateAll();
    },
    onError: e => {
      // Paid season without completed payout setup: prompt the organizer to
      // finish Stripe onboarding instead of surfacing the raw gate code.
      if (e.message.includes('PAYOUTS_SETUP_REQUIRED')) {
        warningHaptic();
        promptOnboardBusinessType();
        return;
      }
      warningHaptic();
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
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

  const openSeason = useMemo(() => seasons.find(s => s.status === 'open'), [seasons]);
  const openSeasonId = openSeason?.id;
  const { data: seasonRoster = [] } = useSeasonMembers(openSeasonId);

  // Sport-scoped rating + reputation for every member/roster row, batch-fetched
  // once (league members lack the enrichment the tournament participants RPC
  // bakes in).
  const badgePlayerIds = useMemo(
    () => [...members.map(m => m.user_id), ...seasonRoster.map(m => m.user_id)],
    [members, seasonRoster]
  );
  const { data: memberBadges } = usePlayersRatingReputation(badgePlayerIds, league?.sport_id);

  // Queued joiners are pending rows that also hold a waitlist entry; tag them
  // with their place in line and list them after the plain approval requests,
  // in queue order.
  const queueRankByUser = useMemo(() => {
    const map = new Map<string, number>();
    waitlistEntries.forEach((w, i) => map.set(w.user_id, i + 1));
    return map;
  }, [waitlistEntries]);

  const pendingMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? pendingRequests
            .map(m => ({
              player: memberToPlayer(m, memberBadges?.[m.user_id]),
              memberId: m.id,
              version: m.version,
              queueRank: queueRankByUser.get(m.user_id),
            }))
            .sort((a, b) => (a.queueRank ?? 0) - (b.queueRank ?? 0))
        : [],
    [pendingRequests, isOrganizer, memberBadges, queueRankByUser]
  );

  const invitedMemberRows = useMemo<PendingMemberRow[]>(
    () =>
      isOrganizer
        ? invitedMembers.map(m => ({
            player: memberToPlayer(m, memberBadges?.[m.user_id]),
            memberId: m.id,
            version: m.version,
          }))
        : [],
    [invitedMembers, isOrganizer, memberBadges]
  );

  const activeMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      activeMembers.map(m => ({
        player: memberToPlayer(m, memberBadges?.[m.user_id]),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [activeMembers, memberBadges]
  );
  const suspendedMemberRows = useMemo<ManageMemberRow[]>(
    () =>
      suspendedMembers.map(m => ({
        player: memberToPlayer(m, memberBadges?.[m.user_id]),
        memberId: m.id,
        version: m.version,
        userId: m.user_id,
      })),
    [suspendedMembers, memberBadges]
  );

  // Members-tab status segments. Requests / Invited / Suspended only exist
  // while they hold entries (all organizer-gated); the selection falls back to
  // Confirmed when its segment empties out.
  const [membersSegment, setMembersSegment] = useState<MembersSegment>('confirmed');
  const membersSegmentTabs = useMemo<UnderlineTabItem<MembersSegment>[]>(() => {
    const tabs: UnderlineTabItem<MembersSegment>[] = [
      {
        key: 'confirmed',
        label: t('leagueDetail.dashboard.memberTabs.confirmed'),
        count: activeMemberRows.length,
        tone: 'positive',
      },
    ];
    // Requests need the organizer to act, so they run warm; invites are just
    // waiting on the invitee.
    if (pendingMemberRows.length > 0)
      tabs.push({
        key: 'requests',
        label: t('leagueDetail.dashboard.memberTabs.requests'),
        count: pendingMemberRows.length,
        tone: 'warning',
      });
    if (invitedMemberRows.length > 0)
      tabs.push({
        key: 'invited',
        label: t('leagueDetail.dashboard.memberTabs.invited'),
        count: invitedMemberRows.length,
        tone: 'info',
      });
    if (isOrganizer && suspendedMemberRows.length > 0)
      tabs.push({
        key: 'suspended',
        label: t('leagueDetail.dashboard.memberTabs.suspended'),
        count: suspendedMemberRows.length,
        tone: 'danger',
      });
    return tabs;
  }, [
    t,
    activeMemberRows.length,
    pendingMemberRows.length,
    invitedMemberRows.length,
    suspendedMemberRows.length,
    isOrganizer,
  ]);
  const activeMembersSegment: MembersSegment = membersSegmentTabs.some(
    tab => tab.key === membersSegment
  )
    ? membersSegment
    : 'confirmed';

  const draftSeasons = useMemo(() => seasons.filter(s => s.status === 'draft'), [seasons]);

  const { data: seasonSessions = [] } = useSeasonSessions(openSeasonId);

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
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
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
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
      },
    }
  );

  // ---------------------------------------------------------------- paid seasons
  const isPaidSeason = (openSeason?.entry_fee_cents ?? 0) > 0;
  const { data: seasonFeeQuote } = useSeasonFeeQuote(openSeasonId, isPaidSeason);
  // What the open season has collected — the organizer's only in-app money view
  // (the Stripe dashboard is account-wide and can't be tied back to one season).
  const { data: seasonEarnings } = useEventEarnings(
    { seasonId: openSeasonId },
    isOrganizer && isPaidSeason
  );
  // Stripe-hosted receipt for the viewer's own paid enrollment. Not gated on
  // enrollment: after a withdrawal that same receipt is where the refund shows up.
  const { data: seasonReceiptUrl } = useSeasonReceiptUrl(mySeasonMembership?.id, isPaidSeason);
  const { mutateAsync: createSeasonPayment, isPending: isPayingSeason } =
    useCreateSeasonEnrollmentPayment();
  const { mutateAsync: refundSeasonEnrollmentAsync, isPending: isRefundingSeason } =
    useRefundSeasonEnrollment();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const handlePaidEnroll = useCallback(async () => {
    if (!openSeasonId || !seasonFeeQuote) return;

    // Point-of-sale disclosure before any charge: the full price breakdown,
    // the refund policy, that the service fee isn't refundable, and that
    // Rallia only facilitates (the organizer, not Rallia, owns the season).
    // GST/QST rides on Rallia's service fee; the player only pays the fee and
    // its tax in player_pays mode (organizer_absorbs nets them from the
    // organizer's take, so the player sees the entry price and nothing else).
    const cur = seasonFeeQuote.currency;
    const money = (cents: number) => formatPrice(cents, cur, { locale });
    const playerPaysFee = seasonFeeQuote.feePayer === 'player_pays';
    const breakdown = playerPaysFee
      ? ([
          t('leagueDetail.paid.breakdownEntry').replace(
            '{amount}',
            money(seasonFeeQuote.entryCents)
          ),
          t('leagueDetail.paid.breakdownServiceFee').replace(
            '{amount}',
            money(seasonFeeQuote.serviceFeeCents)
          ),
          seasonFeeQuote.feeTaxCents > 0
            ? t('leagueDetail.paid.breakdownFeeTax').replace(
                '{amount}',
                money(seasonFeeQuote.feeTaxCents)
              )
            : null,
          t('leagueDetail.paid.breakdownTotal').replace(
            '{amount}',
            money(seasonFeeQuote.totalCents)
          ),
        ]
          .filter(Boolean)
          .join('\n') as string)
      : [
          t('leagueDetail.paid.breakdownEntry').replace(
            '{amount}',
            money(seasonFeeQuote.entryCents)
          ),
          t('leagueDetail.paid.feeCoveredByOrganizer'),
          t('leagueDetail.paid.breakdownTotalTaxesIncluded').replace(
            '{amount}',
            money(seasonFeeQuote.totalCents)
          ),
        ].join('\n');
    const lines = [
      breakdown,
      seasonRefundPolicyLine(seasonFeeQuote, t, locale),
      playerPaysFee ? t('leagueDetail.paid.confirmFeeNonRefundable') : null,
      t('leagueDetail.paid.liabilityNotice'),
    ].filter(Boolean) as string[];

    const confirmed = await new Promise<boolean>(resolve => {
      Alert.alert(t('leagueDetail.paid.confirmTitle'), lines.join('\n\n'), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('leagueDetail.paid.pay'), onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    try {
      const intent = await createSeasonPayment({ seasonId: openSeasonId });
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: intent.clientSecret,
        merchantDisplayName: 'Rallia',
        applePay: { merchantCountryCode: 'CA' },
        googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: __DEV__ },
      });
      if (initError) throw new Error(initError.message);

      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        // Cancelling is not a failure: the 15-min reaper frees the slot.
        if (payError.code === 'Canceled') return;
        throw new Error(payError.message);
      }

      successHaptic();
      toast.success(t('leagueDetail.roster.enrolled'));

      // The webhook flips payment_pending -> enrolled asynchronously, so a single
      // invalidate here would re-read the pre-webhook state. Refetch again shortly
      // after (same trick TournamentDetail uses).
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: leagueKeys.seasons(leagueId) });
        void qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(openSeasonId) });
        void qc.invalidateQueries({
          queryKey: leagueKeys.mySeasonMembership(openSeasonId, userId ?? ''),
        });
        void qc.invalidateQueries({ queryKey: leagueKeys.rankings(openSeasonId) });
      };
      refresh();
      setTimeout(refresh, 2500);
    } catch (e) {
      warningHaptic();
      const code = e instanceof TournamentPaymentError ? e.code : null;
      const key =
        code === 'season_not_open'
          ? 'leagueDetail.paid.errors.seasonNotOpen'
          : code === 'already_enrolled'
            ? 'leagueDetail.paid.errors.alreadyEnrolled'
            : code === 'enrollment_removed'
              ? 'leagueDetail.paid.errors.enrollmentRemoved'
              : code === 'organizer_not_ready'
                ? 'leagueDetail.paid.errors.organizerNotReady'
                : code === 'not_league_member'
                  ? 'leagueDetail.paid.errors.notMember'
                  : 'leagueDetail.paid.errors.generic';
      toast.error(t(key));
    }
  }, [
    createSeasonPayment,
    initPaymentSheet,
    leagueId,
    locale,
    openSeasonId,
    presentPaymentSheet,
    qc,
    seasonFeeQuote,
    t,
    toast,
    userId,
  ]);

  const handleWithdrawSeason = useCallback(() => {
    // A paid enrolment must go through the refund path, not a plain withdraw:
    // the refund RPC is what reverses the charge per the season's policy.
    if (isPaidSeason && mySeasonMembership) {
      // Client-side mirror of the SQL policy math, for the confirm copy only —
      // the server recomputes the authoritative amount.
      const estimate = estimateSeasonRefundCents(seasonFeeQuote);
      const money = (cents: number) =>
        formatPrice(cents, seasonFeeQuote?.currency ?? 'CAD', { locale });
      // The fee + its GST/QST only exist on the player's side in player_pays mode.
      const feesKeptCents = seasonFeeQuote
        ? seasonFeeQuote.serviceFeeCents + seasonFeeQuote.feeTaxCents
        : 0;
      const playerPaidFee =
        !!seasonFeeQuote && seasonFeeQuote.feePayer === 'player_pays' && feesKeptCents > 0;
      const cutoffLabel = seasonFeeQuote?.refundCutoffAt
        ? new Date(seasonFeeQuote.refundCutoffAt).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '';
      const zeroLine =
        seasonRefundZeroReason(seasonFeeQuote) === 'cutoff'
          ? t('leagueDetail.paid.withdrawConfirmCutoffPassed').replace('{date}', cutoffLabel)
          : t('leagueDetail.paid.withdrawConfirmNoRefund');
      const message = [
        seasonFeeQuote
          ? t('leagueDetail.paid.withdrawConfirmPaid').replace(
              '{amount}',
              money(seasonFeeQuote.totalCents)
            )
          : null,
        estimate > 0
          ? t('leagueDetail.paid.withdrawConfirmRefund').replace('{amount}', money(estimate))
          : zeroLine,
        estimate > 0 && playerPaidFee
          ? t('leagueDetail.paid.withdrawConfirmFeesKept').replace('{amount}', money(feesKeptCents))
          : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert(t('leagueDetail.paid.withdrawConfirmTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.roster.leave'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const r = await refundSeasonEnrollmentAsync({
                  seasonMemberId: mySeasonMembership.id,
                  versionWas: mySeasonMembership.version,
                  seasonId: mySeasonMembership.season_id,
                  leagueId,
                });
                lightHaptic();
                toast.success(
                  r.refundedCents > 0
                    ? t('leagueDetail.paid.refunded').replace(
                        '{amount}',
                        formatPrice(r.refundedCents, seasonFeeQuote?.currency ?? 'CAD', {
                          locale,
                        })
                      )
                    : t('leagueDetail.roster.withdrew')
                );
              } catch {
                warningHaptic();
                toast.error(t('leagueDetail.paid.errors.refundFailed'));
              }
            })();
          },
        },
      ]);
      return;
    }

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
  }, [
    isPaidSeason,
    leagueId,
    locale,
    mySeasonMembership,
    refundSeasonEnrollmentAsync,
    seasonFeeQuote,
    t,
    toast,
    withdrawSeasonMut,
  ]);

  // Organizer removes a roster member. Removal marks the member disqualified;
  // on a paid season that queues an automatic refund through the settle cron
  // (the same path a cancellation uses), so the confirmation tells the player
  // their entry comes back per the season's policy. Mirrors how tournaments
  // treat an organizer removal.
  const { mutate: removeSeasonMemberMut, isPending: isRemovingSeasonMember } =
    useRemoveSeasonMember(openSeasonId ?? '', {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.roster.removed'));
      },
      onError: e => {
        const msg = e.message || '';
        const key = msg.includes('OPTIMISTIC_LOCK_CONFLICT')
          ? 'leagueDetail.roster.removeErrors.stale'
          : msg.includes('NOT_ORGANIZER')
            ? 'leagueDetail.roster.removeErrors.notOrganizer'
            : msg.includes('NOT_REMOVABLE')
              ? 'leagueDetail.roster.removeErrors.notRemovable'
              : 'leagueDetail.roster.removeErrors.generic';
        warningHaptic();
        toast.error(t(key));
      },
    });

  const handleRemoveSeasonMember = useCallback(
    (member: SeasonMemberWithProfile) => {
      if (isRemovingSeasonMember) return;
      const name = getHumanName(member.profile, t('leagueDetail.unknownMember'));
      const doRemove = () => {
        warningHaptic();
        removeSeasonMemberMut({ seasonMemberId: member.id, versionWas: member.version });
      };
      const body = isPaidSeason
        ? estimateSeasonRefundCents(seasonFeeQuote) > 0
          ? t('leagueDetail.roster.removeConfirmRefund', {
              amount: formatPrice(
                estimateSeasonRefundCents(seasonFeeQuote),
                seasonFeeQuote?.currency ?? 'CAD',
                {
                  locale,
                }
              ),
            })
          : seasonRefundZeroReason(seasonFeeQuote) === 'cutoff'
            ? t('leagueDetail.roster.removeConfirmCutoffPassed')
            : t('leagueDetail.roster.removeConfirmNoRefund')
        : t('leagueDetail.roster.removeConfirmFree');
      Alert.alert(t('leagueDetail.roster.removeConfirmTitle', { name }), body, [
        { text: t('leagueDetail.roster.keepMember'), style: 'cancel' },
        { text: t('leagueDetail.roster.removeConfirm'), style: 'destructive', onPress: doRemove },
      ]);
    },
    [isPaidSeason, isRemovingSeasonMember, locale, removeSeasonMemberMut, seasonFeeQuote, t]
  );

  // Every season that ever had standings, newest first: a closed season keeps
  // its table instead of being buried by the next one.
  const standingsSeasons = useMemo(
    () =>
      seasons
        .filter(s => s.status === 'open' || s.status === 'closed')
        .sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [seasons]
  );
  const [pickedStandingsSeasonId, setPickedStandingsSeasonId] = useState<string | null>(null);

  // Default to the open season, else the most recent closed one.
  const rankingSeason = useMemo(
    () =>
      standingsSeasons.find(s => s.id === pickedStandingsSeasonId) ??
      openSeason ??
      standingsSeasons[0] ??
      null,
    [standingsSeasons, pickedStandingsSeasonId, openSeason]
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
      toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
    },
  });

  // Closing freezes the final standings and cannot be undone, so it asks first,
  // the way cancelling a season and closing the league already do.
  const handleCloseSeasonPress = useCallback(
    (seasonId: string, versionWas: number, name: string) => {
      if (isClosingSeason) return;
      Alert.alert(
        t('leagueDetail.confirm.closeSeasonTitle', { name }),
        t('leagueDetail.confirm.closeSeasonMessage'),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.closeSeasonConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              closeSeasonMut({ seasonId, versionWas });
            },
          },
        ]
      );
    },
    [closeSeasonMut, isClosingSeason, t]
  );

  const { cancelSeasonAsync, isCancellingSeason } = useCancelSeason({
    onSuccess: () => {
      successHaptic();
      toast.success(t('leagueDetail.seasonCancelled'));
      invalidateAll();
    },
    onError: e => {
      const msg = e.message || '';
      const key = msg.includes('SEASON_NOT_CANCELLABLE')
        ? 'leagueDetail.seasonLifecycle.errors.notCancellable'
        : msg.includes('OPTIMISTIC_LOCK_CONFLICT') || msg.includes('NOT_ORGANIZER')
          ? 'leagueDetail.seasonLifecycle.errors.stale'
          : 'leagueDetail.seasonLifecycle.errors.cancelFailed';
      warningHaptic();
      toast.error(t(key));
    },
  });

  // Cancel is the abort path, distinct from close: it flips the season to
  // 'cancelled', which is the only status that feeds paid enrolments into the
  // refund cron (lt_cancel_refund_candidates). A paid open season is where the
  // money warning matters — cancel refunds everyone per policy, close pays the
  // organizer instead. Draft seasons have no enrolments so the copy is plainer.
  // season_cancel has always accepted a reason and stored it in
  // cancelled_reason; the UI sent null, so the cancellation notice reaching
  // members had nothing to explain it. Ask, the way session cancellation does.
  const [cancelSeasonTarget, setCancelSeasonTarget] = useState<Season | null>(null);
  const [cancelSeasonReason, setCancelSeasonReason] = useState('');

  // Money summary for the open season, from the payment ledger. Alert keeps it
  // glanceable; the Stripe dashboard remains the detailed view.
  const showSeasonEarnings = useCallback(() => {
    if (!seasonEarnings) return;
    const cur = seasonEarnings.currency ?? 'CAD';
    const money = (cents: number) => formatPrice(cents, cur, { locale });
    const e = seasonEarnings;
    const lines =
      e.paidCount === 0 && e.pendingCount === 0 && e.refundedCount === 0
        ? [t('leagueDetail.earnings.none')]
        : [
            t('leagueDetail.earnings.paidLine')
              .replace('{count}', String(e.paidCount))
              .replace('{amount}', money(e.entryCents)),
            t('leagueDetail.earnings.feesLine').replace(
              '{amount}',
              money(e.serviceFeeCents + e.feeTaxCents)
            ),
            ...(e.refundedCents > 0
              ? [
                  t('leagueDetail.earnings.refundedLine').replace(
                    '{amount}',
                    money(e.refundedCents)
                  ),
                ]
              : []),
            ...(e.pendingCount > 0
              ? [t('leagueDetail.earnings.pendingLine').replace('{count}', String(e.pendingCount))]
              : []),
            t('leagueDetail.earnings.netLine').replace('{amount}', money(e.netToOrganizerCents)),
            ...(e.releasedCount > 0
              ? [
                  t('leagueDetail.earnings.releasedLine').replace(
                    '{count}',
                    String(e.releasedCount)
                  ),
                ]
              : []),
          ];
    Alert.alert(t('leagueDetail.earnings.title'), lines.join('\n'), [
      { text: t('leagueDetail.earnings.close') },
    ]);
  }, [seasonEarnings, t, locale]);

  const handleCancelSeason = useCallback(
    (season: Season) => {
      if (isCancellingSeason) return;
      warningHaptic();
      setCancelSeasonReason('');
      setCancelSeasonTarget(season);
    },
    [isCancellingSeason]
  );

  const { mutate: publishSessionMut, isPending: isPublishingSession } = usePublishSession(
    openSeason?.id ?? '',
    {
      onSuccess: () => {
        successHaptic();
        toast.success(t('leagueDetail.sessions.published'));
      },
      onError: e => {
        warningHaptic();
        toast.error(rpcErrorMessage(e, t, 'leagueDetail.seasonErrors.generic', SEASON_ERROR_KEYS));
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

  const goToTab = useCallback((idx: number) => {
    void lightHaptic();
    setActiveTabIdx(idx);
  }, []);

  /** The shared tab bar speaks keys; this screen tracks the index. */
  const selectTab = useCallback(
    (key: (typeof tabs)[number]['key']) => {
      const idx = tabs.findIndex(tab => tab.key === key);
      if (idx >= 0) goToTab(idx);
    },
    [tabs, goToTab]
  );

  // Opening a player profile stays behind the guard the player directory uses,
  // so a roster is not a way around it.
  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!league) return;
      lightHaptic();
      if (!guardAction()) return;
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: league.sport_id,
      });
    },
    [navigation, league, guardAction]
  );

  const handleApprovePress = useCallback(
    (memberId: string, version: number) => {
      if (isApproving) return;
      lightHaptic();
      approveMember({ memberId, versionWas: version });
    },
    [approveMember, isApproving]
  );

  const handleRejectPress = useCallback(
    (memberId: string, version: number, name: string) => {
      if (isRemovingMember) return;
      Alert.alert(
        t('leagueDetail.confirm.rejectTitle', { name }),
        t('leagueDetail.confirm.rejectMessage', { name }),
        [
          { text: t('leagueDetail.confirm.cancel'), style: 'cancel' },
          {
            text: t('leagueDetail.confirm.rejectConfirm'),
            style: 'destructive',
            onPress: () => {
              warningHaptic();
              isRejectingRequest.current = true;
              removeMemberMut({ memberId, versionWas: version });
            },
          },
        ]
      );
    },
    [isRemovingMember, removeMemberMut, t]
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

  const handleEditLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    void SheetManager.show('league-edit', {
      payload: {
        league: {
          id: league.id,
          version: league.version,
          name: league.name,
          description: league.description,
          visibility: league.visibility as LeagueEditData['visibility'],
          joinMode: league.join_mode,
          minRating: league.min_rating,
          maxRating: league.max_rating,
          logoUrl: league.logo_url,
          memberCapacity: league.member_capacity,
          waitlistEnabled: league.waitlist_enabled,
          defaultRules: readRules(league.default_rules) as Record<string, unknown>,
        },
      },
    });
  }, [league]);

  // All three lifecycle transitions map their server errors the same way.
  const lifecycleErrorHandler = useCallback(
    (err: Error) => {
      const msg = err.message || '';
      const key = msg.includes('LEAGUE_HAS_OPEN_SEASONS')
        ? 'leagueDetail.lifecycle.errors.hasOpenSeasons'
        : msg.includes('OPTIMISTIC_LOCK_CONFLICT') ||
            msg.includes('LEAGUE_NOT_ACTIVE') ||
            msg.includes('LEAGUE_NOT_PAUSED') ||
            msg.includes('LEAGUE_NOT_CLOSABLE')
          ? 'leagueDetail.lifecycle.errors.stale'
          : 'leagueDetail.lifecycle.errors.generic';
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  const { pauseLeagueAsync, isPausing } = usePauseLeague({ onError: lifecycleErrorHandler });
  const { resumeLeagueAsync, isResuming } = useResumeLeague({ onError: lifecycleErrorHandler });
  const { closeLeagueAsync, isClosing } = useCloseLeague({ onError: lifecycleErrorHandler });

  const handlePauseLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    Alert.alert(
      t('leagueDetail.lifecycle.pauseConfirmTitle'),
      t('leagueDetail.lifecycle.pauseConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.lifecycle.pause'),
          onPress: () => {
            void (async () => {
              try {
                await pauseLeagueAsync({ leagueId: league.id, versionWas: league.version });
                successHaptic();
                toast.success(t('leagueDetail.lifecycle.paused'));
              } catch {
                // toast handled in hook
              }
            })();
          },
        },
      ]
    );
  }, [league, pauseLeagueAsync, t, toast]);

  const handleResumeLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    void (async () => {
      try {
        await resumeLeagueAsync({ leagueId: league.id, versionWas: league.version });
        successHaptic();
        toast.success(t('leagueDetail.lifecycle.resumed'));
      } catch {
        // toast handled in hook
      }
    })();
  }, [league, resumeLeagueAsync, t, toast]);

  const handleCloseLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    Alert.alert(
      t('leagueDetail.lifecycle.closeConfirmTitle'),
      t('leagueDetail.lifecycle.closeConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('leagueDetail.lifecycle.close'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await closeLeagueAsync({
                  leagueId: league.id,
                  reason: null,
                  versionWas: league.version,
                });
                successHaptic();
                toast.success(t('leagueDetail.lifecycle.closed'));
              } catch {
                // toast handled in hook
              }
            })();
          },
        },
      ]
    );
  }, [league, closeLeagueAsync, t, toast]);

  const handleOpenCreateSeason = useCallback(() => {
    lightHaptic();
    void SheetManager.show('create-season', { payload: { leagueId } });
  }, [leagueId]);

  const handleOpenCreateSession = useCallback(() => {
    if (!openSeason) return;
    lightHaptic();
    const seasonRules = readRules(openSeason.rules);
    void SheetManager.show('create-session', {
      payload: {
        seasonId: openSeason.id,
        leagueId,
        defaultRounds: seasonRules.gamesPerPlayer,
      },
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

  // Pull-to-refresh: rosters, seasons and paid-enrolment state all settle
  // server-side after the user leaves the screen, so refetch the whole set.
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: leagueKeys.detail(leagueId) }),
        qc.invalidateQueries({ queryKey: leagueKeys.members(leagueId) }),
        qc.invalidateQueries({ queryKey: leagueKeys.seasons(leagueId) }),
        // The roster can move server-side while the user sits here, so the
        // card's member count is refreshed alongside the rest.
        qc.invalidateQueries({ queryKey: leagueKeys.lists() }),
        // Pulling is exactly what someone does when the screen looks stale,
        // and "am I in yet?" is the state most likely to have moved.
        userId
          ? qc.invalidateQueries({ queryKey: leagueKeys.myMembership(leagueId, userId) })
          : Promise.resolve(),
        userId
          ? qc.invalidateQueries({ queryKey: leagueKeys.myWaitlistStatus(leagueId, userId) })
          : Promise.resolve(),
        qc.invalidateQueries({ queryKey: leagueKeys.waitlist(leagueId) }),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(openSeasonId) })
          : Promise.resolve(),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.sessions(openSeasonId) })
          : Promise.resolve(),
        openSeasonId
          ? qc.invalidateQueries({ queryKey: leagueKeys.rankings(openSeasonId) })
          : Promise.resolve(),
        openSeasonId && userId
          ? qc.invalidateQueries({
              queryKey: leagueKeys.mySeasonMembership(openSeasonId, userId),
            })
          : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [qc, leagueId, openSeasonId, userId]);

  // Share is headerRight for anyone who can actually mint a link: the
  // organizer always (their skeleton-key link, even on a private league), and
  // everyone else only where the player-link mint would succeed. Mirrors the
  // conditions in league_invite_get_or_create.
  const canShareLeague =
    !!league &&
    (isOrganizer
      ? league.status !== 'closed'
      : league.visibility === 'public' &&
        league.join_mode !== 'invite_only' &&
        league.status === 'active');

  const handleShareLeague = useCallback(() => {
    if (!league) return;
    lightHaptic();
    void SheetManager.show('league-invite', {
      payload: { leagueId: league.id, leagueName: league.name },
    });
  }, [league]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: canShareLeague
        ? () => (
            <TouchableOpacity
              onPress={handleShareLeague}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('leagueDetail.invite.shareCta')}
              testID="league-share"
            >
              <Ionicons name="share-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, canShareLeague, handleShareLeague, colors.text, t]);

  if (isLoading || (invitePreviewEnabled && invitePreviewLoading)) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <LeagueDetailSkeleton />
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
    // A dead share link (revoked, expired, or the league closed) gets its own
    // words — "league not found" would read as a bug to the recipient.
    const invalidInvite = !!inviteTokenParam && inviteInvalid;
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons
            name={invalidInvite ? 'link-outline' : 'people-outline'}
            size={48}
            color={colors.textMuted}
          />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t(invalidInvite ? 'leagueDetail.invite.invalidTitle' : 'leagueDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {t(
              invalidInvite
                ? 'leagueDetail.invite.invalidDescription'
                : 'leagueDetail.notFoundDescription'
            )}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const ratingRangeLabel = formatRatingRange(league.min_rating, league.max_rating);

  // How the league actually runs, read off the rules the standings use. The open
  // season wins: its rules are snapshotted at creation and can drift from the
  // league defaults afterwards.
  const rules = readRules(openSeason?.rules ?? league.default_rules);
  const scoringLabel = rules.matchFormat ? MATCH_FORMAT_KEY[rules.matchFormat] : undefined;
  const pointsLabel =
    rules.pointWin != null && rules.pointLoss != null
      ? t('leagueDetail.overview.rulesPoints', {
          win: String(rules.pointWin),
          loss: String(rules.pointLoss),
          bye: String(rules.pointBye ?? 0),
        })
      : undefined;

  /** Organizer utilities, rendered as one quiet grouped list in the Overview. */
  const organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }> = [];
  if (isOrganizer) {
    organizerRows.push({
      icon: 'person-add-outline',
      label: t('leagueDetail.invitePlayers.button'),
      onPress: handleInvitePress,
      testID: 'action-invite-players',
    });
    // undefined = still loading (or no paid season, query disabled); the row
    // appears once payout status is known.
    if (hasPaidSeason && payoutAccount !== undefined) {
      organizerRows.push({
        icon: 'wallet-outline',
        label: t('leagueDetail.payments.payoutRow.label'),
        onPress:
          payoutAccount === null ? promptOnboardBusinessType : () => void handleManagePayouts(),
        badge: isOpeningPayoutDashboard
          ? { label: t('leagueDetail.payments.payoutRow.opening'), tone: 'muted' }
          : payoutAccount === null
            ? { label: t('leagueDetail.payments.payoutRow.setup'), tone: 'muted' }
            : !payoutAccount.chargesEnabled
              ? { label: t('leagueDetail.payments.payoutRow.actionNeeded'), tone: 'warning' }
              : { label: t('leagueDetail.payments.payoutRow.ready'), tone: 'positive' },
        testID: 'action-payouts',
      });
    }
    // A closed league is terminal server-side, so edit is hidden rather than
    // offered and then refused.
    if (league.status !== 'closed') {
      organizerRows.push({
        icon: 'create-outline',
        label: t('leagueDetail.editModal.title'),
        onPress: handleEditLeague,
        testID: 'cta-edit-league',
      });
    }
    // Lifecycle. Pause/resume are mutually exclusive on status; close is
    // terminal so it's hidden once closed rather than shown and refused.
    if (league.status === 'active') {
      organizerRows.push({
        icon: 'pause-circle-outline',
        label: isPausing ? t('leagueDetail.lifecycle.pausing') : t('leagueDetail.lifecycle.pause'),
        onPress: handlePauseLeague,
        disabled: isPausing,
        testID: 'cta-pause-league',
      });
    }
    if (league.status === 'paused') {
      organizerRows.push({
        icon: 'play-circle-outline',
        label: isResuming
          ? t('leagueDetail.lifecycle.resuming')
          : t('leagueDetail.lifecycle.resume'),
        onPress: handleResumeLeague,
        disabled: isResuming,
        testID: 'cta-resume-league',
      });
    }
    if (league.status !== 'closed') {
      organizerRows.push({
        icon: 'lock-closed-outline',
        label: isClosing ? t('leagueDetail.lifecycle.closing') : t('leagueDetail.lifecycle.close'),
        onPress: handleCloseLeague,
        destructive: true,
        disabled: isClosing,
        testID: 'cta-close-league',
      });
    }
  }

  /**
   * The one state-advancing action for this viewer, docked to the bottom of
   * the screen so it's reachable from any tab at any position (the tournament
   * pattern). Everything else stays quiet in the Overview.
   */
  const primaryAction: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    disabled: boolean;
    hint: string | null;
    testID: string;
  } | null = (() => {
    if (league.status === 'closed') return null;
    // Organizer-sent invite: accept is the conversion moment.
    if (!isOrganizer && myMembership?.status === 'pending' && myMembership.invited_by) {
      return {
        label: isAccepting ? t('leagueDetail.accepting') : t('leagueDetail.acceptInvite'),
        icon: 'mail-open-outline',
        onPress: () => {
          lightHaptic();
          acceptInvite();
        },
        disabled: isAccepting,
        hint: null,
        testID: 'cta-accept-invite',
      };
    }
    if (canJoin) {
      const joinBusy = isJoining || joinViaInvite.isPending;
      return {
        label: joinBusy ? t('leagueDetail.actions.joining') : t('leagueDetail.actions.join'),
        icon: 'person-add-outline',
        onPress: () => {
          lightHaptic();
          // league_join answers NOT_AUTHENTICATED for a visitor: ask for the
          // account instead of surfacing an RPC error.
          if (!guardAction()) return;
          if (inviteToken) {
            joinViaInvite.mutate({ token: inviteToken, leagueId });
          } else {
            joinLeague();
          }
        },
        disabled: joinBusy,
        hint: t('leagueDetail.dashboard.joinCta.description'),
        testID: 'cta-join-league',
      };
    }
    // Active member with a PAID open season they haven't paid into yet. A free
    // season needs no such step: opening it seeds every active member into the
    // standings, and confirming a session enrolls the player on its own.
    if (
      !isOrganizer &&
      league.status === 'active' &&
      openSeason &&
      isPaidSeason &&
      canParticipateInSeason &&
      !isEnrolledInSeason
    ) {
      const busy = isEnrollingSeason || isPayingSeason;
      return {
        label: busy
          ? t('leagueDetail.roster.enrolling')
          : isPaidSeason && seasonFeeQuote
            ? t('leagueDetail.paid.enrollFor').replace(
                '{amount}',
                formatPrice(seasonFeeQuote.totalCents, seasonFeeQuote.currency, {
                  locale,
                  trimZeroCents: true,
                })
              )
            : t('leagueDetail.roster.enroll'),
        icon: 'person-add-outline',
        onPress: () => {
          lightHaptic();
          if (!guardAction()) return;
          if (isPaidSeason) void handlePaidEnroll();
          else enrollSeasonMut();
        },
        disabled: busy,
        hint: isPaidSeason ? seasonRefundPolicyLine(seasonFeeQuote, t, locale) : null,
        testID: 'cta-enroll-season',
      };
    }
    if (isOrganizer && league.status === 'active') {
      if (seasons.length === 0) {
        return {
          label: t('leagueDetail.createSeason.submit'),
          icon: 'add-outline',
          onPress: handleOpenCreateSeason,
          disabled: false,
          hint: t('leagueDetail.dashboard.createSeasonCta.description'),
          testID: 'cta-create-season-overview',
        };
      }
      if (!openSeason && draftSeasons.length > 0) {
        return {
          label: isOpeningSeason
            ? t('leagueDetail.actions.openingSeason')
            : t('leagueDetail.actions.openSeason'),
          icon: 'lock-open-outline',
          onPress: () => {
            lightHaptic();
            openSeasonMut({ seasonId: draftSeasons[0].id, versionWas: draftSeasons[0].version });
          },
          disabled: isOpeningSeason,
          hint: t('leagueDetail.dashboard.openSeasonCta.description').replace(
            '{name}',
            draftSeasons[0].name
          ),
          // Not 'cta-open-season': the Seasons tab keeps that id and Maestro
          // taps it there — duplicate ids make the tap ambiguous.
          testID: 'cta-open-season-docked',
        };
      }
    }
    return null;
  })();

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={[
          styles.screenScrollContent,
          // Clear the docked bar (button + a two-line hint at worst) so the
          // last card is never trapped behind it.
          primaryAction ? { paddingBottom: 120 + insets.bottom } : null,
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero */}
        <View style={styles.heroFixed}>
          {/* Full-bleed banner: status floats on the image, the scrim carries
              the identity line. Mirrors the list card so tapping a card reads
              as it expanding. The description lives in the Details tab. */}
          <View style={styles.heroBanner}>
            <LeagueBanner logoUrl={league.logo_url} />
            <View style={styles.heroBannerTopRow}>
              <LeagueStatusBadge status={league.status} colors={colors} t={t} onImage />
            </View>
            {/* Scrim is deliberately shallow and light: it only has to carry
                two lines, and the text shadow does the rest of the legibility
                work, so the artwork stays visible. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
              locations={[0, 0.42, 1]}
              style={styles.heroScrim}
            >
              <Text
                size="2xl"
                weight="bold"
                lineHeight="tight"
                color="#ffffff"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {league.name}
              </Text>
              <Text
                size="sm"
                color="rgba(255,255,255,0.92)"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {[
                  t('leagueDetail.hero.membersCount').replace(
                    '{count}',
                    String(activeMembers.length)
                  ),
                  league.venue_name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </LinearGradient>
          </View>

          {/* One chip row carries the viewer's membership state; the quiet
              leave/cancel text action sits beside it. */}
          {!isOrganizer &&
          (myMembership?.status === 'active' || myMembership?.status === 'pending') ? (
            <View style={styles.heroChipRow}>
              {myMembership.status === 'active' ? (
                <HeroChip
                  icon="checkmark-circle"
                  tone="positive"
                  colors={colors}
                  label={t('leagueDetail.memberActive')}
                />
              ) : (
                <HeroChip
                  icon={myQueueStatus ? 'list-outline' : 'hourglass-outline'}
                  tone="outline"
                  colors={colors}
                  label={
                    myMembership.invited_by
                      ? t('leagueDetail.acceptInvite')
                      : myQueueStatus
                        ? t('leagueDetail.queuedInLine', {
                            rank: String(myQueueStatus.queueRank),
                            size: String(myQueueStatus.queueSize),
                          })
                        : t('leagueDetail.membershipPending')
                  }
                />
              )}
              {seasonReceiptUrl ? (
                <HeroChip
                  icon="receipt-outline"
                  tone="outline"
                  colors={colors}
                  onPress={() => void Linking.openURL(seasonReceiptUrl)}
                  label={t('leagueDetail.viewReceipt')}
                />
              ) : null}
              {myMembership.status === 'active' ? (
                <TouchableOpacity
                  onPress={handleLeavePress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-leave-league"
                >
                  <Text size="xs" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.leaveLeague')}
                  </Text>
                </TouchableOpacity>
              ) : !myMembership.invited_by ? (
                <TouchableOpacity
                  onPress={handleCancelRequestPress}
                  disabled={isLeaving}
                  style={styles.heroTextAction}
                  testID="cta-cancel-request"
                >
                  <Text size="xs" weight="semibold" color={colors.danger}>
                    {t('leagueDetail.cancelRequest')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Sticky tab bar — scrollable underline tabs, matching the
            tournament detail screen. */}
        <EventDetailTabBar
          tabs={tabs}
          currentKey={currentTabKey}
          onSelect={selectTab}
          colors={colors}
          testIDPrefix="league"
        />

        {/* Overview */}
        {currentTabKey === 'overview' && (
          <OverviewTab
            league={league}
            colors={colors}
            t={t}
            isOrganizer={isOrganizer}
            stepIndex={stepIndex}
            activeMembers={activeMembers}
            seasons={seasons}
            currentSeasonLabel={currentSeasonLabel}
            ratingRangeLabel={ratingRangeLabel}
            scoringLabel={scoringLabel}
            pointsLabel={pointsLabel}
            organizerName={organizerName}
            organizerRows={organizerRows}
            pendingMemberRows={pendingMemberRows}
            rankingSeason={rankingSeason}
            rankings={rankings}
            standingsSeasons={standingsSeasons}
            setPickedStandingsSeasonId={setPickedStandingsSeasonId}
            goToTab={goToTab}
            membersTabIdx={membersTabIdx}
            setMembersSegment={setMembersSegment}
          />
        )}

        {/* Members */}
        {currentTabKey === 'members' && (
          <MembersTab
            league={league}
            colors={colors}
            t={t}
            isOrganizer={isOrganizer}
            membersSegmentTabs={membersSegmentTabs}
            activeMembersSegment={activeMembersSegment}
            setMembersSegment={setMembersSegment}
            activeMemberRows={activeMemberRows}
            pendingMemberRows={pendingMemberRows}
            invitedMemberRows={invitedMemberRows}
            suspendedMemberRows={suspendedMemberRows}
            handlePlayerPress={handlePlayerPress}
            handleInvitePress={handleInvitePress}
            handleApprovePress={handleApprovePress}
            handleRejectPress={handleRejectPress}
            handleRevokePress={handleRevokePress}
            handleSuspendMemberPress={handleSuspendMemberPress}
            handleRemoveMemberPress={handleRemoveMemberPress}
            handleReinstateMemberPress={handleReinstateMemberPress}
          />
        )}

        {/* Seasons */}
        {currentTabKey === 'seasons' && (
          <SeasonsTab
            colors={colors}
            t={t}
            locale={locale}
            userId={userId}
            isOrganizer={isOrganizer}
            seasons={seasons}
            openSeason={openSeason}
            openSeasonId={openSeasonId}
            seasonRoster={seasonRoster}
            memberBadges={memberBadges}
            formatDate={formatDate}
            formatPrice={formatPrice}
            canParticipateInSeason={canParticipateInSeason}
            isEnrolledInSeason={isEnrolledInSeason}
            isPaidSeason={isPaidSeason}
            seasonFeeQuote={seasonFeeQuote}
            seasonEarnings={seasonEarnings}
            showSeasonEarnings={showSeasonEarnings}
            handleOpenCreateSeason={handleOpenCreateSeason}
            handleCloseSeasonPress={handleCloseSeasonPress}
            handleCancelSeason={handleCancelSeason}
            handlePlayerPress={handlePlayerPress}
            handleRemoveSeasonMember={handleRemoveSeasonMember}
            handlePaidEnroll={handlePaidEnroll}
            handleWithdrawSeason={handleWithdrawSeason}
            enrollSeasonMut={enrollSeasonMut}
            openSeasonMut={openSeasonMut}
            isOpeningSeason={isOpeningSeason}
            isClosingSeason={isClosingSeason}
            isCancellingSeason={isCancellingSeason}
            isEnrollingSeason={isEnrollingSeason}
            isWithdrawingSeason={isWithdrawingSeason}
            isPayingSeason={isPayingSeason}
            isRefundingSeason={isRefundingSeason}
          />
        )}

        {/* Sessions */}
        {currentTabKey === 'sessions' && (
          <SessionsTab
            colors={colors}
            t={t}
            isOrganizer={isOrganizer}
            openSeason={openSeason}
            seasonSessions={seasonSessions}
            formatDateTime={formatDateTime}
            sessionPill={sessionPill}
            handleOpenSession={handleOpenSession}
            handleOpenCreateSession={handleOpenCreateSession}
            handlePublishSession={handlePublishSession}
            isPublishingSession={isPublishingSession}
          />
        )}

        {/* Details */}
        {currentTabKey === 'details' && (
          <DetailsTab league={league} colors={colors} t={t} ratingRangeLabel={ratingRangeLabel} />
        )}
      </ScrollView>

      {/* Docked primary action — the one thing this viewer should do next, kept
          out of the scroll so it's reachable from any tab at any position. */}
      {primaryAction && (
        <View
          style={[
            styles.dockedBar,
            {
              backgroundColor: colors.cardBackground,
              borderTopColor: colors.border,
              paddingBottom: spacingPixels[3] + insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            onPress={primaryAction.onPress}
            disabled={primaryAction.disabled}
            activeOpacity={0.7}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              primaryAction.disabled && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            testID={primaryAction.testID}
          >
            <Ionicons name={primaryAction.icon} size={20} color="#ffffff" />
            <Text size="base" weight="semibold" color="#ffffff">
              {primaryAction.label}
            </Text>
          </TouchableOpacity>
          {primaryAction.hint ? (
            <Text size="xs" color={colors.textMuted} numberOfLines={2} style={styles.dockedBarHint}>
              {primaryAction.hint}
            </Text>
          ) : null}
        </View>
      )}

      <ConfirmationModal
        visible={cancelSeasonTarget !== null}
        title={t('leagueDetail.seasonLifecycle.cancelConfirmTitle', {
          name: cancelSeasonTarget?.name ?? '',
        })}
        message={
          cancelSeasonTarget &&
          (cancelSeasonTarget.entry_fee_cents ?? 0) > 0 &&
          cancelSeasonTarget.status === 'open'
            ? cancelSeasonTarget.id === openSeasonId && (seasonEarnings?.paidCount ?? 0) > 0
              ? `${t('leagueDetail.seasonLifecycle.cancelConfirmBodyPaid')}\n\n${t(
                  'leagueDetail.seasonLifecycle.cancelAmounts'
                )
                  .replace('{count}', String(seasonEarnings?.paidCount ?? 0))
                  .replace(
                    '{amount}',
                    formatPrice(
                      seasonEarnings?.entryCents ?? 0,
                      seasonEarnings?.currency ?? 'CAD',
                      {
                        locale,
                      }
                    )
                  )}`
              : t('leagueDetail.seasonLifecycle.cancelConfirmBodyPaid')
            : t('leagueDetail.seasonLifecycle.cancelConfirmBody')
        }
        confirmLabel={t('leagueDetail.seasonLifecycle.cancelConfirm')}
        cancelLabel={t('leagueDetail.seasonLifecycle.keepSeason')}
        confirmTestID="confirm-cancel-season"
        destructive
        isLoading={isCancellingSeason}
        onClose={() => {
          setCancelSeasonTarget(null);
          setCancelSeasonReason('');
        }}
        onConfirm={() => {
          if (!cancelSeasonTarget) return;
          void cancelSeasonAsync({
            seasonId: cancelSeasonTarget.id,
            reason: cancelSeasonReason.trim() || null,
            versionWas: cancelSeasonTarget.version,
            leagueId,
          }).finally(() => setCancelSeasonTarget(null));
        }}
        extraContent={
          <TextInput
            style={[
              styles.seasonReasonInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('leagueDetail.seasonLifecycle.cancelReasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelSeasonReason}
            onChangeText={setCancelSeasonReason}
            multiline
            maxLength={300}
            editable={!isCancellingSeason}
            testID="season-cancel-reason"
          />
        }
      />
    </SafeAreaView>
  );
};
export default LeagueDetail;

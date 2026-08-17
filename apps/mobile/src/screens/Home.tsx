import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useScrollToTop, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
// RNGH ScrollView for the favorites carousel: it nests an inner horizontal
// slot strip (FavoriteAvailabilityCard), and RNGH coordinates the same-axis
// gesture so the inner strip and outer carousel each scroll independently.
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import {
  MatchCard,
  MyMatchCard,
  Text,
  Button,
  LocationSelector,
  SkeletonMatchCard,
  SkeletonMyMatchCard,
  useToast,
} from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { SheetManager, getSheetStack } from 'react-native-actions-sheet';
import {
  useNearbyOpenCourtCount,
  useProfile,
  useTheme,
  usePlayer,
  useJustForYou,
  usePlayerMatches,
  usePlayerSports,
  useRatingScoresForSport,
  useFavoriteFacilities,
  useFavoriteFacilityAvailability,
  useOtherSportsUnreadCount,
  useSports,
  useProfileCompleteness,
  useReferral,
  useAdminStatus,
  useMySportRank,
  useMyTournamentRanking,
  useMyUnscheduledTournamentMatches,
  useMyUnscheduledSessionMatches,
} from '@rallia/shared-hooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MatchScoringPreferences } from '@rallia/shared-hooks';
import type { FacilitySearchResult, MatchWithDetails } from '@rallia/shared-types';
import {
  Logger,
  supabase,
  getMatchWithDetails,
  joinGroupByInviteCode,
  requestToJoinCommunityByInviteCode,
} from '@rallia/shared-services';
import type { JustForYouItem } from '@rallia/shared-services';
import {
  spacingPixels,
  radiusPixels,
  accent,
  base,
  neutral,
  primary,
  secondary,
} from '@rallia/design-system';

import {
  PENDING_REFERRAL_KEY,
  type PendingReferral,
  consumePendingDeepLink,
  getPendingDeepLink,
  addDeepLinkListener,
} from '#/navigation/deepLinkStore';
import { useCheckInContext } from '#/features/weekly-checkin/api';
import { WEEKLY_CHECKIN_ENABLED } from '#/features/weekly-checkin/featureFlag';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';
import { CopilotStep, WalkthroughableView } from '#/context/TourContext';
import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import {
  useOverlay,
  useActionsSheet,
  useSport,
  useMatchDetailSheet,
  useUserHomeLocation,
  useSubscription,
} from '#/context';
import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useTourSequence,
  usePendingReferenceRequestsCount,
  useSuggestionInviteHandler,
  useImpressionTracker,
} from '#/hooks';
import * as Analytics from '#/services/analytics';
import { SportIcon } from '#/components/SportIcon';
import {
  GradientStatTile,
  NAV_TILE_WATERMARK_COLOR,
  breakTileLabel,
} from '#/components/GradientNavTile';
import { FavoriteAvailabilityCard, FavoriteAvailabilityCardSkeleton } from '#/features/facilities';
import { useHomeNavigation, useAppNavigation } from '#/navigation/hooks';
import { useTabPreload } from '#/navigation/useTabPreload';
import ProfileCompletionBanner, {
  useProfileCompletionBannerVisibility,
} from '#/features/profile/components/ProfileCompletionBanner';
import { SuggestionCard } from '#/components/SuggestionCard';
import BillingIssueBanner from '#/components/BillingIssueBanner';
import ReferenceRequestsBanner from '#/components/ReferenceRequestsBanner';
import HomeBanner, { HomeBannerLayoutProvider } from '#/components/HomeBanner';
import {
  incrementOnboardedLaunchCount,
  shouldShowReferralInvite,
  markSheetShown,
} from '#/utils/referralInviteFrequency';
import { runWhenIdle } from '#/utils/runWhenIdle';
import { IS_E2E } from '#/utils/e2e';

import TennisIcon from '../../assets/icons/tennis.svg';
import PickleballIcon from '../../assets/icons/pickleball.svg';
import TennisCourtIcon from '../../assets/icons/tennis-court.svg';

/** Dismissible banner alerting the player to unread notifications in another sport */
const CrossSportBanner: React.FC<{
  sportName: string;
  displayName: string;
  count: number;
  onSwitch: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}> = ({ sportName, displayName, count, onSwitch, onDismiss, t }) => (
  <HomeBanner
    variant="info"
    leading={accent => <SportIcon sportName={sportName} size={20} color={accent} />}
    title={t('home.crossSportBanner.bannerTitle', { count, sportName: displayName })}
    description={t('home.crossSportBanner.bannerDescription')}
    primaryAction={{ label: t('home.crossSportBanner.switch'), onPress: onSwitch }}
    onDismiss={onDismiss}
  />
);

/** Banner encouraging users with only one sport to activate their second sport */
const SecondSportBanner: React.FC<{
  sportName: string;
  displayName: string;
  onActivate: () => void;
  onDismiss: () => void;
  fadeAnim: Animated.Value;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}> = ({ sportName, displayName, onActivate, onDismiss, fadeAnim, t }) => (
  <HomeBanner
    variant="action"
    leading={accent => <SportIcon sportName={sportName} size={20} color={accent} />}
    title={t('home.secondSportBanner.bannerTitle', { sportName: displayName })}
    description={t('home.secondSportBanner.bannerDescription', { sportName: displayName })}
    primaryAction={{ label: t('home.secondSportBanner.activate'), onPress: onActivate }}
    onDismiss={onDismiss}
    fadeAnim={fadeAnim}
  />
);

const quickNavStyles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
  },
  // Full-width stack: every tile spans the row and carries a live status
  // caption, so each entry point doubles as a status card.
  grid: {
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
});

// AsyncStorage key for second sport banner cooldown
// A card counts as shown once it's ≥50% visible for 500ms. Module constant so
// the FlatList viewability config never changes identity (a runtime crash).
const JFY_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50, minimumViewTime: 500 };

// Stable identity for JFY carousel items — used as both the FlatList key and
// the impression-dedup key, so dedup survives data-refetch remounts.
const jfyItemKey = (item: JustForYouItem): string =>
  item.kind === 'match'
    ? `match:${item.data.id}`
    : `suggestion:${item.data.opponentId}:${item.data.slot.datetime.getTime?.() ?? 0}`;

const SECOND_SPORT_BANNER_COOLDOWN_KEY = '@rallia/second-sport-banner-cooldown';
const SECOND_SPORT_BANNER_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const SECOND_SPORT_BANNER_FADE_MS = 10 * 60 * 1000; // 10 minutes

// Weekly check-in banner cooldown — shared key with the wizard's exit-confirm
// (apps/mobile/src/features/weekly-checkin/useWeeklyCheckInWizard.ts), so
// dismissing either surface suppresses both for 24h. The data signal that
// drives the banner is `checkInContext.isPendingCheckIn` (true iff no
// player_weekly_checkin row exists for the current local week) — no
// availability-staleness proxy.
const AVAILABILITY_BANNER_COOLDOWN_KEY = '@rallia/availability-refresh-banner-cooldown';
const AVAILABILITY_BANNER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Default search radius for signed-out users (no max_travel_distance to read).
const GUEST_SEARCH_RADIUS_KM = 20;

const Home = () => {
  // Warm sibling tab stacks in the background so their first open is instant.
  useTabPreload();

  // Use custom hooks for auth, profile, and overlay context
  const { session, loading: authLoading } = useAuth();
  const { isAdmin } = useAdminStatus();
  const { profile } = useProfile();
  const { setOnHomeScreen } = useOverlay();
  const { openSheet, openSheetForMatchCreation } = useActionsSheet();
  const { subscriptionStatus } = useSubscription();

  // User is fully onboarded only if authenticated AND onboarding is complete
  const isOnboarded = !!session?.user && profile?.onboarding_completed;
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { colors } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Card-skeleton palette — mirrors the v2 MatchCard / MyMatchCard surfaces
  // (plain white / dark card with a neutral shimmer).
  const skeletonCardBg = isDark ? neutral[900] : base.white;
  const skeletonCardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const skeletonShimmerBg = isDark ? neutral[800] : neutral[100];
  const skeletonShimmerHighlight = isDark ? neutral[700] : neutral[50];
  const navigation = useHomeNavigation();
  const appNavigation = useAppNavigation();
  const toast = useToast();

  // Overlay state for deep link async operations (group join, community request)
  const [deepLinkOverlay, setDeepLinkOverlay] = useState(false);

  // Consume pending navigation from post-onboarding join (AsyncStorage).
  // Deferred past first paint via runWhenIdle — none of this is on the
  // critical-path for the initial frame and AsyncStorage reads add up.
  useEffect(() => {
    const handle = runWhenIdle(() => {
      AsyncStorage.getItem('@rallia/pending-navigation').then(raw => {
        if (!raw) return;
        AsyncStorage.removeItem('@rallia/pending-navigation');
        try {
          const nav = JSON.parse(raw) as { screen: string; params?: Record<string, string> };
          if (nav.screen === 'GroupDetail' && nav.params?.groupId) {
            appNavigation.navigate('GroupDetail', {
              groupId: nav.params.groupId,
              groupName: nav.params.groupName,
            });
          } else if (nav.screen === 'CommunityDetail' && nav.params?.communityId) {
            appNavigation.navigate('CommunityDetail', {
              communityId: nav.params.communityId,
              communityName: nav.params.communityName,
            });
          } else if (nav.screen === 'MatchDetail' && nav.params?.matchId) {
            getMatchWithDetails(nav.params.matchId).then(match => {
              if (match) {
                openMatchDetail(match as MatchDetailData, { source: 'deep_link' });
              }
            });
          } else if (nav.screen === 'TournamentDetail' && nav.params?.tournamentId) {
            appNavigation.navigate('TournamentDetail', {
              tournamentId: nav.params.tournamentId,
              inviteToken: nav.params.inviteToken,
            });
          } else if (nav.screen === 'LeagueDetail' && nav.params?.leagueId) {
            appNavigation.navigate('LeagueDetail', {
              leagueId: nav.params.leagueId,
              inviteToken: nav.params.inviteToken,
            });
          }
        } catch {
          // Ignore parse errors
        }
      });
    });
    return () => handle.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Web join handoff: profile stores the target match after website onboarding.
  useEffect(() => {
    if (!profile?.id || !isOnboarded) return;
    if (profile.referral_invitation_type !== 'match' || !profile.referral_target_id) return;

    const matchId = profile.referral_target_id;
    const handle = runWhenIdle(() => {
      void (async () => {
        try {
          await supabase
            .from('profile')
            .update({ referral_invitation_type: null, referral_target_id: null })
            .eq('id', profile.id);

          const match = await getMatchWithDetails(matchId);
          if (match) {
            openMatchDetail(match as MatchDetailData, { source: 'deep_link' });
          }
        } catch {
          // Best-effort handoff from web onboarding
        }
      })();
    });
    return () => handle.cancel();
  }, [
    profile?.id,
    profile?.referral_invitation_type,
    profile?.referral_target_id,
    isOnboarded,
    openMatchDetail,
  ]);

  // Fallback: consume PendingReferral from AsyncStorage if DeepLinkContext expired
  // (e.g., session-expired user taps a deep link, signs in, and DeepLinkContext has expired).
  // Deferred past first paint — not critical for initial frame.
  useEffect(() => {
    const handle = runWhenIdle(() => {
      AsyncStorage.getItem(PENDING_REFERRAL_KEY).then(raw => {
        if (!raw) return;
        try {
          const pending: PendingReferral = JSON.parse(raw);
          // Only consume if there's a deferred action (match/group/community with target)
          if (!pending.targetId) return;

          AsyncStorage.removeItem(PENDING_REFERRAL_KEY);

          if (pending.type === 'match') {
            getMatchWithDetails(pending.targetId).then(match => {
              if (match) {
                openMatchDetail(match as MatchDetailData, { source: 'deep_link' });
              }
            });
          } else if (pending.type === 'group' && player?.id) {
            joinGroupByInviteCode(pending.targetId, player.id)
              .then(result => {
                if (result.success && result.groupId) {
                  toast.success(t('groups.joinedViaLinkMessage', { name: result.groupName ?? '' }));
                  appNavigation.navigate('GroupDetail', {
                    groupId: result.groupId,
                    groupName: result.groupName,
                  });
                }
              })
              .catch(() => {});
          } else if (pending.type === 'community' && player?.id) {
            requestToJoinCommunityByInviteCode(pending.targetId, player.id)
              .then(result => {
                if (result.success && result.communityId) {
                  toast.success(
                    t('community.requestSentViaLinkMessage', { name: result.communityName ?? '' })
                  );
                  appNavigation.navigate('CommunityDetail', {
                    communityId: result.communityId,
                    communityName: result.communityName,
                  });
                }
              })
              .catch(() => {});
          } else if (pending.type === 'tournament') {
            appNavigation.navigate('TournamentDetail', {
              tournamentId: pending.targetId,
              inviteToken: pending.shareToken,
            });
          } else if (pending.type === 'league') {
            // Session links land on the sheet; SessionDetail bounces to the
            // league (carrying the token) if RLS hides the session.
            if (pending.sessionId) {
              appNavigation.navigate('SessionDetail', {
                sessionId: pending.sessionId,
                leagueId: pending.targetId,
                inviteToken: pending.shareToken,
              });
            } else {
              appNavigation.navigate('LeagueDetail', {
                leagueId: pending.targetId,
                inviteToken: pending.shareToken,
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      });
    });
    return () => handle.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Home screen tour - triggers after main navigation tour is completed
  useTourSequence({
    screenId: 'home',
    isReady: !authLoading,
    delay: 800,
    autoStart: true,
  });

  // Get user's current location and player preferences for nearby matches
  const { location, locationMode, setLocationMode, hasHomeLocation, hasBothLocationOptions } =
    useEffectiveLocation();
  const { homeLocation } = useUserHomeLocation();
  const { player, maxTravelDistanceKm, loading: playerLoading } = usePlayer();

  // Cached weekly check-in context — read by the availability banner to render
  // the streak-aware subtitle. WeeklyCheckInAutoOpener also reads it; TanStack
  // de-dupes so this is a single RPC round-trip on home mount. Gated on the
  // feature flag so we don't fire the RPC while the wizard is shipped dark.
  // Streak + goal are per sport, so the query is keyed to the sport mode (same
  // key as the wizard/auto-opener → still one shared cache entry).
  const { selectedSport: checkInSport } = useSport();
  const { data: checkInContext } = useCheckInContext({
    enabled: WEEKLY_CHECKIN_ENABLED,
    sportId: checkInSport?.id ?? null,
  });

  // Keep a ref so the stable processDeepLink callback always reads the latest player
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  // Process a pending deep link from deepLinkStore. Stable callback (no deps) — uses refs.
  const processDeepLink = useCallback(async () => {
    const peeked = getPendingDeepLink();
    if (!peeked) return;

    // Defer group/community processing until player is loaded to avoid silent discard
    const needsPlayer =
      peeked.type === 'group' ||
      peeked.type === 'community' ||
      (peeked.type === 'invitation' &&
        (peeked.invitationType === 'group' || peeked.invitationType === 'community'));

    if (needsPlayer && !playerRef.current?.id) return;

    const payload = consumePendingDeepLink();
    if (!payload) return;

    const needsOverlay =
      payload.type === 'group' ||
      payload.type === 'community' ||
      (payload.type === 'invitation' &&
        (payload.invitationType === 'group' || payload.invitationType === 'community'));
    if (needsOverlay) setDeepLinkOverlay(true);

    // Switch to the group/community's sport if it differs from the current selection
    const switchSportIfNeeded = async (sportId: string | null | undefined) => {
      if (!sportId || sportId === selectedSportRef.current?.id) return;
      const target = userSportsRef.current?.find(s => s.id === sportId);
      if (target) await setSelectedSportRef.current(target);
    };

    try {
      switch (payload.type) {
        case 'match': {
          const match = await getMatchWithDetails(payload.matchId);
          if (match) openMatchDetail(match as MatchDetailData, { source: 'deep_link' });
          break;
        }
        case 'group': {
          const r = await joinGroupByInviteCode(payload.inviteCode, playerRef.current!.id);
          if (r.success && r.groupId) {
            await switchSportIfNeeded(r.sportId);
            toast.success(t('groups.joinedViaLinkMessage', { name: r.groupName ?? '' }));
            appNavigation.navigate('GroupDetail', {
              groupId: r.groupId,
              groupName: r.groupName,
            });
          } else {
            toast.error(r.error || t('groups.joinFailedViaLink'));
          }
          break;
        }
        case 'community': {
          const r = await requestToJoinCommunityByInviteCode(
            payload.inviteCode,
            playerRef.current!.id
          );
          if (r.success && r.communityId) {
            await switchSportIfNeeded(r.sportId);
            toast.success(
              t('community.requestSentViaLinkMessage', { name: r.communityName ?? '' })
            );
            appNavigation.navigate('CommunityDetail', {
              communityId: r.communityId,
              communityName: r.communityName,
            });
          } else {
            toast.error(r.error || t('community.joinFailedViaLink'));
          }
          break;
        }
        case 'publicMatches': {
          Analytics.publicMatchesOpened({ cta: 'deep_link' });
          appNavigation.navigate('Main', {
            screen: 'Home',
            params: { screen: 'PublicMatches' },
          } as never);
          break;
        }
        case 'matchupSuggestions': {
          SheetManager.show('match-suggestions');
          break;
        }
        case 'matchInviteConfirm': {
          // Email-driven one-tap invite confirm. The sheet calls
          // validate_and_create_match_from_email_invite to atomically
          // re-validate the slot before creating the match.
          SheetManager.show('match-invite-confirm', {
            payload: {
              opponentId: payload.opponentId,
              facilityId: payload.facilityId,
              sportId: payload.sportId,
              matchDate: payload.matchDate,
              startTime: payload.startTime,
              endTime: payload.endTime,
            },
          });
          break;
        }
        case 'invitation': {
          if (payload.invitationType === 'match' && payload.targetId) {
            const match = await getMatchWithDetails(payload.targetId);
            if (match) openMatchDetail(match as MatchDetailData, { source: 'deep_link' });
          } else if (
            payload.invitationType === 'group' &&
            payload.targetId &&
            playerRef.current?.id
          ) {
            const r = await joinGroupByInviteCode(payload.targetId, playerRef.current.id);
            if (r.success && r.groupId) {
              await switchSportIfNeeded(r.sportId);
              toast.success(t('groups.joinedViaLinkMessage', { name: r.groupName ?? '' }));
              appNavigation.navigate('GroupDetail', {
                groupId: r.groupId,
                groupName: r.groupName,
              });
            } else {
              toast.error(r.error || t('groups.joinFailedViaLink'));
            }
          } else if (
            payload.invitationType === 'community' &&
            payload.targetId &&
            playerRef.current?.id
          ) {
            const r = await requestToJoinCommunityByInviteCode(
              payload.targetId,
              playerRef.current.id
            );
            if (r.success && r.communityId) {
              await switchSportIfNeeded(r.sportId);
              toast.success(
                t('community.requestSentViaLinkMessage', { name: r.communityName ?? '' })
              );
              appNavigation.navigate('CommunityDetail', {
                communityId: r.communityId,
                communityName: r.communityName,
              });
            } else {
              toast.error(r.error || t('community.joinFailedViaLink'));
            }
          } else if (payload.invitationType === 'tournament' && payload.targetId) {
            // Preview-then-confirm: the detail screen resolves the token and
            // owns the register CTA — no auto-registration here.
            appNavigation.navigate('TournamentDetail', {
              tournamentId: payload.targetId,
              inviteToken: payload.shareToken,
            });
          } else if (payload.invitationType === 'league' && payload.targetId) {
            // Same preview-then-confirm shape as tournaments. A session link
            // lands on the sheet; SessionDetail bounces to the league
            // (carrying the token) if RLS hides the session.
            if (payload.sessionId) {
              appNavigation.navigate('SessionDetail', {
                sessionId: payload.sessionId,
                leagueId: payload.targetId,
                inviteToken: payload.shareToken,
              });
            } else {
              appNavigation.navigate('LeagueDetail', {
                leagueId: payload.targetId,
                inviteToken: payload.shareToken,
              });
            }
          }
          // referral-only: nothing to do, already persisted to AsyncStorage by the store
          break;
        }
      }
    } catch {
      // Errors handled per-case above
    } finally {
      setDeepLinkOverlay(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check on mount + subscribe so re-fires when Home is already mounted (fixes app-open bug).
  // The mount-time check is deferred past first paint — the overlay Modal shows
  // during async processing anyway, so a one-frame delay is imperceptible and
  // keeps Supabase/network work off the initial render path. The listener stays
  // synchronous so runtime deep links (app already open) still fire immediately.
  useEffect(() => {
    const handle = runWhenIdle(() => {
      processDeepLink();
    });
    const unsubscribe = addDeepLinkListener(processDeepLink);
    return () => {
      handle.cancel();
      unsubscribe();
    };
  }, [processDeepLink]);

  // Retry once player data arrives in case it was null on first run
  useEffect(() => {
    if (player?.id) processDeepLink();
  }, [player?.id, processDeepLink]);

  // Referral invite prompt — shown every 3 launches (0 referrals) or 7 launches (1+ referrals).
  // Deferred past first paint — this is a periodic prompt, never time-sensitive.
  const { stats: referralStats, statsLoading: referralStatsLoading } = useReferral(player?.id);
  useEffect(() => {
    if (IS_E2E) return;
    if (!isOnboarded || !player?.id || referralStatsLoading) return;

    const hasReferredUser = (referralStats?.total_converted ?? 0) >= 1;

    const handle = runWhenIdle(() => {
      (async () => {
        await incrementOnboardedLaunchCount();
        const show = await shouldShowReferralInvite(hasReferredUser);
        if (show) {
          // Never stack on another pop-up. The wizard owns the screen when
          // it's presenting, and any already-open sheet was either user-intent
          // (deep link) or another auto-opener that got there first. This
          // prompt is periodic and deferrable, so it always yields. Same guard
          // Serie1AnnouncementAutoOpener and useApplyUpdateOnResume use. The
          // launch counter still ticks so it's eligible again next launch.
          if (isWeeklyCheckInActive() || getSheetStack().length > 0) {
            Logger.logUserAction('referral_invite_suppressed_for_wizard', {
              openSheets: getSheetStack().length,
            });
            return;
          }
          await markSheetShown();
          SheetManager.show('referral-invite');
        }
      })();
    });
    return () => handle.cancel();
  }, [isOnboarded, player?.id, referralStatsLoading, referralStats?.total_converted]);

  const { selectedSport, isLoading: sportLoading, userSports, setSelectedSport } = useSport();

  // Refs so processDeepLink (stable callback) can auto-switch sport without stale closures
  const selectedSportRef = useRef(selectedSport);
  useEffect(() => {
    selectedSportRef.current = selectedSport;
  }, [selectedSport]);
  const userSportsRef = useRef(userSports);
  useEffect(() => {
    userSportsRef.current = userSports;
  }, [userSports]);
  const setSelectedSportRef = useRef(setSelectedSport);
  useEffect(() => {
    setSelectedSportRef.current = setSelectedSport;
  }, [setSelectedSport]);

  // Player sport preferences and rating for match relevance scoring
  const { playerSports } = usePlayerSports(session?.user?.id);

  // Cross-sport unread notification counts
  const { otherSportsUnreadCount } = useOtherSportsUnreadCount(
    session?.user?.id,
    userSports,
    selectedSport?.name
  );
  const [dismissedBannerSports, setDismissedBannerSports] = useState<Set<string>>(new Set());

  // Profile completeness for banner
  const profileCompleteness = useProfileCompleteness();
  const profileCompletionBanner = useProfileCompletionBannerVisibility(
    profileCompleteness.isComplete
  );

  // Billing-issue banner dismissal — lifted out of the banner so Home knows
  // whether it will actually render, which keeps the carousel/full-width
  // switch in sync with the number of *visible* banners.
  const [billingBannerDismissed, setBillingBannerDismissed] = useState(false);

  // Tournament action banners are dismissible per tournament (in-session). They
  // still clear themselves once a game is linked; this just lets the player mute
  // the nudge until the next app launch or a new round releases another slot.
  const [dismissedTournamentActionBanners, setDismissedTournamentActionBanners] = useState<
    Set<string>
  >(new Set());

  // Pending incoming reference requests
  const { count: pendingReferenceRequestsCount } = usePendingReferenceRequestsCount();

  // Handle profile completion banner action
  const handleCompletionBannerAction = useCallback(
    (item: {
      actionType: string;
      actionNavigate?: string;
      actionPayload?: Record<string, unknown>;
      actionSheet?: string;
    }) => {
      if (item.actionType === 'navigate' && item.actionNavigate) {
        (appNavigation.navigate as (...args: unknown[]) => void)(
          item.actionNavigate,
          item.actionPayload
        );
      } else if (item.actionType === 'sheet' && item.actionSheet) {
        // For sheet actions, navigate to UserProfile where the sheets are available
        (appNavigation.navigate as (...args: unknown[]) => void)('UserProfile');
      } else if (item.actionType === 'image_picker') {
        appNavigation.navigate('UserProfile' as never);
      }
    },
    [appNavigation]
  );

  // Second sport activation banner state
  const { sports: allSports } = useSports();
  const [showSecondSportBanner, setShowSecondSportBanner] = useState(false);
  const [secondSportBannerDismissed, setSecondSportBannerDismissed] = useState(false);
  const secondSportFadeAnim = useRef(new Animated.Value(1)).current;

  // Find inactive sports (sports user hasn't activated yet)
  const inactiveSports = useMemo(() => {
    if (!allSports || !userSports) return [];
    const activeSportIds = new Set(userSports.map(s => s.id));
    return allSports.filter(sport => !activeSportIds.has(sport.id));
  }, [allSports, userSports]);

  // Show banner only for users with exactly 1 sport and at least 1 inactive sport
  const shouldShowSecondSportBanner = useMemo(() => {
    return (
      isOnboarded &&
      userSports.length === 1 &&
      inactiveSports.length > 0 &&
      showSecondSportBanner &&
      !secondSportBannerDismissed
    );
  }, [
    isOnboarded,
    userSports.length,
    inactiveSports.length,
    showSecondSportBanner,
    secondSportBannerDismissed,
  ]);

  // Check cooldown and set up auto-fade timer for second sport banner.
  // Deferred past first paint — banner is a soft nudge, never first-frame.
  useEffect(() => {
    if (!isOnboarded || userSports.length !== 1 || inactiveSports.length === 0) {
      return;
    }

    const checkCooldownAndShow = async () => {
      try {
        const lastShown = await AsyncStorage.getItem(SECOND_SPORT_BANNER_COOLDOWN_KEY);
        const now = Date.now();

        if (!lastShown || now - parseInt(lastShown, 10) >= SECOND_SPORT_BANNER_COOLDOWN_MS) {
          // Cooldown passed, show banner
          setShowSecondSportBanner(true);
          setSecondSportBannerDismissed(false);
          secondSportFadeAnim.setValue(1);

          // Save current time as last shown
          await AsyncStorage.setItem(SECOND_SPORT_BANNER_COOLDOWN_KEY, now.toString());

          // Set up 10-minute auto-fade timer
          const fadeTimer = setTimeout(() => {
            Animated.timing(secondSportFadeAnim, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }).start(() => {
              setSecondSportBannerDismissed(true);
            });
          }, SECOND_SPORT_BANNER_FADE_MS);

          return () => clearTimeout(fadeTimer);
        }
      } catch {
        // Ignore storage errors
      }
    };

    const handle = runWhenIdle(() => {
      void checkCooldownAndShow();
    });
    return () => handle.cancel();
  }, [isOnboarded, userSports.length, inactiveSports.length, secondSportFadeAnim]);

  // Handle second sport banner dismiss
  const handleDismissSecondSportBanner = useCallback(() => {
    Animated.timing(secondSportFadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setSecondSportBannerDismissed(true);
    });
  }, [secondSportFadeAnim]);

  // Weekly check-in banner state. Data signal is `checkInContext.isPendingCheckIn`
  // (true iff no player_weekly_checkin row exists for the current local week).
  // We also gate on a 24h AsyncStorage cooldown shared with the wizard's ×
  // dismissal — pessimistic default `true` so the banner doesn't flash before
  // the cooldown read resolves.
  const [availabilityBannerDismissed, setAvailabilityBannerDismissed] = useState(false);
  const [weeklyCheckinCooldownActive, setWeeklyCheckinCooldownActive] = useState(true);

  // Read the dismiss-cooldown once on mount. After 24h have elapsed since
  // the last dismissal (either the banner's × or the wizard's exit-confirm),
  // the cooldown becomes inactive and the banner is free to show again
  // whenever `isPendingCheckIn` is true.
  useEffect(() => {
    const handle = runWhenIdle(async () => {
      try {
        const cooldownRaw = await AsyncStorage.getItem(AVAILABILITY_BANNER_COOLDOWN_KEY);
        if (cooldownRaw) {
          const dismissedAt = parseInt(cooldownRaw, 10);
          if (
            Number.isFinite(dismissedAt) &&
            Date.now() - dismissedAt < AVAILABILITY_BANNER_COOLDOWN_MS
          ) {
            return; // Cooldown still active — leave state at default `true`.
          }
        }
        setWeeklyCheckinCooldownActive(false);
      } catch {
        // Best-effort — if AsyncStorage errors, default to allowing the banner.
        setWeeklyCheckinCooldownActive(false);
      }
    });
    return () => handle.cancel();
  }, []);

  // When the wizard completes (or returns to home in any state where the
  // pending-checkin signal flips false), clear the in-session dismiss flag so
  // the banner can reappear naturally next week.
  useFocusEffect(
    useCallback(() => {
      if (checkInContext && !checkInContext.isPendingCheckIn) {
        setAvailabilityBannerDismissed(false);
      }
    }, [checkInContext])
  );

  const handleAvailabilityBannerAction = useCallback(() => {
    // Opens the weekly check-in wizard modal. The wizard combines:
    //   • availability refresh (the original purpose of this banner)
    //   • weekly frequency goal
    //   • streak + freeze mechanic
    //   • opt-ins for auto-create / auto-invite
    // On submit, last_confirmed_at is bumped and a player_weekly_checkin
    // row is inserted, so the banner disappears for the rest of the week.
    appNavigation.navigate('WeeklyCheckIn', { source: 'banner' });
  }, [appNavigation]);

  const handleDismissAvailabilityBanner = useCallback(async () => {
    setAvailabilityBannerDismissed(true);
    setWeeklyCheckinCooldownActive(true);
    try {
      await AsyncStorage.setItem(AVAILABILITY_BANNER_COOLDOWN_KEY, Date.now().toString());
    } catch {
      // Cooldown is best-effort; failing to persist just means the banner
      // may reappear sooner than intended on the next Home mount.
    }
  }, []);

  // Handle activate second sport
  const handleActivateSecondSport = useCallback(() => {
    if (inactiveSports.length > 0) {
      const sportToActivate = inactiveSports[0];
      handleDismissSecondSportBanner();
      appNavigation.navigate('SportProfile', {
        sportId: sportToActivate.id,
        sportName: sportToActivate.name as 'tennis' | 'pickleball',
      });
    }
  }, [inactiveSports, handleDismissSecondSportBanner, appNavigation]);
  const currentPlayerSport = useMemo(
    () => playerSports.find(ps => ps.sport_id === selectedSport?.id),
    [playerSports, selectedSport?.id]
  );
  const { ratingScores, playerRatingScoreId } = useRatingScoresForSport(
    selectedSport?.name,
    selectedSport?.id,
    session?.user?.id
  );
  const playerRatingValue = useMemo(() => {
    if (!playerRatingScoreId) return null;
    return ratingScores.find(rs => rs.id === playerRatingScoreId)?.value ?? null;
  }, [ratingScores, playerRatingScoreId]);
  // Live standings for the home Classements card — signed-in only (both hooks
  // no-op on undefined sportId).
  const { data: myLeaderboardRank, isLoading: myLeaderboardRankLoading } = useMySportRank(
    session ? selectedSport?.id : undefined
  );
  const { data: myCircuitRank, isLoading: myCircuitRankLoading } = useMyTournamentRanking(
    session ? selectedSport?.id : undefined
  );

  const { favorites } = useFavoriteFacilities(session?.user?.id ?? null, selectedSport?.id);
  const favoriteFacilityIds = useMemo(() => favorites.map(f => f.facilityId), [favorites]);

  // Use player's travel distance if signed in, otherwise the guest default.
  // Bounds both the nearby-availability fallback below and the "Just for you"
  // carousel further down.
  const searchRadiusKm = session ? maxTravelDistanceKm : GUEST_SEARCH_RADIUS_KM;

  // Realtime availability at the player's provider-enabled favorite facilities,
  // or — when no favorite has an open slot (incl. signed-out users) — the
  // closest facilities within range that do. Powers the personalized "Open at
  // your favorites" carousel below My Matches.
  const {
    facilities: favoriteAvailability,
    source: availabilitySource,
    isLoading: loadingFavoriteAvailability,
    refetch: refetchFavoriteAvailability,
  } = useFavoriteFacilityAvailability({
    playerId: player?.id,
    sportId: selectedSport?.id,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: searchRadiusKm,
    // Location + sport gated; signed-out users get the nearby fallback.
    enabled: !!location && !!selectedSport?.id,
  });

  // Courts open around the player — the play grid's book-a-court stat. Always
  // geography-scoped (never the favorites carousel's list), so the number means
  // the same thing signed in or out.
  const { count: openCourtCount, isLoading: openCourtCountLoading } = useNearbyOpenCourtCount({
    sportId: selectedSport?.id,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: searchRadiusKm,
    enabled: !!location && !!selectedSport?.id,
  });

  // Favorites are edited on other screens (sport profile, onboarding) while Home
  // stays mounted in the tab navigator, so the availability query never refetches
  // on its own. Refresh it whenever Home regains focus so newly added/removed
  // favorites appear. Skip the first focus — the hook already fetches on mount.
  const favAvailFirstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (favAvailFirstFocusRef.current) {
        favAvailFirstFocusRef.current = false;
        return;
      }
      refetchFavoriteAvailability();
    }, [refetchFavoriteAvailability])
  );

  // The section becomes visible as soon as we have sport + location, and
  // stays visible across transitions (sign-in, sport switching) so the
  // header (title / location selector / view all) doesn't flash out while
  // the carousel re-fetches. The carousel itself swaps to skeletons via
  // `showJfyLoading` when the fetch isn't ready yet.
  const isNearbyFetchReady = !!location && !!selectedSport;
  const [hasShownNearby, setHasShownNearby] = useState(false);
  useEffect(() => {
    if (isNearbyFetchReady) setHasShownNearby(true);
  }, [isNearbyFetchReady]);
  const showNearbySection = isNearbyFetchReady || hasShownNearby;

  // Use TanStack Query hook for fetching nearby matches with infinite scrolling
  // Query refetches automatically when sportId or player gender changes (included in query key)
  // Build scoring preferences for the "Just for you" composer.
  const scoringPreferences = useMemo<MatchScoringPreferences>(
    () => ({
      playerGender: player?.gender,
      playerRatingValue,
      preferredMatchDuration: currentPlayerSport?.preferred_match_duration,
      preferredMatchType: currentPlayerSport?.preferred_match_type,
      favoriteFacilityIds,
      maxTravelDistanceKm,
    }),
    [
      player?.gender,
      playerRatingValue,
      currentPlayerSport?.preferred_match_duration,
      currentPlayerSport?.preferred_match_type,
      favoriteFacilityIds,
      maxTravelDistanceKm,
    ]
  );

  // Just for you: top 5 = best matches in the area, padded with suggestions
  // when matches < 5. Score-ordered, opponent-deduped on the suggestion side,
  // creator/participant matches filtered out by the composer's exclude set.
  const excludeUserIds = session?.user?.id ? [session.user.id] : [];
  const {
    items: justForYouItems,
    isLoading: loadingJustForYou,
    isRefetching,
    refetch: refetchJustForYou,
  } = useJustForYou({
    playerId: player?.id ?? session?.user?.id,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: searchRadiusKm,
    userGender: player?.gender,
    scoringPreferences,
    excludeUserIds,
    matchLimit: 5,
    // Anon-mode supported by the composer/hook — gate only on the location
    // and sport context that the carousel itself depends on.
    //
    // Signed-in: also wait for `player` to finish loading. The RPC's only
    // player-derived input is the search radius (max_travel_distance), which
    // defaults to 50 until `player` resolves then becomes the real value.
    // Gating here means the carousel fires ONCE with the final radius instead
    // of firing at 50 and refetching at 15. Anon has no player → fire as soon
    // as location + sport are ready.
    enabled: showNearbySection && (!session?.user?.id || !playerLoading),
  });

  // Suggestion invite plumbing (shared with PublicMatches via the hook).
  const {
    cardLabels: suggestionLabels,
    handleSendInvite,
    getInviteState,
    callerMatchType,
  } = useSuggestionInviteHandler({ sportId: selectedSport?.id, source: 'home_carousel' });

  // Use TanStack Query hook for fetching player's upcoming matches
  // Filters by selected sport to match the Soon & Nearby section
  const {
    matches: myMatches,
    isLoading: loadingMyMatches,
    refetch: refetchMyMatches,
  } = usePlayerMatches({
    userId: session?.user?.id,
    timeFilter: 'upcoming',
    sportId: selectedSport?.id,
    limit: 5,
    enabled: !!session?.user?.id,
  });

  // Competitive calls-to-action: released bracket/matchup slots with no game
  // linked yet. Once a game is linked they become real `match` rows and flow
  // through usePlayerMatches into the My Games carousel like any other game.
  // Leagues are re-admin-gated during rollout, so that query only fires for admins
  // (passing an undefined userId disables the hook's query); tournaments are not.
  const { data: tournamentActionMatches = [], refetch: refetchTournamentActions } =
    useMyUnscheduledTournamentMatches(session?.user?.id, selectedSport?.id);
  const { data: sessionActionMatches = [], refetch: refetchLeagueActions } =
    useMyUnscheduledSessionMatches(isAdmin ? session?.user?.id : undefined, selectedSport?.id);

  const scrollRef = useRef<ScrollView>(null);
  const isManualRefresh = useRef(false);
  useScrollToTop(scrollRef);

  // Clear manual refresh flag when refetching completes
  useEffect(() => {
    if (!isRefetching) {
      isManualRefresh.current = false;
    }
  }, [isRefetching]);

  // Viewability-gated impressions for the JFY carousel. Home stays mounted in
  // the tab navigator and the carousel can sit below the fold, so fires are
  // gated on (a) the screen being focused and (b) the section being at least
  // half vertically visible; anything else buffers until the gate opens.
  const { track: trackJfyImpression, setGate: setJfyGate } = useImpressionTracker({
    gatedByDefault: true,
  });
  const jfySectionLayoutRef = useRef<{ y: number; height: number } | null>(null);
  const homeScrollYRef = useRef(0);
  const homeViewportHRef = useRef(0);
  const recomputeJfyGate = useCallback(() => {
    const layout = jfySectionLayoutRef.current;
    if (!layout || layout.height === 0 || homeViewportHRef.current === 0) return;
    const viewTop = homeScrollYRef.current;
    const viewBottom = viewTop + homeViewportHRef.current;
    const overlap = Math.min(viewBottom, layout.y + layout.height) - Math.max(viewTop, layout.y);
    setJfyGate(overlap >= layout.height * 0.5);
  }, [setJfyGate]);

  const jfyImpressionCtx = useRef<{ sportId?: string; sportName?: string }>({});
  useEffect(() => {
    jfyImpressionCtx.current = { sportId: selectedSport?.id, sportName: selectedSport?.name };
  }, [selectedSport?.id, selectedSport?.name]);

  const fireJfyImpression = useCallback(
    (item: JustForYouItem, index: number | null) => {
      const { sportId, sportName } = jfyImpressionCtx.current;
      if (item.kind === 'suggestion') {
        const s = item.data;
        trackJfyImpression(jfyItemKey(item), () =>
          Analytics.matchSuggestionShown(
            Analytics.buildSuggestionEventProps(s, 'home_carousel', sportId, sportName)
          )
        );
      } else {
        const m = item.data;
        trackJfyImpression(jfyItemKey(item), () =>
          Analytics.matchCardShown({
            match_id: m.id,
            sport_id: m.sport?.id ?? sportId ?? 'unknown',
            sport_name: m.sport?.name ?? sportName ?? 'unknown',
            is_auto_generated: m.is_auto_generated ?? false,
            surface: 'home_carousel',
            rank: index != null ? index + 1 : undefined,
          })
        );
      }
    },
    [trackJfyImpression]
  );

  // Must keep a stable identity for the lifetime of the FlatList — changing
  // it mid-flight is a runtime crash. Every captured value is itself stable.
  const lastJfyViewableRef = useRef<Array<{ item: JustForYouItem; index: number | null }>>([]);
  const onJfyViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: Array<{ item: JustForYouItem; index: number | null; isViewable: boolean }>;
    }) => {
      lastJfyViewableRef.current = viewableItems
        .filter(token => token.isViewable)
        .map(token => ({ item: token.item, index: token.index }));
      for (const token of lastJfyViewableRef.current) {
        fireJfyImpression(token.item, token.index);
      }
    },
    [fireJfyImpression]
  );

  // Focus session boundary: tab switches keep Home mounted, so the FlatList
  // won't re-emit viewability on refocus — replay the last viewable snapshot
  // into the fresh session instead, and close the gate while away so
  // background refetches can't fire impressions (the prod inflation bug).
  //
  // The session counter is a ref, not state: bumping state here re-rendered
  // the entire Home screen on every refocus just to drive the jfy_viewed
  // analytics effect below.
  const homeFocusNonceRef = useRef(0);
  // Latest-callback ref, synced by an effect next to the callback definition
  // below — keeps this focus callback's identity stable across data changes.
  const maybeFireJfySectionViewedRef = useRef<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Deferred so the tab-switch frame paints before impression replay.
      const handle = runWhenIdle(() => {
        homeFocusNonceRef.current += 1;
        for (const token of lastJfyViewableRef.current) {
          fireJfyImpression(token.item, token.index);
        }
        recomputeJfyGate();
        // Data may already be settled on refocus — fire for the new session.
        maybeFireJfySectionViewedRef.current?.();
      });
      return () => {
        handle.cancel();
        setJfyGate(false);
      };
    }, [fireJfyImpression, recomputeJfyGate, setJfyGate])
  );

  // Notify OverlayContext that we're on Home screen (safe to show permission overlays)
  useEffect(() => {
    setOnHomeScreen(true);
    return () => setOnHomeScreen(false);
  }, [setOnHomeScreen]);

  // Just-for-you items come pre-ranked (score-desc) from the composer. No
  // local re-sort — the canonical ranking is the composer's output.

  // Render section header with "Soon & Nearby" title, location selector, and "View All" button
  // Render section header with "Soon & Nearby" title and "View All" button
  // Wrapped with CopilotStep for home screen tour
  const renderSectionHeader = () => {
    // Get a short label for the home location (full address if available, otherwise postal code)
    const homeLocationLabel = player?.address
      ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
      : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

    // Signed-in users get the personalized "Just for you" title; signed-out
    // sees the original "Nearby" since the only signal is geographic.
    const titleKey = session?.user?.id ? 'home.justForYou' : 'home.soonAndNearby';
    const subtitleKey = session?.user?.id
      ? 'home.justForYouSubtitle'
      : 'home.soonAndNearbySubtitle';

    return (
      <View style={styles.sectionHeaderStacked}>
        {/* Title (+ optional location selector) and "View all" share one
            centered row so "View all" stays aligned to the title even when the
            taller LocationSelector pill grows the row. The subtitle sits below. */}
        <View style={styles.sectionHeaderTopRow}>
          <View style={styles.sectionTitleRow}>
            <Text variant="display" size="xl" weight="bold" color={colors.text}>
              {t(titleKey)}
            </Text>
            {/* Only show LocationSelector when both GPS and home location are available */}
            {hasBothLocationOptions && (
              <View style={styles.locationSelectorWrapper}>
                <LocationSelector
                  selectedMode={locationMode}
                  onSelectMode={setLocationMode}
                  hasHomeLocation={hasHomeLocation}
                  homeLocationLabel={homeLocationLabel}
                  isDark={isDark}
                  t={t}
                />
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.viewAllButton}
            onPress={() => {
              lightHaptic();
              Analytics.publicMatchesOpened({ cta: 'view_all' });
              navigation.navigate('PublicMatches');
            }}
            activeOpacity={0.7}
          >
            <Text size="base" weight="medium" color={colors.primary}>
              {t('home.viewAll')}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.primary}
              style={styles.chevronIcon}
            />
          </TouchableOpacity>
        </View>
        <Text size="sm" color={colors.textMuted}>
          {t(subtitleKey)}
        </Text>
      </View>
    );
  };

  // Render the "Up next" agenda section — games, tournament matches, and
  // league sessions in one chronological rail. Keeps the tour step that
  // previously anchored on the My Games carousel.
  // Render "My Games" with the full MyMatchCard carousel. Every playable
  // match — casual, tournament bracket, league matchup — is the same `match`
  // primitive, so one card type covers them all with its status pills,
  // avatars, and urgency treatments intact.
  const renderMyMatchesSection = useCallback(() => {
    // Only show for fully onboarded users
    if (!isOnboarded) return null;

    return (
      <CopilotStep
        text={t('tour.homeScreen.upcomingMatches.description')}
        order={10}
        name="home_my_matches"
      >
        <WalkthroughableView style={styles.myMatchesSection}>
          {/* Header with title and "See All" button */}
          <View style={[styles.sectionHeader]}>
            <View style={styles.sectionHeaderText}>
              <Text variant="display" size="xl" weight="bold" color={colors.text}>
                {t('home.myMatches')}
              </Text>
              <Text size="sm" color={colors.textMuted}>
                {t('home.myMatchesSubtitle')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() => {
                lightHaptic();
                navigation.navigate('PlayerMatches');
              }}
              activeOpacity={0.7}
            >
              <Text size="base" weight="medium" color={colors.primary}>
                {t('home.viewAll')}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.primary}
                style={styles.chevronIcon}
              />
            </TouchableOpacity>
          </View>

          {/* Loading + populated states share the same horizontal ScrollView
              for layout stability; the empty state breaks out into a static
              full-width card so the message reads as a section, not a card. */}
          {!loadingMyMatches && myMatches.length === 0 ? (
            <View style={styles.myMatchesEmptyWrap}>
              <View style={[styles.myMatchesEmpty, { backgroundColor: colors.card }]}>
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={32}
                  color={colors.textMuted}
                />
                <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                  {t('home.myMatchesEmpty.title')}
                </Text>
                <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                  {t('home.myMatchesEmpty.description')}
                </Text>
                <Button
                  variant="primary"
                  onPress={() => {
                    void lightHaptic();
                    openSheetForMatchCreation();
                  }}
                  style={styles.myMatchesEmptyCta}
                >
                  {t('actions.createMatch')}
                </Button>
              </View>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.myMatchesScrollContent}
            >
              {loadingMyMatches
                ? [1, 2, 3].map(i => (
                    <SkeletonMyMatchCard
                      key={i}
                      backgroundColor={skeletonShimmerBg}
                      highlightColor={skeletonShimmerHighlight}
                      style={{
                        backgroundColor: skeletonCardBg,
                        borderColor: skeletonCardBorder,
                        borderWidth: 1.5,
                        borderRadius: radiusPixels.lg,
                      }}
                    />
                  ))
                : myMatches.slice(0, 5).map((match: MatchWithDetails) => {
                    // The current player's own status — drives the card's
                    // confirmed/invited/requested/waitlisted pill.
                    const participantStatus = player?.id
                      ? (match.participants?.find(p => p.player_id === player.id)?.status ?? null)
                      : null;
                    // Count pending join requests (only relevant if current user is creator)
                    const pendingRequestCount =
                      match.created_by === player?.id
                        ? (match.participants?.filter(p => p.status === 'requested').length ?? 0)
                        : 0;

                    return (
                      <MyMatchCard
                        key={match.id}
                        match={match}
                        isDark={isDark}
                        t={t}
                        locale={locale}
                        participantStatus={participantStatus}
                        pendingRequestCount={pendingRequestCount}
                        onPress={() => {
                          Logger.logUserAction('my_match_pressed', { matchId: match.id });
                          openMatchDetail(match, { source: 'my_matches' });
                        }}
                      />
                    );
                  })}
            </ScrollView>
          )}
        </WalkthroughableView>
      </CopilotStep>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOnboarded,
    colors.text,
    colors.primary,
    colors.textMuted,
    colors.card,
    t,
    navigation,
    loadingMyMatches,
    myMatches,
    isDark,
    locale,
    openMatchDetail,
    openSheetForMatchCreation,
    player,
    selectedSport?.name,
  ]);

  // Render the personalized availability section: a horizontal carousel of the
  // player's favorite facilities with an open slot, or — when none qualify
  // (incl. signed-out users) — the closest facilities within range that do.
  // When even the fallback is empty, an empty-state card (mirroring My Games)
  // points to the facilities directory. Shown once location + sport are ready.
  const renderFavoriteAvailabilitySection = useCallback(() => {
    if (!showNearbySection) return null;
    const showLoading = loadingFavoriteAvailability && favoriteAvailability.length === 0;
    const isEmpty = !showLoading && favoriteAvailability.length === 0;

    // A lone card reads better filling the row than as a peek-able card.
    const isSingle = !showLoading && favoriteAvailability.length === 1;

    // The fallback shows non-favorites, so the header reflects which list it is.
    const sectionTitle =
      availabilitySource === 'favorites'
        ? t('home.favoriteAvailability.title')
        : t('home.favoriteAvailability.nearbyTitle');

    const goToFacilitiesDirectory = () => {
      lightHaptic();
      Logger.logUserAction('favorite_availability_view_all_pressed');
      appNavigation.navigate('Main', {
        screen: 'Courts',
        params: { screen: 'FacilitiesDirectory' },
      } as never);
    };

    const renderCard = (facility: FacilitySearchResult, fullWidth = false) => (
      <FavoriteAvailabilityCard
        key={facility.id}
        facility={facility}
        fullWidth={fullWidth}
        onPress={fac => {
          Logger.logUserAction('favorite_availability_facility_pressed', {
            facilityId: fac.id,
          });
          appNavigation.navigate('FacilityDetail', { facilityId: fac.id });
        }}
        t={t}
      />
    );

    return (
      <View>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text variant="display" size="xl" weight="bold" color={colors.text}>
              {sectionTitle}
            </Text>
            <Text size="sm" color={colors.textMuted}>
              {t('home.favoriteAvailability.subtitle')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.viewAllButton}
            onPress={goToFacilitiesDirectory}
            activeOpacity={0.7}
          >
            <Text size="base" weight="medium" color={colors.primary}>
              {t('home.viewAll')}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.primary}
              style={styles.chevronIcon}
            />
          </TouchableOpacity>
        </View>
        {isEmpty ? (
          <View style={styles.myMatchesEmptyWrap}>
            <View style={[styles.myMatchesEmpty, { backgroundColor: colors.card }]}>
              <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                {t('home.favoriteAvailability.empty.title')}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                {t('home.favoriteAvailability.empty.description')}
              </Text>
              <Button
                variant="primary"
                onPress={goToFacilitiesDirectory}
                style={styles.myMatchesEmptyCta}
              >
                {t('home.favoriteAvailability.empty.cta')}
              </Button>
            </View>
          </View>
        ) : isSingle ? (
          <View style={styles.favAvailSingleWrap}>{renderCard(favoriteAvailability[0], true)}</View>
        ) : (
          <GestureScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.favAvailScrollContent}
          >
            {showLoading
              ? [1, 2].map(i => <FavoriteAvailabilityCardSkeleton key={i} />)
              : favoriteAvailability.map(facility => renderCard(facility))}
          </GestureScrollView>
        )}
      </View>
    );
  }, [
    showNearbySection,
    loadingFavoriteAvailability,
    favoriteAvailability,
    availabilitySource,
    colors.text,
    colors.textMuted,
    colors.primary,
    colors.card,
    t,
    appNavigation,
  ]);

  // Render list header (welcome section for logged-in users)
  const renderListHeader = useCallback(() => {
    const headerComponents = [];

    // Banners go first so they sit above everything else on the home screen.
    // Only signed-in + onboarded users see them. Bucket order IS priority
    // order (billing > competitive actions > weekly check-in > references >
    // profile completion > cross-sport > second sport) — only the first card
    // renders.
    const bannerCards: React.ReactNode[] = [];

    if (session && isOnboarded) {
      // Billing issue banner (shown when subscription payment has failed)
      if (subscriptionStatus === 'billing_issue' && !billingBannerDismissed) {
        bannerCards.push(
          <BillingIssueBanner
            key="billing-issue"
            onManagePress={() => appNavigation.navigate('SubscriptionManagement')}
            onDismiss={() => setBillingBannerDismissed(true)}
          />
        );
      }

      // Competitive action banners — a released bracket/matchup slot with no
      // linked game yet is a call to action. One banner per tournament or
      // session; they clear themselves once a game is linked, and the tournament
      // variant is also dismissible in-session.
      const tournamentActionGroups = new Map<
        string,
        { name: string; count: number; round: number }
      >();
      for (const m of tournamentActionMatches) {
        const group = tournamentActionGroups.get(m.tournament_id);
        if (group) {
          group.count += 1;
          group.round = Math.min(group.round, m.round_number);
        } else {
          tournamentActionGroups.set(m.tournament_id, {
            name: m.tournament.name,
            count: 1,
            round: m.round_number,
          });
        }
      }
      tournamentActionGroups.forEach((group, tournamentId) => {
        if (dismissedTournamentActionBanners.has(tournamentId)) {
          return;
        }
        bannerCards.push(
          <HomeBanner
            key={`tournament-action-${tournamentId}`}
            variant="action"
            leading={accentColor => (
              <Ionicons name="trophy-outline" size={20} color={accentColor} />
            )}
            title={t('home.tournamentActionBanner.title')}
            description={
              group.count === 1
                ? t('home.tournamentActionBanner.description', {
                    round: group.round,
                    name: group.name,
                  })
                : t('home.tournamentActionBanner.descriptionMany', {
                    count: group.count,
                    name: group.name,
                  })
            }
            primaryAction={{
              label: t('home.tournamentActionBanner.cta'),
              onPress: () =>
                appNavigation.navigate('TournamentDetail', {
                  tournamentId,
                  tournamentName: group.name,
                }),
            }}
            onDismiss={() =>
              setDismissedTournamentActionBanners(prev => new Set(prev).add(tournamentId))
            }
          />
        );
      });

      const sessionActionGroups = new Map<
        string,
        { sessionName: string; leagueId: string; leagueName: string; count: number }
      >();
      for (const m of sessionActionMatches) {
        const group = sessionActionGroups.get(m.session_id);
        if (group) {
          group.count += 1;
        } else {
          sessionActionGroups.set(m.session_id, {
            sessionName: m.session.name,
            leagueId: m.session.season.league_id,
            leagueName: m.session.season.league.name,
            count: 1,
          });
        }
      }
      sessionActionGroups.forEach((group, sessionId) => {
        bannerCards.push(
          <HomeBanner
            key={`session-action-${sessionId}`}
            variant="action"
            leading={accentColor => (
              <Ionicons name="ribbon-outline" size={20} color={accentColor} />
            )}
            title={t('home.leagueActionBanner.title')}
            description={
              group.count === 1
                ? t('home.leagueActionBanner.description', {
                    session: group.sessionName,
                    league: group.leagueName,
                  })
                : t('home.leagueActionBanner.descriptionMany', {
                    count: group.count,
                    session: group.sessionName,
                  })
            }
            primaryAction={{
              label: t('home.leagueActionBanner.cta'),
              onPress: () =>
                appNavigation.navigate('SessionDetail', {
                  sessionId,
                  leagueId: group.leagueId,
                  sessionName: group.sessionName,
                }),
            }}
          />
        );
      });

      // Weekly check-in banner — shown when the player hasn't checked in
      // for the current ISO week. The wizard's discrete × dismissal and this
      // banner's onDismiss share the AVAILABILITY_BANNER_COOLDOWN_KEY, so
      // dismissing either one suppresses both for 24h. Kept hidden while the
      // wizard is shipped dark.
      if (
        WEEKLY_CHECKIN_ENABLED &&
        checkInContext?.isPendingCheckIn === true &&
        !availabilityBannerDismissed &&
        !weeklyCheckinCooldownActive
      ) {
        // Show the streak-aware subtitle when the player has an active streak.
        // checkInContext is loaded by the auto-opener but we read it here too
        // (TanStack cache de-dupes the request).
        const streakCount = checkInContext?.currentStreak ?? 0;
        const description =
          streakCount > 0
            ? t('home.availabilityRefreshBanner.descriptionStreak', { count: streakCount })
            : t('home.availabilityRefreshBanner.description');

        bannerCards.push(
          <HomeBanner
            key="availability-refresh"
            variant="danger"
            title={t('home.availabilityRefreshBanner.title')}
            description={description}
            primaryAction={{
              label: t('home.availabilityRefreshBanner.cta'),
              onPress: handleAvailabilityBannerAction,
            }}
            onDismiss={handleDismissAvailabilityBanner}
          />
        );
      }

      // Pending incoming reference requests
      if (pendingReferenceRequestsCount > 0) {
        bannerCards.push(
          <ReferenceRequestsBanner
            key="reference-requests"
            count={pendingReferenceRequestsCount}
            onPress={() => appNavigation.navigate('IncomingReferenceRequests')}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }

      // Profile completion banner — gated on the hook's visibility/ready
      // state so an internally-hidden banner doesn't claim the priority slot.
      if (
        !profileCompleteness.isComplete &&
        !profileCompleteness.loading &&
        profileCompleteness.nextAction &&
        profileCompletionBanner.ready &&
        profileCompletionBanner.visible
      ) {
        bannerCards.push(
          <ProfileCompletionBanner
            key="profile-completion"
            percentage={profileCompleteness.percentage}
            nextAction={profileCompleteness.nextAction}
            onAction={handleCompletionBannerAction}
            onDismiss={profileCompletionBanner.handleDismiss}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }

      // Cross-sport banners for unread notifications in other sports
      Object.entries(otherSportsUnreadCount).forEach(([sportName, count]) => {
        if (count > 0 && !dismissedBannerSports.has(sportName)) {
          const sport = userSports.find(s => s.name === sportName);
          if (sport) {
            bannerCards.push(
              <CrossSportBanner
                key={`cross-sport-${sportName}`}
                sportName={sportName}
                displayName={sport.display_name.toLowerCase()}
                count={count}
                onSwitch={() => setSelectedSport(sport)}
                onDismiss={() => setDismissedBannerSports(prev => new Set(prev).add(sportName))}
                t={
                  t as (key: string, options?: Record<string, string | number | boolean>) => string
                }
              />
            );
          }
        }
      });

      // Second sport activation banner (for users with only 1 sport)
      if (shouldShowSecondSportBanner && inactiveSports.length > 0) {
        const sportToActivate = inactiveSports[0];
        bannerCards.push(
          <SecondSportBanner
            key="second-sport-banner"
            sportName={sportToActivate.name}
            displayName={sportToActivate.display_name.toLowerCase()}
            onActivate={handleActivateSecondSport}
            onDismiss={handleDismissSecondSportBanner}
            fadeAnim={secondSportFadeAnim}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }
    }

    // Single priority slot: only the highest-priority banner renders.
    // Dismissing it reveals the next one on re-render.
    if (bannerCards.length > 0) {
      headerComponents.push(
        <HomeBannerLayoutProvider key="banner-single" layout="fullWidth">
          <View style={styles.bannerSingleWrap}>{bannerCards[0]}</View>
        </HomeBannerLayoutProvider>
      );
    }

    // Play grid: full-width dispatch tiles, one per destination — identity
    // (icon + label) on the left, a live stat showcase on the right. Same
    // layout every launch, nothing hidden behind a horizontal scroll.
    // Signed-out users get the same tiles; destinations gate themselves where
    // needed, and unloaded stats fall back to a nudge line.
    const SportIconComponent =
      selectedSport?.name?.toLowerCase() === 'pickleball' ? PickleballIcon : TennisIcon;
    const breakLabel = breakTileLabel;
    // Find-a-game showcases the monthly-challenge standing (playing games is
    // what moves it), replacing the old standalone Classements card.
    const findGameStat = myLeaderboardRank
      ? {
          prefix: t('home.playGrid.rankPrefix'),
          value: `#${myLeaderboardRank.rank}`,
          detail: t('home.playGrid.findGameStatDetail', { count: myLeaderboardRank.games }),
        }
      : null;
    // Book-a-court showcases the courts open around the player. Without
    // location the count query is disabled — fall back to the generic value
    // line rather than a false "nothing open".
    const bookCourtStat =
      location && openCourtCount
        ? {
            value: openCourtCount.toLocaleString(),
            unit: t('home.playGrid.bookCourtStatCourts', { count: openCourtCount }),
            detail: t('home.playGrid.bookCourtStatDetail'),
          }
        : null;
    // Tournaments and leagues share one destination now, so they share one
    // tile. It keeps the tournament identity (trophy, coral) the Compete hub's
    // own Events segment uses. Public like the other two tiles: the hub reads
    // for everyone and gates its own actions. It also showcases the Circuit
    // Rallia standing, which is what entering an event earns.
    const competeStat = myCircuitRank
      ? {
          prefix: t('home.playGrid.rankPrefix'),
          value: `#${myCircuitRank.rank}`,
          detail: t('home.playGrid.competeStatDetail', {
            points: myCircuitRank.points.toLocaleString(),
            count: myCircuitRank.eventsPlayed,
          }),
        }
      : null;
    const playTiles: React.ReactNode[] = [
      <GradientStatTile
        key="compete"
        icon={color => <Ionicons name="trophy-outline" size={24} color={color} />}
        watermark={<Ionicons name="trophy" size={56} color={NAV_TILE_WATERMARK_COLOR} />}
        gradient={[secondary[400], secondary[600]]}
        borderColor={secondary[500]}
        label={breakLabel(t('home.playGrid.compete'))}
        statTitle={t('classements.tabs.ranking')}
        statIcon="ribbon"
        stat={competeStat}
        statFallback={t('home.playGrid.competeNudge')}
        statLoading={myCircuitRankLoading}
        onPress={() => appNavigation.navigate('Compete')}
      />,
      <GradientStatTile
        key="find-game"
        icon={color => <SportIconComponent width={24} height={24} fill={color} />}
        watermark={<SportIconComponent width={56} height={56} fill={NAV_TILE_WATERMARK_COLOR} />}
        gradient={[primary[500], primary[700]]}
        borderColor={primary[600]}
        label={breakLabel(t('home.playGrid.findGame'))}
        statTitle={t('classements.tabs.challenge')}
        statIcon="podium"
        stat={findGameStat}
        statFallback={t('home.playGrid.findGameNudge')}
        statLoading={myLeaderboardRankLoading}
        onPress={() => {
          Analytics.publicMatchesOpened({ cta: 'find_game' });
          navigation.navigate('PublicMatches');
        }}
      />,
      <GradientStatTile
        key="book-court"
        icon={color => <Ionicons name="calendar-outline" size={24} color={color} />}
        watermark={<TennisCourtIcon width={56} height={56} stroke={NAV_TILE_WATERMARK_COLOR} />}
        gradient={[accent[400], accent[600]]}
        borderColor={accent[500]}
        label={breakLabel(t('home.playGrid.bookCourt'))}
        statTitle={t('home.playGrid.bookCourtStatTitle')}
        statLive
        stat={bookCourtStat}
        statFallback={
          location ? t('home.playGrid.bookCourtEmpty') : t('home.playGrid.bookCourtNudge')
        }
        statLoading={openCourtCountLoading}
        onPress={() => {
          appNavigation.navigate('Main', {
            screen: 'Courts',
            params: { screen: 'FacilitiesDirectory' },
          } as never);
        }}
      />,
    ];
    headerComponents.push(
      <View key="play-grid">
        <View style={quickNavStyles.sectionHeader}>
          <Text variant="display" size="xl" weight="bold" color={colors.text}>
            {t('home.playGrid.title')}
          </Text>
        </View>
        <View style={quickNavStyles.grid}>{playTiles}</View>
      </View>
    );

    if (!session) {
      // Not signed in: show sign-in prompt
      headerComponents.push(
        <View key="sign-in">
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text variant="display" size="xl" weight="bold" color={colors.text}>
                {t('home.yourMatches')}
              </Text>
            </View>
          </View>
          <View style={styles.myMatchesEmptyWrap}>
            <View style={[styles.myMatchesEmpty, { backgroundColor: colors.card }]}>
              <Ionicons name="log-in-outline" size={32} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                {t('home.signInEmpty.title')}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                {t('home.signInEmpty.description')}
              </Text>
              <Button
                variant="primary"
                onPress={openSheet}
                style={styles.myMatchesEmptyCta}
                testID="home-signin"
              >
                {t('auth.signIn')}
              </Button>
            </View>
          </View>
        </View>
      );
    } else if (!isOnboarded) {
      // Signed in but not onboarded: show complete profile prompt
      headerComponents.push(
        <View key="complete-profile">
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text variant="display" size="xl" weight="bold" color={colors.text}>
                {t('home.yourMatches')}
              </Text>
            </View>
          </View>
          <View style={styles.myMatchesEmptyWrap}>
            <View style={[styles.myMatchesEmpty, { backgroundColor: colors.card }]}>
              <Ionicons name="person-add-outline" size={32} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                {t('home.onboardingEmpty.title')}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                {t('home.onboardingEmpty.description')}
              </Text>
              <Button variant="primary" onPress={openSheet} style={styles.myMatchesEmptyCta}>
                {t('home.completeProfile')}
              </Button>
            </View>
          </View>
        </View>
      );
    } else {
      // Add "My Games" for fully onboarded users
      headerComponents.push(<View key="my-matches">{renderMyMatchesSection()}</View>);
    }

    // Only show "Soon & Nearby" section header if we have location.
    // The favorite-availability section renders below the Just-for-you carousel
    // (a sibling of this header in the ScrollView), so it's not pushed here.
    if (showNearbySection) {
      headerComponents.push(<View key="section-header">{renderSectionHeader()}</View>);
    }

    return <View>{headerComponents}</View>;
  }, [
    session,
    isOnboarded,
    showNearbySection,
    colors.card,
    colors.border,
    colors.textMuted,
    colors.headerBackground,
    colors.text,
    t,
    openSheet,
    selectedSport,
    renderMyMatchesSection,
    renderSectionHeader,
    otherSportsUnreadCount,
    dismissedBannerSports,
    userSports,
    setSelectedSport,
    colors.primary,
    shouldShowSecondSportBanner,
    inactiveSports,
    handleActivateSecondSport,
    handleDismissSecondSportBanner,
    secondSportFadeAnim,
    profileCompleteness.isComplete,
    profileCompleteness.loading,
    profileCompleteness.percentage,
    profileCompleteness.tier,
    profileCompleteness.nextAction,
    handleCompletionBannerAction,
    isDark,
    subscriptionStatus,
    appNavigation,
    pendingReferenceRequestsCount,
    billingBannerDismissed,
    dismissedTournamentActionBanners,
    profileCompletionBanner.ready,
    profileCompletionBanner.visible,
    profileCompletionBanner.handleDismiss,
    checkInContext?.isPendingCheckIn,
    checkInContext?.currentStreak,
    availabilityBannerDismissed,
    weeklyCheckinCooldownActive,
    handleAvailabilityBannerAction,
    handleDismissAvailabilityBanner,
    isAdmin,
    navigation,
    myLeaderboardRank,
    myLeaderboardRankLoading,
    myCircuitRank,
    myCircuitRankLoading,
    location,
    openCourtCount,
    openCourtCountLoading,
    tournamentActionMatches,
    sessionActionMatches,
  ]);

  // No more full-page skeleton. Each section (My Matches, Just for you) owns
  // its own loading state, so the page renders immediately and the relevant
  // section shows its skeleton until its data arrives. Avoids the layout
  // flicker that came from swapping a full-page skeleton in and out.
  // Treat "fetch not yet ready" as a loading state so the carousel renders
  // skeletons (instead of the empty card) while sport/location settle.
  //
  // Also cover the signed-in gate window: the carousel is disabled until
  // `player` loads (see useJustForYou `enabled`), so the query reports
  // isLoading=false even though it hasn't fired yet. Without this, skeletons
  // would disappear during that window. Gate on "no items yet" so a warm cache
  // (persisted results) still renders instantly instead of skeletons.
  const jfyGatedWaiting = !!session?.user?.id && playerLoading && justForYouItems.length === 0;
  const showJfyLoading = loadingJustForYou || !isNearbyFetchReady || jfyGatedWaiting;
  const showJfyEmpty = !showJfyLoading && justForYouItems.length === 0;

  // jfy_section_viewed: once per focus session, after the section settles.
  // "Viewed" here means Home focused with data resolved — per-card visibility
  // lives in the impression events. Two triggers, same guard: the focus
  // handler above (data already settled on refocus) and the effect below
  // (focused first, data settles later). The ref indirection keeps the focus
  // callback's identity stable across data changes.
  const jfyViewedForNonce = useRef(0);
  const maybeFireJfySectionViewed = useCallback(() => {
    const nonce = homeFocusNonceRef.current;
    if (nonce === 0 || jfyViewedForNonce.current === nonce) return;
    if (!showNearbySection || showJfyLoading) return;
    jfyViewedForNonce.current = nonce;
    const matchCount = justForYouItems.filter(i => i.kind === 'match').length;
    Analytics.jfySectionViewed({
      item_count: justForYouItems.length,
      match_count: matchCount,
      suggestion_count: justForYouItems.length - matchCount,
      is_empty: justForYouItems.length === 0,
    });
  }, [showNearbySection, showJfyLoading, justForYouItems]);

  useEffect(() => {
    maybeFireJfySectionViewedRef.current = maybeFireJfySectionViewed;
  }, [maybeFireJfySectionViewed]);

  useEffect(() => {
    maybeFireJfySectionViewed();
  }, [maybeFireJfySectionViewed]);

  const content = (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onLayout={e => {
          homeViewportHRef.current = e.nativeEvent.layout.height;
          recomputeJfyGate();
        }}
        onScroll={e => {
          homeScrollYRef.current = e.nativeEvent.contentOffset.y;
          recomputeJfyGate();
        }}
        scrollEventThrottle={100}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && isManualRefresh.current}
            onRefresh={() => {
              isManualRefresh.current = true;
              Analytics.feedRefreshed({ screen: 'home' });
              refetchJustForYou();
              // Availability section shows for signed-out users too (nearby
              // fallback), so refresh it regardless of auth state.
              refetchFavoriteAvailability();
              if (session?.user?.id) {
                refetchMyMatches();
                refetchTournamentActions();
                refetchLeagueActions();
              }
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {renderListHeader()}

        {showNearbySection && (
          <View
            onLayout={e => {
              const { y, height } = e.nativeEvent.layout;
              jfySectionLayoutRef.current = { y, height };
              recomputeJfyGate();
            }}
          >
            {showJfyEmpty ? (
              /* Same empty-state shell as My Matches / Favorite Availability. */
              <View style={styles.myMatchesEmptyWrap}>
                <View style={[styles.myMatchesEmpty, { backgroundColor: colors.card }]}>
                  <Ionicons name="location-outline" size={32} color={colors.textMuted} />
                  <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                    {t('home.nearbyEmpty.title')}
                  </Text>
                  <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                    {t('home.nearbyEmpty.description', { distance: searchRadiusKm })}
                  </Text>
                  <Button
                    variant="primary"
                    onPress={() => {
                      Analytics.createGameCtaPressed({
                        placement: 'home_nearby_empty',
                        has_active_filters: false,
                      });
                      openSheetForMatchCreation('home_nearby_empty');
                    }}
                    style={styles.myMatchesEmptyCta}
                  >
                    {t('matches.createMatch')}
                  </Button>
                </View>
              </View>
            ) : showJfyLoading ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.justForYouScrollContent}
              >
                {[1, 2, 3].map(i => (
                  <View key={i} style={styles.jfyCardWrapper}>
                    <SkeletonMatchCard
                      backgroundColor={skeletonShimmerBg}
                      highlightColor={skeletonShimmerHighlight}
                      style={{
                        backgroundColor: skeletonCardBg,
                        borderColor: skeletonCardBorder,
                        borderWidth: 1.5,
                        borderRadius: radiusPixels.xl,
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
            ) : (
              /* FlatList (not ScrollView) so card impressions ride on the
                 native viewability callbacks. ≤5 fixed-width items — the
                 virtualization itself is moot. */
              <FlatList
                horizontal
                data={justForYouItems}
                keyExtractor={jfyItemKey}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.justForYouScrollContent}
                viewabilityConfig={JFY_VIEWABILITY_CONFIG}
                onViewableItemsChanged={onJfyViewableItemsChanged}
                renderItem={({ item }) =>
                  item.kind === 'match' ? (
                    <View style={styles.jfyCardWrapper}>
                      {/* MatchCard has built-in marginHorizontal:16; the
                      negative wrapper margin neutralizes it so the card
                      fills our 340px slot exactly. */}
                      <View style={styles.jfyMatchInner}>
                        <MatchCard
                          match={item.data}
                          isDark={isDark}
                          t={
                            t as (
                              key: string,
                              options?: Record<string, string | number | boolean>
                            ) => string
                          }
                          locale={locale}
                          currentPlayerId={player?.id}
                          sportIcon={
                            <SportIcon
                              sportName={item.data.sport?.name ?? selectedSport?.name ?? 'tennis'}
                              size={100}
                              color={isDark ? neutral[600] : neutral[400]}
                            />
                          }
                          onPress={() => {
                            Logger.logUserAction('match_pressed', { matchId: item.data.id });
                            openMatchDetail(item.data, { source: 'home_carousel' });
                          }}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.jfyCardWrapper}>
                      <SuggestionCard
                        suggestion={item.data}
                        colors={{
                          cardBackground: colors.cardBackground,
                          text: colors.foreground,
                          textSecondary: colors.textSecondary,
                          textMuted: colors.textMuted,
                          border: colors.border,
                          buttonActive: colors.primary,
                          buttonTextActive: '#ffffff',
                        }}
                        isDark={isDark}
                        labels={suggestionLabels}
                        locale={locale}
                        onSendInvite={handleSendInvite}
                        inviteState={getInviteState(
                          item.data.opponentId,
                          item.data.facility.facilityId,
                          item.data.slot.datetime
                        )}
                        source="home_carousel"
                        sportId={selectedSport?.id}
                        sportName={selectedSport?.name}
                        defaultMatchType={callerMatchType}
                        trackImpressionOnMount={false}
                      />
                    </View>
                  )
                }
              />
            )}
          </View>
        )}

        {/* Personalized realtime availability at the player's favorite
            facilities, now below the Just-for-you carousel. The renderer shows
            an empty-state card when no favorite has an open slot, and returns
            null only for non-onboarded users. */}
        {renderFavoriteAvailabilitySection()}
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <>
      {content}

      {/* Deep link processing overlay */}
      <Modal visible={deepLinkOverlay} transparent animationType="fade">
        <View style={styles.deepLinkOverlay}>
          <View
            style={[
              styles.deepLinkCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name="gift-outline" size={48} color={colors.primary} />
            <Text
              size="lg"
              weight="semibold"
              color={colors.text}
              style={{ marginTop: spacingPixels[3] }}
            >
              {t('referral.welcomeTitle')}
            </Text>
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginTop: spacingPixels[4] }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[6],
  },
  justForYouScrollContent: {
    paddingHorizontal: spacingPixels[4], // leading & trailing edge from screen
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[4], // inter-card spacing (16px)
  },
  // 310px slot per card — leaves a clearer peek of the next card on typical
  // phone widths, signalling horizontal scrollability.
  jfyCardWrapper: {
    width: 320,
  },
  // MatchCard ships with marginHorizontal: spacingPixels[4] built in (so it
  // sits flush in vertical lists). In a horizontal carousel that margin would
  // shrink the visible card and add unwanted gap. Negative margin neutralizes
  // it so the card fills the 340px slot exactly.
  jfyMatchInner: {
    marginHorizontal: -spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Top-align so "View all" sits next to the title, with the description
    // wrapping below it in the left column.
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    // More room above the title than below it, so the header groups with its
    // own content instead of floating between two sections.
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  // Variant of sectionHeader used when the title row carries inline controls
  // (the LocationSelector). The title row and "View all" live in a centered top
  // row, with the description stacked below — so a taller control can't drag
  // "View all" out of alignment with the title.
  sectionHeaderStacked: {
    gap: spacingPixels[0.5],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  sectionHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  // Left column of a section header: title (+ optional inline controls) stacked
  // above a muted one-line description.
  sectionHeaderText: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  locationSelectorWrapper: {
    marginLeft: spacingPixels[1],
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  chevronIcon: {
    marginLeft: spacingPixels[1],
  },
  myMatchesSection: {
    overflow: 'visible', // Allow corner badges to extend outside cards
  },
  // Full-width empty-state card — replaces the carousel entirely when there
  // are no upcoming games, so the message reads as a section instead of a
  // single scrollable card.
  myMatchesEmptyWrap: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  myMatchesEmpty: {
    padding: spacingPixels[6],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusPixels.xl,
  },
  myMatchesEmptyText: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  myMatchesEmptyDescription: {
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
  myMatchesEmptyCta: {
    marginTop: spacingPixels[4],
    minWidth: 180,
  },
  myMatchesScrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
  favAvailScrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
  favAvailSingleWrap: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  bannerSingleWrap: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
  },
  deepLinkOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deepLinkCard: {
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
    paddingHorizontal: spacingPixels[10],
    borderRadius: radiusPixels['2xl'],
    borderWidth: 1,
  },
});

export default Home;

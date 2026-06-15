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
import { SheetManager } from 'react-native-actions-sheet';
import {
  useProfile,
  useTheme,
  usePlayer,
  useJustForYou,
  usePlayerMatches,
  usePlayerSports,
  useRatingScoresForSport,
  useFavoriteFacilities,
  useOtherSportsUnreadCount,
  useSports,
  useProfileCompleteness,
  useReferral,
  useAdminStatus,
} from '@rallia/shared-hooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MatchScoringPreferences } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';
import {
  Logger,
  supabase,
  getMatchWithDetails,
  joinGroupByInviteCode,
  requestToJoinCommunityByInviteCode,
} from '@rallia/shared-services';
import type { JustForYouItem } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, accent, neutral, primary } from '@rallia/design-system';
import { LinearGradient } from 'expo-linear-gradient';

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

// Splits a label at the last space so every quick-nav button renders exactly
// two lines, regardless of locale. Single-word labels (rare) still take two
// lines of vertical space — the second line is empty but reserves height so
// the row stays visually aligned.
const splitLabelTwoLines = (label: string): [string, string] => {
  const trimmed = label.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return [trimmed, ' '];
  return [trimmed.slice(0, lastSpace), trimmed.slice(lastSpace + 1)];
};

const QuickNavButton: React.FC<{
  icon: (color: string) => React.ReactNode;
  label: string;
  onPress: () => void;
}> = ({ icon, label, onPress }) => {
  const [lineOne, lineTwo] = splitLabelTwoLines(label);
  const handlePress = () => {
    void lightHaptic();
    onPress();
  };
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={quickNavStyles.item}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <LinearGradient
        colors={[accent[300], accent[400], accent[500]]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={quickNavStyles.gradient}
      >
        <View style={quickNavStyles.topHighlight} />
        <View style={quickNavStyles.iconCircle}>{icon('#ffffff')}</View>
        <View style={quickNavStyles.labelBlock}>
          <Text
            size="sm"
            weight="semibold"
            color="#ffffff"
            style={quickNavStyles.label}
            numberOfLines={1}
          >
            {lineOne}
          </Text>
          <Text
            size="sm"
            weight="semibold"
            color="#ffffff"
            style={quickNavStyles.label}
            numberOfLines={1}
          >
            {lineTwo}
          </Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const quickNavStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  item: {
    width: 190,
    borderRadius: radiusPixels['2xl'],
  },
  gradient: {
    flexDirection: 'row',
    borderRadius: radiusPixels['2xl'],
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    flexShrink: 0,
  },
  labelBlock: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
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

const Home = () => {
  // Warm sibling tab stacks in the background so their first open is instant.
  useTabPreload();

  // Use custom hooks for auth, profile, and overlay context
  const { session, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useAdminStatus();
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

  // Card-skeleton palette — mirrors PlayerCardSkeleton / FacilityCardSkeleton
  // so My Matches & Just-for-you skeletons sit on the same tinted surface
  // as the real MatchCard / MyMatchCard (primary[50/950]).
  const skeletonCardBg = isDark ? primary[950] : primary[50];
  const skeletonCardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const skeletonShimmerBg = isDark ? primary[900] : primary[100];
  const skeletonShimmerHighlight = isDark ? primary[800] : primary[50];
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
          }
        } catch {
          // Ignore parse errors
        }
      });
    });
    return () => handle.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const { data: checkInContext } = useCheckInContext({ enabled: WEEKLY_CHECKIN_ENABLED });

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
          // Don't surface the referral invite over the weekly check-in
          // wizard — the wizard owns the screen when it's presenting.
          // The launch counter still ticks so this prompt will be eligible
          // again on the next launch.
          if (isWeeklyCheckInActive()) {
            Logger.logUserAction('referral_invite_suppressed_for_wizard');
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
  const { favorites } = useFavoriteFacilities(session?.user?.id ?? null, selectedSport?.id);
  const favoriteFacilityIds = useMemo(() => favorites.map(f => f.facilityId), [favorites]);

  // Default search radius for signed-out users
  const GUEST_SEARCH_RADIUS_KM = 20;

  // Use player's travel distance if signed in, otherwise use guest default
  const searchRadiusKm = session ? maxTravelDistanceKm : GUEST_SEARCH_RADIUS_KM;

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
  const [homeFocusNonce, setHomeFocusNonce] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setHomeFocusNonce(n => n + 1);
      for (const token of lastJfyViewableRef.current) {
        fireJfyImpression(token.item, token.index);
      }
      recomputeJfyGate();
      return () => setJfyGate(false);
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

    return (
      <View style={[styles.sectionHeader]}>
        <View style={styles.sectionTitleRow}>
          <Text size="xl" weight="bold" color={colors.text}>
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
    );
  };

  // Render "My Matches" section with horizontal scroll
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
            <Text size="xl" weight="bold" color={colors.text}>
              {t('home.myMatches')}
            </Text>
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
                <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
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
                    // Check if current player is invited (has pending invitation)
                    const isInvited = !!(
                      player?.id &&
                      match.participants?.some(
                        p => p.player_id === player.id && p.status === 'pending'
                      )
                    );
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
                        isInvited={isInvited}
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
  ]);

  // Render list header (welcome section for logged-in users)
  const renderListHeader = useCallback(() => {
    const headerComponents = [];

    // Banners go first so they sit above everything else on the home screen,
    // including the quick-nav FAB row. Only signed-in + onboarded users see
    // them; the bucket is built up below and only flushed if non-empty.
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

      // Weekly check-in banner — shown when the player hasn't checked in
      // for the current ISO week (proxy: availability staleness ≥ 7 days,
      // since the check-in RPC refreshes last_confirmed_at). Tapping the
      // CTA opens the full-screen weekly-checkin wizard.
      //
      // The wizard's discrete × dismissal and this banner's onDismiss share
      // the AVAILABILITY_BANNER_COOLDOWN_KEY, so dismissing either one
      // suppresses both for 24h.
      // Banner CTA navigates into the weekly check-in wizard, so keep it
      // hidden while the wizard is shipped dark.
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

      // Profile completion banner — gated on the hook's visibility/ready state
      // so an internally-hidden banner doesn't inflate bannerCards.length and
      // accidentally flip the layout into carousel mode.
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
    }

    // Single banner gets the full row; multiple banners scroll horizontally
    // as a carousel (matching My Matches / Just for you below).
    if (bannerCards.length === 1) {
      headerComponents.push(
        <HomeBannerLayoutProvider key="banner-single" layout="fullWidth">
          <View style={styles.bannerSingleWrap}>{bannerCards[0]}</View>
        </HomeBannerLayoutProvider>
      );
    } else if (bannerCards.length > 1) {
      headerComponents.push(
        <HomeBannerLayoutProvider key="banner-carousel" layout="card">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bannerCarouselContent}
          >
            {bannerCards}
          </ScrollView>
        </HomeBannerLayoutProvider>
      );
    }

    // Quick-nav row: 3 card buttons (community / book a court / find a game).
    // Shown for everyone — signed-out users land on the same destinations,
    // which gate themselves where needed.
    const SportIconComponent =
      selectedSport?.name?.toLowerCase() === 'pickleball' ? PickleballIcon : TennisIcon;
    headerComponents.push(
      <ScrollView
        key="quick-nav"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={quickNavStyles.row}
      >
        {isOnboarded && (
          <QuickNavButton
            icon={color => <Ionicons name="sparkles" size={24} color={color} />}
            label={t('home.quickNav.browseSuggestions')}
            onPress={() => SheetManager.show('match-suggestions')}
          />
        )}
        <QuickNavButton
          icon={color => <SportIconComponent width={24} height={24} fill={color} />}
          label={t('home.quickNav.findGame')}
          onPress={() => {
            Analytics.publicMatchesOpened({ cta: 'find_game' });
            navigation.navigate('PublicMatches');
          }}
        />
        <QuickNavButton
          icon={color => <Ionicons name="people-outline" size={24} color={color} />}
          label={t('home.quickNav.joinCommunity')}
          onPress={() =>
            appNavigation.navigate('Main', {
              screen: 'Community',
              params: {
                screen: 'Communities',
                initial: false,
              },
            } as never)
          }
        />
        {isAdmin && (
          <QuickNavButton
            icon={color => <Ionicons name="trophy-outline" size={24} color={color} />}
            label={t('home.quickNav.tournaments')}
            onPress={() => appNavigation.navigate('Tournaments')}
          />
        )}
      </ScrollView>
    );

    if (!session) {
      // Not signed in: show sign-in prompt
      headerComponents.push(
        <View
          key="sign-in"
          style={[
            styles.matchesSection,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingHorizontal: spacingPixels[10],
            },
          ]}
        >
          <Text size="xl" weight="bold" color={colors.text} style={styles.matchesSectionTitle}>
            {t('home.yourMatches')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.sectionSubtitle}>
            {t('home.signInPrompt')}
          </Text>
          <Button
            variant="primary"
            rounded
            onPress={openSheet}
            style={styles.signInButton}
            leftIcon={<Ionicons name="log-in-outline" size={20} color="#FFFFFF" />}
            isDark={isDark}
            testID="home-signin"
          >
            {t('auth.signIn')}
          </Button>
        </View>
      );
    } else if (!isOnboarded) {
      // Signed in but not onboarded: show complete profile prompt
      headerComponents.push(
        <View
          key="complete-profile"
          style={[
            styles.matchesSection,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.matchesSectionIconWrap, { backgroundColor: `${primary[500]}20` }]}>
            <Ionicons name="person-add-outline" size={40} color={primary[500]} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.matchesSectionTitle}>
            {t('home.yourMatches')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.sectionSubtitle}>
            {t('home.onboardingPrompt')}
          </Text>
          <Button
            variant="primary"
            rounded
            onPress={openSheet}
            style={styles.signInButton}
            leftIcon={<Ionicons name="person-add-outline" size={20} color="#FFFFFF" />}
            isDark={isDark}
          >
            {t('home.completeProfile')}
          </Button>
        </View>
      );
    } else {
      // Add "My Matches" section for fully onboarded users
      headerComponents.push(<View key="my-matches">{renderMyMatchesSection()}</View>);
    }

    // Only show "Soon & Nearby" section header if we have location
    if (showNearbySection) {
      headerComponents.push(<View key="section-header">{renderSectionHeader()}</View>);
    }

    return <View>{headerComponents}</View>;
  }, [
    session,
    isOnboarded,
    isAdmin,
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
    profileCompletionBanner.ready,
    profileCompletionBanner.visible,
    profileCompletionBanner.handleDismiss,
    checkInContext?.isPendingCheckIn,
    checkInContext?.currentStreak,
    availabilityBannerDismissed,
    weeklyCheckinCooldownActive,
    handleAvailabilityBannerAction,
    handleDismissAvailabilityBanner,
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
  // lives in the impression events.
  const jfyViewedForNonce = useRef(0);
  useEffect(() => {
    if (homeFocusNonce === 0 || jfyViewedForNonce.current === homeFocusNonce) return;
    if (!showNearbySection || showJfyLoading) return;
    jfyViewedForNonce.current = homeFocusNonce;
    const matchCount = justForYouItems.filter(i => i.kind === 'match').length;
    Analytics.jfySectionViewed({
      item_count: justForYouItems.length,
      match_count: matchCount,
      suggestion_count: justForYouItems.length - matchCount,
      is_empty: justForYouItems.length === 0,
    });
  }, [homeFocusNonce, showNearbySection, showJfyLoading, justForYouItems]);

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
              if (session?.user?.id) refetchMyMatches();
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
              <View
                style={[
                  styles.matchesSection,
                  { backgroundColor: colors.card, borderColor: colors.border, marginTop: 0 },
                ]}
              >
                <Ionicons name="location-outline" size={32} color={colors.textMuted} />
                <Text size="sm" color={colors.textMuted} style={styles.jfyEmptyText}>
                  {t('home.nearbyEmpty.title')}
                </Text>
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
  jfyEmptyText: {
    textAlign: 'center',
  },
  matchesSection: {
    padding: spacingPixels[6],
    margin: spacingPixels[4],
    marginTop: spacingPixels[5],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    alignItems: 'center',
  },
  matchesSectionIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  matchesSectionTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  sectionSubtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  signInButton: {
    marginTop: spacingPixels[2],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[5],
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
  },
  chevronIcon: {
    marginLeft: spacingPixels[1],
  },
  myMatchesSection: {
    overflow: 'visible', // Allow corner badges to extend outside cards
  },
  myMatchesLoading: {
    padding: spacingPixels[8],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-width empty-state card — replaces the carousel entirely when there
  // are no upcoming games, so the message reads as a section instead of a
  // single scrollable card.
  myMatchesEmptyWrap: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: 10,
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
    paddingTop: 10, // Minimal space for corner badges (badge extends 8px above card)
    paddingLeft: spacingPixels[4],
    paddingRight: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  bannerCarouselContent: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[3],
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

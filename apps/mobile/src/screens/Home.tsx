import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useScrollToTop } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  MatchCard,
  MyMatchCard,
  Text,
  Heading,
  Button,
  LocationSelector,
  SkeletonMatchCard,
  SkeletonMyMatchCard,
  useToast,
} from '@rallia/shared-components';

import { lightHaptic } from '@rallia/shared-utils';
import { SheetManager } from 'react-native-actions-sheet';
import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useTourSequence,
  usePendingReferenceRequestsCount,
  useSuggestionInviteHandler,
} from '../hooks';
import {
  useOverlay,
  useActionsSheet,
  useSport,
  useMatchDetailSheet,
  useUserHomeLocation,
} from '../context';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { CopilotStep, WalkthroughableView } from '../context/TourContext';
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
} from '@rallia/shared-hooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MatchScoringPreferences } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';
import {
  Logger,
  getMatchWithDetails,
  joinGroupByInviteCode,
  requestToJoinCommunityByInviteCode,
} from '@rallia/shared-services';
import {
  PENDING_REFERRAL_KEY,
  type PendingReferral,
  consumePendingDeepLink,
  getPendingDeepLink,
  addDeepLinkListener,
} from '../navigation/deepLinkStore';
import { spacingPixels, radiusPixels, accent, neutral, secondary } from '@rallia/design-system';
import { LinearGradient } from 'expo-linear-gradient';
import TennisIcon from '../../assets/icons/tennis.svg';
import PickleballIcon from '../../assets/icons/pickleball.svg';
import TennisCourtIcon from '../../assets/icons/tennis-court.svg';
import { SportIcon } from '../components/SportIcon';
import { useHomeNavigation, useAppNavigation } from '../navigation/hooks';
import ProfileCompletionBanner, {
  useProfileCompletionBannerVisibility,
} from '../features/profile/components/ProfileCompletionBanner';
import { SuggestionCard } from '../components/SuggestionCard';
import type { UnifiedFeedItem } from '@rallia/shared-hooks';
import BillingIssueBanner from '../components/BillingIssueBanner';
import ReferenceRequestsBanner from '../components/ReferenceRequestsBanner';
import HomeBanner, { HomeBannerLayoutProvider } from '../components/HomeBanner';
import { useSubscription } from '../context';
import {
  incrementOnboardedLaunchCount,
  shouldShowReferralInvite,
  markSheetShown,
} from '../utils/referralInviteFrequency';

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
        colors={[accent[400], accent[500], accent[600]]}
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
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  item: {
    width: 150,
    borderRadius: radiusPixels['2xl'],
  },
  gradient: {
    borderRadius: radiusPixels['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
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
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  labelBlock: {
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
});

// AsyncStorage key for second sport banner cooldown
const SECOND_SPORT_BANNER_COOLDOWN_KEY = '@rallia/second-sport-banner-cooldown';
const SECOND_SPORT_BANNER_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const SECOND_SPORT_BANNER_FADE_MS = 10 * 60 * 1000; // 10 minutes

const Home = () => {
  // Use custom hooks for auth, profile, and overlay context
  const { session, loading: authLoading } = useAuth();
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
  const navigation = useHomeNavigation();
  const appNavigation = useAppNavigation();
  const toast = useToast();

  // Overlay state for deep link async operations (group join, community request)
  const [deepLinkOverlay, setDeepLinkOverlay] = useState(false);

  // Consume pending navigation from post-onboarding join (AsyncStorage)
  useEffect(() => {
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
              openMatchDetail(match as MatchDetailData);
            }
          });
        }
      } catch {
        // Ignore parse errors
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: consume PendingReferral from AsyncStorage if DeepLinkContext expired
  // (e.g., session-expired user taps a deep link, signs in, and DeepLinkContext has expired)
  useEffect(() => {
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
              openMatchDetail(match as MatchDetailData);
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
        }
      } catch {
        // Ignore parse errors
      }
    });
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
          if (match) openMatchDetail(match as MatchDetailData);
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
            if (match) openMatchDetail(match as MatchDetailData);
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

  // Check on mount + subscribe so re-fires when Home is already mounted (fixes app-open bug)
  useEffect(() => {
    processDeepLink();
    return addDeepLinkListener(processDeepLink);
  }, [processDeepLink]);

  // Retry once player data arrives in case it was null on first run
  useEffect(() => {
    if (player?.id) processDeepLink();
  }, [player?.id, processDeepLink]); // eslint-disable-line react-hooks/exhaustive-deps

  // Referral invite prompt — shown every 3 launches (0 referrals) or 7 launches (1+ referrals)
  const { stats: referralStats, statsLoading: referralStatsLoading } = useReferral(player?.id);
  useEffect(() => {
    if (!isOnboarded || !player?.id || referralStatsLoading) return;

    const hasReferredUser = (referralStats?.total_converted ?? 0) >= 1;

    (async () => {
      await incrementOnboardedLaunchCount();
      const show = await shouldShowReferralInvite(hasReferredUser);
      if (show) {
        await markSheetShown();
        SheetManager.show('referral-invite');
      }
    })();
  }, [isOnboarded, player?.id, referralStatsLoading, referralStats?.total_converted]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Check cooldown and set up auto-fade timer for second sport banner
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

    void checkCooldownAndShow();
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
  const excludeUserIds = useMemo(
    () => (session?.user?.id ? [session.user.id] : []),
    [session?.user?.id]
  );
  const {
    matches: jfyMatches,
    suggestions: jfySuggestions,
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
    enabled: showNearbySection,
  });

  // Suggestion invite plumbing (shared with PublicMatches via the hook).
  const {
    cardLabels: suggestionLabels,
    handleSendInvite,
    getInviteState,
    callerMatchType,
  } = useSuggestionInviteHandler({ sportId: selectedSport?.id, source: 'feed' });

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

  // Notify OverlayContext that we're on Home screen (safe to show permission overlays)
  useEffect(() => {
    setOnHomeScreen(true);
    return () => setOnHomeScreen(false);
  }, [setOnHomeScreen]);

  // Combined Just-for-you items (matches first, suggestions tail). Always
  // exactly `matchLimit` long when fully loaded. Shape matches UnifiedFeedItem
  // so we can pass it straight into FeedItemCard.
  const justForYouItems = useMemo<UnifiedFeedItem[]>(
    () => [
      ...jfyMatches.map(m => ({
        kind: 'match' as const,
        key: `match:${m.id}`,
        sortTime: 0,
        data: m,
      })),
      ...jfySuggestions.map(s => ({
        kind: 'suggestion' as const,
        key: `suggestion:${s.opponentId}:${(s.slot.datetime as Date).getTime?.() ?? 0}`,
        sortTime: 0,
        data: s,
      })),
    ],
    [jfyMatches, jfySuggestions]
  );

  // Render section header with "Soon & Nearby" title, location selector, and "View All" button
  // Render section header with "Soon & Nearby" title and "View All" button
  // Wrapped with CopilotStep for home screen tour
  const renderSectionHeader = useCallback(() => {
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
                t={t as (key: string) => string}
              />
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.viewAllButton}
          onPress={() => {
            lightHaptic();
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
  }, [
    colors.text,
    colors.primary,
    navigation,
    t,
    locationMode,
    setLocationMode,
    hasHomeLocation,
    hasBothLocationOptions,
    homeLocation,
    isDark,
    player?.address,
    player?.city,
    session?.user?.id,
  ]);

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
                      backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                      highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                      style={{ backgroundColor: colors.card }}
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
                        t={
                          t as (
                            key: string,
                            options?: Record<string, string | number | boolean>
                          ) => string
                        }
                        locale={locale}
                        isInvited={isInvited}
                        pendingRequestCount={pendingRequestCount}
                        onPress={() => {
                          Logger.logUserAction('my_match_pressed', { matchId: match.id });
                          openMatchDetail(match);
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
          onPress={() => navigation.navigate('PublicMatches')}
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
        <QuickNavButton
          icon={color => (
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <TennisCourtIcon width={24} height={24} stroke={color} />
            </View>
          )}
          label={t('home.quickNav.bookCourt')}
          onPress={() =>
            appNavigation.navigate('Main', {
              screen: 'Courts',
              params: { screen: 'FacilitiesDirectory' },
            } as never)
          }
        />
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
            },
          ]}
        >
          <SportIcon
            sportName={selectedSport?.name ?? 'tennis'}
            size={32}
            color={colors.text}
            style={styles.matchesSectionIcon}
          />
          <Heading level={3} color={colors.text}>
            {t('home.yourMatches')}
          </Heading>
          <Text size="sm" color={colors.textMuted} style={styles.sectionSubtitle}>
            {t('home.signInPrompt')}
          </Text>
          <Button variant="primary" onPress={openSheet} style={styles.signInButton}>
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
          <SportIcon
            sportName={selectedSport?.name ?? 'tennis'}
            size={32}
            color={colors.text}
            style={styles.matchesSectionIcon}
          />
          <Heading level={3} color={colors.text}>
            {t('home.yourMatches')}
          </Heading>
          <Text size="sm" color={colors.textMuted} style={styles.sectionSubtitle}>
            {t('home.onboardingPrompt')}
          </Text>
          <Button variant="primary" onPress={openSheet} style={styles.signInButton}>
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
  ]);

  // No more full-page skeleton. Each section (My Matches, Just for you) owns
  // its own loading state, so the page renders immediately and the relevant
  // section shows its skeleton until its data arrives. Avoids the layout
  // flicker that came from swapping a full-page skeleton in and out.
  // Treat "fetch not yet ready" as a loading state so the carousel renders
  // skeletons (instead of the empty card) while sport/location settle.
  const showJfyLoading = loadingJustForYou || !isNearbyFetchReady;
  const showJfyEmpty = !showJfyLoading && justForYouItems.length === 0;

  const content = (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && isManualRefresh.current}
            onRefresh={() => {
              isManualRefresh.current = true;
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
          /* Single horizontal ScrollView always rendered — only its children
             change between loading / empty / real states. Avoids layout
             shift and preserves horizontal scroll position across transitions. */
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.justForYouScrollContent}
          >
            {showJfyLoading ? (
              [1, 2, 3].map(i => (
                <View key={i} style={styles.jfyCardWrapper}>
                  <SkeletonMatchCard
                    backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                    highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                    style={{
                      backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA',
                      borderColor: colors.border,
                    }}
                  />
                </View>
              ))
            ) : showJfyEmpty ? (
              <View
                style={[
                  styles.jfyEmptyCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons name="location-outline" size={32} color={colors.textMuted} />
                <Text size="sm" color={colors.textMuted} style={styles.jfyEmptyText}>
                  {t('home.nearbyEmpty.title')}
                </Text>
              </View>
            ) : (
              justForYouItems.map(item =>
                item.kind === 'match' ? (
                  <View key={item.key} style={styles.jfyCardWrapper}>
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
                          openMatchDetail(item.data as MatchDetailData);
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <View key={item.key} style={styles.jfyCardWrapper}>
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
                      source="feed"
                      sportId={selectedSport?.id}
                      sportName={selectedSport?.name}
                      defaultMatchType={callerMatchType}
                    />
                  </View>
                )
              )
            )}
          </ScrollView>
        )}
      </ScrollView>

      {/* FAB buttons */}
      <View style={styles.fabContainer}>
        {isOnboarded && (
          <TouchableOpacity
            style={[styles.suggestionsFab, { backgroundColor: secondary[500] }]}
            onPress={() => {
              lightHaptic();
              SheetManager.show('match-suggestions');
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="sparkles" size={24} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
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
  fabContainer: {
    position: 'absolute',
    bottom: spacingPixels[6],
    right: spacingPixels[4],
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  suggestionsFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
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
  // Empty-state card matching the carousel's slot dimensions so the layout
  // doesn't shift when transitioning between loading / empty / data states.
  jfyEmptyCard: {
    width: 320,
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
  },
  jfyEmptyText: {
    textAlign: 'center',
  },
  matchesSection: {
    padding: spacingPixels[5],
    margin: spacingPixels[4],
    marginTop: spacingPixels[5],
    borderRadius: radiusPixels.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  matchesSectionIcon: {
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
    paddingVertical: spacingPixels[5],
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

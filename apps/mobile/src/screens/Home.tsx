import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
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
  Skeleton,
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
import { FeedbackFAB } from '../components/BugReportFAB';
import {
  useProfile,
  useTheme,
  usePlayer,
  useNearbyMatches,
  usePlayerMatches,
  usePlayerSports,
  useRatingScoresForSport,
  useSortedNearbyMatches,
  useFavoriteFacilities,
  useOtherSportsUnreadCount,
  useSports,
  useProfileCompleteness,
} from '@rallia/shared-hooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NearbyMatch, MatchScoringPreferences } from '@rallia/shared-hooks';
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
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import { SportIcon } from '../components/SportIcon';
import { useHomeNavigation, useAppNavigation } from '../navigation/hooks';
import ProfileCompletionBanner from '../features/profile/components/ProfileCompletionBanner';
import { SuggestionsFeedSection } from '../components/SuggestionsFeedSection';
import BillingIssueBanner from '../components/BillingIssueBanner';
import LaunchCountdownBanner from '../components/LaunchCountdownBanner';
import ReferenceRequestsBanner from '../components/ReferenceRequestsBanner';
import { useSubscription } from '../context';

/** Dismissible banner alerting the player to unread notifications in another sport */
const CrossSportBanner: React.FC<{
  sportName: string;
  displayName: string;
  count: number;
  onSwitch: () => void;
  onDismiss: () => void;
  colors: { card: string; text: string; textMuted: string; primary: string; border: string };
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}> = ({ sportName, displayName, count, onSwitch, onDismiss, colors, t }) => (
  <View
    style={[
      crossBannerStyles.container,
      { backgroundColor: colors.card, borderColor: colors.border },
    ]}
  >
    <View style={crossBannerStyles.content}>
      <SportIcon
        sportName={sportName}
        size={20}
        color={colors.primary}
        style={{ marginRight: 8 }}
      />
      <Text size="sm" color={colors.text} style={crossBannerStyles.text} numberOfLines={2}>
        {t('home.crossSportBanner.unreadNotifications', { count, sportName: displayName })}
      </Text>
    </View>
    <View style={crossBannerStyles.actions}>
      <Button variant="primary" size="xs" onPress={onSwitch}>
        {t('home.crossSportBanner.switch')}
      </Button>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  </View>
);

const crossBannerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacingPixels[2],
  },
  text: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
});

/** Banner encouraging users with only one sport to activate their second sport */
const SecondSportBanner: React.FC<{
  sportName: string;
  displayName: string;
  onActivate: () => void;
  onDismiss: () => void;
  fadeAnim: Animated.Value;
  colors: { card: string; text: string; textMuted: string; primary: string; border: string };
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}> = ({ sportName, displayName, onActivate, onDismiss, fadeAnim, colors, t }) => (
  <Animated.View
    style={[
      crossBannerStyles.container,
      { backgroundColor: colors.card, borderColor: colors.border, opacity: fadeAnim },
    ]}
  >
    <View style={crossBannerStyles.content}>
      <SportIcon
        sportName={sportName}
        size={20}
        color={colors.primary}
        style={{ marginRight: 8 }}
      />
      <Text size="sm" color={colors.text} style={crossBannerStyles.text} numberOfLines={2}>
        {t('home.secondSportBanner.message', { sportName: displayName })}
      </Text>
    </View>
    <View style={crossBannerStyles.actions}>
      <Button variant="primary" size="xs" onPress={onActivate}>
        {t('home.secondSportBanner.activate')}
      </Button>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  </Animated.View>
);

// AsyncStorage key for second sport banner cooldown
const SECOND_SPORT_BANNER_COOLDOWN_KEY = '@rallia/second-sport-banner-cooldown';
const SECOND_SPORT_BANNER_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const SECOND_SPORT_BANNER_FADE_MS = 10 * 60 * 1000; // 10 minutes

const Home = () => {
  // Use custom hooks for auth, profile, and overlay context
  const { session, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const { setOnHomeScreen } = useOverlay();
  const { openSheet } = useActionsSheet();
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

  // Default search radius for signed-out users (10km)
  const GUEST_SEARCH_RADIUS_KM = 15;

  // Use player's travel distance if signed in, otherwise use guest default
  const searchRadiusKm = session ? maxTravelDistanceKm : GUEST_SEARCH_RADIUS_KM;

  // Determine if we should show the nearby matches section
  // For dev: always show since we're using hardcoded location
  const showNearbySection = !!location && !!selectedSport;

  // Use TanStack Query hook for fetching nearby matches with infinite scrolling
  // Query refetches automatically when sportId or player gender changes (included in query key)
  const {
    matches: allNearbyMatches,
    isLoading: loadingMatches,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error: matchesError,
  } = useNearbyMatches({
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: searchRadiusKm,
    sportId: selectedSport?.id,
    userGender: player?.gender,
    limit: 20,
    enabled: showNearbySection,
  });

  // Filter out matches where user is creator or participant (these show in "My Matches" section)
  const filteredMatches = useMemo(() => {
    if (!session?.user?.id) return allNearbyMatches;

    return allNearbyMatches.filter(match => {
      // Exclude if user is the creator
      if (match.created_by === session.user.id) return false;

      // Exclude if user is a participant, has requested to join, or is waitlisted
      const isInvolved = match.participants?.some(
        p =>
          p.player_id === session.user.id &&
          p.status != null &&
          ['joined', 'requested', 'waitlisted'].includes(p.status)
      );
      if (isInvolved) return false;

      return true;
    });
  }, [allNearbyMatches, session?.user?.id]);

  // Build scoring preferences for match relevance sorting
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

  // Sort nearby matches by relevance score
  const matches = useSortedNearbyMatches(filteredMatches, scoringPreferences);

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

  const flatListRef = useRef<FlatList>(null);
  const isManualRefresh = useRef(false);
  useScrollToTop(flatListRef);

  // Clear manual refresh flag when refetching completes
  useEffect(() => {
    if (!isRefetching) {
      isManualRefresh.current = false;
    }
  }, [isRefetching]);

  // Log errors from match fetching
  useEffect(() => {
    if (matchesError) {
      Logger.error('Failed to fetch matches', matchesError);
    }
  }, [matchesError]);

  // Notify OverlayContext that we're on Home screen (safe to show permission overlays)
  useEffect(() => {
    setOnHomeScreen(true);
    return () => setOnHomeScreen(false);
  }, [setOnHomeScreen]);

  // Handle end reached for infinite scroll
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render individual match card
  const renderMatchCard = useCallback(
    ({ item }: { item: NearbyMatch }) => (
      <MatchCard
        key={item.id}
        match={item}
        isDark={isDark}
        t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
        locale={locale}
        currentPlayerId={player?.id}
        sportIcon={
          <SportIcon
            sportName={item.sport?.name ?? 'tennis'}
            size={100}
            color={isDark ? neutral[600] : neutral[400]}
          />
        }
        onPress={() => {
          Logger.logUserAction('match_pressed', { matchId: item.id });
          openMatchDetail(item);
        }}
      />
    ),
    [isDark, t, locale, openMatchDetail, player?.id]
  );

  // Render footer with loading indicator
  const renderFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    if (!hasNextPage && isOnboarded) {
      return (
        <SuggestionsFeedSection
          playerId={player?.id}
          sportId={selectedSport?.id}
          sportName={selectedSport?.name}
        />
      );
    }
    return null;
  }, [
    isFetchingNextPage,
    hasNextPage,
    isOnboarded,
    colors.primary,
    isDark,
    player?.id,
    selectedSport?.id,
    selectedSport?.name,
  ]);

  // Render empty state with helpful message about travel distance (signed in) or simple message (signed out)
  const renderEmptyComponent = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconContainer, { backgroundColor: colors.card }]}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
        </View>
        <Text size="lg" weight="semibold" color={colors.text} style={styles.emptyTitle}>
          {t('home.nearbyEmpty.title')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {session
            ? t('home.nearbyEmpty.description', { distance: maxTravelDistanceKm })
            : t('home.nearbyEmpty.guestDescription')}
        </Text>
        {session && (
          <>
            <Text size="sm" color={colors.textMuted} style={styles.emptySuggestion}>
              {t('home.nearbyEmpty.suggestion')}
            </Text>
            <Button
              variant="outline"
              onPress={() => appNavigation.navigate('Settings')}
              style={styles.updateSettingsButton}
              isDark={isDark}
              themeColors={{
                primary: colors.primary,
                primaryForeground: colors.primaryForeground,
                buttonActive: colors.buttonActive,
                buttonInactive: colors.buttonInactive,
                buttonTextActive: colors.buttonTextActive,
                buttonTextInactive: colors.buttonTextInactive,
                text: colors.text,
                textMuted: colors.textMuted,
                border: colors.border,
                background: colors.background,
              }}
            >
              {t('home.nearbyEmpty.updateSettings')}
            </Button>
          </>
        )}
      </View>
    ),
    [colors, t, maxTravelDistanceKm, session, appNavigation, isDark]
  );

  // Render section header with "Soon & Nearby" title, location selector, and "View All" button
  // Render section header with "Soon & Nearby" title and "View All" button
  // Wrapped with CopilotStep for home screen tour
  const renderSectionHeader = useCallback(() => {
    // Get a short label for the home location (full address if available, otherwise postal code)
    const homeLocationLabel = player?.address
      ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
      : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

    return (
      <View style={[styles.sectionHeader]}>
        <View style={styles.sectionTitleRow}>
          <Text size="xl" weight="bold" color={colors.text}>
            {t('home.soonAndNearby')}
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

          {/* Content: horizontal scroll or empty state */}
          {loadingMyMatches ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.myMatchesScrollContent}
            >
              {[1, 2, 3].map(i => (
                <SkeletonMyMatchCard
                  key={i}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ backgroundColor: colors.card }}
                />
              ))}
            </ScrollView>
          ) : myMatches.length === 0 ? (
            <View style={styles.myMatchesEmpty}>
              <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
              <Text size="sm" color={colors.textMuted} style={styles.myMatchesEmptyText}>
                {t('home.myMatchesEmpty.title')}
              </Text>
              <Text size="xs" color={colors.textMuted} style={styles.myMatchesEmptyDescription}>
                {t('home.myMatchesEmpty.description')}
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.myMatchesScrollContent}
            >
              {myMatches.slice(0, 5).map((match: MatchWithDetails) => {
                // Check if current player is invited (has pending invitation)
                const isInvited = !!(
                  player?.id &&
                  match.participants?.some(p => p.player_id === player.id && p.status === 'pending')
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
    t,
    navigation,
    loadingMyMatches,
    myMatches,
    isDark,
    locale,
    openMatchDetail,
    player,
  ]);

  // Render list header (welcome section for logged-in users)
  const renderListHeader = useCallback(() => {
    const headerComponents = [];

    // Launch countdown — shown above everything until LAUNCH_MS
    headerComponents.push(<LaunchCountdownBanner key="launch-countdown" isDark={isDark} />);

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
          <Heading level={3}>{t('home.yourMatches')}</Heading>
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
          <Heading level={3}>{t('home.yourMatches')}</Heading>
          <Text size="sm" color={colors.textMuted} style={styles.sectionSubtitle}>
            {t('home.onboardingPrompt')}
          </Text>
          <Button variant="primary" onPress={openSheet} style={styles.signInButton}>
            {t('home.completeProfile')}
          </Button>
        </View>
      );
    } else {
      // Billing issue banner (shown when subscription payment has failed)
      if (subscriptionStatus === 'billing_issue') {
        headerComponents.push(
          <BillingIssueBanner
            key="billing-issue"
            onManagePress={() => appNavigation.navigate('SubscriptionManagement')}
          />
        );
      }

      // Pending incoming reference requests
      if (pendingReferenceRequestsCount > 0) {
        headerComponents.push(
          <ReferenceRequestsBanner
            key="reference-requests"
            count={pendingReferenceRequestsCount}
            onPress={() => appNavigation.navigate('IncomingReferenceRequests')}
            colors={colors}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }

      // Fully onboarded: show My Matches
      // Cross-sport banners for unread notifications in other sports
      Object.entries(otherSportsUnreadCount).forEach(([sportName, count]) => {
        if (count > 0 && !dismissedBannerSports.has(sportName)) {
          const sport = userSports.find(s => s.name === sportName);
          if (sport) {
            headerComponents.push(
              <CrossSportBanner
                key={`cross-sport-${sportName}`}
                sportName={sportName}
                displayName={sport.display_name.toLowerCase()}
                count={count}
                onSwitch={() => setSelectedSport(sport)}
                onDismiss={() => setDismissedBannerSports(prev => new Set(prev).add(sportName))}
                colors={colors}
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
        headerComponents.push(
          <SecondSportBanner
            key="second-sport-banner"
            sportName={sportToActivate.name}
            displayName={sportToActivate.display_name.toLowerCase()}
            onActivate={handleActivateSecondSport}
            onDismiss={handleDismissSecondSportBanner}
            fadeAnim={secondSportFadeAnim}
            colors={colors}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }

      // Profile completion banner
      if (!profileCompleteness.isComplete && !profileCompleteness.loading) {
        headerComponents.push(
          <ProfileCompletionBanner
            key="profile-completion"
            percentage={profileCompleteness.percentage}
            tier={profileCompleteness.tier}
            nextAction={profileCompleteness.nextAction}
            isComplete={profileCompleteness.isComplete}
            loading={profileCompleteness.loading}
            onAction={handleCompletionBannerAction}
            colors={colors}
            isDark={isDark}
            t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          />
        );
      }

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
  ]);

  // Show loading if auth is loading, or if player/sport data is loading initially
  // Note: locationLoading is ignored when using hardcoded Montreal location for dev

  const isInitialLoading = authLoading || playerLoading || sportLoading;

  // Determine main content based on loading / data state
  let content: React.ReactNode;

  if (isInitialLoading) {
    content = (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          {/* My Matches skeleton */}
          <View style={styles.skeletonSection}>
            <Skeleton
              width={120}
              height={20}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{ marginBottom: 12, marginHorizontal: 16 }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.myMatchesScrollContent}
            >
              {[1, 2, 3].map(i => (
                <SkeletonMyMatchCard
                  key={i}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ backgroundColor: colors.card }}
                />
              ))}
            </ScrollView>
          </View>

          {/* Nearby Matches skeleton */}
          <View style={styles.skeletonSection}>
            <Skeleton
              width={150}
              height={20}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{ marginBottom: 12, marginHorizontal: 16 }}
            />
            {[1, 2, 3].map(i => (
              <SkeletonMatchCard
                key={i}
                backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                style={{
                  backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA',
                  borderColor: colors.border,
                  marginHorizontal: spacingPixels[4],
                  marginBottom: spacingPixels[3],
                }}
              />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  } else if (!showNearbySection) {
    content = (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <FlatList
          ref={flatListRef}
          data={[]}
          renderItem={renderMatchCard}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          automaticallyAdjustContentInsets={false}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={null}
        />
      </SafeAreaView>
    );
  } else {
    content = (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        {loadingMatches ? (
          <View style={styles.loadingContainer}>
            {renderListHeader()}
            <View style={styles.skeletonSection}>
              {[1, 2, 3].map(i => (
                <SkeletonMatchCard
                  key={i}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{
                    backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA',
                    borderColor: colors.border,
                    marginHorizontal: spacingPixels[4],
                    marginBottom: spacingPixels[3],
                  }}
                />
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={matches}
            renderItem={renderMatchCard}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            automaticallyAdjustContentInsets={false}
            ListHeaderComponent={renderListHeader()}
            ListEmptyComponent={renderEmptyComponent()}
            ListFooterComponent={renderFooter()}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching && isManualRefresh.current}
                onRefresh={() => {
                  isManualRefresh.current = true;
                  refetch();
                  if (session?.user?.id) {
                    refetchMyMatches();
                  }
                }}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          />
        )}
        {/* FAB buttons */}
        <View style={styles.fabContainer}>
          {isOnboarded && (
            <TouchableOpacity
              style={[styles.suggestionsFab, { backgroundColor: colors.primary }]}
              onPress={() => {
                lightHaptic();
                SheetManager.show('match-suggestions');
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={24} color="#ffffff" />
            </TouchableOpacity>
          )}
          <FeedbackFAB />
        </View>
      </SafeAreaView>
    );
  }

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
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[2],
  },
  skeletonSection: {
    marginBottom: spacingPixels[6],
  },
  listContent: {
    flexGrow: 1,
    paddingTop: spacingPixels[2],
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
  emptyContainer: {
    padding: spacingPixels[8],
    paddingTop: spacingPixels[10],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptyDescription: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  emptySuggestion: {
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  updateSettingsButton: {
    marginTop: spacingPixels[2],
  },
  footerLoader: {
    padding: spacingPixels[4],
    alignItems: 'center',
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
  myMatchesEmpty: {
    padding: spacingPixels[6],
    marginHorizontal: spacingPixels[4],
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
  myMatchesScrollContent: {
    paddingTop: 10, // Minimal space for corner badges (badge extends 8px above card)
    paddingLeft: spacingPixels[4],
    paddingRight: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[2],
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

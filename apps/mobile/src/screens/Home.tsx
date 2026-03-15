import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Animated,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
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
} from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useTourSequence,
} from '../hooks';
import {
  useOverlay,
  useActionsSheet,
  useSport,
  useMatchDetailSheet,
  useUserHomeLocation,
} from '../context';
import { CopilotStep, WalkthroughableView } from '../context/TourContext';
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
} from '@rallia/shared-hooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NearbyMatch, MatchScoringPreferences } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, radiusPixels, neutral } from '@rallia/design-system';
import { SportIcon } from '../components/SportIcon';
import { useHomeNavigation, useAppNavigation } from '../navigation/hooks';

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
      <TouchableOpacity
        onPress={onSwitch}
        style={[crossBannerStyles.switchButton, { backgroundColor: colors.primary }]}
      >
        <Text size="xs" weight="semibold" color="#ffffff">
          {t('home.crossSportBanner.switch')}
        </Text>
      </TouchableOpacity>
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
  switchButton: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.md,
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
      <TouchableOpacity
        onPress={onActivate}
        style={[crossBannerStyles.switchButton, { backgroundColor: colors.primary }]}
      >
        <Text size="xs" weight="semibold" color="#ffffff">
          {t('home.secondSportBanner.activate')}
        </Text>
      </TouchableOpacity>
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

  // User is fully onboarded only if authenticated AND onboarding is complete
  const isOnboarded = !!session?.user && profile?.onboarding_completed;
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { colors } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigation = useHomeNavigation();
  const appNavigation = useAppNavigation();

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
  const { selectedSport, isLoading: sportLoading, userSports, setSelectedSport } = useSport();

  // Player sport preferences and rating for match relevance scoring
  const { playerSports } = usePlayerSports(session?.user?.id);

  // Cross-sport unread notification counts
  const { otherSportsUnreadCount } = useOtherSportsUnreadCount(
    session?.user?.id,
    userSports,
    selectedSport?.name
  );
  const [dismissedBannerSports, setDismissedBannerSports] = useState<Set<string>>(new Set());

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
  const { favorites } = useFavoriteFacilities(session?.user?.id ?? null);
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

  const [showWelcome, setShowWelcome] = useState(true);
  const welcomeOpacity = useState(new Animated.Value(1))[0];

  // Extract display name from profile
  const displayName = profile?.display_name || null;

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

  // Auto-dismiss welcome message when user logs in
  useEffect(() => {
    if (session?.user && displayName) {
      // Auto-dismiss welcome message after 3 seconds (3000ms)
      const dismissTimer = setTimeout(() => {
        Animated.timing(welcomeOpacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }).start(() => {
          setShowWelcome(false);
        });
      }, 3000);

      return () => clearTimeout(dismissTimer);
    } else {
      // Reset states when user logs out
      setShowWelcome(true);
      welcomeOpacity.setValue(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, displayName]);

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
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <SkeletonMatchCard
          backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
          highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
          style={{ backgroundColor: colors.card, marginHorizontal: 16 }}
        />
      </View>
    );
  }, [isFetchingNextPage, colors.card, isDark]);

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
            <View style={styles.myMatchesLoading}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
              >
                {[1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.myMatchSkeletonCard,
                      { backgroundColor: colors.card, marginRight: 12 },
                    ]}
                  >
                    <Skeleton
                      width={120}
                      height={16}
                      backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                      highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                      style={{ marginBottom: 8 }}
                    />
                    <Skeleton
                      width={80}
                      height={14}
                      backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                      highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                      style={{ marginBottom: 6 }}
                    />
                    <Skeleton
                      width={100}
                      height={12}
                      backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                      highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
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
      // Fully onboarded: show welcome and My Matches
      if (showWelcome) {
        headerComponents.push(
          <Animated.View
            key="welcome"
            style={[
              styles.welcomeSection,
              {
                backgroundColor: colors.headerBackground,
                opacity: welcomeOpacity,
              },
            ]}
          >
            <Text size="lg" weight="bold" color={colors.text} style={styles.welcomeText}>
              {t('home.welcomeBack')}
            </Text>
            <Text size="sm" color={colors.textMuted}>
              {displayName || session.user.email?.split('@')[0] || t('home.user')}
            </Text>
          </Animated.View>
        );
      }

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
    showWelcome,
    showNearbySection,
    colors.card,
    colors.border,
    colors.textMuted,
    colors.headerBackground,
    colors.text,
    t,
    openSheet,
    welcomeOpacity,
    displayName,
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
  ]);

  // Show loading if auth is loading, or if player/sport data is loading initially
  // Note: locationLoading is ignored when using hardcoded Montreal location for dev

  const isInitialLoading = authLoading || playerLoading || sportLoading;

  if (isInitialLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          {/* Welcome skeleton */}
          <View style={styles.skeletonWelcome}>
            <Skeleton
              width={200}
              height={24}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{ marginBottom: 8 }}
            />
            <Skeleton
              width={150}
              height={16}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
            />
          </View>

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
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {[1, 2, 3].map(i => (
                <View
                  key={i}
                  style={[
                    styles.myMatchSkeletonCard,
                    { backgroundColor: colors.card, marginRight: 12 },
                  ]}
                >
                  <Skeleton
                    width={120}
                    height={16}
                    backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                    highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                    style={{ marginBottom: 8 }}
                  />
                  <Skeleton
                    width={80}
                    height={14}
                    backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                    highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                    style={{ marginBottom: 6 }}
                  />
                  <Skeleton
                    width={100}
                    height={12}
                    backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                    highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  />
                </View>
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
                style={{ backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 12 }}
              />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // If location is not available, only show the header (no matches list)
  if (!showNearbySection) {
    return (
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
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {loadingMatches ? (
        <View style={styles.loadingContainer}>
          {/* Skeleton for matches list */}
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
                style={{ backgroundColor: colors.card, marginHorizontal: 16, marginBottom: 12 }}
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
      {/* All overlays are now managed by OverlayProvider in App.tsx */}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[8],
  },
  skeletonWelcome: {
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[6],
  },
  skeletonSection: {
    marginBottom: spacingPixels[6],
  },
  myMatchSkeletonCard: {
    width: 160,
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
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
  welcomeSection: {
    padding: spacingPixels[5],
    margin: spacingPixels[4],
    marginTop: spacingPixels[5],
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
  },
  welcomeText: {
    marginBottom: spacingPixels[2],
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
});

export default Home;

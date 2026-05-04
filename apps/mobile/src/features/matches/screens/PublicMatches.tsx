/**
 * PublicMatches Screen
 * Displays public matches with search, filtering, and infinite scroll.
 */

import React, { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Text, SkeletonMatchCard } from '@rallia/shared-components';
import {
  useTheme,
  usePlayer,
  usePublicMatches,
  usePublicMatchFilters,
  usePlayerSports,
  useRatingScoresForSport,
  useSortedNearbyMatches,
  useFavoriteFacilities,
  useMatchSuggestions,
  useUnifiedMatchFeed,
  type MatchScoringPreferences,
  type UnifiedFeedItem,
} from '@rallia/shared-hooks';
import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useSuggestionInviteHandler,
} from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { useMatchDetailSheet, useSport, useUserHomeLocation } from '../../../context';
import type { MatchDetailData } from '../../../context/MatchDetailSheetContext';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels } from '@rallia/design-system';
import { SearchBar, MatchFiltersBar } from '../components';
import { FeedItemCard } from '../components/FeedItemCard';

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasFilters: boolean;
  textMutedColor: string;
  t: (key: TranslationKey) => string;
}

function EmptyState({ hasFilters, textMutedColor, t }: EmptyStateProps) {
  return (
    <View style={styles.emptyWrapper}>
      <View style={styles.inlineEmpty}>
        <Ionicons
          name={hasFilters ? 'filter-outline' : 'search-outline'}
          size={20}
          color={textMutedColor}
        />
        <Text size="sm" color={textMutedColor} style={styles.inlineEmptyText}>
          {hasFilters ? t('publicMatches.empty.title') : t('publicMatches.empty.noFilters.title')}
        </Text>
      </View>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PublicMatches() {
  const { session } = useAuth();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
  const navigation = useNavigation();

  // Keep the header title in sync with the loaded translations.
  // On Android, the navigator can mount before i18next is ready, so the
  // options-function snapshot may contain the raw key. setOptions is reactive
  // and will patch the header the moment t() returns the real string.
  useEffect(() => {
    navigation.setOptions({ headerTitle: t('screens.publicMatches') });
  }, [navigation, t]);
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const isDark = theme === 'dark';

  // Get user location and preferences
  const { location, locationMode, setLocationMode, hasHomeLocation, hasBothLocationOptions } =
    useEffectiveLocation();
  const { homeLocation } = useUserHomeLocation();
  const { player, maxTravelDistanceKm, loading: playerLoading } = usePlayer();
  const { selectedSport, isLoading: sportLoading } = useSport();

  // Get a short label for the home location (full address if available, otherwise postal code)
  const homeLocationLabel = player?.address
    ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
    : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

  // Filter state - default is no distance filter (shows all location types)
  const {
    filters,
    debouncedSearchQuery,
    hasActiveFilters,
    setSearchQuery,
    setFormat,
    setMatchType,
    setDateRange,
    setTimeOfDay,
    setGender,
    setCost,
    setJoinMode,
    setDistance,
    setDuration,
    setMatchTier,
    setSpecificDate,
    setSpotsAvailable,
    setFavoritesOnly,
    setSpecificTime,
    setReputation,
    setRating,
    resetFilters,
    clearSearch,
  } = usePublicMatchFilters();

  // Fetch favorite player IDs for favorites filter
  const [favoritePlayerIds, setFavoritePlayerIds] = useState<string[]>([]);
  useEffect(() => {
    if (!session?.user?.id) {
      setFavoritePlayerIds([]);
      return;
    }
    const fetchFavorites = async () => {
      const { data } = await supabase
        .from('player_favorite')
        .select('favorite_player_id')
        .eq('player_id', session.user.id);
      if (data) {
        setFavoritePlayerIds(data.map(row => row.favorite_player_id));
      }
    };
    fetchFavorites();
  }, [session?.user?.id]);

  // Determine if we should enable the query
  const showMatches = !!location && !!selectedSport;

  // Fetch public matches - use distance from filters and user's gender for eligibility
  const isManualRefresh = useRef(false);
  const {
    matches,
    isLoading,
    isFetching,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = usePublicMatches({
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: filters.distance,
    sportId: selectedSport?.id,
    filters,
    debouncedSearchQuery,
    userGender: player?.gender,
    enabled: showMatches,
  });

  // Filter out matches where user is creator or participant (show only joinable matches)
  // Also apply favorites filter client-side
  const filteredMatches = useMemo(() => {
    const userId = session?.user?.id;

    return matches.filter(match => {
      // Exclude if user is the creator
      if (userId && match.created_by === userId) return false;

      // Exclude if user is a participant
      if (userId) {
        const isParticipant = match.participants?.some(
          p => p.player_id === userId && p.status === 'joined'
        );
        if (isParticipant) return false;
      }

      // Favorites filter: only show matches from favorited hosts
      if (filters.favoritesOnly && favoritePlayerIds.length > 0) {
        if (!favoritePlayerIds.includes(match.created_by)) return false;
      }
      // If favoritesOnly but no favorites, show nothing
      if (filters.favoritesOnly && favoritePlayerIds.length === 0) return false;

      return true;
    });
  }, [matches, session, filters.favoritesOnly, favoritePlayerIds]);

  // Player sport preferences and rating for match relevance scoring (tiebreaker)
  const { playerSports } = usePlayerSports(session?.user?.id);
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

  // Build scoring preferences for relevance tiebreaking
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

  // Sort: chronological primary, relevance score as tiebreaker for same date+time
  const sortedMatches = useSortedNearbyMatches(filteredMatches, scoringPreferences);

  // Fetch matchup suggestions to fill the feed up to ≥30 items.
  const {
    suggestions,
    isLoading: loadingSuggestions,
    refetch: refetchSuggestions,
  } = useMatchSuggestions({
    playerId: player?.id,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: location?.latitude,
    longitude: location?.longitude,
    limit: 30,
    enabled: showMatches,
  });

  // Build suggestion-applicable filters (stable ref via useMemo).
  // Uses debouncedSearchQuery to avoid re-filtering on every keystroke.
  const suggestionFilters = useMemo(
    () => ({
      searchQuery: debouncedSearchQuery,
      matchType: filters.matchType,
      duration: filters.duration,
      format: filters.format,
      dateRange: filters.dateRange,
      timeOfDay: filters.timeOfDay,
      specificDate: filters.specificDate,
      specificTime: filters.specificTime,
    }),
    [
      debouncedSearchQuery,
      filters.matchType,
      filters.duration,
      filters.format,
      filters.dateRange,
      filters.timeOfDay,
      filters.specificDate,
      filters.specificTime,
    ]
  );

  // Build the unified chronological feed (matches + suggestions interleaved).
  const feed = useUnifiedMatchFeed({
    matches: sortedMatches,
    suggestions,
    filters: suggestionFilters,
  });

  // Suggestion invite plumbing (shared with Home).
  const {
    cardLabels: suggestionLabels,
    handleSendInvite,
    getInviteState,
  } = useSuggestionInviteHandler(selectedSport?.id);

  // Auto-paginate matches up to 30 before relying on suggestions to fill the feed.
  useEffect(() => {
    if (
      showMatches &&
      !isLoading &&
      !isFetchingNextPage &&
      hasNextPage &&
      sortedMatches.length < 30
    ) {
      fetchNextPage();
    }
  }, [
    showMatches,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    sortedMatches.length,
    fetchNextPage,
  ]);

  // Handle infinite scroll
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render feed item (match or suggestion)
  const renderFeedItem = useCallback(
    ({ item }: { item: UnifiedFeedItem }) => (
      <FeedItemCard
        item={item}
        isDark={isDark}
        locale={locale}
        t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
        currentPlayerId={player?.id}
        themeColors={colors}
        suggestionLabels={suggestionLabels}
        getInviteState={getInviteState}
        onMatchPress={match => {
          Logger.logUserAction('public_match_pressed', { matchId: match.id });
          openMatchDetail(match as MatchDetailData);
        }}
        onSendInvite={handleSendInvite}
      />
    ),
    [
      isDark,
      t,
      locale,
      openMatchDetail,
      player?.id,
      colors,
      suggestionLabels,
      getInviteState,
      handleSendInvite,
    ]
  );

  // Check if we're loading due to filter/search changes (not initial load or pagination)
  const isSearching = isFetching && !isLoading && !isRefetching && !isFetchingNextPage;

  // Render empty state — only shows when both matches AND suggestions are empty.
  const renderEmptyComponent = useCallback(() => {
    if (isLoading || isSearching) return null;
    return (
      <EmptyState
        hasFilters={hasActiveFilters || debouncedSearchQuery.length > 0}
        textMutedColor={colors.textMuted}
        t={t as (key: TranslationKey) => string}
      />
    );
  }, [isLoading, isSearching, hasActiveFilters, debouncedSearchQuery, colors.textMuted, t]);

  // Render footer — pagination spinner or suggestion-loading spinner.
  const renderFooter = useCallback(() => {
    if (isFetchingNextPage || (loadingSuggestions && feed.length < 30)) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    return null;
  }, [isFetchingNextPage, loadingSuggestions, feed.length, colors.primary]);

  // Loading state for initial data
  const isInitialLoading = playerLoading || sportLoading;

  if (isInitialLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // No location/sport selected state
  if (!showMatches) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
          <Text size="base" color={colors.textMuted} style={styles.noLocationText}>
            {t('home.nearbyEmpty.title')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Fixed Header - Search and Filters always visible */}
      <View style={styles.headerContainer}>
        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <SearchBar
              value={filters.searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('publicMatches.searchPlaceholder')}
              isLoading={isFetching && debouncedSearchQuery !== filters.searchQuery}
              onClear={clearSearch}
            />
          </View>
        </View>

        {/* Filter Chips with Location Selector */}
        <MatchFiltersBar
          format={filters.format}
          matchType={filters.matchType}
          dateRange={filters.dateRange}
          timeOfDay={filters.timeOfDay}
          gender={filters.gender}
          cost={filters.cost}
          joinMode={filters.joinMode}
          distance={filters.distance}
          duration={filters.duration}
          matchTier={filters.matchTier}
          specificDate={filters.specificDate}
          spotsAvailable={filters.spotsAvailable}
          favoritesOnly={filters.favoritesOnly}
          specificTime={filters.specificTime}
          reputation={filters.reputation}
          rating={filters.rating}
          onFormatChange={setFormat}
          onMatchTypeChange={setMatchType}
          onDateRangeChange={setDateRange}
          onTimeOfDayChange={setTimeOfDay}
          onGenderChange={setGender}
          onCostChange={setCost}
          onJoinModeChange={setJoinMode}
          onDistanceChange={setDistance}
          onDurationChange={setDuration}
          onMatchTierChange={setMatchTier}
          onSpecificDateChange={setSpecificDate}
          onSpotsAvailableChange={setSpotsAvailable}
          onFavoritesOnlyChange={setFavoritesOnly}
          onSpecificTimeChange={setSpecificTime}
          onReputationChange={setReputation}
          onRatingChange={setRating}
          ratingOptions={ratingScores}
          isAuthenticated={!!session?.user}
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          showLocationSelector={hasBothLocationOptions}
          locationMode={locationMode}
          onLocationModeChange={setLocationMode}
          hasHomeLocation={hasHomeLocation}
          homeLocationLabel={homeLocationLabel}
        />
      </View>

      {/* Match List */}
      {isLoading || loadingSuggestions ? (
        <View style={styles.listLoadingContainer}>
          {[1, 2, 3, 4].map(i => (
            <SkeletonMatchCard
              key={i}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{
                backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA',
                borderColor: colors.border,
              }}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={feed}
          renderItem={renderFeedItem}
          keyExtractor={item => item.key}
          ListHeaderComponent={null}
          ListEmptyComponent={renderEmptyComponent}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={[styles.listContent, feed.length === 0 && styles.emptyListContent]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && isManualRefresh.current}
              onRefresh={() => {
                isManualRefresh.current = true;
                Promise.all([refetch(), refetchSuggestions()]).finally(() => {
                  isManualRefresh.current = false;
                });
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[4],
  },
  listLoadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[3],
  },
  noLocationText: {
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  headerContainer: {
    paddingTop: spacingPixels[5],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  searchContainer: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[5],
  },
  emptyListContent: {
    flexGrow: 0,
  },
  emptyWrapper: {
    paddingTop: spacingPixels[2],
  },
  inlineEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  inlineEmptyText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  emptyContainer: {
    padding: spacingPixels[8],
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
    paddingHorizontal: spacingPixels[4],
  },
  footerLoader: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
});

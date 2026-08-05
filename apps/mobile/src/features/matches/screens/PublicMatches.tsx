/**
 * PublicMatches Screen
 * Displays public matches with search, filtering, and infinite scroll.
 */

import React, { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { Button, MatchCard, Text } from '@rallia/shared-components';
import {
  useTheme,
  usePlayer,
  usePublicMatches,
  usePublicMatchFilters,
  usePlayerSports,
  useRatingScoresForSport,
  useSortedNearbyMatches,
  useFavoriteFacilities,
  type MatchScoringPreferences,
  type PublicMatch,
} from '@rallia/shared-hooks';
import { getUpcomingDateSection, type UpcomingDateSection } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import { Logger, supabase } from '@rallia/shared-services';
import { neutral, spacingPixels } from '@rallia/design-system';

import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useImpressionTracker,
} from '#/hooks';
import * as Analytics from '#/services/analytics';
import { useActionsSheet, useMatchDetailSheet, useSport, useUserHomeLocation } from '#/context';
import type { HomeStackParamList } from '#/navigation/types';
import { SportIcon } from '#/components/SportIcon';
import { SearchBar, MatchFiltersBar, MatchCardSkeleton } from '#/features/matches/components';

// A card counts as shown once it's ≥50% visible for 500ms. Module constant so
// the FlatList viewability config never changes identity (a runtime crash).
const FEED_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50, minimumViewTime: 500 };

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasFilters: boolean;
  textMutedColor: string;
  t: (key: TranslationKey) => string;
  onCreatePress: () => void;
}

function EmptyState({ hasFilters, textMutedColor, t, onCreatePress }: EmptyStateProps) {
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
      <Text size="sm" color={textMutedColor} style={styles.emptyDescription}>
        {hasFilters
          ? t('publicMatches.empty.description')
          : t('publicMatches.empty.noFilters.description')}
      </Text>
      <View style={styles.emptyCtaRow}>
        <Button variant="primary" size="sm" onPress={onCreatePress}>
          {t('matches.createMatch')}
        </Button>
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
  const { openSheetForMatchCreation } = useActionsSheet();
  const route = useRoute<RouteProp<HomeStackParamList, 'PublicMatches'>>();
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
    activeFilterCount,
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
    totalCount,
    isLoading,
    isFetching,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    pageCount,
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

  // Translate section labels once per locale change, not per match.
  const upcomingSectionLabels = useMemo<Record<UpcomingDateSection, string>>(
    () => ({
      today: t('playerMatches.time.today'),
      tomorrow: t('playerMatches.time.tomorrow'),
      thisWeek: t('playerMatches.time.thisWeek'),
      nextWeek: t('playerMatches.time.nextWeek'),
      later: t('playerMatches.time.later'),
    }),
    [t]
  );

  // Build the flat feed: real matches only, grouped by upcoming-date section.
  type PublicFeedRow =
    | { kind: 'item'; key: string; rank: number; match: PublicMatch }
    | { kind: 'section-header'; key: string; title: string };
  const feed = useMemo<PublicFeedRow[]>(() => {
    const rows: PublicFeedRow[] = [];
    let currentSection = '';
    // 1-indexed position among cards only — section headers excluded.
    let rank = 0;

    sortedMatches.forEach(m => {
      const section = getUpcomingDateSection(m.match_date);
      const label = upcomingSectionLabels[section];
      if (label !== currentSection) {
        currentSection = label;
        rows.push({ kind: 'section-header', key: `section:${section}`, title: label });
      }
      rank += 1;
      rows.push({ kind: 'item', key: `match:${m.id}`, rank, match: m });
    });

    return rows;
  }, [sortedMatches, upcomingSectionLabels]);

  // Pagination is driven by FlatList `onEndReached` so the first page renders
  // immediately and additional pages only fetch as the user scrolls.

  // Handle infinite scroll
  const pagesFetchedRef = useRef(0);
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      pagesFetchedRef.current += 1;
      Analytics.feedPageFetched({ screen: 'public_matches', page_number: pageCount + 1 });
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pageCount]);

  // search_performed: once per settled query value, with the server-side total.
  // When debouncedSearchQuery changes, the query key changes in the same
  // render, so isFetching is already true by the time this effect runs.
  const lastSearchFired = useRef('');
  useEffect(() => {
    if (debouncedSearchQuery.length === 0) {
      lastSearchFired.current = '';
      return;
    }
    if (isLoading || isFetching) return;
    if (lastSearchFired.current === debouncedSearchQuery) return;
    lastSearchFired.current = debouncedSearchQuery;
    Analytics.searchPerformed({
      query: debouncedSearchQuery,
      result_count: totalCount ?? 0,
      context: 'public_matches',
    });
  }, [debouncedSearchQuery, isLoading, isFetching, totalCount]);

  // public_matches_feed_loaded: once per load signature (sport / location /
  // filters / search / manual refresh), after the matches settle. refreshNonce
  // must be state — a ref wouldn't re-run the effect when a refresh returns
  // identical data.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const loadSignature = useMemo(() => {
    const { searchQuery, ...nonSearchFilters } = filters;
    void searchQuery;
    return [
      selectedSport?.id ?? '',
      locationMode,
      debouncedSearchQuery,
      JSON.stringify(nonSearchFilters),
      String(refreshNonce),
    ].join('|');
  }, [filters, selectedSport?.id, locationMode, debouncedSearchQuery, refreshNonce]);

  const lastLoadedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!showMatches || isLoading || isFetching) return;
    if (lastLoadedSignature.current === loadSignature) return;
    // Small grace timer debounces rapid settles (e.g. a refresh returning
    // identical data) before firing the one analytics row.
    const timer = setTimeout(() => {
      lastLoadedSignature.current = loadSignature;
      Analytics.publicMatchesFeedLoaded({
        real_match_count: sortedMatches.length,
        suggestion_count: 0,
        total_match_count: totalCount,
        has_next_page: hasNextPage,
        active_filter_count: activeFilterCount,
        has_search_query: debouncedSearchQuery.length > 0,
        padded_with_suggestions: false,
      });
      if (sortedMatches.length === 0) {
        Analytics.feedEmptyStateShown({
          screen: 'public_matches',
          has_active_filters: hasActiveFilters,
          has_search: debouncedSearchQuery.length > 0,
        });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [
    loadSignature,
    showMatches,
    isLoading,
    isFetching,
    sortedMatches.length,
    totalCount,
    hasNextPage,
    activeFilterCount,
    hasActiveFilters,
    debouncedSearchQuery,
  ]);

  // Wrap a filter setter so every chip interaction emits filter_applied.
  const withFilterTracking = useCallback(
    <V,>(filterType: string, setter: (v: V) => void, serialize?: (v: V) => string) =>
      (value: V) => {
        Analytics.filterApplied({
          filter_type: filterType,
          value: serialize ? serialize(value) : String(value),
          screen: 'public_matches',
        });
        setter(value);
      },
    []
  );

  // Viewability-gated impressions: a card counts as shown once it's ≥50%
  // visible for 500ms, at most once per focus session. Stable row keys make
  // the dedup survive background-refetch remounts.
  const { track } = useImpressionTracker();
  const maxIndexViewedRef = useRef(0);
  const impressionCtx = useRef<{ sportId?: string; sportName?: string }>({});
  useEffect(() => {
    impressionCtx.current = { sportId: selectedSport?.id, sportName: selectedSport?.name };
  }, [selectedSport?.id, selectedSport?.name]);

  // Must keep a stable identity for the lifetime of the FlatList — changing
  // it mid-flight is a runtime crash. Every captured value is itself stable.
  const onViewableItemsChanged = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: Array<{ item: PublicFeedRow; index: number | null; isViewable: boolean }>;
    }) => {
      const { sportId, sportName } = impressionCtx.current;
      for (const token of viewableItems) {
        if (!token.isViewable || token.item.kind !== 'item') continue;
        if (token.index != null && token.index > maxIndexViewedRef.current) {
          maxIndexViewedRef.current = token.index;
        }
        const row = token.item;
        const m = row.match;
        track(row.key, () =>
          Analytics.matchCardShown({
            match_id: m.id,
            sport_id: m.sport?.id ?? sportId ?? 'unknown',
            sport_name: m.sport?.name ?? sportName ?? 'unknown',
            is_auto_generated: m.is_auto_generated ?? false,
            surface: 'public_matches_feed',
            rank: row.rank,
          })
        );
      }
    },
    [track]
  );

  // Scroll-depth summary per focus session (pushing a profile blurs the
  // screen, so one visit can emit several rows).
  const feedLenRef = useRef(0);
  useEffect(() => {
    feedLenRef.current = feed.length;
  }, [feed.length]);
  useFocusEffect(
    useCallback(() => {
      const focusedAt = Date.now();
      return () => {
        Analytics.publicMatchesBrowsed({
          max_index_viewed: maxIndexViewedRef.current,
          items_total: feedLenRef.current,
          pages_fetched: pagesFetchedRef.current,
          duration_seconds: Math.round((Date.now() - focusedAt) / 1000),
        });
        maxIndexViewedRef.current = 0;
        pagesFetchedRef.current = 0;
      };
    }, [])
  );

  // Render feed row — a match card or a date section header.
  const renderFeedItem = useCallback(
    ({ item }: { item: PublicFeedRow }) => {
      if (item.kind === 'section-header') {
        return (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <Text size="sm" weight="semibold" color={colors.textMuted}>
              {item.title}
            </Text>
          </View>
        );
      }
      const match = item.match;
      return (
        <MatchCard
          match={match}
          isDark={isDark}
          t={t}
          locale={locale}
          currentPlayerId={player?.id}
          sportIcon={
            <SportIcon
              sportName={match.sport?.name ?? 'tennis'}
              size={100}
              color={isDark ? neutral[600] : neutral[400]}
            />
          }
          onPress={() => {
            Logger.logUserAction('public_match_pressed', { matchId: match.id });
            openMatchDetail(match, { source: 'public_matches_feed' });
          }}
        />
      );
    },
    [isDark, t, locale, openMatchDetail, player?.id, colors]
  );

  // Check if we're loading due to filter/search changes (not initial load or pagination)
  const isSearching = isFetching && !isLoading && !isRefetching && !isFetchingNextPage;

  // Recovery context from a match_cancelled notification tap: show a banner and
  // prefilter to the cancelled game's date (if still upcoming) so alternatives
  // for the freed-up slot surface first.
  const [cancelledContext, setCancelledContext] = useState<
    NonNullable<HomeStackParamList['PublicMatches']>['cancelledContext'] | null
  >(null);
  useEffect(() => {
    const ctx = route.params?.cancelledContext;
    if (!ctx) return;
    setCancelledContext(ctx);
    const todayIso = new Date().toISOString().slice(0, 10);
    if (ctx.matchDate && ctx.matchDate >= todayIso) {
      setSpecificDate(ctx.matchDate);
    }
    // Consume the param so re-focusing the screen doesn't replay the banner.
    navigation.setParams({ cancelledContext: undefined } as never);
  }, [route.params?.cancelledContext, navigation, setSpecificDate]);

  // "Create your own game" CTA — shared by the empty state and the end-of-list footer.
  const handleCreateGamePress = useCallback(
    (placement: 'empty_state' | 'feed_footer') => {
      Analytics.createGameCtaPressed({
        placement,
        has_active_filters: hasActiveFilters || debouncedSearchQuery.length > 0,
      });
      openSheetForMatchCreation(placement === 'feed_footer' ? 'feed_footer' : 'empty_feed');
    },
    [hasActiveFilters, debouncedSearchQuery, openSheetForMatchCreation]
  );

  // Render empty state — shows once matches have settled and there are none.
  const renderEmptyComponent = useCallback(() => {
    if (isLoading || isSearching) return null;
    return (
      <EmptyState
        hasFilters={hasActiveFilters || debouncedSearchQuery.length > 0}
        textMutedColor={colors.textMuted}
        t={t}
        onCreatePress={() => handleCreateGamePress('empty_state')}
      />
    );
  }, [
    isLoading,
    isSearching,
    hasActiveFilters,
    debouncedSearchQuery,
    colors.textMuted,
    t,
    handleCreateGamePress,
  ]);

  // Render footer — pagination spinner, or a create-your-own prompt at the end of the list.
  const renderFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    if (!hasNextPage && sortedMatches.length > 0) {
      return (
        <View style={styles.endOfListCta}>
          <Text size="sm" color={colors.textMuted} style={styles.inlineEmptyText}>
            {t('publicMatches.endOfList.title')}
          </Text>
          <Button variant="outline" size="sm" onPress={() => handleCreateGamePress('feed_footer')}>
            {t('matches.createMatch')}
          </Button>
        </View>
      );
    }
    return null;
  }, [
    isFetchingNextPage,
    hasNextPage,
    sortedMatches.length,
    colors.primary,
    colors.textMuted,
    t,
    handleCreateGamePress,
  ]);

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
      {/* Recovery banner after a cancelled-game notification tap */}
      {cancelledContext && (
        <View
          style={[
            styles.cancelledBanner,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />
          <View style={styles.cancelledBannerTextWrap}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t('publicMatches.cancelledBanner.title')}
            </Text>
            <Text size="xs" color={colors.textMuted}>
              {t('publicMatches.cancelledBanner.description')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setCancelledContext(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

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
          onFormatChange={withFilterTracking('format', setFormat)}
          onMatchTypeChange={withFilterTracking('match_type', setMatchType)}
          onDateRangeChange={withFilterTracking('date_range', setDateRange)}
          onTimeOfDayChange={withFilterTracking('time_of_day', setTimeOfDay)}
          onGenderChange={withFilterTracking('gender', setGender)}
          onCostChange={withFilterTracking('cost', setCost)}
          onJoinModeChange={withFilterTracking('join_mode', setJoinMode)}
          onDistanceChange={withFilterTracking('distance', setDistance)}
          onDurationChange={withFilterTracking('duration', setDuration)}
          onMatchTierChange={withFilterTracking('match_tier', setMatchTier)}
          onSpecificDateChange={withFilterTracking('specific_date', setSpecificDate, v =>
            v == null ? 'none' : String(v)
          )}
          onSpotsAvailableChange={withFilterTracking('spots_available', setSpotsAvailable)}
          onFavoritesOnlyChange={withFilterTracking('favorites_only', setFavoritesOnly)}
          onSpecificTimeChange={withFilterTracking('specific_time', setSpecificTime, v =>
            v == null ? 'none' : String(v)
          )}
          onReputationChange={withFilterTracking('reputation', setReputation)}
          onRatingChange={withFilterTracking('rating', setRating, v =>
            v.length ? v.join(',') : 'none'
          )}
          ratingOptions={ratingScores}
          isAuthenticated={!!session?.user}
          onReset={() => {
            Analytics.filterApplied({
              filter_type: 'reset',
              value: 'all',
              screen: 'public_matches',
            });
            resetFilters();
          }}
          hasActiveFilters={hasActiveFilters}
          showLocationSelector={hasBothLocationOptions}
          locationMode={locationMode}
          onLocationModeChange={setLocationMode}
          hasHomeLocation={hasHomeLocation}
          homeLocationLabel={homeLocationLabel}
        />
      </View>

      {/* Match List */}
      {isLoading ? (
        <View style={styles.listLoadingContainer}>
          {[1, 2, 3, 4].map(i => (
            <MatchCardSkeleton key={i} />
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
          viewabilityConfig={FEED_VIEWABILITY_CONFIG}
          onViewableItemsChanged={onViewableItemsChanged}
          contentContainerStyle={[styles.listContent, feed.length === 0 && styles.emptyListContent]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && isManualRefresh.current}
              onRefresh={() => {
                isManualRefresh.current = true;
                Analytics.feedRefreshed({ screen: 'public_matches' });
                setRefreshNonce(n => n + 1);
                refetch().finally(() => {
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
  emptyCtaRow: {
    alignItems: 'center',
    paddingTop: spacingPixels[4],
  },
  endOfListCta: {
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[6],
  },
  cancelledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
    padding: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelledBannerTextWrap: {
    flex: 1,
    gap: 2,
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
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
});

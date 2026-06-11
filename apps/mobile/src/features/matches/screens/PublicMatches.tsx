/**
 * PublicMatches Screen
 * Displays public matches with search, filtering, and infinite scroll.
 */

import React, { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Text } from '@rallia/shared-components';
import {
  useTheme,
  usePlayer,
  usePublicMatches,
  usePublicMatchFilters,
  usePlayerSports,
  useRatingScoresForSport,
  useSortedNearbyMatches,
  useFavoriteFacilities,
  useTopSuggestions,
  doesSuggestionPassFilters,
  type MatchScoringPreferences,
  type UnifiedFeedItem,
} from '@rallia/shared-hooks';
import { getUpcomingDateSection, type UpcomingDateSection } from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';
import { Logger, supabase } from '@rallia/shared-services';
import { spacingPixels } from '@rallia/design-system';

import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useSuggestionInviteHandler,
  useImpressionTracker,
} from '#/hooks';
import * as Analytics from '#/services/analytics';
import { useMatchDetailSheet, useSport, useUserHomeLocation } from '#/context';
import type { MatchDetailData } from '#/context/MatchDetailSheetContext';
import { SearchBar, MatchFiltersBar, MatchCardSkeleton } from '#/features/matches/components';
import { FeedItemCard } from '#/features/matches/components/FeedItemCard';

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

  // Fetch a flat top-N list of opponent-deduped, score-sorted suggestions.
  // Only used to pad the feed once matches genuinely run out — gate the fetch
  // on `!hasNextPage && sortedMatches.length < 30` so the suggestion RPC
  // doesn't fire on every screen open (it competes with the public-matches
  // RPC for the same Postgres pool and is rarely consumed for users with
  // enough nearby matches). `isLoading` is included so we don't kick off the
  // RPC before the first page of matches has even resolved.
  const suggestionsNeeded = showMatches && !isLoading && !hasNextPage && sortedMatches.length < 30;
  const {
    suggestions: rawSuggestions,
    isLoading: loadingSuggestions,
    refetch: refetchSuggestions,
  } = useTopSuggestions({
    playerId: player?.id,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxItems: 30,
    enabled: suggestionsNeeded,
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

  // Apply user-selected filters to suggestions (matches are already filtered server-side).
  const filteredSuggestions = useMemo(() => {
    const nowMs = Date.now();
    return rawSuggestions.filter(s => doesSuggestionPassFilters(s, suggestionFilters, nowMs));
  }, [rawSuggestions, suggestionFilters]);

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

  // Build the flat feed: matches first (chronological with score tiebreak),
  // then a single light "Suggestions for you" divider, then up-to-N suggestions
  // padding to a minimum of 30 total — but only once matches finish paginating.
  type PublicFeedRow =
    | { kind: 'item'; key: string; rank: number; data: UnifiedFeedItem }
    | { kind: 'section-header'; key: string; title: string }
    | { kind: 'frontier'; key: string };
  const feed = useMemo<PublicFeedRow[]>(() => {
    const matchItems: PublicFeedRow[] = [];
    let currentSection = '';
    // 1-indexed position among cards only — headers/frontier excluded.
    let rank = 0;

    sortedMatches.forEach(m => {
      const section = getUpcomingDateSection(m.match_date);
      const label = upcomingSectionLabels[section];
      if (label !== currentSection) {
        currentSection = label;
        matchItems.push({ kind: 'section-header', key: `section:${section}`, title: label });
      }
      rank += 1;
      matchItems.push({
        kind: 'item',
        key: `match:${m.id}`,
        rank,
        data: { kind: 'match', key: `match:${m.id}`, sortTime: 0, data: m } as UnifiedFeedItem,
      });
    });

    // Suggestions only kick in when matches genuinely exhausted (no more pages)
    // and the feed has fewer than 30 real matches.
    const padCount = Math.max(0, 30 - sortedMatches.length);
    if (padCount === 0 || hasNextPage) return matchItems;

    const suggestionItems: PublicFeedRow[] = filteredSuggestions.slice(0, padCount).map((s, i) => ({
      kind: 'item' as const,
      key: `suggestion:${s.opponentId}:${s.slot.datetime.getTime()}`,
      rank: rank + i + 1,
      data: {
        kind: 'suggestion',
        key: `suggestion:${s.opponentId}:${s.slot.datetime.getTime()}`,
        sortTime: 0,
        data: s,
      },
    }));

    if (suggestionItems.length === 0) return matchItems;

    const frontier: PublicFeedRow = { kind: 'frontier', key: 'frontier' };
    return [...matchItems, frontier, ...suggestionItems];
  }, [sortedMatches, filteredSuggestions, hasNextPage, upcomingSectionLabels]);

  // Suggestion invite plumbing (shared with Home).
  const {
    cardLabels: suggestionLabels,
    handleSendInvite,
    getInviteState,
    callerMatchType,
  } = useSuggestionInviteHandler({ sportId: selectedSport?.id, source: 'public_matches_feed' });

  // Pagination is driven by FlatList `onEndReached` so the first page renders
  // immediately and additional pages only fetch as the user scrolls. Padding
  // suggestions surface when matches run out before the user scrolls past
  // them (see the `padCount`/`hasNextPage` branch in the `feed` memo above).

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
  // filters / search / manual refresh), after matches AND suggestion padding
  // settle. refreshNonce must be state — a ref wouldn't re-run the effect
  // when a refresh returns identical data.
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
    if (!showMatches || isLoading || isFetching || loadingSuggestions) return;
    if (lastLoadedSignature.current === loadSignature) return;
    // Matches settle one render before useTopSuggestions flips to enabled —
    // the grace timer absorbs that gap (cleanup cancels if suggestions start
    // loading inside the window, and we re-arm when they finish).
    const timer = setTimeout(() => {
      lastLoadedSignature.current = loadSignature;
      const suggestionCount = feed.filter(
        r => r.kind === 'item' && r.data.kind === 'suggestion'
      ).length;
      Analytics.publicMatchesFeedLoaded({
        real_match_count: sortedMatches.length,
        suggestion_count: suggestionCount,
        total_match_count: totalCount,
        has_next_page: hasNextPage,
        active_filter_count: activeFilterCount,
        has_search_query: debouncedSearchQuery.length > 0,
        padded_with_suggestions: suggestionCount > 0,
      });
      if (sortedMatches.length + suggestionCount === 0) {
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
    loadingSuggestions,
    feed,
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

  // Both viewability props must keep a stable identity for the lifetime of
  // the FlatList — changing them mid-flight is a runtime crash, so neither
  // can be a useCallback with deps.
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 500,
  }).current;
  const onViewableItemsChanged = useRef(
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
        if (row.data.kind === 'suggestion') {
          const s = row.data.data;
          track(row.key, () =>
            Analytics.matchSuggestionShown(
              Analytics.buildSuggestionEventProps(s, 'public_matches_feed', sportId, sportName)
            )
          );
        } else {
          const m = row.data.data;
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
      }
    }
  ).current;

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

  // Render feed row — either a match/suggestion card or the single hairline
  // divider between the match block and the suggestion tail.
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
      if (item.kind === 'frontier') {
        return (
          <View style={styles.frontierRow}>
            <View style={[styles.frontierLine, { backgroundColor: colors.border }]} />
            <Text size="xs" color={colors.textMuted} style={styles.frontierLabel}>
              {t('publicMatches.suggestionsFrontier')}
            </Text>
            <View style={[styles.frontierLine, { backgroundColor: colors.border }]} />
          </View>
        );
      }
      return (
        <FeedItemCard
          item={item.data}
          isDark={isDark}
          locale={locale}
          t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          currentPlayerId={player?.id}
          themeColors={colors}
          suggestionLabels={suggestionLabels}
          getInviteState={getInviteState}
          onMatchPress={match => {
            Logger.logUserAction('public_match_pressed', { matchId: match.id });
            openMatchDetail(match, { source: 'public_matches_feed' });
          }}
          onSendInvite={handleSendInvite}
          suggestionSource="public_matches_feed"
          trackSuggestionImpressionOnMount={false}
          sportId={selectedSport?.id}
          sportName={selectedSport?.name}
          defaultMatchType={callerMatchType}
        />
      );
    },
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

  // Render empty state — only shows when both matches AND suggestions are
  // empty. While suggestions are still loading (after matches exhausted but
  // before the suggestion RPC returns), hold the empty card so we don't
  // flash "no matches" → suggestions populating.
  const renderEmptyComponent = useCallback(() => {
    if (isLoading || isSearching || loadingSuggestions) return null;
    return (
      <EmptyState
        hasFilters={hasActiveFilters || debouncedSearchQuery.length > 0}
        textMutedColor={colors.textMuted}
        t={t}
      />
    );
  }, [
    isLoading,
    isSearching,
    loadingSuggestions,
    hasActiveFilters,
    debouncedSearchQuery,
    colors.textMuted,
    t,
  ]);

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
          viewabilityConfig={viewabilityConfig}
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
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  frontierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: 0,
    paddingBottom: spacingPixels[4],
    gap: spacingPixels[3],
  },
  frontierLine: {
    flex: 1,
    height: 1,
  },
  frontierLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

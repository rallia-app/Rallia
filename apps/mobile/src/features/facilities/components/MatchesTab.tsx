/**
 * MatchesTab Component
 * Displays public matches scheduled at this facility with search and filtering.
 * Reuses the same infrastructure as PublicMatches screen.
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MatchCard, Text } from '@rallia/shared-components';
import { SportIcon } from '../../../components/SportIcon';
import {
  useTheme,
  usePlayer,
  usePublicMatches,
  usePublicMatchFilters,
  type PublicMatch,
} from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { useMatchDetailSheet, useSport } from '../../../context';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, neutral } from '@rallia/design-system';
import { SearchBar, MatchFiltersBar } from '../../matches/components';

// =============================================================================
// TYPES
// =============================================================================

interface MatchesTabProps {
  /** Facility ID to filter matches */
  facilityId: string;
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasActiveFilters: boolean;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  t: (key: TranslationKey) => string;
}

function EmptyState({ hasActiveFilters, colors, t }: EmptyStateProps) {
  const { selectedSport } = useSport();
  return (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: colors.card }]}>
        {hasActiveFilters ? (
          <Ionicons name="search-outline" size={48} color={colors.textMuted} />
        ) : (
          <SportIcon
            sportName={selectedSport?.name ?? 'tennis'}
            size={48}
            color={colors.textMuted}
          />
        )}
      </View>
      <Text size="lg" weight="semibold" color={colors.text} style={styles.emptyTitle}>
        {t(hasActiveFilters ? 'publicMatches.empty.title' : 'publicMatches.empty.noFilters.title')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {t(
          hasActiveFilters
            ? 'publicMatches.empty.description'
            : 'publicMatches.empty.noFilters.description'
        )}
      </Text>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function MatchesTab({ facilityId }: MatchesTabProps) {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { colors } = useThemeStyles();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const isDark = theme === 'dark';

  // Get user location and preferences
  const { location } = useEffectiveLocation();
  const { player, loading: playerLoading } = usePlayer();
  const { selectedSport, isLoading: sportLoading } = useSport();

  // Filter state - reuse the same hook as PublicMatches
  const {
    filters,
    debouncedSearchQuery,
    hasActiveFilters,
    setSearchQuery,
    setFormat,
    setMatchType,
    setDateRange,
    setTimeOfDay,
    setSkillLevel,
    setGender,
    setCost,
    setJoinMode,
    setDistance,
    setDuration,
    setCourtStatus,
    setSpecificDate,
    resetFilters,
    clearSearch,
  } = usePublicMatchFilters();

  // Determine if we should enable the query
  const showMatches = !!location && !!selectedSport;

  // Fetch public matches filtered to this facility
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
    maxDistanceKm: 'all', // No distance filter - we're already at this facility
    sportId: selectedSport?.id,
    filters,
    debouncedSearchQuery,
    userGender: player?.gender,
    facilityId, // Filter to this facility only
    enabled: showMatches,
  });

  // Filter out matches where user is creator or participant (show only joinable matches)
  const filteredMatches = useMemo(() => {
    const userId = player?.id;
    if (!userId) return matches;

    return matches.filter(match => {
      // Exclude if user is the creator
      if (match.created_by === userId) return false;

      // Exclude if user is a participant
      const isParticipant = match.participants?.some(
        p => p.player_id === userId && p.status === 'joined'
      );
      if (isParticipant) return false;

      return true;
    });
  }, [matches, player?.id]);

  // Handle infinite scroll
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: PublicMatch }) => (
      <MatchCard
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
          Logger.logUserAction('facility_match_pressed', { matchId: item.id });
          openMatchDetail(item);
        }}
      />
    ),
    [isDark, t, locale, openMatchDetail, player?.id]
  );

  // Check if we're loading due to filter/search changes (not initial load)
  const isSearching = isFetching && !isLoading && !isRefetching;

  // Render results count or loading indicator in list
  const renderResultsInfo = useCallback(() => {
    // Show loading indicator when searching/filtering
    if (isSearching) {
      return (
        <View style={styles.listLoadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }

    // Show results count when we have matches
    if (!isLoading && filteredMatches.length > 0) {
      return (
        <View style={styles.resultsContainer}>
          <Text size="sm" color={colors.textMuted}>
            {filteredMatches.length === 1
              ? t('publicMatches.results.countSingular')
              : t('publicMatches.results.count', {
                  count: filteredMatches.length,
                })}
          </Text>
        </View>
      );
    }

    return null;
  }, [isSearching, isLoading, filteredMatches.length, colors.primary, colors.textMuted, t]);

  // Render empty state
  const renderEmptyComponent = useCallback(() => {
    // Don't show empty state while loading or searching
    if (isLoading || isSearching) return null;
    return <EmptyState hasActiveFilters={hasActiveFilters} colors={colors} t={t} />;
  }, [isLoading, isSearching, hasActiveFilters, colors, t]);

  // Render footer with loading indicator
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, colors.primary]);

  // Loading state for initial data
  const isInitialLoading = playerLoading || sportLoading;

  if (isInitialLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // No location/sport selected state
  if (!showMatches) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
          <Text size="base" color={colors.textMuted} style={styles.noLocationText}>
            {t('home.nearbyEmpty.title')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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

        {/* Filter Chips - hide distance filter (not relevant within a facility) */}
        <MatchFiltersBar
          format={filters.format}
          matchType={filters.matchType}
          dateRange={filters.dateRange}
          timeOfDay={filters.timeOfDay}
          skillLevel={filters.skillLevel}
          gender={filters.gender}
          cost={filters.cost}
          joinMode={filters.joinMode}
          distance={filters.distance}
          duration={filters.duration}
          courtStatus={filters.courtStatus}
          specificDate={filters.specificDate}
          onFormatChange={setFormat}
          onMatchTypeChange={setMatchType}
          onDateRangeChange={setDateRange}
          onTimeOfDayChange={setTimeOfDay}
          onSkillLevelChange={setSkillLevel}
          onGenderChange={setGender}
          onCostChange={setCost}
          onJoinModeChange={setJoinMode}
          onDistanceChange={setDistance}
          onDurationChange={setDuration}
          onCourtStatusChange={setCourtStatus}
          onSpecificDateChange={setSpecificDate}
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          showLocationSelector={false}
        />
      </View>

      {/* Match List */}
      {isLoading ? (
        <View style={styles.listLoadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={isSearching ? [] : filteredMatches}
          renderItem={renderMatchCard}
          keyExtractor={item => item.id}
          ListHeaderComponent={renderResultsInfo}
          ListEmptyComponent={renderEmptyComponent}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={[
            styles.listContent,
            (filteredMatches.length === 0 || isSearching) && styles.emptyListContent,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
  },
  noLocationText: {
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  headerContainer: {
    // Top spacing comes from FacilityDetail contentWithTopPadding
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
  resultsContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacingPixels[6],
  },
  emptyListContent: {
    justifyContent: 'center',
    minHeight: '100%',
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

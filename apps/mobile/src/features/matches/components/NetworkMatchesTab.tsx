/**
 * NetworkMatchesTab Component
 * Displays upcoming public matches from network (group/community) members
 * with search and filtering. Mirrors the MatchesTab pattern from FacilityDetail.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MatchCard, Text } from '@rallia/shared-components';
import { SportIcon } from '../../../components/SportIcon';
import {
  useNetworkMemberUpcomingMatches,
  usePublicMatchFilters,
  usePlayer,
  type NetworkMemberMatch,
  type NetworkMatchFilters,
} from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, useAuth } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { useMatchDetailSheet, useSport } from '../../../context';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, neutral } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { SearchBar, MatchFiltersBar } from './index';

// =============================================================================
// TYPES
// =============================================================================

interface NetworkMatchesTabProps {
  networkId: string;
  networkType: 'group' | 'community';
  sportId?: string | null;
  /** When true, renders matches inline (no FlatList) for embedding in a parent ScrollView */
  inline?: boolean;
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasActiveFilters: boolean;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  t: (key: TranslationKey) => string;
  networkType: 'group' | 'community';
}

function EmptyState({ hasActiveFilters, colors, t, networkType }: EmptyStateProps) {
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
        {hasActiveFilters
          ? t('publicMatches.empty.title')
          : t(
              networkType === 'community'
                ? 'community.matches.empty.title'
                : 'groups.matches.empty.title'
            )}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {hasActiveFilters
          ? t('publicMatches.empty.description')
          : t(
              networkType === 'community'
                ? 'community.matches.empty.description'
                : 'groups.matches.empty.description'
            )}
      </Text>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function NetworkMatchesTab({
  networkId,
  networkType,
  sportId,
  inline = false,
}: NetworkMatchesTabProps) {
  const { t, locale } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { selectedSport } = useSport();
  const { player } = usePlayer();
  const playerId = session?.user?.id;

  // Filter state
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

  // Build server-side filters from filter state
  const serverFilters = useMemo<NetworkMatchFilters>(
    () => ({
      searchQuery: debouncedSearchQuery || undefined,
      format: filters.format,
      matchType: filters.matchType,
      dateRange: filters.dateRange,
      timeOfDay: filters.timeOfDay,
      gender: filters.gender,
      cost: filters.cost,
      joinMode: filters.joinMode,
      duration: filters.duration,
      courtStatus: filters.courtStatus,
      matchTier: filters.matchTier,
      specificDate: filters.specificDate,
      spotsAvailable: filters.spotsAvailable,
      specificTime: filters.specificTime,
      userGender: player?.gender,
    }),
    [debouncedSearchQuery, filters, player?.gender]
  );

  // Fetch network member upcoming matches with server-side filters
  const isManualRefresh = useRef(false);
  const {
    data: matches,
    isLoading,
    isFetching,
    isRefetching,
    refetch,
  } = useNetworkMemberUpcomingMatches(
    networkId,
    networkType,
    playerId,
    sportId ?? undefined,
    100,
    serverFilters
  );

  const filteredMatches = matches ?? [];

  // Handle match card press
  const handleMatchPress = useCallback(
    (match: NetworkMemberMatch) => {
      void lightHaptic();
      Logger.logUserAction('network_match_pressed', { matchId: match.id, networkId, networkType });
      openMatchDetail(match as Parameters<typeof openMatchDetail>[0]);
    },
    [openMatchDetail, networkId, networkType]
  );

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: NetworkMemberMatch }) => {
      return (
        <MatchCard
          match={item as Parameters<typeof MatchCard>[0]['match']}
          isDark={isDark}
          t={t as (key: string, options?: Record<string, string | number | boolean>) => string}
          locale={locale}
          currentPlayerId={playerId}
          sportIcon={
            <SportIcon
              sportName={item.sport?.name ?? selectedSport?.name ?? 'tennis'}
              size={100}
              color={isDark ? neutral[600] : neutral[400]}
            />
          }
          onPress={() => handleMatchPress(item)}
        />
      );
    },
    [isDark, t, locale, playerId, selectedSport, handleMatchPress]
  );

  // Render results count
  const renderResultsInfo = useCallback(() => {
    if (isLoading || !filteredMatches || filteredMatches.length === 0) return null;
    return (
      <View style={styles.resultsContainer}>
        <Text size="sm" color={colors.textMuted}>
          {filteredMatches.length === 1
            ? t('publicMatches.results.countSingular')
            : t('publicMatches.results.count', { count: filteredMatches.length })}
        </Text>
      </View>
    );
  }, [isLoading, filteredMatches, colors.textMuted, t]);

  // Render empty state
  const renderEmptyComponent = useCallback(() => {
    if (isLoading) return null;
    return (
      <EmptyState
        hasActiveFilters={hasActiveFilters}
        colors={colors}
        t={t as (key: TranslationKey) => string}
        networkType={networkType}
      />
    );
  }, [isLoading, hasActiveFilters, colors, t, networkType]);

  const filtersBar = (
    <View style={styles.headerContainer}>
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
        onReset={resetFilters}
        hasActiveFilters={hasActiveFilters}
        showDistanceFilter={false}
        showLocationSelector={false}
      />
    </View>
  );

  // Inline mode: render matches with .map() for embedding in a parent ScrollView
  if (inline) {
    return (
      <View>
        {filtersBar}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : filteredMatches.length > 0 ? (
          <View style={styles.inlineListContent}>
            {renderResultsInfo()}
            {filteredMatches.map(match => (
              <View key={match.id}>{renderMatchCard({ item: match })}</View>
            ))}
          </View>
        ) : (
          renderEmptyComponent()
        )}
      </View>
    );
  }

  // Standalone mode: own FlatList with pull-to-refresh
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {filtersBar}

      {/* Match List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredMatches}
          renderItem={renderMatchCard}
          keyExtractor={item => item.id}
          ListHeaderComponent={renderResultsInfo}
          ListEmptyComponent={renderEmptyComponent}
          contentContainerStyle={[
            styles.listContent,
            (!filteredMatches || filteredMatches.length === 0) && styles.emptyListContent,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && isManualRefresh.current}
              onRefresh={() => {
                isManualRefresh.current = true;
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
  headerContainer: {
    paddingTop: spacingPixels[3],
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacingPixels[6],
  },
  inlineListContent: {
    paddingBottom: spacingPixels[4],
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
});

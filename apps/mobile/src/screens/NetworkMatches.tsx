/**
 * NetworkMatches Screen
 * Shows all upcoming public matches of network (community/group) members.
 * Provides search and filtering similar to FacilityDetail's MatchesTab and PublicMatches.
 */

import React, { useCallback, useMemo, useRef } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MatchCard, Text, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral, primary } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useNetworkMemberUpcomingMatches,
  usePublicMatchFilters,
  usePlayer,
  type NetworkMemberMatch,
  type NetworkMatchFilters,
} from '@rallia/shared-hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Logger } from '@rallia/shared-services';

import { useThemeStyles, useTranslation, useAuth } from '#/hooks';
import { useMatchDetailSheet, useSport } from '#/context';
import { SportIcon } from '#/components/SportIcon';
import type { RootStackParamList } from '#/navigation/types';
import { SearchBar, MatchFiltersBar } from '#/features/matches/components';

// =============================================================================
// TYPES
// =============================================================================

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type NetworkMatchesRouteProp = RouteProp<RootStackParamList, 'NetworkMatches'>;

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasActiveFilters: boolean;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  t: (key: TranslationKey) => string;
  networkType: 'community' | 'group';
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

export default function NetworkMatchesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<NetworkMatchesRouteProp>();
  const { networkId, networkType, networkName, sportId } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { selectedSport } = useSport();
  const { player } = usePlayer();
  const playerId = session?.user?.id;

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

  // Handle match card press - open match detail sheet
  const handleMatchPress = useCallback(
    (match: NetworkMemberMatch) => {
      void lightHaptic();
      Logger.logUserAction('network_match_pressed', { matchId: match.id, networkId, networkType });
      openMatchDetail(match);
    },
    [openMatchDetail, networkId, networkType]
  );

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: NetworkMemberMatch }) => {
      return (
        <MatchCard
          match={item}
          isDark={isDark}
          t={t}
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
    if (isLoading) return null;
    if (!filteredMatches || filteredMatches.length === 0) return null;

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
        t={t}
        networkType={networkType}
      />
    );
  }, [isLoading, hasActiveFilters, colors, t, networkType]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header - green background like CommunityDetail/GroupDetail */}
      <View style={[styles.header, { backgroundColor: isDark ? primary[900] : primary[100] }]}>
        <TouchableOpacity
          onPress={() => {
            void lightHaptic();
            navigation.goBack();
          }}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={isDark ? '#FFFFFF' : colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text size="lg" weight="bold" style={{ color: isDark ? '#FFFFFF' : colors.text }}>
            {networkType === 'community' ? t('community.matches.title') : t('groups.matches.title')}
          </Text>
          {networkName && (
            <Text
              size="xs"
              style={{ color: isDark ? 'rgba(255,255,255,0.8)' : colors.textSecondary }}
            >
              {networkName}
            </Text>
          )}
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Search and Filters */}
      <View style={styles.filtersContainer}>
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

        {/* Filter Chips - hide distance and location filters (not relevant for network matches) */}
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

      {/* Match List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4].map(i => {
            const skBg = isDark ? '#2C2C2E' : '#E1E9EE';
            const skHl = isDark ? '#3C3C3E' : '#F2F8FC';
            return (
              <View
                key={i}
                style={[
                  styles.skeletonMatchCard,
                  { backgroundColor: isDark ? '#1C1C1E' : '#FAFAFA', borderColor: colors.border },
                ]}
              >
                {/* Time row */}
                <View style={styles.skeletonRow}>
                  <Skeleton
                    width={16}
                    height={16}
                    circle
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width={120}
                    height={16}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* Location row */}
                <View style={styles.skeletonRow}>
                  <Skeleton
                    width={14}
                    height={14}
                    circle
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width="55%"
                    height={14}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* Player avatars */}
                <View style={styles.skeletonRow}>
                  {[1, 2, 3].map(j => (
                    <Skeleton
                      key={j}
                      width={32}
                      height={32}
                      circle
                      backgroundColor={skBg}
                      highlightColor={skHl}
                      style={j > 1 ? { marginLeft: -6 } : undefined}
                    />
                  ))}
                  <Skeleton
                    width={40}
                    height={12}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* Badges row */}
                <View style={styles.skeletonRow}>
                  <Skeleton
                    width={70}
                    height={20}
                    borderRadius={10}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                  />
                  <Skeleton
                    width={55}
                    height={20}
                    borderRadius={10}
                    backgroundColor={skBg}
                    highlightColor={skHl}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {/* CTA button */}
                <Skeleton
                  width="100%"
                  height={40}
                  borderRadius={10}
                  backgroundColor={skBg}
                  highlightColor={skHl}
                />
              </View>
            );
          })}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    width: 40,
  },
  filtersContainer: {
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
    paddingTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[3],
  },
  skeletonMatchCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
  },
  skeletonRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
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
});

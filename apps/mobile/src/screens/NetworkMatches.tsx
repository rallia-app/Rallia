/**
 * NetworkMatches Screen
 * Shows all upcoming public matches of network (community/group) members.
 * Provides search and filtering similar to FacilityDetail's MatchesTab and PublicMatches.
 */

import React, { useCallback, useMemo } from 'react';
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
import { MatchCard, Text } from '@rallia/shared-components';
import { spacingPixels, neutral, primary } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useNetworkMemberUpcomingMatches,
  usePublicMatchFilters,
  type NetworkMemberMatch,
} from '@rallia/shared-hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { Logger } from '@rallia/shared-services';

import { getSafeAreaEdges } from '../utils';
import { useThemeStyles, useTranslation, useAuth } from '../hooks';
import { useMatchDetailSheet, useSport } from '../context';
import { SportIcon } from '../components/SportIcon';
import type { RootStackParamList } from '../navigation/types';
import { SearchBar, MatchFiltersBar } from '../features/matches/components';

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
    setSkillLevel,
    setGender,
    setCost,
    setJoinMode,
    setDistance,
    setDuration,
    setCourtStatus,
    setMatchTier,
    setSpecificDate,
    resetFilters,
    clearSearch,
  } = usePublicMatchFilters();

  // Fetch network member upcoming matches
  const {
    data: matches,
    isLoading,
    isRefetching,
    refetch,
  } = useNetworkMemberUpcomingMatches(
    networkId,
    networkType,
    playerId, // excludePlayerId - exclude current user's own matches
    sportId ?? undefined, // sportId - filter by sport if specified
    100 // Higher limit since we'll filter client-side
  );

  // Transform and filter matches based on search and filters
  const filteredMatches = useMemo(() => {
    if (!matches) return [];

    return matches.filter(match => {
      // Search filter - check host name, facility name, location
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        const hostName = (match.creator?.first_name ?? '') + ' ' + (match.creator?.last_name ?? '');
        const facilityName = match.facility?.name ?? '';
        const locationName = match.location_name ?? '';

        const matchesSearch =
          hostName.toLowerCase().includes(query) ||
          facilityName.toLowerCase().includes(query) ||
          locationName.toLowerCase().includes(query);

        if (!matchesSearch) return false;
      }

      // Format filter - only filter if not 'all'
      if (filters.format !== 'all' && match.format !== filters.format) {
        return false;
      }

      // Match type filter - only filter if not 'all'
      if (filters.matchType !== 'all' && match.player_expectation !== filters.matchType) {
        return false;
      }

      // Date range filter
      if (filters.dateRange && filters.dateRange !== 'all') {
        const matchDate = new Date(match.match_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        switch (filters.dateRange) {
          case 'today': {
            const endOfToday = new Date(today);
            endOfToday.setHours(23, 59, 59, 999);
            if (matchDate < today || matchDate > endOfToday) return false;
            break;
          }
          case 'week': {
            const endOfWeek = new Date(today);
            endOfWeek.setDate(endOfWeek.getDate() + 7);
            endOfWeek.setHours(23, 59, 59, 999);
            if (matchDate < today || matchDate > endOfWeek) return false;
            break;
          }
          case 'weekend': {
            const saturday = new Date(today);
            saturday.setDate(saturday.getDate() + (6 - saturday.getDay()));
            saturday.setHours(0, 0, 0, 0);
            const sunday = new Date(saturday);
            sunday.setDate(sunday.getDate() + 1);
            sunday.setHours(23, 59, 59, 999);
            if (matchDate < saturday || matchDate > sunday) return false;
            break;
          }
        }
      }

      // Time of day filter
      if (filters.timeOfDay && filters.timeOfDay !== 'all') {
        const startHour = parseInt(match.start_time?.split(':')[0] ?? '0', 10);
        switch (filters.timeOfDay) {
          case 'morning':
            if (startHour < 6 || startHour >= 12) return false;
            break;
          case 'afternoon':
            if (startHour < 12 || startHour >= 17) return false;
            break;
          case 'evening':
            if (startHour < 17) return false;
            break;
        }
      }

      // Join mode filter - only filter if not 'all'
      if (filters.joinMode !== 'all' && match.join_mode !== filters.joinMode) {
        return false;
      }

      return true;
    });
  }, [matches, debouncedSearchQuery, filters]);

  // Transform NetworkMemberMatch to a format compatible with MatchCard
  const transformMatchForCard = useCallback((match: NetworkMemberMatch) => {
    // Create a minimal object compatible with MatchWithDetails for MatchCard
    return {
      id: match.id,
      sport_id: match.sport_id,
      match_date: match.match_date,
      start_time: match.start_time,
      end_time: match.end_time,
      format: match.format,
      player_expectation: match.player_expectation,
      visibility: match.visibility,
      join_mode: match.join_mode,
      location_type: match.location_type,
      location_name: match.location_name,
      facility_id: match.facility_id,
      created_by: match.created_by,
      cancelled_at: match.cancelled_at,
      status: 'scheduled' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Relations
      sport: match.sport
        ? {
            id: match.sport.id,
            name: match.sport.name,
            display_name: match.sport.display_name,
            icon_url: match.sport.icon_url,
            is_active: true,
            created_at: '',
            updated_at: '',
          }
        : null,
      facility: match.facility
        ? {
            id: match.facility.id,
            name: match.facility.name,
            city: match.facility.city,
            address: match.facility.address,
            // Add required fields with defaults
            latitude: null,
            longitude: null,
            phone: null,
            email: null,
            website: null,
            timezone: null,
            created_at: '',
            updated_at: '',
          }
        : undefined,
      created_by_player: match.created_by_player
        ? {
            id: match.created_by_player.id,
            profile: match.created_by_player.profile
              ? {
                  id: match.created_by,
                  first_name: match.created_by_player.profile.first_name,
                  last_name: match.created_by_player.profile.last_name,
                  display_name: match.created_by_player.profile.display_name,
                  profile_picture_url: match.created_by_player.profile.profile_picture_url,
                }
              : undefined,
          }
        : {
            id: match.created_by,
            profile: match.creator
              ? {
                  id: match.created_by,
                  first_name: match.creator.first_name,
                  last_name: match.creator.last_name,
                  display_name: null,
                  profile_picture_url: match.creator.profile_picture_url,
                }
              : undefined,
          },
      participants: match.participants?.map(p => ({
        id: p.id,
        match_id: match.id,
        player_id: p.player_id,
        team_number: p.team_number,
        is_host: p.is_host,
        status: p.status,
        joined_at: null,
        created_at: '',
        updated_at: '',
        player: p.player
          ? {
              id: p.player.id,
              profile: p.player.profile
                ? {
                    id: p.player_id,
                    first_name: p.player.profile.first_name,
                    last_name: p.player.profile.last_name,
                    display_name: p.player.profile.display_name,
                    profile_picture_url: p.player.profile.profile_picture_url,
                  }
                : undefined,
            }
          : { id: p.player_id },
      })),
      // Distance is not available for network matches
      distance_meters: null,
    };
  }, []);

  // Handle match card press - open match detail sheet
  const handleMatchPress = useCallback(
    (match: NetworkMemberMatch) => {
      void lightHaptic();
      Logger.logUserAction('network_match_pressed', { matchId: match.id, networkId, networkType });
      // Transform and open the match detail sheet
      const transformed = transformMatchForCard(match);
      openMatchDetail(transformed as unknown as Parameters<typeof openMatchDetail>[0]);
    },
    [openMatchDetail, transformMatchForCard, networkId, networkType]
  );

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: NetworkMemberMatch }) => {
      const transformed = transformMatchForCard(item);
      return (
        <MatchCard
          match={transformed as unknown as Parameters<typeof MatchCard>[0]['match']}
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
    [transformMatchForCard, isDark, t, locale, playerId, selectedSport, handleMatchPress]
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
        t={t as (key: TranslationKey) => string}
        networkType={networkType}
      />
    );
  }, [isLoading, hasActiveFilters, colors, t, networkType]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={getSafeAreaEdges(['top'])}
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
              isLoading={false}
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
          skillLevel={filters.skillLevel}
          gender={filters.gender}
          cost={filters.cost}
          joinMode={filters.joinMode}
          distance={filters.distance}
          duration={filters.duration}
          courtStatus={filters.courtStatus}
          matchTier={filters.matchTier}
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
          onMatchTierChange={setMatchTier}
          onSpecificDateChange={setSpecificDate}
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          showLocationSelector={false}
        />
      </View>

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
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
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

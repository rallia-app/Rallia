/**
 * PlayerDirectory Component
 *
 * Displays a searchable list of players for the current sport.
 * Features infinite scrolling, search, filters, and empty states.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { usePlayerSearch, usePlayer, useMultipleReputations } from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import { useEffectiveLocation } from '../../../hooks/useEffectiveLocation';
import { useUserHomeLocation } from '../../../context';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { supabase, Logger } from '@rallia/shared-services';
import { lightHaptic } from '@rallia/shared-utils';
import { SearchBar } from '../../../components/SearchBar';
import PlayerCard from './PlayerCard';
import { PlayerFiltersBar, type PlayerFilters, DEFAULT_PLAYER_FILTERS } from './PlayerFiltersBar';

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
  inputBackground: string;
}

interface PlayerDirectoryProps {
  sportId: string | undefined;
  sportName?: string; // 'Tennis' or 'Pickleball'
  currentUserId: string | undefined;
  colors: ThemeColors;
  onPlayerPress: (player: PlayerSearchResult) => void;
  ListHeaderComponent?: React.ReactElement | null;
}

const PlayerDirectory: React.FC<PlayerDirectoryProps> = ({
  sportId,
  sportName,
  currentUserId,
  colors,
  onPlayerPress,
  ListHeaderComponent,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<PlayerFilters>(DEFAULT_PLAYER_FILTERS);

  // Get user's max travel distance preference
  const { maxTravelDistanceKm, player } = usePlayer();

  // Location for distance sorting
  const { location, locationMode, setLocationMode, hasHomeLocation, hasBothLocationOptions } =
    useEffectiveLocation();
  const { homeLocation } = useUserHomeLocation();

  // Home location label for display
  const homeLocationLabel = player?.address
    ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
    : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.favorites ||
      filters.blocked ||
      filters.gender !== 'all' ||
      filters.skillLevel !== 'all' ||
      filters.availability !== 'all' ||
      filters.day !== 'all' ||
      filters.playStyle !== 'all' ||
      filters.maxDistance !== 'all' ||
      (filters.sortBy && filters.sortBy !== 'name_asc')
    );
  }, [filters]);

  // Convert UI filters to service filters
  const serviceFilters = useMemo(
    () => ({
      favorites: filters.favorites,
      blocked: filters.blocked,
      gender: filters.gender,
      skillLevel: filters.skillLevel,
      availability: filters.availability,
      day: filters.day,
      playStyle: filters.playStyle,
      maxDistance: filters.maxDistance,
      sortBy: filters.sortBy,
    }),
    [filters]
  );

  // Filter change handler
  // State for favorite player IDs
  const [favoritePlayerIds, setFavoritePlayerIds] = useState<string[]>([]);
  const [, setFavoritesLoading] = useState(false);
  // Track if we're making a local change to skip subscription refetch
  const isLocalFavoriteChangeRef = React.useRef(false);

  // State for blocked player IDs
  const [blockedPlayerIds, setBlockedPlayerIds] = useState<string[]>([]);
  const [, setBlockedLoading] = useState(false);

  // Function to fetch favorites - can be called on demand
  const fetchFavorites = useCallback(async () => {
    if (!currentUserId) return;

    setFavoritesLoading(true);
    try {
      const { data, error } = await supabase
        .from('player_favorite')
        .select('favorite_player_id')
        .eq('player_id', currentUserId);

      if (error) {
        Logger.error('Failed to fetch favorites', error);
        return;
      }

      const ids = data?.map(item => item.favorite_player_id) || [];
      setFavoritePlayerIds(ids);
    } catch (error) {
      Logger.error('Failed to fetch favorites', error as Error);
    } finally {
      setFavoritesLoading(false);
    }
  }, [currentUserId]);

  // Function to fetch blocked players - can be called on demand
  const fetchBlocked = useCallback(async () => {
    if (!currentUserId) return;

    setBlockedLoading(true);
    try {
      const { data, error } = await supabase
        .from('player_block')
        .select('blocked_player_id')
        .eq('player_id', currentUserId);

      if (error) {
        Logger.error('Failed to fetch blocked players', error);
        return;
      }

      const ids = data?.map(item => item.blocked_player_id) || [];
      setBlockedPlayerIds(ids);
    } catch (error) {
      Logger.error('Failed to fetch blocked players', error as Error);
    } finally {
      setBlockedLoading(false);
    }
  }, [currentUserId]);

  // Fetch favorites on mount and subscribe to changes
  useEffect(() => {
    if (!currentUserId) return;

    fetchFavorites();

    // Subscribe to real-time changes for favorites
    const subscription = supabase
      .channel('player_favorites_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_favorite',
          filter: `player_id=eq.${currentUserId}`,
        },
        () => {
          // Skip refetch if this was triggered by our own local change
          if (isLocalFavoriteChangeRef.current) {
            isLocalFavoriteChangeRef.current = false;
            return;
          }
          // Refetch favorites when any external change occurs
          fetchFavorites();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentUserId, fetchFavorites]);

  // Fetch blocked players on mount and subscribe to changes
  useEffect(() => {
    if (!currentUserId) return;

    fetchBlocked();

    // Subscribe to real-time changes for blocked players
    const subscription = supabase
      .channel('player_blocked_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_block',
          filter: `player_id=eq.${currentUserId}`,
        },
        () => {
          // Refetch blocked players when any change occurs
          fetchBlocked();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentUserId, fetchBlocked]);

  // Refetch favorites/blocked when screen gains focus (e.g., returning from PlayerProfile)
  useFocusEffect(
    useCallback(() => {
      // Refetch if the respective filter is active to update the list immediately
      if (filters.favorites) {
        fetchFavorites();
      }
      if (filters.blocked) {
        fetchBlocked();
      }
    }, [filters.favorites, filters.blocked, fetchFavorites, fetchBlocked])
  );

  // Filter change handler - refetch when filters are toggled on
  const handleFiltersChange = useCallback(
    (newFilters: PlayerFilters) => {
      // For guest users, ensure favorites and blocked are always false
      const sanitizedFilters = currentUserId
        ? newFilters
        : { ...newFilters, favorites: false, blocked: false };

      // If favorites filter is being turned on, refetch favorites first
      if (sanitizedFilters.favorites && !filters.favorites) {
        fetchFavorites();
      }
      // If blocked filter is being turned on, refetch blocked first
      if (sanitizedFilters.blocked && !filters.blocked) {
        fetchBlocked();
      }
      setFilters(sanitizedFilters);
    },
    [filters.favorites, filters.blocked, fetchFavorites, fetchBlocked, currentUserId]
  );

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_PLAYER_FILTERS);
  }, []);

  // Reset favorites/blocked filters when user signs out
  useEffect(() => {
    if (!currentUserId && (filters.favorites || filters.blocked)) {
      setFilters(prev => ({ ...prev, favorites: false, blocked: false }));
    }
  }, [currentUserId, filters.favorites, filters.blocked]);

  const {
    players,
    totalCount,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
  } = usePlayerSearch({
    sportId,
    currentUserId,
    searchQuery,
    filters: serviceFilters,
    favoritePlayerIds,
    blockedPlayerIds,
    enabled: !!sportId,
    latitude: location?.latitude,
    longitude: location?.longitude,
  });

  // Sort players based on selected sort option
  const sortedPlayers = useMemo(() => {
    if (!players || players.length === 0) return players;

    const sorted = [...players];
    const sortBy = filters.sortBy || 'name_asc';

    switch (sortBy) {
      case 'name_asc':
        return sorted.sort((a, b) => {
          const nameA = a.display_name || a.first_name || '';
          const nameB = b.display_name || b.first_name || '';
          return nameA.localeCompare(nameB);
        });
      case 'name_desc':
        return sorted.sort((a, b) => {
          const nameA = a.display_name || a.first_name || '';
          const nameB = b.display_name || b.first_name || '';
          return nameB.localeCompare(nameA);
        });
      case 'rating_high':
        return sorted.sort((a, b) => {
          const ratingA = a.rating?.value || 0;
          const ratingB = b.rating?.value || 0;
          return ratingB - ratingA;
        });
      case 'rating_low':
        return sorted.sort((a, b) => {
          const ratingA = a.rating?.value || 0;
          const ratingB = b.rating?.value || 0;
          return ratingA - ratingB;
        });
      case 'distance':
        return sorted.sort((a, b) => {
          const distA = a.distance_meters ?? Infinity;
          const distB = b.distance_meters ?? Infinity;
          return distA - distB;
        });
      case 'recently_active':
        // Last active not available in current data - fallback to name
        return sorted.sort((a, b) => {
          const nameA = a.display_name || a.first_name || '';
          const nameB = b.display_name || b.first_name || '';
          return nameA.localeCompare(nameB);
        });
      default:
        return sorted;
    }
  }, [players, filters.sortBy]);

  // Fetch reputation data for visible players
  const playerIds = useMemo(() => (sortedPlayers || []).map(p => p.id), [sortedPlayers]);
  const { reputations } = useMultipleReputations(playerIds);

  // Toggle favorite handler
  const handleToggleFavorite = useCallback(
    async (playerId: string) => {
      if (!currentUserId) return;

      lightHaptic();
      const wasFavorite = favoritePlayerIds.includes(playerId);

      // Mark as local change to skip subscription refetch
      isLocalFavoriteChangeRef.current = true;

      // Optimistic update
      if (wasFavorite) {
        setFavoritePlayerIds(prev => prev.filter(id => id !== playerId));
      } else {
        setFavoritePlayerIds(prev => [...prev, playerId]);
      }

      try {
        if (wasFavorite) {
          // Remove from favorites
          const { error } = await supabase
            .from('player_favorite')
            .delete()
            .eq('player_id', currentUserId)
            .eq('favorite_player_id', playerId);

          if (error) throw error;
          toast.success(t('playerDirectory.favorites.removedFromFavorites'));
          Logger.info('Player removed from favorites', { playerId });
        } else {
          // Add to favorites
          const { error } = await supabase.from('player_favorite').insert({
            player_id: currentUserId,
            favorite_player_id: playerId,
          });

          if (error) throw error;
          toast.success(t('playerDirectory.favorites.addedToFavorites'));
          Logger.info('Player added to favorites', { playerId });
        }
      } catch (error) {
        // Revert optimistic update on error
        if (wasFavorite) {
          setFavoritePlayerIds(prev => [...prev, playerId]);
        } else {
          setFavoritePlayerIds(prev => prev.filter(id => id !== playerId));
        }
        Logger.error('Failed to toggle favorite', error as Error);
        toast.error(t('common.error'));
      }
    },
    [currentUserId, favoritePlayerIds, t, toast]
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSearchResult }) => (
      <PlayerCard
        player={item}
        colors={colors}
        onPress={onPlayerPress}
        isFavorite={favoritePlayerIds.includes(item.id)}
        onToggleFavorite={handleToggleFavorite}
        showFavorite={!!currentUserId && currentUserId !== item.id}
        reputationDisplay={reputations.get(item.id)}
      />
    ),
    [colors, onPlayerPress, favoritePlayerIds, handleToggleFavorite, currentUserId, reputations]
  );

  const renderEmpty = () => {
    if (isLoading) return null;

    const hasSearchOrFilters = searchQuery || hasActiveFilters;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {hasSearchOrFilters
            ? t('playerDirectory.noPlayersFound')
            : t('playerDirectory.noPlayersYet')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {hasSearchOrFilters
            ? t('playerDirectory.adjustSearch')
            : t('playerDirectory.beFirstToInvite')}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <View
          style={[
            styles.skeletonCard,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.skeletonAvatarContainer}>
            <Skeleton
              width={48}
              height={48}
              circle
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
          <View style={styles.skeletonInfoContainer}>
            <Skeleton
              width="60%"
              height={16}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <View style={styles.skeletonBadgesRow}>
              <Skeleton
                width={64}
                height={20}
                borderRadius={radiusPixels.full}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={56}
                height={20}
                borderRadius={radiusPixels.full}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            <View style={styles.skeletonLocationRow}>
              <Skeleton
                width={14}
                height={14}
                borderRadius={7}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width="45%"
                height={14}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ marginLeft: spacingPixels[1] }}
              />
            </View>
          </View>
          <Skeleton
            width={20}
            height={20}
            borderRadius={4}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
        </View>
      </View>
    );
  };

  if (!sportId) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {t('playerDirectory.selectSport')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {t('playerDirectory.chooseSport')}
        </Text>
      </View>
    );
  }

  // Theme-aware skeleton colors
  const skeletonBg = colors.inputBackground;
  const skeletonHighlight = colors.border;

  // Render loading skeleton for list content only
  const renderListSkeleton = () => (
    <View style={styles.loadingContainer}>
      {/* Results count skeleton */}
      <View style={styles.resultsInfo}>
        <Skeleton
          width={100}
          height={14}
          borderRadius={4}
          backgroundColor={skeletonBg}
          highlightColor={skeletonHighlight}
        />
      </View>
      {[1, 2, 3, 4].map(i => (
        <View
          key={i}
          style={[
            styles.skeletonCard,
            {
              backgroundColor: colors.cardBackground,
              borderColor: colors.border,
            },
          ]}
        >
          {/* Avatar */}
          <View style={styles.skeletonAvatarContainer}>
            <Skeleton
              width={48}
              height={48}
              circle
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
          {/* Info */}
          <View style={styles.skeletonInfoContainer}>
            {/* Name */}
            <Skeleton
              width="60%"
              height={16}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            {/* Badges row */}
            <View style={styles.skeletonBadgesRow}>
              <Skeleton
                width={64}
                height={20}
                borderRadius={radiusPixels.full}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={56}
                height={20}
                borderRadius={radiusPixels.full}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
            {/* Location row */}
            <View style={styles.skeletonLocationRow}>
              <Skeleton
                width={14}
                height={14}
                borderRadius={7}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width="45%"
                height={14}
                borderRadius={4}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ marginLeft: spacingPixels[1] }}
              />
            </View>
          </View>
          {/* Chevron */}
          <Skeleton
            width={20}
            height={20}
            borderRadius={4}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
        </View>
      ))}
    </View>
  );

  // Render error state for list content only
  const renderErrorContent = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="cloud-offline-outline" size={64} color={colors.textMuted} />
      <Text size="lg" weight="semibold" color={colors.text} style={styles.emptyTitle}>
        {t('playerDirectory.failedToLoad')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {error?.message || t('playerDirectory.checkConnection')}
      </Text>
      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: colors.primary }]}
        onPress={() => refetch()}
      >
        <Text size="sm" weight="semibold" color="#FFFFFF">
          {t('common.retry')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Results count between filters and list
  const renderResultsInfo = () => {
    if (isLoading || !sportId) return null;

    const count = totalCount ?? sortedPlayers.length;
    const countText =
      count === 1
        ? t('playerDirectory.results.countSingular')
        : t('playerDirectory.results.count').replace('{count}', String(count));

    return (
      <View style={styles.resultsInfo}>
        <Text size="sm" color={colors.textMuted}>
          {countText}
        </Text>
      </View>
    );
  };

  // Search bar and filters - rendered inside list header so everything scrolls together
  const renderSearchAndFilters = () => (
    <>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('playerDirectory.searchPlaceholder')}
        colors={{
          text: colors.text,
          textMuted: colors.textMuted,
          border: colors.border,
          buttonInactive: colors.inputBackground ?? colors.cardBackground,
        }}
        style={styles.searchContainer}
      />
      <PlayerFiltersBar
        filters={filters}
        sportName={sportName}
        maxTravelDistance={maxTravelDistanceKm ?? 50}
        onFiltersChange={handleFiltersChange}
        onReset={handleResetFilters}
        isAuthenticated={!!currentUserId}
        showLocationSelector={hasBothLocationOptions}
        locationMode={locationMode}
        onLocationModeChange={setLocationMode}
        hasHomeLocation={hasHomeLocation}
        homeLocationLabel={homeLocationLabel}
      />
    </>
  );

  // Determine what to render in the list area
  const renderListContent = () => {
    // Initial loading - show skeleton
    if (isLoading) {
      return (
        <>
          {ListHeaderComponent}
          {renderSearchAndFilters()}
          {renderListSkeleton()}
        </>
      );
    }

    // Error with no data - show error
    if (error && !players.length) {
      return (
        <>
          {ListHeaderComponent}
          {renderSearchAndFilters()}
          {renderErrorContent()}
        </>
      );
    }

    // Normal state - show FlatList
    return (
      <FlatList
        data={sortedPlayers}
        renderItem={renderPlayer}
        keyExtractor={item => item.id}
        ListHeaderComponent={
          <>
            {ListHeaderComponent}
            {renderSearchAndFilters()}
            {renderResultsInfo()}
          </>
        }
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={[
          styles.listContent,
          sortedPlayers.length === 0 && styles.emptyListContent,
        ]}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isFetchingNextPage}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={10}
        getItemLayout={undefined}
      />
    );
  };

  // Main render
  return <View style={styles.container}>{renderListContent()}</View>;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[3],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  resultsInfo: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  listContent: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingTop: spacingPixels[10],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
    textAlign: 'center',
  },
  emptyDescription: {
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  skeletonAvatarContainer: {
    marginRight: spacingPixels[3],
  },
  skeletonInfoContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
    gap: spacingPixels[0.5],
  },
  skeletonBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[0.5],
  },
  skeletonLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
  },
});

export default PlayerDirectory;

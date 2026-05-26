/**
 * PlayerDirectory Component
 *
 * Displays a searchable list of players for the current sport.
 * Features infinite scrolling, search, filters, and empty states.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { usePlayerSearch, usePlayer, useRatingScoresForSport } from '@rallia/shared-hooks';
import type { PlayerSearchResult, ReputationTier } from '@rallia/shared-services';
import { supabase, Logger, getTierConfig } from '@rallia/shared-services';
import { lightHaptic } from '@rallia/shared-utils';

import { useTranslation } from '#/hooks';
import { useEffectiveLocation } from '#/hooks/useEffectiveLocation';
import { useUserHomeLocation } from '#/context';
import * as Analytics from '#/services/analytics';
import { SearchBar } from '#/components/SearchBar';

import PlayerCard from './PlayerCard';
import PlayerCardSkeleton from './PlayerCardSkeleton';
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

  // Get rating scores for current sport (for multi-select rating filter)
  const { ratingScores } = useRatingScoresForSport(sportName, sportId, currentUserId);

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
      filters.rating.length > 0 ||
      filters.reputation !== 'all' ||
      filters.certifiedOnly ||
      filters.hourRange.minHour !== null ||
      filters.hourRange.maxHour !== null ||
      filters.day !== 'all' ||
      filters.playStyle !== 'all' ||
      filters.maxDistance !== 'all' ||
      (filters.sortBy && filters.sortBy !== 'distance')
    );
  }, [filters]);

  // Convert UI filters to service filters
  const serviceFilters = useMemo(
    () => ({
      favorites: filters.favorites,
      blocked: filters.blocked,
      gender: filters.gender,
      rating: filters.rating,
      reputation: filters.reputation,
      certifiedOnly: filters.certifiedOnly,
      hourRange: filters.hourRange,
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

  // Only feed favorite/blocked IDs into the query when their respective filter
  // is active — otherwise toggling a heart would change the query key and
  // trigger a full refetch on every tap. The UI's heart state reads from
  // `favoritePlayerIds` directly, so the local toggle still updates instantly.
  const searchFavoriteIds = filters.favorites ? favoritePlayerIds : undefined;
  const searchBlockedIds = filters.blocked ? blockedPlayerIds : undefined;

  const {
    players,
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
    favoritePlayerIds: searchFavoriteIds,
    blockedPlayerIds: searchBlockedIds,
    enabled: !!sportId,
    latitude: location?.latitude,
    longitude: location?.longitude,
  });

  const isManualRefresh = useRef(false);

  useEffect(() => {
    if (!isFetching) {
      isManualRefresh.current = false;
    }
  }, [isFetching]);

  const handleRefresh = useCallback(() => {
    isManualRefresh.current = true;
    refetch();
  }, [refetch]);

  // Derive reputation display data directly from search results (no extra API calls)
  const getReputationDisplay = useCallback((player: PlayerSearchResult) => {
    if (!player.reputation_tier || !player.reputation_is_public) return undefined;
    const tier = player.reputation_tier as ReputationTier;
    const tierConfig = getTierConfig(tier);
    return {
      tier,
      score: player.reputation_score ?? 100,
      isVisible: player.reputation_is_public,
      tierLabel: tierConfig.label,
      tierColor: tierConfig.color,
      tierIcon: tierConfig.icon,
    };
  }, []);

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
        Analytics.playerFavorited();
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
        reputationDisplay={getReputationDisplay(item)}
        isOnline={
          item.last_seen_at
            ? new Date(item.last_seen_at).getTime() > Date.now() - 5 * 60 * 1000
            : false
        }
      />
    ),
    [
      colors,
      onPlayerPress,
      favoritePlayerIds,
      handleToggleFavorite,
      currentUserId,
      getReputationDisplay,
    ]
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
        <ActivityIndicator size="small" color={colors.primary} />
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

  // Render loading skeleton for list content only
  const renderListSkeleton = () => (
    <View style={styles.loadingContainer}>
      {[1, 2, 3, 4].map(i => (
        <PlayerCardSkeleton key={i} />
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
        ratingOptions={ratingScores}
      />
    </>
  );

  // Determine what to render in the list area
  const renderListContent = () => {
    // Resolve empty component based on current state
    const emptyComponent = isLoading
      ? renderListSkeleton()
      : error && !players.length
        ? renderErrorContent()
        : renderEmpty();

    // Always render FlatList so the header (SearchBar) stays mounted
    // and the TextInput keeps keyboard focus during search
    return (
      <FlatList
        data={isLoading ? [] : players}
        renderItem={renderPlayer}
        keyExtractor={item => item.id}
        ListHeaderComponent={
          <>
            {ListHeaderComponent}
            {renderSearchAndFilters()}
            <View style={styles.headerBottomSpacer} />
          </>
        }
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={renderFooter}
        contentContainerStyle={[
          styles.listContent,
          (isLoading || players.length === 0) && styles.emptyListContent,
        ]}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && isManualRefresh.current}
            onRefresh={handleRefresh}
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
        keyboardShouldPersistTaps="handled"
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
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  headerBottomSpacer: {
    height: spacingPixels[2],
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
  },
});

export default PlayerDirectory;

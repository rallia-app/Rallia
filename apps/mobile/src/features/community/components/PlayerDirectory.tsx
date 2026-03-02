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
  TextInput,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text, SkeletonPlayerCard, Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';
import { usePlayerSearch, usePlayer } from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import { useEffectiveLocation } from '../../../hooks/useEffectiveLocation';
import { useUserHomeLocation } from '../../../context';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { supabase, Logger } from '@rallia/shared-services';
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
}

const PlayerDirectory: React.FC<PlayerDirectoryProps> = ({
  sportId,
  sportName,
  currentUserId,
  colors,
  onPlayerPress,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<PlayerFilters>(DEFAULT_PLAYER_FILTERS);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle search with debounce indicator
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    setIsTyping(true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout - matches the 300ms debounce in usePlayerSearch
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 350);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

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
          // Refetch favorites when any change occurs
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

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSearchResult }) => (
      <PlayerCard player={item} colors={colors} onPress={onPlayerPress} />
    ),
    [colors, onPlayerPress]
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
        <SkeletonPlayerCard
          backgroundColor={colors.inputBackground}
          highlightColor={colors.border}
          style={{ paddingHorizontal: spacingPixels[4] }}
        />
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      {/* Search Bar - same look as WhereStep */}
      <View style={styles.searchContainer}>
        <View
          style={[
            styles.searchInputContainer,
            {
              borderColor: colors.border,
              backgroundColor: colors.inputBackground ?? colors.cardBackground,
            },
          ]}
        >
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t('playerDirectory.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {(isTyping || (isFetching && searchQuery.length > 0)) && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.searchLoader} />
          )}
          {searchQuery.length > 0 && !isTyping && !isFetching && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setIsTyping(false);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filters Bar */}
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
    </View>
  );

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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        {/* Skeleton search bar */}
        <View style={[styles.searchContainer, { marginBottom: spacingPixels[4] }]}>
          <Skeleton
            width="100%"
            height={44}
            borderRadius={radiusPixels.lg}
            backgroundColor={colors.inputBackground}
            highlightColor={colors.border}
          />
        </View>
        {/* Skeleton filter chips */}
        <View style={[styles.skeletonFilters, { marginBottom: spacingPixels[4] }]}>
          {[1, 2, 3, 4].map(i => (
            <Skeleton
              key={i}
              width={80}
              height={32}
              borderRadius={16}
              backgroundColor={colors.inputBackground}
              highlightColor={colors.border}
              style={{ marginRight: spacingPixels[2] }}
            />
          ))}
        </View>
        {/* Skeleton player cards */}
        {[1, 2, 3, 4, 5].map(i => (
          <SkeletonPlayerCard
            key={i}
            backgroundColor={colors.inputBackground}
            highlightColor={colors.border}
            style={{ marginBottom: spacingPixels[3], paddingHorizontal: spacingPixels[4] }}
          />
        ))}
      </View>
    );
  }

  // Error state with retry button
  if (error && !players.length) {
    return (
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
  }

  return (
    <FlatList
      data={sortedPlayers}
      renderItem={renderPlayer}
      keyExtractor={item => item.id}
      ListHeaderComponent={renderHeader}
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
      // Performance optimizations
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={10}
      initialNumToRender={10}
      getItemLayout={undefined}
    />
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[3],
  },
  skeletonFilters: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[3],
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: spacingPixels[1],
  },
  searchLoader: {
    marginLeft: spacingPixels[2],
  },
  listContent: {
    paddingBottom: spacingPixels[5],
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
    paddingVertical: spacingPixels[4],
  },
});

export default PlayerDirectory;

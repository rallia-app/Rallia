/**
 * FacilitiesDirectory Screen
 * Displays facilities with search, filtering, and favorites.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import {
  useFacilitySearch,
  useFavoriteFacilities,
  usePlayer,
  useDebounce,
  useProfile,
  DEFAULT_FACILITY_FILTERS,
  MIN_FAVORITE_FACILITIES,
  type FacilityFilters,
  FormattedSlot,
} from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { Logger } from '@rallia/shared-services';
import { spacingPixels, secondary, status } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { SheetManager } from 'react-native-actions-sheet';

import { SearchBar } from '#/features/matches/components';
import {
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  type TranslationKey,
  type TranslationOptions,
  useRequireOnboarding,
} from '#/hooks';
import { useAuth } from '#/hooks';
import { useSport, useUserHomeLocation, useActionsSheet } from '#/context';
import { useCourtsNavigation, useAppNavigation } from '#/navigation/hooks';
import {
  FacilityCard,
  FacilityCardSkeleton,
  FacilityFiltersBar,
} from '#/features/facilities/components';

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface EmptyStateProps {
  hasActiveSearch: boolean;
  hasLocation: boolean;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

function EmptyState({ hasActiveSearch, hasLocation, colors, t }: EmptyStateProps) {
  return (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: colors.card }]}>
        <Ionicons
          name={
            hasActiveSearch
              ? 'search-outline'
              : hasLocation
                ? 'business-outline'
                : 'location-outline'
          }
          size={48}
          color={colors.textMuted}
        />
      </View>
      <Text size="lg" weight="semibold" color={colors.text} style={styles.emptyTitle}>
        {!hasLocation
          ? t('facilitiesTab.empty.noLocation')
          : hasActiveSearch
            ? t('facilitiesTab.empty.title')
            : t('facilitiesTab.empty.title')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {hasLocation ? t('facilitiesTab.empty.description') : t('facilitiesTab.empty.noLocation')}
      </Text>
    </View>
  );
}

function LoadingSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <FacilityCardSkeleton key={i} />
      ))}
    </View>
  );
}

const keyExtractor = (item: FacilitySearchResult) => item.id;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function FacilitiesDirectory() {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const toast = useToast();
  const navigation = useCourtsNavigation();
  const rootNavigation = useAppNavigation();
  const { session } = useAuth();
  const { profile } = useProfile();
  const showFavoriteButton = !!session?.user && !!profile?.onboarding_completed;
  const { openSheet } = useActionsSheet();
  const { guardAction } = useRequireOnboarding();

  // User is fully onboarded only if authenticated AND onboarding is complete
  const isOnboarded = !!session?.user && !!profile?.onboarding_completed;

  // Location and preferences
  const { location, locationMode, setLocationMode, hasHomeLocation, hasBothLocationOptions } =
    useEffectiveLocation();
  const { homeLocation } = useUserHomeLocation();
  const { player } = usePlayer();
  const { selectedSport, isLoading: sportLoading } = useSport();

  // Home location label for display (full address if available, otherwise postal code)
  const homeLocationLabel = player?.address
    ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
    : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const hasActiveSearch = debouncedSearchQuery.length > 0;

  // Filter state
  const [filters, setFilters] = useState<FacilityFilters>(DEFAULT_FACILITY_FILTERS);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.distance !== 'all' ||
      filters.facilityType !== 'all' ||
      filters.surfaceType !== 'all' ||
      filters.courtType !== 'all' ||
      filters.lighting !== 'all' ||
      filters.membership !== 'all' ||
      filters.organizationNature !== 'all' ||
      filters.hasAvailabilities ||
      filters.hasOpenSlots ||
      filters.slotDate !== null ||
      filters.hourRange.minHour !== null ||
      filters.hourRange.maxHour !== null ||
      filters.favoritesOnly
    );
  }, [filters]);

  // Reset filters
  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FACILITY_FILTERS);
  }, []);

  // Determine if we should enable the query
  // Must check latitude/longitude exist, not just that location object exists
  const showFacilities =
    !!location &&
    location.latitude !== undefined &&
    location.longitude !== undefined &&
    !!selectedSport;

  // Fetch facilities with server-side pagination
  const {
    facilities,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error: queryError,
  } = useFacilitySearch({
    sportIds: selectedSport?.id ? [selectedSport.id] : undefined,
    latitude: location?.latitude,
    longitude: location?.longitude,
    searchQuery: debouncedSearchQuery,
    filters,
    userGender: player?.gender,
    playerId: player?.id,
    enabled: showFacilities,
  });

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, colors.primary]);

  // Favorites mutations. Heart state is read off the RPC row (`is_favorite`)
  // so the heart and the server-side `favoritesOnly` filter share a single
  // source of truth — addFavorite/removeFavorite invalidate the search cache
  // so the RPC re-runs and the flag updates.
  const { addFavorite, removeFavorite, isMaxReached, canRemoveFavorite } = useFavoriteFacilities(
    player?.id ?? null,
    selectedSport?.id
  );

  // Handle facility press
  const handleFacilityPress = useCallback(
    (facility: FacilitySearchResult) => {
      lightHaptic();
      Logger.logUserAction('facility_pressed', { facilityId: facility.id });
      navigation.navigate('FacilityDetail', { facilityId: facility.id });
    },
    [navigation]
  );

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(
    async (facility: FacilitySearchResult) => {
      if (!player?.id) {
        // User not authenticated - would need to show auth sheet
        return;
      }

      lightHaptic();
      const wasAdded = !!facility.is_favorite;

      if (wasAdded) {
        if (!canRemoveFavorite) {
          toast.info(
            t('facilitiesTab.favorites.minimumRequired', { min: MIN_FAVORITE_FACILITIES })
          );
          return;
        }
        const success = await removeFavorite(facility.id);
        if (success) {
          toast.success(t('facilitiesTab.favorites.removedFromFavorites'));
        }
      } else {
        if (isMaxReached) {
          toast.info(t('facilitiesTab.favorites.maxReached'));
          return;
        }
        const success = await addFavorite(facility);
        if (success) {
          toast.success(t('facilitiesTab.favorites.addedToFavorites'));
        }
      }
    },
    [player?.id, removeFavorite, addFavorite, isMaxReached, canRemoveFavorite, t, toast]
  );

  // Handle slot press - show court selection sheet if multiple courts available
  const handleSlotPress = useCallback(
    (facility: FacilitySearchResult, slot: FormattedSlot) => {
      // Require auth and onboarding before allowing booking actions
      if (!guardAction()) return;

      // Court selection + redirect runs through the shared external-booking
      // sheet (same as the facility detail availability tab).
      SheetManager.show('external-booking', {
        payload: { facility, slot, source: 'facility_directory' },
      });
    },
    [guardAction]
  );

  // Render facility card. onPress now receives the facility so the prop is
  // stable across all rows (instead of a per-row closure) — combined with
  // React.memo on FacilityCard this prevents row re-renders.
  const renderFacilityCard = useCallback(
    ({ item }: { item: FacilitySearchResult }) => (
      <FacilityCard
        facility={item}
        isFavorite={!!item.is_favorite}
        onPress={handleFacilityPress}
        onToggleFavorite={handleToggleFavorite}
        isMaxFavoritesReached={isMaxReached}
        showFavoriteButton={showFavoriteButton}
        sportName={selectedSport?.name}
        onSlotPress={handleSlotPress}
        isDark={isDark}
        colors={colors}
        t={t}
      />
    ),
    [
      handleFacilityPress,
      handleToggleFavorite,
      handleSlotPress,
      isMaxReached,
      showFavoriteButton,
      selectedSport?.name,
      isDark,
      colors,
      t,
    ]
  );

  // Full list header: title, search, filters, error, then results info or skeleton.
  // Built as a memoized element (not invoked from ListHeaderComponent) so the
  // header subtree only rebuilds when its deps actually change.
  const listHeader = useMemo(
    () => (
      <>
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <Text size="xl" weight="bold" color={colors.text}>
            {t('facilitiesTab.title')}
          </Text>
          <TouchableOpacity
            onPress={() => {
              lightHaptic();
              rootNavigation.navigate('Map', {
                screen: 'MapView',
                params: location
                  ? { focusLocation: { lat: location.latitude, lng: location.longitude } }
                  : undefined,
              });
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessible
            accessibilityLabel={t('navigation.map')}
          >
            <Ionicons name="map-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={[styles.searchContainer, { backgroundColor: colors.background }]}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('facilitiesTab.searchPlaceholder')}
            onClear={() => setSearchQuery('')}
          />
        </View>
        <FacilityFiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          onReset={handleResetFilters}
          hasActiveFilters={hasActiveFilters}
          showLocationSelector={hasBothLocationOptions}
          locationMode={locationMode}
          onLocationModeChange={setLocationMode}
          hasHomeLocation={hasHomeLocation}
          homeLocationLabel={homeLocationLabel}
          showFavoritesFilter={showFavoriteButton}
        />
        {queryError && (
          <View style={[styles.errorContainer, { backgroundColor: colors.card }]}>
            <Text size="sm" color={colors.error || status.error.DEFAULT}>
              {t('common.error')}: {queryError.message}
            </Text>
          </View>
        )}
        <View style={styles.filtersBottomSpacer} />
        {(isLoading || sportLoading) && <LoadingSkeleton />}
      </>
    ),
    [
      colors,
      t,
      searchQuery,
      filters,
      handleResetFilters,
      hasActiveFilters,
      hasBothLocationOptions,
      locationMode,
      setLocationMode,
      hasHomeLocation,
      homeLocationLabel,
      showFavoriteButton,
      queryError,
      isLoading,
      sportLoading,
      rootNavigation,
      location,
    ]
  );

  // Render empty state
  const renderEmptyComponent = useCallback(() => {
    if (isLoading) return null;
    return (
      <EmptyState
        hasActiveSearch={hasActiveSearch}
        hasLocation={!!location}
        colors={colors}
        t={t}
      />
    );
  }, [isLoading, hasActiveSearch, location, colors, t]);

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <FlatList
        data={facilities}
        renderItem={renderFacilityCard}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmptyComponent}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && isManualRefresh.current}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.listContent,
          facilities.length === 0 && styles.emptyListContent,
        ]}
        showsVerticalScrollIndicator={false}
        // Virtualization tuning — keep the active window small so off-screen
        // cards unmount and stop competing for the JS thread during scroll.
        removeClippedSubviews
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        updateCellsBatchingPeriod={50}
      />
      {/* FAB Container */}
      <View style={styles.fabContainer}>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: secondary[500] }]}
          onPress={() => {
            lightHaptic();
            rootNavigation.navigate('Map', {
              screen: 'MapView',
              params: location
                ? { focusLocation: { lat: location.latitude, lng: location.longitude } }
                : undefined,
            });
          }}
          activeOpacity={0.8}
          accessible
          accessibilityLabel={t('navigation.map')}
        >
          <Ionicons name="map" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[3],
  },
  listContent: {
    paddingTop: 0,
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flexGrow: 1,
    paddingBottom: 0,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptyDescription: {
    textAlign: 'center',
  },
  // Sits inside the list header below the filters so the gap above the first
  // card is the same whether the skeleton or the loaded items are rendering.
  filtersBottomSpacer: {
    height: spacingPixels[3],
  },
  skeletonContainer: {
    paddingBottom: spacingPixels[4],
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
  errorContainer: {
    padding: spacingPixels[4],
    margin: spacingPixels[4],
    borderRadius: 8,
  },
  fabContainer: {
    position: 'absolute',
    bottom: spacingPixels[6],
    right: spacingPixels[4],
    alignItems: 'center',
    gap: 12,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});

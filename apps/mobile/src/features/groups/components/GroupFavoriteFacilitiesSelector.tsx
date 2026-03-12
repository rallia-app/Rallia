/**
 * GroupFavoriteFacilitiesSelector Component
 *
 * A searchable dropdown component for selecting favorite facilities for a group.
 * Shows current favorites and allows adding/removing them (only for moderators/owners).
 * Filters facilities based on the group's sport.
 * Unlike player favorites, groups have no limit on the number of favorites.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, selectionHaptic, successHaptic } from '@rallia/shared-utils';
import { useFacilitySearch, useCommunityFavoriteFacilities } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeColors {
  text: string;
  textMuted: string;
  textSecondary: string;
  inputBackground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  card: string;
  error: string;
}

interface GroupFavoriteFacilitiesSelectorProps {
  /** Group ID (which is a network ID) */
  groupId: string;
  /** Current player ID (for permission check) */
  currentPlayerId: string | null;
  /** Sport ID(s) for filtering facilities - null means both sports */
  sportId: string | null;
  /** All sport IDs (tennis + pickleball) for when group has no sport */
  allSportIds?: string[];
  /** Sport names corresponding to allSportIds (for displaying sport tags) */
  sportNames?: string[];
  /** User's latitude for distance calculation */
  latitude: number | null;
  /** User's longitude for distance calculation */
  longitude: number | null;
  /** Theme colors */
  colors: ThemeColors;
  /** Translation function */
  t: (key: TranslationKey) => string;
  /** If true, hides the search input (read-only view) */
  readOnly?: boolean;
  /** Callback when user taps on a facility card to view details */
  onNavigateToFacility?: (facilityId: string) => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format distance in meters to human-readable string
 */
function formatDistance(meters: number | null): string {
  if (meters === null) return '';
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface FavoriteCardProps {
  name: string;
  address: string | null;
  city: string | null;
  distanceMeters: number | null;
  courtCount: number;
  isFavorite: boolean;
  onToggleFavorite?: () => void;
  onPress?: () => void;
  colors: ThemeColors;
  showFavoriteButton: boolean;
}

const FavoriteCard: React.FC<FavoriteCardProps> = ({
  name,
  address,
  city,
  distanceMeters,
  courtCount,
  isFavorite,
  onToggleFavorite,
  onPress,
  colors,
  showFavoriteButton,
}) => {
  const addressText = [address, city].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={[styles.favoriteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Header Row: Name + Heart */}
      <View style={styles.cardHeaderRow}>
        <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        {showFavoriteButton && onToggleFavorite && (
          <TouchableOpacity
            onPress={e => {
              e.stopPropagation?.();
              onToggleFavorite();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.heartButton}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={22}
              color={isFavorite ? colors.error : colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Address Row */}
      {addressText && (
        <View style={styles.cardInfoRow}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.cardInfoText, { color: colors.textMuted }]} numberOfLines={1}>
            {addressText}
          </Text>
        </View>
      )}

      {/* Distance + Court Count Row */}
      <View style={styles.cardDetailsRow}>
        {distanceMeters !== null && (
          <View style={styles.cardDetailItem}>
            <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.cardDetailText, { color: colors.textMuted }]}>
              {formatDistance(distanceMeters)}
            </Text>
          </View>
        )}
        {courtCount > 0 && (
          <View style={styles.cardDetailItem}>
            <Ionicons name="grid-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.cardDetailText, { color: colors.textMuted }]}>
              {courtCount} {courtCount === 1 ? 'court' : 'courts'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

interface FacilitySearchItemProps {
  facility: FacilitySearchResult;
  isSelected: boolean;
  onPress: () => void;
  colors: ThemeColors;
  sportLabels?: string[];
}

const FacilitySearchItem: React.FC<FacilitySearchItemProps> = ({
  facility,
  isSelected,
  onPress,
  colors,
  sportLabels = [],
}) => (
  <TouchableOpacity
    style={[
      styles.searchResultItem,
      { borderBottomColor: colors.border },
      isSelected && { backgroundColor: `${colors.primary}10` },
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.searchResultContent}>
      <View style={styles.searchResultInfo}>
        <Text
          style={[styles.searchResultName, { color: isSelected ? colors.primary : colors.text }]}
          numberOfLines={1}
        >
          {facility.name}
        </Text>
        <Text style={[styles.searchResultAddress, { color: colors.textMuted }]} numberOfLines={1}>
          {[facility.address, facility.city].filter(Boolean).join(', ')}
        </Text>
        {/* Sport tags */}
        {sportLabels.length > 0 && (
          <View style={styles.sportTagsRow}>
            {sportLabels.map(label => (
              <View
                key={label}
                style={[styles.sportTag, { backgroundColor: `${colors.primary}20` }]}
              >
                <Text style={[styles.sportTagText, { color: colors.primary }]}>{label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={styles.searchResultRight}>
        {facility.distance_meters !== null && (
          <Text style={[styles.distanceText, { color: colors.textMuted }]}>
            {formatDistance(facility.distance_meters)}
          </Text>
        )}
        {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
      </View>
    </View>
  </TouchableOpacity>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const GroupFavoriteFacilitiesSelector: React.FC<GroupFavoriteFacilitiesSelectorProps> = ({
  groupId,
  currentPlayerId,
  sportId,
  allSportIds = [],
  sportNames = [],
  latitude,
  longitude,
  colors,
  t,
  readOnly = false,
  onNavigateToFacility,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Fetch group's current favorites (using the same hook as communities since both use network_favorite_facility)
  const {
    favorites,
    loading: favoritesLoading,
    addFavorite,
    removeFavorite,
    isFavorite,
    canManage,
  } = useCommunityFavoriteFacilities(groupId, currentPlayerId, latitude, longitude);

  // Helper to get sport labels for a facility
  const getSportLabels = useCallback(
    (facility: FacilitySearchResult): string[] => {
      const facilitySpIds = facility.sport_ids ?? [];
      const labels: string[] = [];
      for (let i = 0; i < allSportIds.length; i++) {
        if (facilitySpIds.includes(allSportIds[i])) {
          labels.push(sportNames[i] ?? '');
        }
      }
      return labels.filter(l => l.length > 0);
    },
    [allSportIds, sportNames]
  );

  // Determine sport IDs for facility search:
  // - If sportId is set, use only that sport
  // - If sportId is null (both sports), use allSportIds
  const searchSportIds = useMemo(() => {
    if (sportId) {
      return [sportId];
    }
    // Group has no specific sport = both sports
    return allSportIds.length > 0 ? allSportIds : undefined;
  }, [sportId, allSportIds]);

  // Facility search
  const { facilities: searchResults, isLoading: searchLoading } = useFacilitySearch({
    sportIds: searchSportIds,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    searchQuery,
    enabled: isDropdownOpen && latitude !== null && longitude !== null,
  });

  // Filter out already selected facilities from search results
  const filteredResults = useMemo(() => {
    return searchResults.filter(f => !isFavorite(f.id));
  }, [searchResults, isFavorite]);

  // Handle facility selection
  const handleSelectFacility = useCallback(
    async (facility: FacilitySearchResult) => {
      const success = await addFavorite(facility);
      if (success) {
        void successHaptic();
        setSearchQuery('');
      }
    },
    [addFavorite]
  );

  // Handle removing a favorite
  const handleRemoveFavorite = useCallback(
    async (facilityId: string) => {
      void selectionHaptic();
      await removeFavorite(facilityId);
    },
    [removeFavorite]
  );

  // Handle search input change
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (!isDropdownOpen && text.length > 0) {
        setIsDropdownOpen(true);
      }
    },
    [isDropdownOpen]
  );

  // Toggle dropdown
  const handleToggleDropdown = useCallback(() => {
    void lightHaptic();
    setIsDropdownOpen(prev => !prev);
    if (isDropdownOpen) {
      setSearchQuery('');
    }
  }, [isDropdownOpen]);

  const isLoading = favoritesLoading || searchLoading;
  const showSearch = canManage && !readOnly;

  // If no favorites and not a moderator, don't render anything
  if (favorites.length === 0 && !canManage) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('groups.favoriteFacilities')}
          </Text>
        </View>
        {favorites.length > 0 && (
          <Text style={[styles.countBadge, { color: colors.textMuted }]}>{favorites.length}</Text>
        )}
      </View>

      {/* Empty State for moderators */}
      {favorites.length === 0 && canManage && !readOnly && (
        <View style={[styles.emptyState, { borderColor: colors.border }]}>
          <Ionicons name="location-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
            {t('groups.noFavoriteFacilities')}
          </Text>
          <Text style={[styles.emptyStateHint, { color: colors.textMuted }]}>
            {t('groups.addFavoriteFacilitiesHint')}
          </Text>
        </View>
      )}

      {/* Current Favorites */}
      {favorites.length > 0 &&
        (favorites.length > 3 ? (
          // Scrollable container when more than 3 favorites
          <ScrollView
            style={styles.favoritesScrollContainer}
            contentContainerStyle={styles.favoritesScrollContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled
          >
            {favorites.map(fav => (
              <FavoriteCard
                key={fav.id}
                name={fav.facility.name}
                address={fav.facility.address}
                city={fav.facility.city}
                distanceMeters={fav.distanceMeters}
                courtCount={fav.courtCount}
                isFavorite={true}
                onToggleFavorite={
                  canManage && !readOnly ? () => handleRemoveFavorite(fav.facilityId) : undefined
                }
                onPress={
                  onNavigateToFacility ? () => onNavigateToFacility(fav.facilityId) : undefined
                }
                colors={colors}
                showFavoriteButton={canManage && !readOnly}
              />
            ))}
          </ScrollView>
        ) : (
          // Regular container for 3 or fewer favorites
          <View style={styles.favoritesContainer}>
            {favorites.map(fav => (
              <FavoriteCard
                key={fav.id}
                name={fav.facility.name}
                address={fav.facility.address}
                city={fav.facility.city}
                distanceMeters={fav.distanceMeters}
                courtCount={fav.courtCount}
                isFavorite={true}
                onToggleFavorite={
                  canManage && !readOnly ? () => handleRemoveFavorite(fav.facilityId) : undefined
                }
                onPress={
                  onNavigateToFacility ? () => onNavigateToFacility(fav.facilityId) : undefined
                }
                colors={colors}
                showFavoriteButton={canManage && !readOnly}
              />
            ))}
          </View>
        ))}

      {/* Search Input (only for moderators) */}
      {showSearch && (
        <View>
          <TouchableOpacity
            style={[
              styles.searchInputContainer,
              { backgroundColor: colors.inputBackground, borderColor: colors.border },
            ]}
            onPress={handleToggleDropdown}
            activeOpacity={0.8}
          >
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder={
                favorites.length === 0
                  ? t('groups.searchFacilityToAdd')
                  : t('groups.addAnotherFacility')
              }
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearchChange}
              onFocus={() => setIsDropdownOpen(true)}
            />
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name={isDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textMuted}
              />
            )}
          </TouchableOpacity>

          {/* Dropdown Results */}
          {isDropdownOpen && (
            <View
              style={[
                styles.dropdownContainer,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
            >
              {filteredResults.length > 0 ? (
                <ScrollView
                  style={styles.dropdownScroll}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {filteredResults.slice(0, 10).map(facility => (
                    <FacilitySearchItem
                      key={facility.id}
                      facility={facility}
                      isSelected={isFavorite(facility.id)}
                      onPress={() => handleSelectFacility(facility)}
                      colors={colors}
                      sportLabels={getSportLabels(facility)}
                    />
                  ))}
                </ScrollView>
              ) : searchQuery.length > 0 && !searchLoading ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('groups.noFacilitiesFound')}
                  </Text>
                </View>
              ) : !searchLoading && latitude !== null && longitude !== null ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('groups.typeToSearchFacility')}
                  </Text>
                </View>
              ) : latitude === null || longitude === null ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('groups.locationRequiredForFacilities')}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    padding: spacingPixels[4],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: spacingPixels[2],
  },
  emptyStateHint: {
    fontSize: 12,
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
  favoritesContainer: {
    marginBottom: spacingPixels[3],
    gap: spacingPixels[3],
  },
  favoritesScrollContainer: {
    maxHeight: 320, // Shows ~3.5 cards to indicate scrollability
    marginBottom: spacingPixels[3],
  },
  favoritesScrollContent: {
    gap: spacingPixels[3],
  },
  favoriteCard: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: spacingPixels[2],
  },
  heartButton: {
    padding: spacingPixels[1],
  },
  cardInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  cardInfoText: {
    fontSize: 13,
    flex: 1,
  },
  cardDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
    marginTop: spacingPixels[1],
  },
  cardDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  cardDetailText: {
    fontSize: 12,
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
  dropdownContainer: {
    marginTop: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: 250,
  },
  dropdownScroll: {
    maxHeight: 250,
  },
  searchResultItem: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  searchResultContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchResultInfo: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '500',
  },
  searchResultAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  sportTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  sportTag: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
  },
  sportTagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  searchResultRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  distanceText: {
    fontSize: 12,
  },
  noResults: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default GroupFavoriteFacilitiesSelector;

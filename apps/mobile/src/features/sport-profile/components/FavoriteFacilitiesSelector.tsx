/**
 * FavoriteFacilitiesSelector Component
 *
 * A searchable dropdown component for selecting up to 3 favorite facilities.
 * Shows current favorites and allows adding/removing them.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { lightHaptic, selectionHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useFacilitySearch, useFavoriteFacilities } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { TranslationKey } from '@rallia/shared-translations';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeColors {
  text: string;
  textMuted: string;
  inputBackground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  card: string;
}

interface FavoriteFacilitiesSelectorProps {
  /** Player ID for fetching/saving favorites */
  playerId: string;
  /** Sport ID for filtering facilities */
  sportId: string;
  /** User's latitude for distance calculation */
  latitude: number | null;
  /** User's longitude for distance calculation */
  longitude: number | null;
  /** Theme colors */
  colors: ThemeColors;
  /** Translation function */
  t: (key: TranslationKey) => string;
  /** Maximum number of favorites allowed */
  maxFavorites?: number;
  /** Callback when the sport-filtered favorites count changes */
  onFavoritesCountChange?: (count: number) => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MAX_FAVORITES = 3;

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

interface FavoriteBadgeProps {
  name: string;
  address: string | null;
  city: string | null;
  order: number;
  onRemove: () => void;
  colors: ThemeColors;
}

const FavoriteBadge: React.FC<FavoriteBadgeProps> = ({
  name,
  address,
  city,
  order,
  onRemove,
  colors,
}) => (
  <View
    style={[
      styles.favoriteBadge,
      { backgroundColor: `${colors.primary}15`, borderColor: colors.primary },
    ]}
  >
    <View style={[styles.orderBadge, { backgroundColor: colors.primary }]}>
      <Text style={[styles.orderText, { color: colors.primaryForeground }]}>{order}</Text>
    </View>
    <View style={styles.badgeTextContainer}>
      <Text style={[styles.badgeName, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      {(address || city) && (
        <Text style={[styles.badgeAddress, { color: colors.textMuted }]} numberOfLines={1}>
          {[address, city].filter(Boolean).join(', ')}
        </Text>
      )}
    </View>
    <TouchableOpacity
      onPress={onRemove}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.removeBadgeButton}
    >
      <Ionicons name="close-circle" size={20} color={colors.primary} />
    </TouchableOpacity>
  </View>
);

interface FacilitySearchItemProps {
  facility: FacilitySearchResult;
  isSelected: boolean;
  onPress: () => void;
  colors: ThemeColors;
}

const FacilitySearchItem: React.FC<FacilitySearchItemProps> = ({
  facility,
  isSelected,
  onPress,
  colors,
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

export const FavoriteFacilitiesSelector: React.FC<FavoriteFacilitiesSelectorProps> = ({
  playerId,
  sportId,
  latitude,
  longitude,
  colors,
  t,
  maxFavorites = DEFAULT_MAX_FAVORITES,
  onFavoritesCountChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Fetch user's current favorites — filtered by sport so only
  // facilities linked to this sport appear as "already favorite"
  const {
    favorites,
    loading: favoritesLoading,
    addFavorite,
    removeFavorite,
    isFavorite,
    isMaxReached,
  } = useFavoriteFacilities(playerId, sportId);

  // Notify parent of favorites count changes (used for min-3 enforcement)
  useEffect(() => {
    onFavoritesCountChange?.(favorites.length);
  }, [favorites.length, onFavoritesCountChange]);

  // Facility search
  const { facilities: searchResults, isLoading: searchLoading } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    searchQuery,
    enabled: isDropdownOpen && !!sportId && latitude !== null && longitude !== null,
  });

  // Filter out already selected facilities from search results
  const filteredResults = useMemo(() => {
    return searchResults.filter(f => !isFavorite(f.id));
  }, [searchResults, isFavorite]);

  // Handle facility selection
  const handleSelectFacility = useCallback(
    async (facility: FacilitySearchResult) => {
      if (isMaxReached) {
        warningHaptic();
        return;
      }

      const success = await addFavorite(facility);
      if (success) {
        successHaptic();
        setSearchQuery('');
        // Keep dropdown open to allow adding more if not at max
        if (favorites.length + 1 >= maxFavorites) {
          setIsDropdownOpen(false);
        }
      }
    },
    [addFavorite, isMaxReached, favorites.length, maxFavorites]
  );

  // Handle removing a favorite
  const handleRemoveFavorite = useCallback(
    async (facilityId: string) => {
      selectionHaptic();
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
    lightHaptic();
    setIsDropdownOpen(prev => !prev);
    if (isDropdownOpen) {
      setSearchQuery('');
    }
  }, [isDropdownOpen]);

  const isLoading = favoritesLoading || searchLoading;

  return (
    <View style={styles.container}>
      {/* Current Favorites */}
      {favorites.length > 0 && (
        <View style={styles.favoritesContainer}>
          {favorites.map((fav, index) => (
            <FavoriteBadge
              key={fav.id}
              name={fav.facility.name}
              address={fav.facility.address}
              city={fav.facility.city}
              order={index + 1}
              onRemove={() => handleRemoveFavorite(fav.facilityId)}
              colors={colors}
            />
          ))}
        </View>
      )}

      {/* Search Input */}
      {!isMaxReached && (
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
                  ? t('profile.preferences.searchFacility')
                  : t('profile.preferences.addAnotherFacility')
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
                    />
                  ))}
                </ScrollView>
              ) : searchQuery.length > 0 && !searchLoading ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('profile.preferences.noFacilitiesFound')}
                  </Text>
                </View>
              ) : !searchLoading && latitude !== null && longitude !== null ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('profile.preferences.typeToSearch')}
                  </Text>
                </View>
              ) : latitude === null || longitude === null ? (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: colors.textMuted }]}>
                    {t('profile.preferences.locationRequired')}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}

      {/* Max reached message with helpful hint */}
      {isMaxReached && (
        <View style={styles.maxReachedContainer}>
          <View style={styles.maxReachedIconRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={[styles.maxReachedTitle, { color: colors.text }]}>
              {t('profile.preferences.maxFavoritesReached')}
            </Text>
          </View>
          <Text style={[styles.maxReachedHint, { color: colors.textMuted }]}>
            {t('profile.preferences.tapToRemove')}
          </Text>
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
  favoritesContainer: {
    marginBottom: spacingPixels[3],
    gap: spacingPixels[2],
  },
  favoriteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  orderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacingPixels[3],
  },
  orderText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  badgeName: {
    fontSize: 14,
    fontWeight: '600',
  },
  badgeAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  removeBadgeButton: {
    padding: spacingPixels[1],
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
  maxReachedContainer: {
    marginTop: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    backgroundColor: 'transparent',
  },
  maxReachedIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  maxReachedTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  maxReachedHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacingPixels[1],
    fontStyle: 'italic',
  },
});

export default FavoriteFacilitiesSelector;

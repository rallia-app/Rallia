/**
 * FavoriteSitesStep Component
 *
 * Onboarding step to select favorite facilities/sites.
 * Single sport: at least 3 facilities.
 * Both sports: at least 3 tennis facilities AND 3 pickleball facilities.
 * Dual-sport facilities count toward both counters.
 * Uses useFacilitySearch hook for searching facilities by name and location.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { BottomSheetTextInput, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, selectionHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useFacilitySearch } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import { computeFavoriteSportCounts } from '../../../hooks/useOnboardingWizard';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';
import { useUserLocation } from '../../../../../hooks/useUserLocation';
import { SearchBar } from '../../../../../components/SearchBar';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  success?: string;
}

interface FavoriteSitesStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  /** Sport IDs for filtering facilities */
  sportIds: string[] | undefined;
  /** Sport names matching sportIds order */
  sportNames: string[];
  /** Whether the user selected tennis */
  hasTennis: boolean;
  /** Whether the user selected pickleball */
  hasPickleball: boolean;
  /** User's latitude for distance calculation */
  latitude: number | null;
  /** User's longitude for distance calculation */
  longitude: number | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_SINGLE_SPORT = 3;
const MIN_BOTH_SPORTS = 3;

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

/**
 * Get the display labels for sports a facility supports.
 */
function getSportLabels(
  facility: FacilitySearchResult,
  sportIds: string[],
  sportNames: string[]
): string[] {
  const facilitySpIds = facility.sport_ids ?? [];
  const labels: string[] = [];
  for (let i = 0; i < sportIds.length; i++) {
    if (facilitySpIds.includes(sportIds[i])) {
      const name = sportNames[i];
      labels.push(name.charAt(0).toUpperCase() + name.slice(1));
    }
  }
  return labels;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface FacilityCardProps {
  facility: FacilitySearchResult;
  isSelected: boolean;
  onPress: () => void;
  colors: ThemeColors;
  showSportTags: boolean;
  sportLabels: string[];
}

const FacilityCard: React.FC<FacilityCardProps> = ({
  facility,
  isSelected,
  onPress,
  colors,
  showSportTags,
  sportLabels,
}) => (
  <TouchableOpacity
    style={[
      styles.facilityCard,
      {
        backgroundColor: isSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
        borderColor: isSelected ? colors.buttonActive : colors.border,
      },
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.facilityCardContent}>
      {/* Facility icon */}
      <View
        style={[
          styles.facilityIconContainer,
          { backgroundColor: isSelected ? colors.buttonActive : colors.border },
        ]}
      >
        <Ionicons
          name="business"
          size={20}
          color={isSelected ? colors.buttonTextActive : colors.textMuted}
        />
      </View>

      {/* Facility info */}
      <View style={styles.facilityInfo}>
        <Text
          size="base"
          weight={isSelected ? 'semibold' : 'medium'}
          color={isSelected ? colors.buttonActive : colors.text}
          numberOfLines={1}
        >
          {facility.name}
        </Text>
        <Text size="sm" color={colors.textMuted} numberOfLines={1}>
          {[facility.address, facility.city].filter(Boolean).join(', ')}
        </Text>
        {/* Sport tags */}
        {showSportTags && sportLabels.length > 0 && (
          <View style={styles.sportTagsRow}>
            {sportLabels.map(label => (
              <View
                key={label}
                style={[styles.sportTag, { backgroundColor: `${colors.buttonActive}20` }]}
              >
                <Text size="xs" weight="medium" color={colors.buttonActive}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Distance and selection indicator */}
      <View style={styles.facilityCardRight}>
        {facility.distance_meters !== null && (
          <Text size="xs" color={colors.textSecondary} style={styles.distanceText}>
            {formatDistance(facility.distance_meters)}
          </Text>
        )}
        {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />}
      </View>
    </View>
  </TouchableOpacity>
);

interface SelectedFacilityBadgeProps {
  facility: FacilitySearchResult;
  onRemove: () => void;
  colors: ThemeColors;
  order: number;
}

const SelectedFacilityBadge: React.FC<SelectedFacilityBadgeProps> = ({
  facility,
  onRemove,
  colors,
  order,
}) => (
  <View
    style={[
      styles.selectedBadge,
      { backgroundColor: `${colors.buttonActive}15`, borderColor: colors.buttonActive },
    ]}
  >
    <View style={[styles.orderBadge, { backgroundColor: colors.buttonActive }]}>
      <Text size="xs" weight="bold" color={colors.buttonTextActive}>
        {order}
      </Text>
    </View>
    <Text
      size="sm"
      weight="medium"
      color={colors.text}
      numberOfLines={1}
      style={styles.selectedBadgeName}
    >
      {facility.name}
    </Text>
    <TouchableOpacity
      onPress={onRemove}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.removeBadgeButton}
    >
      <Ionicons name="close-circle" size={20} color={colors.buttonActive} />
    </TouchableOpacity>
  </View>
);

// =============================================================================
// SPORT COUNTER ROW
// =============================================================================

interface SportCounterRowProps {
  label: string;
  count: number;
  target: number;
  colors: ThemeColors;
}

const SportCounterBadge: React.FC<SportCounterRowProps> = ({ label, count, target, colors }) => {
  const met = count >= target;
  const accentColor = met ? (colors.success ?? colors.buttonActive) : colors.textMuted;
  return (
    <View
      style={[
        styles.sportCounterBadge,
        {
          backgroundColor: met ? `${accentColor}15` : 'transparent',
          borderColor: accentColor,
        },
      ]}
    >
      {met && <Ionicons name="checkmark-circle" size={16} color={accentColor} />}
      <Text size="sm" weight="bold" color={accentColor}>
        {label}
      </Text>
      <Text size="sm" weight="semibold" color={accentColor}>
        {count}/{target}
      </Text>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FavoriteSitesStep: React.FC<FavoriteSitesStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark: _isDark,
  sportIds,
  sportNames,
  hasTennis,
  hasPickleball,
  latitude: propLatitude,
  longitude: propLongitude,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const bothSports = hasTennis && hasPickleball;
  const maxFavorites = bothSports ? 6 : 3;

  // Get device location as fallback if props don't have coordinates
  // This handles cases where user typed city manually without using autocomplete
  const { location: deviceLocation, loading: locationLoading } = useUserLocation();

  // Use props coordinates first (from address autocomplete), fallback to device location
  const latitude = propLatitude ?? deviceLocation?.latitude ?? null;
  const longitude = propLongitude ?? deviceLocation?.longitude ?? null;

  // Use facility search hook
  const {
    facilities: searchResults,
    isLoading: facilitiesLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useFacilitySearch({
    sportIds,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    searchQuery,
    enabled: !!sportIds?.length && latitude !== null && longitude !== null,
  });

  // Combined loading state
  const isLoading = facilitiesLoading || (locationLoading && latitude === null);

  // Get selected facilities from form data (array of FacilitySearchResult)
  // Memoize to prevent dependency changes on every render
  const selectedFacilities = useMemo(
    () => formData.favoriteFacilities || [],
    [formData.favoriteFacilities]
  );
  const selectedFacilityIds = useMemo(
    () => selectedFacilities.map(f => f.id),
    [selectedFacilities]
  );

  // Compute per-sport counts
  const sportCounts = useMemo(() => computeFavoriteSportCounts(formData), [formData]);

  // Check if a facility is selected
  const isFacilitySelected = useCallback(
    (facilityId: string) => selectedFacilityIds.includes(facilityId),
    [selectedFacilityIds]
  );

  // Handle facility selection toggle
  const handleFacilityPress = useCallback(
    (facility: FacilitySearchResult) => {
      const isCurrentlySelected = isFacilitySelected(facility.id);

      if (isCurrentlySelected) {
        // Remove from selection
        lightHaptic();
        const newFacilities = selectedFacilities.filter(f => f.id !== facility.id);
        onUpdateFormData({ favoriteFacilities: newFacilities });
      } else {
        // Add to selection (if under max)
        if (selectedFacilities.length >= maxFavorites) {
          warningHaptic();
          return;
        }
        successHaptic();
        const newFacilities = [...selectedFacilities, facility];
        onUpdateFormData({ favoriteFacilities: newFacilities });
        // Clear search input after selecting a facility
        setSearchQuery('');
      }
    },
    [isFacilitySelected, selectedFacilities, onUpdateFormData, maxFavorites, setSearchQuery]
  );

  // Handle removing a selected facility
  const handleRemoveFacility = useCallback(
    (facilityId: string) => {
      selectionHaptic();
      const newFacilities = selectedFacilities.filter(f => f.id !== facilityId);
      onUpdateFormData({ favoriteFacilities: newFacilities });
    },
    [selectedFacilities, onUpdateFormData]
  );

  // Filter out already selected facilities from search results
  const filteredSearchResults = useMemo(() => {
    return searchResults.filter(f => !selectedFacilityIds.includes(f.id));
  }, [searchResults, selectedFacilityIds]);

  // Handle scroll to load more
  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        layoutMeasurement: { height: number };
        contentOffset: { y: number };
        contentSize: { height: number };
      };
    }) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const paddingToBottom = 100;
      const isCloseToBottom =
        layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;

      if (isCloseToBottom && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // Render empty state when no facilities found
  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('onboarding.favoriteSitesStep.loading')}
          </Text>
        </View>
      );
    }

    if (!sportIds?.length) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('onboarding.favoriteSitesStep.noSportSelected')}
          </Text>
        </View>
      );
    }

    if (latitude === null || longitude === null) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('onboarding.favoriteSitesStep.noLocation')}
          </Text>
        </View>
      );
    }

    if (searchQuery && filteredSearchResults.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('onboarding.favoriteSitesStep.noResults')}
          </Text>
        </View>
      );
    }

    if (filteredSearchResults.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="business-outline" size={48} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('onboarding.favoriteSitesStep.noFacilitiesNearby')}
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <BottomSheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      onScroll={handleScroll}
      scrollEventThrottle={400}
    >
      {/* Title */}
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.favoriteSitesStep.title')}
      </Text>
      <Text size="base" color={colors.textSecondary} style={styles.subtitle}>
        {bothSports
          ? t('onboarding.favoriteSitesStep.subtitleBothSports')
          : t('onboarding.favoriteSitesStep.subtitle')}
      </Text>

      {/* Optional hint - at top so users see it before scrolling */}
      <View style={styles.hintContainer}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
        <Text size="xs" color={colors.textMuted} style={styles.hintText}>
          {t('onboarding.favoriteSitesStep.hint')}
        </Text>
      </View>

      {/* Selection counters */}
      <View style={styles.counterContainer}>
        {bothSports ? (
          <View style={styles.counterRow}>
            <SportCounterBadge
              label={t('onboarding.favoriteSitesStep.tennisCount')}
              count={sportCounts.tennisCount}
              target={MIN_BOTH_SPORTS}
              colors={colors}
            />
            <SportCounterBadge
              label={t('onboarding.favoriteSitesStep.pickleballCount')}
              count={sportCounts.pickleballCount}
              target={MIN_BOTH_SPORTS}
              colors={colors}
            />
          </View>
        ) : (
          <Text
            size="sm"
            weight="semibold"
            color={
              selectedFacilities.length >= MIN_SINGLE_SPORT ? colors.buttonActive : colors.textMuted
            }
          >
            {selectedFacilities.length} / {MIN_SINGLE_SPORT}{' '}
            {t('onboarding.favoriteSitesStep.selected')}
          </Text>
        )}
      </View>

      {/* Selected facilities badges */}
      {selectedFacilities.length > 0 && (
        <View style={styles.selectedContainer}>
          {selectedFacilities.map((facility, index) => (
            <SelectedFacilityBadge
              key={facility.id}
              facility={facility}
              onRemove={() => handleRemoveFacility(facility.id)}
              colors={colors}
              order={index + 1}
            />
          ))}
        </View>
      )}

      {/* Search input */}
      <View style={styles.searchSection}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('onboarding.favoriteSitesStep.searchLabel')}
        </Text>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('onboarding.favoriteSitesStep.searchPlaceholder')}
          colors={colors}
          InputComponent={BottomSheetTextInput}
        />
      </View>

      {/* Facility list */}
      <View style={styles.facilityListSection}>
        {filteredSearchResults.length > 0 ? (
          <>
            {filteredSearchResults.map(facility => (
              <FacilityCard
                key={facility.id}
                facility={facility}
                isSelected={isFacilitySelected(facility.id)}
                onPress={() => handleFacilityPress(facility)}
                colors={colors}
                showSportTags={bothSports}
                sportLabels={
                  bothSports && sportIds ? getSportLabels(facility, sportIds, sportNames) : []
                }
              />
            ))}
            {isFetchingNextPage && (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.buttonActive} />
              </View>
            )}
          </>
        ) : (
          renderEmptyState()
        )}
      </View>
    </BottomSheetScrollView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[12],
  },
  title: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  subtitle: {
    marginBottom: spacingPixels[6],
  },
  counterContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[3],
  },
  sportCounterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  selectedContainer: {
    marginBottom: spacingPixels[6],
    gap: spacingPixels[2],
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  orderBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
  },
  selectedBadgeName: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  removeBadgeButton: {
    padding: spacingPixels[1],
  },
  searchSection: {
    marginBottom: spacingPixels[4],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  facilityListSection: {
    minHeight: 200,
  },
  facilityCard: {
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    overflow: 'hidden',
  },
  facilityCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
  },
  facilityIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  facilityInfo: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  sportTagsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  sportTag: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.md,
  },
  facilityCardRight: {
    alignItems: 'flex-end',
    gap: spacingPixels[1],
  },
  distanceText: {
    marginBottom: spacingPixels[1],
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[10],
  },
  emptyStateText: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacingPixels[4],
    paddingHorizontal: spacingPixels[2],
    gap: spacingPixels[2],
  },
  hintText: {
    flex: 1,
    lineHeight: 18,
  },
});

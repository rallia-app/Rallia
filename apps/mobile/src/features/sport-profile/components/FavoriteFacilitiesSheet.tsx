/**
 * FavoriteFacilitiesSheet
 *
 * Bottom sheet for editing favorite facilities from the SportProfile screen.
 * Uses a search bar with all facilities listed by distance, selected facilities
 * displayed above the search bar as badge cards — matching the onboarding
 * FavoriteSitesStep UX.
 *
 * Selection is managed locally; changes are persisted only when the user
 * presses Save.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { useFacilitySearch } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { lightHaptic, selectionHaptic, successHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';
import TennisCourtIcon from '../../../../assets/icons/tennis-court.svg';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_FAVORITES = 2;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

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

interface FacilityCardProps {
  facility: FacilitySearchResult;
  isSelected: boolean;
  onPress: () => void;
}

const FacilityCard: React.FC<FacilityCardProps> = ({ facility, isSelected, onPress }) => {
  const { colors } = useThemeStyles();
  return (
    <TouchableOpacity
      style={[
        styles.facilityCard,
        {
          backgroundColor: isSelected ? `${colors.primary}15` : colors.inputBackground,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.facilityCardContent}>
        <View
          style={[
            styles.facilityIconContainer,
            { backgroundColor: isSelected ? colors.primary : colors.border },
          ]}
        >
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <TennisCourtIcon
              width={20}
              height={20}
              stroke={isSelected ? colors.primaryForeground : colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.facilityInfo}>
          <Text
            style={[
              styles.facilityName,
              {
                color: isSelected ? colors.primary : colors.text,
                fontWeight: isSelected ? '600' : '500',
              },
            ]}
            numberOfLines={1}
          >
            {facility.name}
          </Text>
          <Text style={[styles.facilityAddress, { color: colors.textMuted }]} numberOfLines={1}>
            {[facility.address, facility.city].filter(Boolean).join(', ')}
          </Text>
        </View>

        <View style={styles.facilityCardRight}>
          {facility.distance_meters !== null && (
            <Text style={[styles.distanceText, { color: colors.textMuted }]}>
              {formatDistance(facility.distance_meters)}
            </Text>
          )}
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
        </View>
      </View>
    </TouchableOpacity>
  );
};

interface SelectedFacilityBadgeProps {
  name: string;
  order: number;
  onRemove: () => void;
  disabled?: boolean;
}

const SelectedFacilityBadge: React.FC<SelectedFacilityBadgeProps> = ({
  name,
  order,
  onRemove,
  disabled,
}) => {
  const { colors } = useThemeStyles();
  return (
    <View
      style={[
        styles.selectedBadge,
        { backgroundColor: `${colors.primary}15`, borderColor: colors.primary },
      ]}
    >
      <View style={[styles.orderBadge, { backgroundColor: colors.primary }]}>
        <Text style={[styles.orderText, { color: colors.primaryForeground }]}>{order}</Text>
      </View>
      <Text style={[styles.selectedBadgeName, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      {!disabled && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.removeBadgeButton}
        >
          <Ionicons name="close-circle" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function FavoriteFacilitiesActionSheet({ payload }: SheetProps<'favorite-facilities'>) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const playerId = payload?.playerId;
  const sportId = payload?.sportId;
  const latitude = payload?.latitude;
  const longitude = payload?.longitude;
  const onSave = payload?.onSave;
  const onDismiss = payload?.onDismiss;
  const minFavorites = payload?.minFavorites ?? MIN_FAVORITES;

  const didSaveRef = useRef(false);

  const [searchQuery, setSearchQuery] = useState('');

  // Local selection state — array of FacilitySearchResult objects
  const [selectedFacilities, setSelectedFacilities] = useState<FacilitySearchResult[]>([]);
  const [initialised, setInitialised] = useState(false);

  // Search facilities sorted by distance
  const {
    facilities: searchResults,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    searchQuery,
    enabled: !!sportId && latitude !== null && longitude !== null,
  });

  // Seed selected state from search results once they arrive
  // (match initialFacilityIds against the loaded facilities)
  const initialFacilityIds = payload?.initialFacilityIds;
  if (
    !initialised &&
    searchResults.length > 0 &&
    initialFacilityIds &&
    initialFacilityIds.length > 0
  ) {
    const idSet = new Set(initialFacilityIds);
    const matched = searchResults.filter(f => idSet.has(f.id));
    // Preserve the original order from initialFacilityIds
    const ordered = initialFacilityIds
      .map(id => matched.find(f => f.id === id))
      .filter((f): f is FacilitySearchResult => !!f);
    setSelectedFacilities(ordered);
    setInitialised(true);
  } else if (
    !initialised &&
    searchResults.length > 0 &&
    (!initialFacilityIds || initialFacilityIds.length === 0)
  ) {
    setInitialised(true);
  }

  const selectedIds = useMemo(
    () => new Set(selectedFacilities.map(f => f.id)),
    [selectedFacilities]
  );

  // Filter out already selected facilities from the list
  const filteredResults = useMemo(() => {
    return searchResults.filter(f => !selectedIds.has(f.id));
  }, [searchResults, selectedIds]);

  const handleSelectFacility = useCallback((facility: FacilitySearchResult) => {
    successHaptic();
    setSelectedFacilities(prev => [...prev, facility]);
    setSearchQuery('');
  }, []);

  const handleRemoveFacility = useCallback((facilityId: string) => {
    lightHaptic();
    setSelectedFacilities(prev => prev.filter(f => f.id !== facilityId));
  }, []);

  const handleToggleFacility = useCallback(
    (facility: FacilitySearchResult) => {
      if (selectedIds.has(facility.id)) {
        handleRemoveFacility(facility.id);
      } else {
        handleSelectFacility(facility);
      }
    },
    [selectedIds, handleRemoveFacility, handleSelectFacility]
  );

  const canSave = selectedFacilities.length >= minFavorites;

  const handleSave = useCallback(() => {
    mediumHaptic();
    didSaveRef.current = true;
    onSave?.(selectedFacilities.map(f => f.id));
    SheetManager.hide('favorite-facilities');
  }, [onSave, selectedFacilities]);

  // Scroll-to-load pagination
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

  const onClose = () => {
    SheetManager.hide('favorite-facilities');
  };

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (latitude === null || longitude === null) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>
            {t('profile.preferences.locationRequired')}
          </Text>
        </View>
      );
    }

    if (searchQuery && filteredResults.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>
            {t('profile.preferences.noFacilitiesFound')}
          </Text>
        </View>
      );
    }

    if (filteredResults.length === 0) {
      return (
        <View style={styles.emptyState}>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <TennisCourtIcon width={48} height={48} stroke={colors.textMuted} />
          </View>
          <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>
            {t('profile.preferences.noFacilitiesFound')}
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeClose={() => {
        if (onDismiss && !didSaveRef.current) {
          onDismiss();
        }
      }}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('profile.fields.favoriteFacilities')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={400}
        >
          {/* Selected facilities badges */}
          {selectedFacilities.length > 0 && (
            <View style={styles.selectedContainer}>
              {selectedFacilities.map((facility, index) => (
                <SelectedFacilityBadge
                  key={facility.id}
                  name={facility.name}
                  order={index + 1}
                  onRemove={() => handleRemoveFacility(facility.id)}
                  disabled={selectedFacilities.length <= minFavorites}
                />
              ))}
            </View>
          )}

          {/* Search bar */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('profile.preferences.searchFacility')}
            style={styles.searchBar}
          />

          {/* Facility list */}
          <View style={styles.facilityListSection}>
            {filteredResults.length > 0 ? (
              <>
                {filteredResults.map(facility => (
                  <FacilityCard
                    key={facility.id}
                    facility={facility}
                    isSelected={selectedIds.has(facility.id)}
                    onPress={() => handleToggleFacility(facility)}
                  />
                ))}
                {isFetchingNextPage && (
                  <View style={styles.footerLoader}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
              </>
            ) : (
              renderEmptyState()
            )}
          </View>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              !canSave && { opacity: 0.6 },
            ]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.8}
          >
            <Text weight="semibold" style={{ color: colors.primaryForeground }}>
              {t('common.save')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  selectedContainer: {
    marginBottom: spacingPixels[4],
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
  orderText: {
    fontSize: 12,
    fontWeight: '700',
  },
  selectedBadgeName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    marginRight: spacingPixels[2],
  },
  removeBadgeButton: {
    padding: spacingPixels[1],
  },
  searchBar: {
    marginBottom: spacingPixels[4],
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
  facilityName: {
    fontSize: 14,
  },
  facilityAddress: {
    fontSize: 12,
  },
  facilityCardRight: {
    alignItems: 'flex-end',
    gap: spacingPixels[1],
  },
  distanceText: {
    fontSize: 12,
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
    fontSize: 14,
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
  },
});

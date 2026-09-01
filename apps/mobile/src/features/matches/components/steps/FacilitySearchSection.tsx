/**
 * Facility Search Section
 *
 * The dynamic facility-search portion of the Where step: search input with
 * location-mode selector, nearby facility list with slot chips, and infinite
 * scroll. Extracted from WhereStep so the step's static chrome can mount
 * instantly while this section (and its data hooks) mounts one idle tick
 * later.
 */

import React, { useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, LocationSelector } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent, secondary } from '@rallia/design-system';
import { formatDistance, lightHaptic } from '@rallia/shared-utils';
import {
  useFacilitySearch,
  usePreferredFacility,
  useCourtAvailability,
  useFavoriteFacilities,
} from '@rallia/shared-hooks';
import type { FormattedSlot } from '@rallia/shared-hooks';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { SearchBar } from '#/components/SearchBar';
import type { KeyboardAwareInputProps } from '#/hooks/useKeyboardAwareSheetScroll';
import type { TranslationKey, TranslationOptions } from '#/hooks/useTranslation';

// =============================================================================
// TYPES
// =============================================================================

interface StepColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  cardBackground: string;
}

interface FacilitySearchSectionProps {
  colors: StepColors;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  sportId: string | undefined;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  /** Keyboard-aware wiring for the search input (owned by WhereStep's scroll) */
  searchInput: KeyboardAwareInputProps;
  location: { latitude: number; longitude: number } | null;
  locationLoading: boolean;
  locationMode: 'current' | 'home';
  onSelectLocationMode: (mode: 'current' | 'home') => void;
  hasHomeLocation: boolean;
  hasBothLocationOptions: boolean;
  homeLocationLabel?: string;
  playerId: string | null;
  preferredFacilityId?: string;
  onSelectFacility: (facility: FacilitySearchResult) => void;
  onSlotPress: (facility: FacilitySearchResult, slot: FormattedSlot) => void;
  /** WhereStep's scroll handler calls this to load the next page */
  loadMoreRef: React.MutableRefObject<(() => void) | null>;
}

// =============================================================================
// SKELETON SLOTS
// =============================================================================

interface SkeletonProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  colors: StepColors;
  style?: object;
}

const Skeleton: React.FC<SkeletonProps> = ({ width, height, borderRadius = 4, colors, style }) => {
  // Use useMemo to avoid accessing refs during render
  const pulseAnim = React.useMemo(() => new Animated.Value(0.3), []);

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.border,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
};

interface SkeletonSlotsProps {
  colors: StepColors;
}

const SkeletonSlots: React.FC<SkeletonSlotsProps> = ({ colors }) => {
  return (
    <View style={styles.slotsContainer}>
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
    </View>
  );
};

// =============================================================================
// FACILITY ITEM
// =============================================================================

interface FacilityItemProps {
  facility: FacilitySearchResult;
  onSelect: (facility: FacilitySearchResult) => void;
  onSlotPress?: (facility: FacilitySearchResult, slot: FormattedSlot) => void;
  colors: StepColors;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  /** Whether this is the user's preferred facility */
  isPreferred?: boolean;
  /** Whether this facility is in the user's favorites */
  isFavorite?: boolean;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
}

const FacilityItem: React.FC<FacilityItemProps> = ({
  facility,
  onSelect,
  onSlotPress,
  colors,
  t,
  isDark,
  isPreferred = false,
  isFavorite = false,
  sportName,
}) => {
  // Fetch availability using the unified system (local-first, then external provider)
  const { slotsByDate, isLoading } = useCourtAvailability({
    facilityId: facility.id,
    dataProviderId: facility.data_provider_id,
    dataProviderType: facility.data_provider_type,
    externalProviderId: facility.external_provider_id,
    bookingUrlTemplate: facility.booking_url_template,
    facilityTimezone: facility.timezone,
    sportName,
  });

  // Determine if slot is actionable (has booking URL or is a local slot)
  const isSlotActionable = (slot: FormattedSlot): boolean => {
    return !!slot.bookingUrl || !!slot.isLocalSlot;
  };

  const handleSlotPress = (slot: FormattedSlot) => {
    if (onSlotPress && isSlotActionable(slot)) {
      lightHaptic();
      onSlotPress(facility, slot);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.facilityItem,
        { backgroundColor: colors.buttonInactive, borderColor: colors.border },
      ]}
      onPress={() => {
        lightHaptic();
        onSelect(facility);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.facilityItemContent}>
        {/* Header row with name and distance */}
        <View style={styles.facilityHeader}>
          <View style={styles.facilityNameContainer}>
            <View style={styles.facilityNameRow}>
              {isFavorite && !isPreferred && (
                <View
                  style={[
                    styles.favoriteIconBadge,
                    { backgroundColor: `${isDark ? secondary[400] : secondary[500]}20` },
                  ]}
                >
                  <Ionicons
                    name="heart"
                    size={10}
                    color={isDark ? secondary[400] : secondary[500]}
                  />
                </View>
              )}
              <Text
                size="base"
                weight="medium"
                color={colors.text}
                numberOfLines={1}
                style={{ flexShrink: 1 }}
              >
                {facility.name}
              </Text>
              {isPreferred && (
                <View
                  style={[styles.preferredBadge, { backgroundColor: `${colors.buttonActive}20` }]}
                >
                  <Ionicons name="star" size={10} color={colors.buttonActive} />
                  <Text size="xs" weight="semibold" color={colors.buttonActive}>
                    {t('matchCreation.fields.preferredFacility')}
                  </Text>
                </View>
              )}
            </View>
            <Text size="sm" color={colors.textMuted} numberOfLines={1}>
              {[facility.address, facility.city].filter(Boolean).join(', ')}
            </Text>
          </View>
          {facility.distance_meters !== null && (
            <View style={styles.distanceBadge}>
              <Text size="xs" color={colors.textSecondary}>
                {formatDistance(facility.distance_meters)}
              </Text>
            </View>
          )}
        </View>

        {/* First come first serve alert */}
        {facility.is_first_come_first_serve && (
          <View
            style={[
              styles.fcfsAlert,
              {
                backgroundColor: (isDark ? accent[400] : accent[500]) + '15',
                borderColor: isDark ? accent[400] : accent[500],
              },
            ]}
          >
            <Ionicons name="walk-outline" size={14} color={isDark ? accent[400] : accent[500]} />
            <Text size="xs" weight="medium" color={isDark ? accent[400] : accent[500]}>
              {t('matchCreation.booking.firstComeFirstServe')}
            </Text>
          </View>
        )}

        {/* Skeleton slots while loading */}
        {isLoading && !facility.is_first_come_first_serve && <SkeletonSlots colors={colors} />}

        {/* Date-sectioned slots with horizontal scroll */}
        {slotsByDate.length > 0 && !isLoading && !facility.is_first_come_first_serve && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.slotsScrollContent}
            style={styles.slotsScrollView}
          >
            {slotsByDate.map(dateGroup => (
              <View key={dateGroup.dateKey} style={styles.dateGroup}>
                <Text
                  size="xs"
                  weight="semibold"
                  color={dateGroup.isToday ? colors.buttonActive : colors.textMuted}
                  style={styles.dateLabel}
                >
                  {dateGroup.dateLabel}
                </Text>
                <View style={styles.dateSlotsRow}>
                  {dateGroup.slots.map((slot, index) => {
                    // Slot is tappable if it has a booking URL (external) or is a local slot
                    const isTappable = !!slot.bookingUrl || !!slot.isLocalSlot;
                    return (
                      <TouchableOpacity
                        key={`${slot.facilityScheduleId}-${index}`}
                        style={[
                          styles.slotChip,
                          {
                            backgroundColor: isTappable
                              ? `${colors.buttonActive}15`
                              : colors.buttonInactive,
                            borderColor: isTappable ? colors.buttonActive : colors.border,
                          },
                        ]}
                        onPress={() => isTappable && handleSlotPress(slot)}
                        disabled={!isTappable}
                        activeOpacity={0.7}
                      >
                        <Text
                          size="xs"
                          weight="medium"
                          color={isTappable ? colors.buttonActive : colors.textMuted}
                        >
                          {slot.time}
                        </Text>
                        {/* Show court count badge for external slots, building icon for local */}
                        {slot.isLocalSlot ? (
                          <Ionicons name="business-outline" size={10} color={colors.buttonActive} />
                        ) : (
                          slot.courtCount > 0 && (
                            <View
                              style={[
                                styles.courtCountBadge,
                                {
                                  backgroundColor: isTappable
                                    ? colors.buttonActive
                                    : isDark
                                      ? colors.border
                                      : colors.textMuted,
                                },
                              ]}
                            >
                              <Text
                                size="xs"
                                weight="bold"
                                color={isTappable ? colors.buttonTextActive : colors.buttonInactive}
                                style={styles.courtCountText}
                              >
                                {slot.courtCount}
                              </Text>
                            </View>
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Empty state when no slots available - only show if we fetched but got no results */}
        {slotsByDate.length === 0 && !isLoading && !facility.is_first_come_first_serve && (
          <View style={styles.emptySlots}>
            <Ionicons name="calendar-clear-outline" size={14} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted}>
              {t('matchCreation.booking.noSlotsAvailable')}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FacilitySearchSection: React.FC<FacilitySearchSectionProps> = ({
  colors,
  t,
  isDark,
  sportId,
  sportName,
  searchQuery,
  onSearchQueryChange,
  searchInput,
  location,
  locationLoading,
  locationMode,
  onSelectLocationMode,
  hasHomeLocation,
  hasBothLocationOptions,
  homeLocationLabel,
  playerId,
  preferredFacilityId,
  onSelectFacility,
  onSlotPress,
  loadMoreRef,
}) => {
  // Facility search hook (this component only mounts while the search UI shows)
  const {
    facilities: searchFacilities,
    isLoading: facilitiesLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: facilitiesError,
  } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude: location?.latitude,
    longitude: location?.longitude,
    searchQuery,
    playerId,
    enabled: true,
  });

  // Preferred facility hook - fetch the player's preferred facility
  const { preferredFacility } = usePreferredFacility({
    preferredFacilityId,
    sportId,
    latitude: location?.latitude,
    longitude: location?.longitude,
    enabled: !!preferredFacilityId,
  });

  // Favorites management
  const { favorites, isFavorite: isFavoriteFacility } = useFavoriteFacilities(playerId, sportId);

  // Merge facilities list with preferred facility first, then favorites, deduplicating
  const facilities = useMemo(() => {
    let merged = searchFacilities;

    // Insert preferred facility at the top if available
    if (preferredFacility) {
      merged = [preferredFacility, ...merged.filter(f => f.id !== preferredFacility.id)];
    }

    // Sort favorites first (after preferred), preserving distance order within each group
    const favoriteIds = new Set(favorites.map(f => f.facilityId));
    const preferredId = preferredFacility?.id;

    const preferred = merged.filter(f => f.id === preferredId);
    const favs = merged.filter(f => f.id !== preferredId && favoriteIds.has(f.id));
    const rest = merged.filter(f => f.id !== preferredId && !favoriteIds.has(f.id));

    return [...preferred, ...favs, ...rest];
  }, [preferredFacility, searchFacilities, favorites]);

  // Expose load-more to WhereStep's scroll handler (the step owns the ScrollView)
  useEffect(() => {
    loadMoreRef.current = () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    };
    return () => {
      loadMoreRef.current = null;
    };
  }, [loadMoreRef, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render empty state
  const renderEmptyState = () => {
    if (facilitiesLoading || locationLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.buttonActive} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {locationLoading
              ? t('matchCreation.fields.gettingLocation')
              : t('matchCreation.fields.searchingFacilities')}
          </Text>
        </View>
      );
    }

    if (facilitiesError) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.failedToLoadFacilities')}
          </Text>
        </View>
      );
    }

    if (searchQuery && facilities.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.noFacilitiesFound', { query: searchQuery })}
          </Text>
        </View>
      );
    }

    if (!searchQuery && facilities.length === 0 && !isFetching) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="business-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.noFacilitiesAvailable')}
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <>
      {/* Search input with location selector */}
      <View style={styles.searchRow}>
        <View style={styles.searchBarFlex}>
          <SearchBar
            inputRef={searchInput.ref}
            onFocus={searchInput.onFocus}
            onBlur={searchInput.onBlur}
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            placeholder={t('matchCreation.fields.facilityPlaceholder')}
            colors={colors}
            InputComponent={TextInput}
            containerStyle={styles.compactSearchContainer}
          />
        </View>
        {hasBothLocationOptions && (
          <LocationSelector
            selectedMode={locationMode}
            onSelectMode={onSelectLocationMode}
            hasHomeLocation={hasHomeLocation}
            homeLocationLabel={homeLocationLabel}
            isDark={isDark}
            t={t}
          />
        )}
      </View>

      {/* Facility list */}
      {facilities.length > 0 ? (
        <View style={styles.facilityListContainer}>
          {facilities.map(facility => (
            <FacilityItem
              key={facility.id}
              facility={facility}
              onSelect={onSelectFacility}
              onSlotPress={onSlotPress}
              colors={colors}
              t={t}
              isDark={isDark}
              isPreferred={facility.id === preferredFacilityId}
              isFavorite={isFavoriteFacility(facility.id)}
              sportName={sportName}
            />
          ))}
          {isFetchingNextPage && (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.buttonActive} />
            </View>
          )}
        </View>
      ) : (
        renderEmptyState()
      )}
    </>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  searchBarFlex: {
    flex: 1,
  },
  compactSearchContainer: {
    paddingVertical: spacingPixels[2],
  },
  facilityListContainer: {
    marginTop: spacingPixels[3],
  },
  facilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  facilityItemContent: {
    flex: 1,
  },
  facilityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  facilityNameContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
    gap: spacingPixels[2],
  },
  facilityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  favoriteIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  slotsScrollView: {
    marginTop: spacingPixels[2],
    marginHorizontal: -spacingPixels[3], // Extend to card edges
  },
  slotsScrollContent: {
    paddingHorizontal: spacingPixels[3],
    gap: spacingPixels[4],
  },
  dateGroup: {
    gap: spacingPixels[1],
  },
  dateLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
  },
  dateSlotsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  slotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
  },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  courtCountBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[0.5],
  },
  courtCountText: {
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
  },
  emptySlots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  fcfsAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  distanceBadge: {
    marginLeft: spacingPixels[2],
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
    gap: spacingPixels[2],
  },
  emptyStateText: {
    textAlign: 'center',
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});

export default FacilitySearchSection;

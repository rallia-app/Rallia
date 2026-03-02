/**
 * AvailabilityTab Component
 * Displays court availability slots with date picker, time-of-day groupings,
 * and enhanced visual design.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  shadowsNative,
  primary,
  neutral,
} from '@rallia/design-system';
import type { FormattedSlot } from '@rallia/shared-hooks';
import type { Court } from '@rallia/shared-types';
import type { FacilityWithDetails } from '@rallia/shared-services';
import { lightHaptic } from '@rallia/shared-utils';

import { useRequireOnboarding, type TranslationKey, type TranslationOptions } from '../../../hooks';
import { useActionsSheet } from '../../../context';
import { SheetManager } from 'react-native-actions-sheet';
import AvailabilitySlotCard from './AvailabilitySlotCard';
import DatePickerBar from './DatePickerBar';
import TimeOfDaySection, { groupSlotsByTimeOfDay } from './TimeOfDaySection';

// =============================================================================
// TYPES
// =============================================================================

interface AvailabilityTabProps {
  facility: FacilityWithDetails;
  slots: FormattedSlot[];
  courts: Court[];
  isLoading: boolean;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
    background: string;
    error: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

interface DateItem {
  dateKey: string;
  label: string;
  dayOfWeek: string;
  dayNumber: string;
  month: string;
  isToday: boolean;
  isTomorrow: boolean;
  slotCount: number;
  slots: FormattedSlot[];
}

type TimeFilter = 'all' | 'morning' | 'afternoon' | 'evening';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Groups slots by date and creates date items for the date picker
 */
function groupSlotsByDate(slots: FormattedSlot[]): DateItem[] {
  const groups: Map<string, FormattedSlot[]> = new Map();

  slots.forEach(slot => {
    const dateKey = slot.datetime.toDateString();
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(slot);
  });

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return Array.from(groups.entries()).map(([dateKey, dateSlots]) => {
    const date = dateSlots[0].datetime;
    const isToday = date.toDateString() === today.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    let label: string;
    if (isToday) {
      label = 'Today';
    } else if (isTomorrow) {
      label = 'Tomorrow';
    } else {
      label = date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }

    return {
      dateKey,
      label,
      dayOfWeek: date.toLocaleDateString(undefined, { weekday: 'short' }),
      dayNumber: date.getDate().toString(),
      month: date.toLocaleDateString(undefined, { month: 'short' }),
      isToday,
      isTomorrow,
      slotCount: dateSlots.length,
      slots: dateSlots.sort((a, b) => a.datetime.getTime() - b.datetime.getTime()),
    };
  });
}

// =============================================================================
// FILTER CHIPS COMPONENT
// =============================================================================

interface FilterChipsProps {
  activeFilter: TimeFilter;
  onFilterChange: (filter: TimeFilter) => void;
  colors: AvailabilityTabProps['colors'];
  isDark: boolean;
  t: AvailabilityTabProps['t'];
}

function FilterChips({ activeFilter, onFilterChange, colors, isDark, t }: FilterChipsProps) {
  const filters: { key: TimeFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: t('facilityDetail.filters.allTimes'), icon: 'time-outline' },
    { key: 'morning', label: t('facilityDetail.timeOfDay.morning'), icon: 'sunny-outline' },
    {
      key: 'afternoon',
      label: t('facilityDetail.timeOfDay.afternoon'),
      icon: 'partly-sunny-outline',
    },
    { key: 'evening', label: t('facilityDetail.timeOfDay.evening'), icon: 'moon-outline' },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterChipsContainer}
    >
      {filters.map(filter => {
        const isActive = activeFilter === filter.key;
        return (
          <TouchableOpacity
            key={filter.key}
            onPress={() => {
              lightHaptic();
              onFilterChange(filter.key);
            }}
            activeOpacity={0.7}
            style={[
              styles.filterChip,
              {
                backgroundColor: isActive ? primary[500] : isDark ? neutral[800] : colors.card,
                borderColor: isActive ? primary[500] : isDark ? neutral[700] : neutral[200],
              },
            ]}
          >
            <Ionicons name={filter.icon} size={14} color={isActive ? '#fff' : colors.textMuted} />
            <Text
              size="xs"
              weight={isActive ? 'semibold' : 'medium'}
              color={isActive ? '#fff' : colors.text}
            >
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// =============================================================================
// SKELETON LOADING COMPONENT
// =============================================================================

interface SkeletonLoadingProps {
  colors: AvailabilityTabProps['colors'];
  isDark: boolean;
}

function SkeletonLoading({ colors: _colors, isDark }: SkeletonLoadingProps) {
  const skeletonBg = isDark ? neutral[800] : '#E1E9EE';
  const skeletonHighlight = isDark ? neutral[700] : '#F2F8FC';

  return (
    <View style={styles.skeletonContainer}>
      {/* Date picker skeleton */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.skeletonDateRow}
      >
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton
            key={i}
            width={80}
            height={100}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
            style={{ borderRadius: radiusPixels.xl }}
          />
        ))}
      </ScrollView>

      {/* Filter chips skeleton */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.skeletonFilterRow}
      >
        {[1, 2, 3, 4].map(i => (
          <Skeleton
            key={i}
            width={90}
            height={32}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
            style={{ borderRadius: radiusPixels.full }}
          />
        ))}
      </ScrollView>

      {/* Time section skeletons */}
      {[1, 2].map(section => (
        <View key={section} style={styles.skeletonSection}>
          {/* Section header skeleton */}
          <View style={styles.skeletonSectionHeader}>
            <Skeleton
              width={32}
              height={32}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ borderRadius: radiusPixels.md }}
            />
            <View style={styles.skeletonSectionText}>
              <Skeleton
                width={80}
                height={14}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ borderRadius: radiusPixels.sm }}
              />
              <Skeleton
                width={100}
                height={12}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ borderRadius: radiusPixels.sm, marginTop: 4 }}
              />
            </View>
          </View>

          {/* Slot cards skeleton */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.skeletonSlotsRow}
          >
            {[1, 2, 3, 4].map(i => (
              <Skeleton
                key={i}
                width={110}
                height={160}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ borderRadius: radiusPixels.xl }}
              />
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

interface EmptyStateProps {
  facility: FacilityWithDetails;
  colors: AvailabilityTabProps['colors'];
  isDark: boolean;
  t: AvailabilityTabProps['t'];
}

function EmptyState({ facility, colors, isDark, t }: EmptyStateProps) {
  const hasExternalBooking = Boolean(facility.booking_url_template);

  const handleExternalBooking = useCallback(() => {
    if (facility.booking_url_template) {
      lightHaptic();
    }
  }, [facility.booking_url_template]);

  return (
    <View style={styles.emptyContainer}>
      <View
        style={[
          styles.emptyCard,
          { backgroundColor: colors.card },
          isDark ? shadowsNative.sm : shadowsNative.DEFAULT,
        ]}
      >
        {/* Icon */}
        <View
          style={[
            styles.emptyIconWrapper,
            { backgroundColor: isDark ? neutral[700] : primary[50] },
          ]}
        >
          <Ionicons name="calendar-outline" size={48} color={colors.primary} />
        </View>

        {/* Title */}
        <Text size="xl" weight="bold" color={colors.text} style={styles.emptyTitle}>
          {t('facilityDetail.noAvailability.title')}
        </Text>

        {/* Description */}
        <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
          {t('facilityDetail.noAvailability.description')}
        </Text>

        {/* Suggestions */}
        <View
          style={[styles.suggestionsList, { backgroundColor: isDark ? neutral[800] : neutral[50] }]}
        >
          <View style={styles.suggestionItem}>
            <Ionicons name="refresh-outline" size={18} color={colors.primary} />
            <Text size="sm" color={colors.text}>
              {t('facilityDetail.noAvailability.tryLater')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function AvailabilityTab({
  facility,
  slots,
  courts,
  isLoading,
  colors,
  isDark,
  t,
}: AvailabilityTabProps) {
  // Guard for auth and onboarding
  const { guardAction } = useRequireOnboarding();
  const { openSheetForMatchCreationFromBooking } = useActionsSheet();

  // Selected date and time filter
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  // Selected slot for booking
  const [, setSelectedSlot] = useState<FormattedSlot | null>(null);

  // Check if payments are enabled for this facility
  const paymentsEnabled = facility.paymentsEnabled ?? false;

  // Build lookup sets from sport-filtered courts
  // Courts prop is already filtered by sport in facilityService (via court_sport join)
  const sportCourtIds = useMemo(() => {
    const courtIdSet = new Set<string>();
    const externalIdSet = new Set<string>();

    for (const court of courts) {
      courtIdSet.add(court.id);
      if (court.external_provider_id) {
        externalIdSet.add(court.external_provider_id);
      }
    }

    return { courtIdSet, externalIdSet };
  }, [courts]);

  // Filter slots to only include courts that support the selected sport
  const slotsForSport = useMemo(() => {
    if (!slots) return [];

    const { courtIdSet, externalIdSet } = sportCourtIds;

    // If no local courts support this sport, return all external (non-local) slots as-is
    // External providers already return sport-scoped availability
    if (courtIdSet.size === 0) {
      return slots.filter(slot => !slot.isLocalSlot);
    }

    return slots
      .map(slot => {
        // For external slots (from third-party providers), include them as-is
        // They are already sport-scoped by the external provider's API
        if (!slot.isLocalSlot) return slot;

        // Filter court options to only sport-supported courts
        const filteredOptions = slot.courtOptions.filter(opt => {
          if (opt.courtId && courtIdSet.has(opt.courtId)) return true;
          if (!opt.courtId && opt.externalCourtId && externalIdSet.has(opt.externalCourtId))
            return true;
          return false;
        });

        // Check if this slot's primary court (if any) supports the sport
        const primaryCourtValid =
          (slot.courtId && courtIdSet.has(slot.courtId)) ||
          (!slot.courtId && slot.externalCourtId && externalIdSet.has(slot.externalCourtId));

        // If no valid court options and primary court invalid, exclude slot
        if (filteredOptions.length === 0 && !primaryCourtValid) {
          return null;
        }

        // Return slot with filtered court options
        return {
          ...slot,
          courtOptions: filteredOptions,
          courtCount: filteredOptions.length || (primaryCourtValid ? 1 : 0),
        };
      })
      .filter((slot): slot is FormattedSlot => slot !== null);
  }, [slots, sportCourtIds]);

  // Helper to check if a court option is free
  const isCourtOptionFree = useCallback((courtOption: { price?: number }): boolean => {
    return (courtOption.price ?? 0) === 0;
  }, []);

  // Determine if a slot should be disabled
  const isSlotDisabled = useCallback(
    (slot: FormattedSlot): boolean => {
      if (!slot.isLocalSlot || paymentsEnabled) {
        return false;
      }
      if (slot.courtOptions && slot.courtOptions.length > 0) {
        const hasFreeCourt = slot.courtOptions.some(opt => isCourtOptionFree(opt));
        return !hasFreeCourt;
      }
      return (slot.price ?? 0) > 0;
    },
    [paymentsEnabled, isCourtOptionFree]
  );

  // Check if a slot has some paid courts that would be unavailable
  const hasUnavailablePaidCourts = useCallback(
    (slot: FormattedSlot): boolean => {
      if (!slot.isLocalSlot || paymentsEnabled) {
        return false;
      }
      if (slot.courtOptions && slot.courtOptions.length > 0) {
        return slot.courtOptions.some(opt => !isCourtOptionFree(opt));
      }
      return false;
    },
    [paymentsEnabled, isCourtOptionFree]
  );

  // Handle slot press
  const handleSlotPress = useCallback(
    (slot: FormattedSlot) => {
      if (isSlotDisabled(slot)) {
        return;
      }

      lightHaptic();

      // For local slots, require auth and onboarding
      if (slot.isLocalSlot && !guardAction()) {
        return;
      }

      setSelectedSlot(slot);

      if (slot.isLocalSlot) {
        SheetManager.show('court-booking', {
          payload: {
            facility,
            slot,
            courts,
            onCreateGameFromBooking: (data: {
              facility: unknown;
              slot: unknown;
              facilityId: string;
              courtId: string;
              courtNumber: number | null;
            }) => openSheetForMatchCreationFromBooking(data),
          },
        });
      } else {
        SheetManager.show('external-booking', {
          payload: { facility, slot },
        });
      }
    },
    [guardAction, isSlotDisabled, facility, courts, openSheetForMatchCreationFromBooking]
  );

  // Group slots by date (using sport-filtered slots)
  const dateItems = useMemo(() => {
    if (!slotsForSport) return [];
    return groupSlotsByDate(slotsForSport);
  }, [slotsForSport]);

  // Set initial selected date
  React.useEffect(() => {
    if (dateItems.length > 0 && !selectedDateKey) {
      setSelectedDateKey(dateItems[0].dateKey);
    }
  }, [dateItems, selectedDateKey]);

  // Get slots for selected date
  const selectedDateSlots = useMemo(() => {
    if (!selectedDateKey) return [];
    const dateItem = dateItems.find(d => d.dateKey === selectedDateKey);
    return dateItem?.slots ?? [];
  }, [dateItems, selectedDateKey]);

  // Apply time filter
  const filteredSlots = useMemo(() => {
    if (timeFilter === 'all') return selectedDateSlots;

    return selectedDateSlots.filter(slot => {
      const hour = slot.datetime.getHours();
      switch (timeFilter) {
        case 'morning':
          return hour < 12;
        case 'afternoon':
          return hour >= 12 && hour < 17;
        case 'evening':
          return hour >= 17;
        default:
          return true;
      }
    });
  }, [selectedDateSlots, timeFilter]);

  // Group filtered slots by time of day
  const timeGroupedSlots = useMemo(() => {
    return groupSlotsByTimeOfDay(filteredSlots);
  }, [filteredSlots]);

  // Check if there are any paid court options that would be unavailable
  const hasDisabledPaidSlots =
    !paymentsEnabled &&
    slotsForSport?.some(slot => slot.isLocalSlot && hasUnavailablePaidCourts(slot));

  // Render slot with animation delay
  const renderSlot = useCallback(
    (slot: FormattedSlot, index: number) => {
      const slotDisabled = isSlotDisabled(slot);
      const hasSomeUnavailable = !slotDisabled && hasUnavailablePaidCourts(slot);

      return (
        <AvailabilitySlotCard
          key={`${slot.time}-${index}`}
          slot={slot}
          onPress={() => handleSlotPress(slot)}
          disabled={slotDisabled}
          partiallyDisabled={hasSomeUnavailable}
          animationDelay={index * 50}
          colors={colors}
          isDark={isDark}
          t={t}
        />
      );
    },
    [isSlotDisabled, hasUnavailablePaidCourts, handleSlotPress, colors, isDark, t]
  );

  // Loading state
  if (isLoading || !slots) {
    return <SkeletonLoading colors={colors} isDark={isDark} />;
  }

  // Empty state (no slots for the selected sport)
  if (slotsForSport.length === 0) {
    return <EmptyState facility={facility} colors={colors} isDark={isDark} t={t} />;
  }

  return (
    <View style={styles.container}>
      {/* Date Picker Bar */}
      <DatePickerBar
        dates={dateItems}
        selectedDate={selectedDateKey ?? ''}
        onSelectDate={setSelectedDateKey}
        colors={colors}
        isDark={isDark}
        t={t}
      />

      {/* Time Filter Chips */}
      <FilterChips
        activeFilter={timeFilter}
        onFilterChange={setTimeFilter}
        colors={colors}
        isDark={isDark}
        t={t}
      />

      {/* Payment unavailable banner */}
      {hasDisabledPaidSlots && (
        <View style={[styles.banner, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}>
          <Ionicons name="information-circle" size={16} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.bannerText}>
            {t('facilityDetail.paidSlotsDisabled')}
          </Text>
        </View>
      )}

      {/* Selected date header */}
      <View style={styles.selectedDateHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {dateItems.find(d => d.dateKey === selectedDateKey)?.label ?? ''}
        </Text>
        <View
          style={[styles.slotCountBadge, { backgroundColor: isDark ? neutral[700] : primary[50] }]}
        >
          <Text size="xs" weight="semibold" color={colors.primary}>
            {filteredSlots.length} {filteredSlots.length === 1 ? 'slot' : 'slots'}
          </Text>
        </View>
      </View>

      {/* Time of day sections */}
      <View style={styles.sectionsContainer}>
        {timeGroupedSlots.morning.length > 0 && (
          <TimeOfDaySection
            timeOfDay="morning"
            slots={timeGroupedSlots.morning}
            renderSlot={renderSlot}
            colors={colors}
            isDark={isDark}
            t={t}
          />
        )}

        {timeGroupedSlots.afternoon.length > 0 && (
          <TimeOfDaySection
            timeOfDay="afternoon"
            slots={timeGroupedSlots.afternoon}
            renderSlot={renderSlot}
            colors={colors}
            isDark={isDark}
            t={t}
          />
        )}

        {timeGroupedSlots.evening.length > 0 && (
          <TimeOfDaySection
            timeOfDay="evening"
            slots={timeGroupedSlots.evening}
            renderSlot={renderSlot}
            colors={colors}
            isDark={isDark}
            t={t}
          />
        )}

        {/* No slots for filtered time */}
        {filteredSlots.length === 0 && selectedDateSlots.length > 0 && (
          <View
            style={[
              styles.noFilteredSlots,
              { backgroundColor: isDark ? neutral[800] : neutral[50] },
            ]}
          >
            <Ionicons name="filter-outline" size={24} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.noFilteredText}>
              {t('facilityDetail.noSlotsForFilter')}
            </Text>
            <TouchableOpacity
              onPress={() => {
                lightHaptic();
                setTimeFilter('all');
              }}
              activeOpacity={0.7}
            >
              <Text size="sm" weight="semibold" color={colors.primary}>
                {t('facilityDetail.showAllSlots')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    gap: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  // Filter chips
  filterChipsContainer: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginHorizontal: spacingPixels[4],
  },
  bannerText: {
    flex: 1,
  },
  // Selected date header
  selectedDateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[1],
  },
  slotCountBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  // Sections
  sectionsContainer: {
    gap: spacingPixels[4],
  },
  // No filtered slots
  noFilteredSlots: {
    alignItems: 'center',
    padding: spacingPixels[6],
    marginHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    gap: spacingPixels[2],
  },
  noFilteredText: {
    textAlign: 'center',
  },
  // Skeleton loading
  skeletonContainer: {
    padding: spacingPixels[2],
    gap: spacingPixels[4],
  },
  skeletonDateRow: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  skeletonFilterRow: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  skeletonSection: {
    gap: spacingPixels[3],
  },
  skeletonSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
  },
  skeletonSectionText: {
    flex: 1,
  },
  skeletonSlotsRow: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2.5],
  },
  // Empty state
  emptyContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  emptyCard: {
    padding: spacingPixels[8],
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
  },
  emptyIconWrapper: {
    width: 96,
    height: 96,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: spacingPixels[4],
  },
  suggestionsList: {
    width: '100%',
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    gap: spacingPixels[3],
    marginBottom: spacingPixels[4],
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  externalCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
});

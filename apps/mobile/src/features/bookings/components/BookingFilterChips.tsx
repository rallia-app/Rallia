/**
 * BookingFilterChips Component
 * Horizontally scrollable filter chips for booking lists.
 * Shows different filter options based on the active tab (upcoming vs past).
 * Mirrors PlayerMatchFilterChips.
 */

import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SelectableChip } from '@rallia/shared-components';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, base } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import type { UpcomingBookingFilter, PastBookingFilter } from '@rallia/shared-hooks';

import { lightHaptic } from '#/utils/haptics';
import { useThemeStyles, useTranslation } from '#/hooks';

// =============================================================================
// TYPES
// =============================================================================

interface BookingFilterChipsProps {
  timeFilter: 'upcoming' | 'past';
  upcomingFilter: UpcomingBookingFilter;
  pastFilter: PastBookingFilter;
  onUpcomingFilterToggle: (filter: UpcomingBookingFilter) => void;
  onPastFilterToggle: (filter: PastBookingFilter) => void;
}

// =============================================================================
// FILTER OPTIONS
// =============================================================================

interface FilterOption<T> {
  value: T;
  labelKey: TranslationKey;
  icon?: keyof typeof Ionicons.glyphMap;
}

const UPCOMING_OPTIONS: FilterOption<UpcomingBookingFilter>[] = [
  { value: 'all', labelKey: 'myBookings.filters.all' },
  {
    value: 'confirmed',
    labelKey: 'myBookings.filters.confirmed',
    icon: 'checkmark-circle-outline',
  },
  { value: 'pending', labelKey: 'myBookings.filters.pending', icon: 'hourglass-outline' },
  {
    value: 'awaiting_approval',
    labelKey: 'myBookings.filters.awaitingApproval',
    icon: 'time-outline',
  },
];

const PAST_OPTIONS: FilterOption<PastBookingFilter>[] = [
  { value: 'all', labelKey: 'myBookings.filters.all' },
  { value: 'completed', labelKey: 'myBookings.filters.completed', icon: 'checkmark-done-outline' },
  { value: 'cancelled', labelKey: 'myBookings.filters.cancelled', icon: 'close-circle-outline' },
  { value: 'no_show', labelKey: 'myBookings.filters.noShow', icon: 'alert-circle-outline' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function BookingFilterChips({
  timeFilter,
  upcomingFilter,
  pastFilter,
  onUpcomingFilterToggle,
  onPastFilterToggle,
}: BookingFilterChipsProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const options = timeFilter === 'upcoming' ? UPCOMING_OPTIONS : PAST_OPTIONS;
  const currentFilter = timeFilter === 'upcoming' ? upcomingFilter : pastFilter;
  const onToggle =
    timeFilter === 'upcoming'
      ? (v: string) => onUpcomingFilterToggle(v as UpcomingBookingFilter)
      : (v: string) => onPastFilterToggle(v as PastBookingFilter);

  const getLabel = useCallback((labelKey: TranslationKey): string => t(labelKey), [t]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {options.map(option => {
          const isActive = currentFilter === option.value;
          const showIcon = option.value !== 'all' && option.icon;
          return (
            <SelectableChip
              key={option.value}
              label={getLabel(option.labelKey)}
              selected={isActive}
              animateOnPress
              icon={
                showIcon ? (
                  <Ionicons
                    name={option.icon as keyof typeof Ionicons.glyphMap}
                    size={14}
                    color={isActive ? base.white : colors.textMuted}
                  />
                ) : undefined
              }
              onPress={() => {
                void lightHaptic();
                onToggle(option.value);
              }}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacingPixels[2],
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
    alignItems: 'center',
  },
});

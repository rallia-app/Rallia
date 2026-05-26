/**
 * BookingFilterChips Component
 * Horizontally scrollable filter chips for booking lists.
 * Shows different filter options based on the active tab (upcoming vs past).
 * Mirrors PlayerMatchFilterChips.
 */

import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import type { UpcomingBookingFilter, PastBookingFilter } from '@rallia/shared-hooks';

import { lightHaptic } from '#/utils/haptics';
import { useTranslation } from '#/hooks';

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
// FILTER CHIP COMPONENT
// =============================================================================

interface ChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  isFirst?: boolean;
}

function FilterChip({ label, isActive, onPress, isDark, icon, isFirst }: ChipProps) {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, isFirst && styles.firstChip]}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bgColor, borderColor }]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        {icon && <Ionicons name={icon} size={14} color={textColor} style={styles.chipIcon} />}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

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
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

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
        {options.map((option, index) => (
          <FilterChip
            key={option.value}
            label={getLabel(option.labelKey)}
            isActive={currentFilter === option.value}
            onPress={() => onToggle(option.value)}
            isDark={isDark}
            icon={option.value !== 'all' ? option.icon : undefined}
            isFirst={index === 0}
          />
        ))}
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
  firstChip: {
    marginLeft: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  chipIcon: {
    marginRight: 2,
  },
});

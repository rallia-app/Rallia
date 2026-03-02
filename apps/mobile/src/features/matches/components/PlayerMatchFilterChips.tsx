/**
 * PlayerMatchFilterChips Component
 * A horizontally scrollable row of filter chips for player matches.
 * Uses single-select behavior (WhatsApp-style) - only one chip can be active at a time.
 * Shows different filter options based on the active tab (upcoming vs past).
 */

import React, { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { lightHaptic } from '../../../utils/haptics';
import type { UpcomingMatchFilter, PastMatchFilter } from '@rallia/shared-hooks';

// =============================================================================
// TYPES
// =============================================================================

interface PlayerMatchFilterChipsProps {
  /** Current time filter tab */
  timeFilter: 'upcoming' | 'past';
  /** Current upcoming filter value */
  upcomingFilter: UpcomingMatchFilter;
  /** Current past filter value */
  pastFilter: PastMatchFilter;
  /** Callback when upcoming filter is toggled */
  onUpcomingFilterToggle: (filter: UpcomingMatchFilter) => void;
  /** Callback when past filter is toggled */
  onPastFilterToggle: (filter: PastMatchFilter) => void;
}

// =============================================================================
// FILTER CHIP OPTIONS
// =============================================================================

interface FilterOption<T> {
  value: T;
  labelKey: TranslationKey;
  icon?: keyof typeof Ionicons.glyphMap;
}

const UPCOMING_OPTIONS: FilterOption<UpcomingMatchFilter>[] = [
  { value: 'all', labelKey: 'playerMatches.filters.all' },
  {
    value: 'confirmed',
    labelKey: 'playerMatches.filters.confirmed',
    icon: 'checkmark-circle-outline',
  },
  { value: 'hosting', labelKey: 'playerMatches.filters.hosting', icon: 'person-outline' },
  {
    value: 'needs_players',
    labelKey: 'playerMatches.filters.needsPlayers',
    icon: 'people-outline',
  },
  { value: 'waiting', labelKey: 'playerMatches.filters.waiting', icon: 'hourglass-outline' },
  { value: 'private', labelKey: 'playerMatches.filters.private', icon: 'lock-closed-outline' },
];

const PAST_OPTIONS: FilterOption<PastMatchFilter>[] = [
  { value: 'all', labelKey: 'playerMatches.filters.all' },
  {
    value: 'feedback_needed',
    labelKey: 'playerMatches.filters.feedbackNeeded',
    icon: 'chatbubble-outline',
  },
  { value: 'completed', labelKey: 'playerMatches.filters.completed', icon: 'trophy-outline' },
  { value: 'hosted', labelKey: 'playerMatches.filters.hosted', icon: 'person-outline' },
  { value: 'cancelled', labelKey: 'playerMatches.filters.cancelled', icon: 'close-circle-outline' },
  { value: 'unfilled', labelKey: 'playerMatches.filters.unfilled', icon: 'time-outline' },
  { value: 'private', labelKey: 'playerMatches.filters.private', icon: 'lock-closed-outline' },
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
        style={[
          styles.chip,
          {
            backgroundColor: bgColor,
            borderColor: borderColor,
          },
        ]}
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

export default function PlayerMatchFilterChips({
  timeFilter,
  upcomingFilter,
  pastFilter,
  onUpcomingFilterToggle,
  onPastFilterToggle,
}: PlayerMatchFilterChipsProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Get the appropriate options and handlers based on tab
  const options = timeFilter === 'upcoming' ? UPCOMING_OPTIONS : PAST_OPTIONS;
  const currentFilter = timeFilter === 'upcoming' ? upcomingFilter : pastFilter;
  const onToggle =
    timeFilter === 'upcoming'
      ? (v: string) => onUpcomingFilterToggle(v as UpcomingMatchFilter)
      : (v: string) => onPastFilterToggle(v as PastMatchFilter);

  const getLabel = useCallback(
    (labelKey: TranslationKey): string => {
      return t(labelKey);
    },
    [t]
  );

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

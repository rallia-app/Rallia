/**
 * PlayerMatchFilterChips Component
 * A horizontally scrollable row of filter chips for player matches.
 * Uses single-select behavior (WhatsApp-style) - only one chip can be active at a time.
 * Shows different filter options based on the active tab (upcoming vs past).
 */

import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SelectableChip } from '@rallia/shared-components';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, base } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import type { UpcomingMatchFilter, PastMatchFilter } from '@rallia/shared-hooks';

import { lightHaptic } from '#/utils/haptics';
import { useThemeStyles, useTranslation } from '#/hooks';

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
// MAIN COMPONENT
// =============================================================================

export default function PlayerMatchFilterChips({
  timeFilter,
  upcomingFilter,
  pastFilter,
  onUpcomingFilterToggle,
  onPastFilterToggle,
}: PlayerMatchFilterChipsProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

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

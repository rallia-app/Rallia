/**
 * HourlyAvailabilityPresets
 *
 * Horizontal chip row that lets users apply common patterns (after-work,
 * weekends, lunch, mornings) to the hourly availability grid in one tap.
 * Toggleable: a chip is "applied" when every cell in its pattern is already
 * selected; tapping a applied chip clears just those cells.
 *
 * Sits above `HourlyAvailabilityGrid` and updates the same `HourGrid` value.
 * Designed as a small composable so we can drop it (or swap presets) without
 * touching the grid itself.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SelectableChip, Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  AVAILABILITY_PRESETS,
  isPresetApplied,
  selectionHaptic,
  togglePreset as applyPresetToggle,
} from '@rallia/shared-utils';
import type { TranslationKey } from '@rallia/shared-translations';

import type { HourGrid } from './HourlyAvailabilityGrid';

// Cell patterns live in shared-utils (web renders the same presets); only the
// label-key mapping is platform-side because TranslationKey is app-typed.
const PRESETS = AVAILABILITY_PRESETS.map(preset => ({
  ...preset,
  labelKey: `onboarding.availabilityStep.presets.${preset.key}` as TranslationKey,
}));

interface PresetColors {
  presetActiveBg: string;
  presetActiveText: string;
  textMuted: string;
  border: string;
}

interface HourlyAvailabilityPresetsProps {
  value: HourGrid;
  onChange: (next: HourGrid) => void;
  colors: PresetColors;
  t: (key: TranslationKey) => string;
}

export const HourlyAvailabilityPresets: React.FC<HourlyAvailabilityPresetsProps> = ({
  value,
  onChange,
  colors,
  t,
}) => {
  // Determine which presets are currently fully applied so they render with
  // the active styling. A preset is applied when every cell in its pattern
  // is in the current selection; partial overlap renders as inactive.
  const appliedFlags = useMemo(() => PRESETS.map(p => isPresetApplied(value, p)), [value]);

  const totalSelected = value.size;

  const togglePreset = (idx: number) => {
    selectionHaptic();
    onChange(applyPresetToggle(value, PRESETS[idx]));
  };

  const clearAll = () => {
    selectionHaptic();
    onChange(new Set());
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {totalSelected > 0 && (
        <TouchableOpacity
          style={[styles.chip, { backgroundColor: 'transparent', borderColor: colors.border }]}
          onPress={clearAll}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.availabilityStep.presets.clear')}
        >
          <Ionicons name="trash-outline" size={14} color={colors.textMuted} style={styles.icon} />
          <Text size="xs" weight="semibold" color={colors.textMuted}>
            {t('onboarding.availabilityStep.presets.clear')}
          </Text>
        </TouchableOpacity>
      )}
      {PRESETS.map((preset, idx) => {
        const active = appliedFlags[idx];
        return (
          <SelectableChip
            key={preset.key}
            label={t(preset.labelKey)}
            selected={active}
            accentColor={colors.presetActiveBg}
            selectedLabelColor={colors.presetActiveText}
            icon={
              active ? (
                <Ionicons name="checkmark" size={14} color={colors.presetActiveText} />
              ) : undefined
            }
            onPress={() => togglePreset(idx)}
          />
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacingPixels[1],
    // Horizontal padding so the first/last chip don't kiss the screen edge
    // when the parent only adds minimal padding (the grid below uses an
    // asymmetric tight-left layout because of its hours column).
    paddingHorizontal: spacingPixels[2],
    gap: spacingPixels[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  icon: {
    marginRight: spacingPixels[1],
  },
});

export default HourlyAvailabilityPresets;

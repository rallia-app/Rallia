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
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import type { DayEnum } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import { cellKey, ORDERED_DAYS, type HourGrid } from './HourlyAvailabilityGrid';

const WEEKDAYS: DayEnum[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const WEEKEND: DayEnum[] = ['saturday', 'sunday'];

// Preset definitions. Cells are computed lazily so the helper functions can
// reuse weekday/weekend day arrays without prebuilding 100+ key strings.
interface PresetDef {
  key: 'afterWork' | 'weekendsAny' | 'lunch' | 'mornings';
  labelKey: TranslationKey;
  cells: ReadonlyArray<string>;
}

function buildCells(days: ReadonlyArray<DayEnum>, hours: ReadonlyArray<number>): string[] {
  const out: string[] = [];
  for (const d of days) for (const h of hours) out.push(cellKey(d, h));
  return out;
}

// Preset hour ranges (start..end inclusive, mapped to hour cells where
// `cell h` represents the [h:00, h+1:00) window):
//   afterWork    Mon–Fri 17:00–22:00 → cells 17,18,19,20,21,22  (5–11 PM)
//   weekendsAny  Sat–Sun 06:00–22:00 → all 17 hours
//   lunch        Mon–Fri 12:00–13:00 → cell 12 only             (12 PM)
//   mornings     Daily   06:00–09:00 → cells 6,7,8              (6–9 AM)
const PRESETS: PresetDef[] = [
  {
    key: 'afterWork',
    labelKey: 'onboarding.availabilityStep.presets.afterWork',
    cells: buildCells(WEEKDAYS, [17, 18, 19, 20, 21, 22]),
  },
  {
    key: 'weekendsAny',
    labelKey: 'onboarding.availabilityStep.presets.weekendsAny',
    cells: buildCells(
      WEEKEND,
      Array.from({ length: 17 }, (_, i) => i + 6)
    ),
  },
  {
    key: 'lunch',
    labelKey: 'onboarding.availabilityStep.presets.lunch',
    cells: buildCells(WEEKDAYS, [12]),
  },
  {
    key: 'mornings',
    labelKey: 'onboarding.availabilityStep.presets.mornings',
    cells: buildCells(ORDERED_DAYS, [6, 7, 8]),
  },
];

interface PresetColors {
  presetActiveBg: string;
  presetInactiveBg: string;
  presetActiveBorder: string;
  presetInactiveBorder: string;
  presetActiveText: string;
  presetInactiveText: string;
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
  const appliedFlags = useMemo(() => PRESETS.map(p => p.cells.every(c => value.has(c))), [value]);

  const totalSelected = value.size;

  const togglePreset = (idx: number) => {
    selectionHaptic();
    const preset = PRESETS[idx];
    const applied = appliedFlags[idx];
    const next = new Set(value);
    if (applied) {
      for (const c of preset.cells) next.delete(c);
    } else {
      for (const c of preset.cells) next.add(c);
    }
    onChange(next);
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
          <TouchableOpacity
            key={preset.key}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.presetActiveBg : colors.presetInactiveBg,
                borderColor: active ? colors.presetActiveBorder : colors.presetInactiveBorder,
              },
            ]}
            onPress={() => togglePreset(idx)}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: active }}
          >
            {active && (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.presetActiveText}
                style={styles.icon}
              />
            )}
            <Text
              size="xs"
              weight="semibold"
              color={active ? colors.presetActiveText : colors.presetInactiveText}
            >
              {t(preset.labelKey)}
            </Text>
          </TouchableOpacity>
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

/**
 * AvailabilitiesStep — last onboarding step.
 *
 * Hourly weekly grid (7 days × 17 hours) with paint-drag selection plus a
 * preset chip row above. State is a `Set<string>` of `${day}-${hour}` cell
 * keys owned by useOnboardingWizard — see formData.availabilities.
 *
 * The step wraps its content in `SheetScrollView` so the chips + grid can
 * overflow + scroll on small phones without squishing chip heights. Safe
 * to nest a scrollable here because HourlyAvailabilityGrid now uses
 * `Gesture.Pan().minDistance(0).blocksExternalGesture(sheetGestureRef)`,
 * which wins gesture arbitration before any parent scroll can claim the
 * vertical pan.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { spacingPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';

import {
  HourlyAvailabilityGrid,
  type HourGrid,
} from '#/features/onboarding/components/HourlyAvailabilityGrid';
import { HourlyAvailabilityPresets } from '#/features/onboarding/components/HourlyAvailabilityPresets';
import type { OnboardingFormData } from '#/features/onboarding/hooks/useOnboardingWizard';

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
}

interface AvailabilitiesStepProps {
  formData: OnboardingFormData;
  onUpdateFormData: (updates: Partial<OnboardingFormData>) => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  isDark: boolean;
  locale?: string;
}

export const AvailabilitiesStep: React.FC<AvailabilitiesStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark: _isDark,
  locale = 'en-US',
}) => {
  const grid = formData.availabilities;

  const onGridChange = (next: HourGrid) => onUpdateFormData({ availabilities: next });

  const gridColors = useMemo(
    () => ({
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.border,
      cellInactive: colors.buttonInactive,
      cellActive: colors.buttonActive,
    }),
    [colors]
  );

  const presetColors = useMemo(
    () => ({
      presetActiveBg: colors.buttonActive,
      presetActiveText: colors.buttonTextActive,
      textMuted: colors.textMuted,
      border: colors.border,
    }),
    [colors]
  );

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <HourlyAvailabilityPresets value={grid} onChange={onGridChange} colors={presetColors} t={t} />

      <View style={styles.gridWrapper}>
        <HourlyAvailabilityGrid
          value={grid}
          onChange={onGridChange}
          colors={gridColors}
          t={t}
          locale={locale}
        />
      </View>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // Asymmetric: the hours column on the left already looks padded thanks
    // to its right-aligned label inside a 40pt column, so we hug the screen
    // edge there. The right side needs real breathing room past the last
    // cell column.
    paddingLeft: spacingPixels[1],
    paddingRight: spacingPixels[3],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  gridWrapper: {
    marginTop: spacingPixels[2],
  },
});

export default AvailabilitiesStep;

/**
 * AvailabilitiesStep — last onboarding step.
 *
 * Hourly weekly grid (7 days × 17 hours) with paint-drag selection plus a
 * preset chip row above the grid for one-tap patterns. Total hour count is
 * shown alongside the minimum-required hint so users know when the step
 * unlocks. Privacy toggle for `privacy_show_availability` lives at the
 * bottom, unchanged from the previous version.
 *
 * State is a `Set<string>` of `${day}-${hour}` cell keys owned by
 * useOnboardingWizard — see formData.availabilities.
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';
import { HourlyAvailabilityGrid, type HourGrid } from '../../HourlyAvailabilityGrid';
import { HourlyAvailabilityPresets } from '../../HourlyAvailabilityPresets';
import type { OnboardingFormData } from '../../../hooks/useOnboardingWizard';

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

/** Minimum cells required for the step to validate. 6 ≈ "one decent block." */
const MIN_SELECTIONS = 6;

export const AvailabilitiesStep: React.FC<AvailabilitiesStepProps> = ({
  formData,
  onUpdateFormData,
  colors,
  t,
  isDark: _isDark,
  locale = 'en-US',
}) => {
  const grid = formData.availabilities;
  const totalSelections = grid.size;
  const hasMinimum = totalSelections >= MIN_SELECTIONS;

  // Disabled while the user is paint-dragging the grid so the surrounding
  // SheetScrollView can't scroll the page out from under them.
  const [scrollEnabled, setScrollEnabled] = useState(true);

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
      presetInactiveBg: colors.buttonInactive,
      presetActiveBorder: colors.buttonActive,
      presetInactiveBorder: colors.border,
      presetActiveText: colors.buttonTextActive,
      presetInactiveText: colors.text,
      textMuted: colors.textMuted,
      border: colors.border,
    }),
    [colors]
  );

  return (
    <SheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      scrollEnabled={scrollEnabled}
    >
      {/* Compact header row: title on the left, live count on the right.
          Collapses what used to be three stacked rows (title, subtitle,
          counter) into one ~26pt line so the 17-hour grid clears the screen
          on iPhone SE without scrolling. */}
      <View style={styles.headerRow}>
        <Text size="lg" weight="bold" color={colors.text} style={styles.title}>
          {t('onboarding.availability')}
        </Text>
        <Text
          size="xs"
          weight="semibold"
          color={hasMinimum ? colors.buttonActive : colors.textMuted}
        >
          {totalSelections >= MIN_SELECTIONS
            ? t('onboarding.availabilityStep.selected').replace('{count}', String(totalSelections))
            : t('onboarding.availabilityStep.minimumSelected')
                .replace('{count}', String(totalSelections))
                .replace('{minimum}', String(MIN_SELECTIONS))}
        </Text>
      </View>

      <HourlyAvailabilityPresets value={grid} onChange={onGridChange} colors={presetColors} t={t} />

      <View style={styles.gridWrapper}>
        <HourlyAvailabilityGrid
          value={grid}
          onChange={onGridChange}
          colors={gridColors}
          t={t}
          locale={locale}
          onInteractionChange={active => setScrollEnabled(!active)}
        />
      </View>
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[4],
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  title: {
    flexShrink: 1,
  },
  gridWrapper: {
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
});

export default AvailabilitiesStep;

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

import React, { useMemo } from 'react';
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
    >
      <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
        {t('onboarding.availability')}
      </Text>
      <Text size="base" color={colors.textSecondary} style={styles.subtitle}>
        {t('onboarding.availabilitySubtitle')}
      </Text>

      <View style={styles.counterContainer}>
        <Text
          size="sm"
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
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    flexGrow: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
    lineHeight: 28,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  counterContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  gridWrapper: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[6],
  },
});

export default AvailabilitiesStep;

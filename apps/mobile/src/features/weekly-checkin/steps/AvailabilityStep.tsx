/**
 * Step 2 — Confirm availability.
 *
 * Reuses HourlyAvailabilityGrid from the onboarding feature folder. The
 * grid's drag-to-paint mechanic is the same one used in onboarding + the
 * profile availability overlay — same component, same haptics.
 *
 * Continue CTA is disabled until the player has at least
 * MIN_AVAILABILITY_CELLS hours selected (matches onboarding minimum).
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';
import {
  HourlyAvailabilityGrid,
  type HourGrid,
} from '../../onboarding/components/HourlyAvailabilityGrid';
import { MascotBubble } from '../components/MascotBubble';
import { MIN_AVAILABILITY_CELLS } from '../useWeeklyCheckInWizard';
import { useTranslation } from '../../../hooks';
import { useLocale } from '../../../context';

interface AvailabilityStepProps {
  availability: HourGrid;
  onChange: (next: HourGrid) => void;
  onContinue: () => void;
}

export function AvailabilityStep({ availability, onChange, onContinue }: AvailabilityStepProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { colors } = useThemeStyles();

  const gridColors = useMemo(
    () => ({
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.inputBorder,
      cellInactive: colors.inputBackground,
      cellActive: colors.primary,
    }),
    [colors]
  );

  const canContinue = availability.size >= MIN_AVAILABILITY_CELLS;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MascotBubble text={t('weeklyCheckIn.step2.bubble' as any)} textKey="step2-bubble" />

        <View style={styles.gridWrap}>
          <HourlyAvailabilityGrid
            value={availability}
            onChange={onChange}
            colors={gridColors}
            t={t}
            locale={locale}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rounded
          disabled={!canContinue}
          onPress={onContinue}
        >
          {t('weeklyCheckIn.step2.cta' as any)}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    paddingTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[3],
  },
  gridWrap: {
    marginTop: spacingPixels[5],
    marginBottom: spacingPixels[4],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});

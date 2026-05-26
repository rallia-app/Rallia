/**
 * Step 3 — Frequency goal + auto-magic opt-ins.
 *
 * Single screen with frequency pills at the top + two compact opt-in cards
 * under a "Make this easier" label at the bottom. CTA triggers submit.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { FrequencyPills } from '#/features/weekly-checkin/components/FrequencyPills';
import { AutoToggleRow } from '#/features/weekly-checkin/components/AutoToggleRow';
import { WEEKLY_CHECKIN_AUTO_TOGGLES_ENABLED } from '#/features/weekly-checkin/featureFlag';
import { useTranslation } from '#/hooks';

interface FrequencyAutoStepProps {
  frequencyGoal: number;
  setFrequencyGoal: (n: number) => void;
  previousGoal: number | null;
  autoCreate: boolean;
  setAutoCreate: (b: boolean) => void;
  autoInvite: boolean;
  setAutoInvite: (b: boolean) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
}

export function FrequencyAutoStep({
  frequencyGoal,
  setFrequencyGoal,
  previousGoal,
  autoCreate,
  setAutoCreate,
  autoInvite,
  setAutoInvite,
  isSubmitting,
  onSubmit,
}: FrequencyAutoStepProps) {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MascotBubble text={t('weeklyCheckIn.step3.bubble')} textKey="step3-bubble" />

        <View style={styles.section}>
          <FrequencyPills
            value={frequencyGoal}
            onChange={setFrequencyGoal}
            previousGoal={previousGoal}
          />

          {WEEKLY_CHECKIN_AUTO_TOGGLES_ENABLED && (
            <>
              <Text style={[styles.opsLabel, { color: colors.textMuted }]}>
                {t('weeklyCheckIn.step3.opsLabel')}
              </Text>

              <AutoToggleRow
                title={t('weeklyCheckIn.step3.autoCreateTitle')}
                description={t('weeklyCheckIn.step3.autoCreateDesc')}
                checked={autoCreate}
                onChange={setAutoCreate}
              />
              <AutoToggleRow
                title={t('weeklyCheckIn.step3.autoInviteTitle')}
                description={t('weeklyCheckIn.step3.autoInviteDesc')}
                checked={autoInvite}
                onChange={setAutoInvite}
              />
            </>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rounded
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onSubmit}
        >
          {t('weeklyCheckIn.step3.cta')}
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
  section: {
    marginTop: spacingPixels[5],
  },
  opsLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginHorizontal: spacingPixels[1],
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});

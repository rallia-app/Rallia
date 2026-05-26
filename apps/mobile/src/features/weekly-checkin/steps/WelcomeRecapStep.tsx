/**
 * Step 1 — Welcome + Recap.
 *
 * Variant-aware welcome bubble:
 *   • hit   — beat last week's goal (gold celebration)
 *   • met   — exactly matched the goal
 *   • miss  — missed the goal (Option C: "missed the goal, not the streak")
 *   • first — no prior recap data (new player)
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { StreakCard } from '#/features/weekly-checkin/components/StreakCard';
import { GoalsCard } from '#/features/weekly-checkin/components/GoalsCard';
import type { CheckInContext } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

interface WelcomeRecapStepProps {
  context: CheckInContext;
  onContinue: () => void;
}

type RecapVariant = 'hit' | 'met' | 'miss' | 'first';

function deriveVariant(ctx: CheckInContext): RecapVariant {
  if (ctx.lastWeekFrequencyGoal == null) return 'first';
  const played = ctx.lastWeekSessionsPlayed ?? 0;
  if (played > ctx.lastWeekFrequencyGoal) return 'hit';
  if (played === ctx.lastWeekFrequencyGoal) return 'met';
  return 'miss';
}

export function WelcomeRecapStep({ context, onContinue }: WelcomeRecapStepProps) {
  const { t } = useTranslation();
  const variant = deriveVariant(context);

  const bubbleText = (() => {
    switch (variant) {
      case 'hit':
        return t('weeklyCheckIn.step1.bubbleHit');
      case 'met':
        return t('weeklyCheckIn.step1.bubbleMet', {
          goal: context.lastWeekFrequencyGoal ?? 0,
        });
      case 'miss':
        return t('weeklyCheckIn.step1.bubbleMiss');
      case 'first':
        return t('weeklyCheckIn.step1.bubbleFirstTime');
    }
  })();

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MascotBubble text={bubbleText} textKey={`step1-${variant}`} />

        <View style={styles.section}>
          <StreakCard
            currentStreak={context.currentStreak}
            freezeInventory={context.freezeInventory}
          />
          <GoalsCard
            lastWeekGoal={context.lastWeekFrequencyGoal}
            lastWeekPlayed={context.lastWeekSessionsPlayed}
            goalsHitLast4Weeks={context.goalsHitLast4Weeks}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button variant="primary" size="lg" fullWidth rounded onPress={onContinue}>
          {t('weeklyCheckIn.step1.cta')}
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
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});

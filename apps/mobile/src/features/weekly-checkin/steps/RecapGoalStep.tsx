/**
 * Step 1 — Slim recap + weekly goal (merged).
 *
 * Opens the wizard: Ace greets with the variant-aware recap line, the
 * StreakCard carries the streak + goal-tracking recap (the motivational hook),
 * and the weekly goal picker is the focus below. The CTA advances to the
 * availability step.
 *
 * Only rendered when the goal hasn't been set this ISO week — otherwise the
 * wizard skips straight to availability (skipRecapStep in the hook).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { StreakCard } from '#/features/weekly-checkin/components/StreakCard';
import { FrequencyPills } from '#/features/weekly-checkin/components/FrequencyPills';
import type { CheckInContext } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

export type RecapVariant = 'hit' | 'met' | 'miss' | 'frozen' | 'back' | 'first';

export function deriveVariant(ctx: CheckInContext): RecapVariant {
  if (ctx.lastWeekFrequencyGoal == null) {
    // The RPC only surfaces last week once the hourly evaluator has folded it
    // in, so this bucket holds true first-timers AND returning players (lapsed,
    // or last week simply not evaluated yet). Greet returners as such.
    const hasHistory =
      ctx.lastFrequencyGoal != null ||
      ctx.historyWeeks.some(w => w.status !== 'none') ||
      ctx.currentStreak > 0;
    return hasHistory ? 'back' : 'first';
  }
  const played = ctx.lastWeekSessionsPlayed ?? 0;
  if (played > ctx.lastWeekFrequencyGoal) return 'hit';
  if (played === ctx.lastWeekFrequencyGoal) return 'met';
  // Missed — and since last week only surfaces post-evaluation, a streak that
  // survived the miss means a freeze auto-rescued it at week-end.
  return ctx.currentStreak > 0 ? 'frozen' : 'miss';
}

interface RecapGoalStepProps {
  context: CheckInContext;
  frequencyGoal: number;
  setFrequencyGoal: (n: number) => void;
  previousGoal: number | null;
  onContinue: () => void;
}

export function RecapGoalStep({
  context,
  frequencyGoal,
  setFrequencyGoal,
  previousGoal,
  onContinue,
}: RecapGoalStepProps) {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
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
      case 'frozen':
        return t('weeklyCheckIn.step1.bubbleFrozen');
      case 'back':
        return t('weeklyCheckIn.step1.bubbleBack');
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
        <MascotBubble text={bubbleText} textKey={`recap-${variant}`} />

        <View style={styles.recapSection}>
          <StreakCard
            currentStreak={context.currentStreak}
            freezeInventory={context.freezeInventory}
            lastWeekGoal={context.lastWeekFrequencyGoal}
            lastWeekPlayed={context.lastWeekSessionsPlayed}
            historyWeeks={context.historyWeeks}
          />
        </View>

        <View style={styles.goalSection}>
          <Text style={[styles.goalHeading, { color: colors.text }]}>
            {t('weeklyCheckIn.step3.goalHeading')}
          </Text>

          <FrequencyPills
            value={frequencyGoal}
            onChange={setFrequencyGoal}
            previousGoal={previousGoal}
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
  recapSection: {
    marginTop: spacingPixels[4],
  },
  goalSection: {
    marginTop: spacingPixels[3],
  },
  goalHeading: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});

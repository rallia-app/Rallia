/**
 * Step 2 — Slim recap + weekly goal (merged).
 *
 * Combines what used to be two separate steps (welcome/recap and frequency)
 * into one to keep the wizard short. Ace opens with the variant-aware recap
 * line, the StreakCard + GoalsCard carry the recap signal, and the weekly goal
 * picker (+ auto-magic opt-ins) is the focus below. The CTA submits.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { StreakCard } from '#/features/weekly-checkin/components/StreakCard';
import { GoalsCard } from '#/features/weekly-checkin/components/GoalsCard';
import { FrequencyPills } from '#/features/weekly-checkin/components/FrequencyPills';
import { AutoToggleRow } from '#/features/weekly-checkin/components/AutoToggleRow';
import {
  WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED,
  WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED,
} from '#/features/weekly-checkin/featureFlag';
import type { CheckInContext } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

export type RecapVariant = 'hit' | 'met' | 'miss' | 'first';

export function deriveVariant(ctx: CheckInContext): RecapVariant {
  if (ctx.lastWeekFrequencyGoal == null) return 'first';
  const played = ctx.lastWeekSessionsPlayed ?? 0;
  if (played > ctx.lastWeekFrequencyGoal) return 'hit';
  if (played === ctx.lastWeekFrequencyGoal) return 'met';
  return 'miss';
}

interface RecapGoalStepProps {
  context: CheckInContext;
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

export function RecapGoalStep({
  context,
  frequencyGoal,
  setFrequencyGoal,
  previousGoal,
  autoCreate,
  setAutoCreate,
  autoInvite,
  setAutoInvite,
  isSubmitting,
  onSubmit,
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
          />
          <GoalsCard
            lastWeekGoal={context.lastWeekFrequencyGoal}
            lastWeekPlayed={context.lastWeekSessionsPlayed}
            goalsHitLast4Weeks={context.goalsHitLast4Weeks}
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

          {(WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED ||
            WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED) && (
            <>
              <Text style={[styles.opsLabel, { color: colors.textMuted }]}>
                {t('weeklyCheckIn.step3.opsLabel')}
              </Text>

              {WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED && (
                <AutoToggleRow
                  title={t('weeklyCheckIn.step3.autoCreateTitle')}
                  description={t('weeklyCheckIn.step3.autoCreateDesc')}
                  checked={autoCreate}
                  onChange={setAutoCreate}
                />
              )}
              {WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && (
                <AutoToggleRow
                  title={t('weeklyCheckIn.step3.autoInviteTitle')}
                  description={t('weeklyCheckIn.step3.autoInviteDesc')}
                  checked={autoInvite}
                  onChange={setAutoInvite}
                />
              )}
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

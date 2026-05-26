/**
 * Step 4 — Success / All Set.
 *
 * Plays a celebratory bubble + the streak hero animation + summary recap.
 * CTA dismisses the modal (returns the user to Home).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { SummaryCard } from '#/features/weekly-checkin/components/SummaryCard';
import type { CheckInResult } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

interface AllSetStepProps {
  result: CheckInResult;
  /** True if the player had no streak before this submit (first-ever check-in). */
  isFirstEver: boolean;
  frequencyGoal: number;
  hoursConfirmed: number;
  autoCreate: boolean;
  autoInvite: boolean;
  onDone: () => void;
}

export function AllSetStep({
  result,
  isFirstEver,
  frequencyGoal,
  hoursConfirmed,
  autoCreate,
  autoInvite,
  onDone,
}: AllSetStepProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MascotBubble text={t('weeklyCheckIn.step4.bubble')} textKey="step4-bubble" />

        <View style={styles.section}>
          <SummaryCard
            newStreak={result.newStreak}
            milestoneReached={result.milestoneReached}
            freezeEarned={result.freezeEarned}
            isFirstEver={isFirstEver}
            frequencyGoal={frequencyGoal}
            hoursConfirmed={hoursConfirmed}
            autoCreate={autoCreate}
            autoInvite={autoInvite}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button variant="primary" size="lg" fullWidth rounded onPress={onDone}>
          {t('weeklyCheckIn.step4.cta')}
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

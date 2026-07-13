/**
 * Step 5 — Success / All Set.
 *
 * Celebratory bubble + a recap of what the check-in locked in (goal, hours, the
 * real games it just created, games joined). No streak hero — the streak is
 * driven by hitting your weekly game goal at week-end, not by checking in. CTA
 * dismisses the modal.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { SummaryCard, type RecapGame } from '#/features/weekly-checkin/components/SummaryCard';
import type { CreatedMatch } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

interface AllSetStepProps {
  frequencyGoal: number;
  hoursConfirmed: number;
  /** Games record_weekly_checkin created from the confirmed plan. */
  createdMatches: CreatedMatch[];
  /** Games joined / asked to join on the "Games for you" step. */
  joinedGames: RecapGame[];
  requestedGames: RecapGame[];
  onDone: () => void;
}

export function AllSetStep({
  frequencyGoal,
  hoursConfirmed,
  createdMatches,
  joinedGames,
  requestedGames,
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
            frequencyGoal={frequencyGoal}
            hoursConfirmed={hoursConfirmed}
            createdMatches={createdMatches}
            joinedGames={joinedGames}
            requestedGames={requestedGames}
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

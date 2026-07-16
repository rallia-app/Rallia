/**
 * League Edit Sheet
 *
 * Mirrors TournamentEditSheet: a dedicated full-height sheet that renders the
 * league wizard directly, so opening edit is a single clean present rather than
 * a trip through the shared 'main-actions' landing machinery.
 *
 * The league is passed via payload (synchronous with show) so the first presented
 * frame already has the wizard — no state-propagation flash. The sheet's content
 * unmounts on close, so each open remounts the wizard with fresh form state from
 * the payload.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, type SheetProps } from 'react-native-actions-sheet';
import { radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

import { LeagueCreationWizard } from './LeagueCreationWizard';

export function LeagueEditActionSheet({ payload }: SheetProps<'league-edit'>) {
  const { colors } = useThemeStyles();
  const league = payload?.league;

  // Gestures/backdrop dismiss are disabled (this is a form), so the wizard's own
  // close/back buttons drive the hide. onSuccess: the detail screen refreshes via
  // the update mutation's query invalidation, so we just dismiss.
  const handleClose = useCallback(() => {
    SheetManager.hide('league-edit');
  }, []);

  return (
    <ActionSheet
      gestureEnabled={false}
      closeOnTouchBackdrop={false}
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.indicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {league ? (
          <LeagueCreationWizard
            editLeague={league}
            onClose={handleClose}
            onBackToLanding={handleClose}
            onSuccess={handleClose}
          />
        ) : null}
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    overflow: 'hidden',
  },
  indicator: {
    width: 40,
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
});

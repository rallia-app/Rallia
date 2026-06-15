/**
 * Tournament Edit Sheet
 *
 * Dedicated full-height sheet for editing a tournament. Editing used to route
 * through the shared 'main-actions' action sheet, whose landing/slide machinery
 * and heavy multi-purpose render made the present feel laggy. This sheet renders
 * the wizard directly, so opening edit is a single clean present.
 *
 * The tournament is passed via payload (synchronous with show) so the first
 * presented frame already has the wizard — no state-propagation flash. The
 * sheet's content unmounts on close (react-native-actions-sheet renders
 * children only while visible), so each open remounts the wizard with fresh
 * form state from the payload.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, type SheetProps } from 'react-native-actions-sheet';
import { radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

import { TournamentCreationWizard } from './TournamentCreationWizard';

export function TournamentEditActionSheet({ payload }: SheetProps<'tournament-edit'>) {
  const { colors } = useThemeStyles();
  const tournament = payload?.tournament;

  // Gestures/backdrop dismiss are disabled (this is a form), so the wizard's own
  // close/back buttons drive the hide. onSuccess: the wizard already fired the
  // success haptic and the detail screen refreshes via the update mutation's
  // query invalidation, so we just dismiss.
  const handleClose = useCallback(() => {
    SheetManager.hide('tournament-edit');
  }, []);

  return (
    <ActionSheet
      gestureEnabled={false}
      closeOnTouchBackdrop={false}
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.indicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {tournament ? (
          <TournamentCreationWizard
            editTournament={tournament}
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

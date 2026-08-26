/**
 * League Create / Edit Sheets
 *
 * Both render LeagueCreationWizard directly in a dedicated full-height sheet, so
 * opening either is a single clean present rather than a trip through the shared
 * 'main-actions' landing/slide machinery (see TournamentEditSheet, which moved
 * off that path for the same reason).
 *
 * Edit takes the league via payload (synchronous with show) so the first
 * presented frame already has the wizard — no state-propagation flash. The
 * sheet's content unmounts on close, so each open remounts the wizard with fresh
 * form state from the payload.
 *
 * They differ only in what they hand the wizard, so the chrome is shared.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, type SheetProps } from 'react-native-actions-sheet';
import { radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

import { LeagueCreationWizard, type LeagueEditData } from './LeagueCreationWizard';

function LeagueFormSheet({
  sheetId,
  editLeague,
  // Edit mode with no payload yet: the ActionSheet must still mount (returning
  // null before it mounts breaks the sheet), so gate the children instead.
  ready,
}: {
  sheetId: 'league-edit';
  editLeague?: LeagueEditData;
  ready: boolean;
}) {
  const { colors } = useThemeStyles();

  // Gestures/backdrop dismiss are disabled (this is a form), so the wizard's own
  // close/back buttons drive the hide.
  const handleClose = useCallback(() => {
    void SheetManager.hide(sheetId);
  }, [sheetId]);

  const handleSuccess = useCallback(() => {
    void SheetManager.hide(sheetId);
  }, [sheetId]);

  return (
    <ActionSheet
      gestureEnabled={false}
      closeOnTouchBackdrop={false}
      containerStyle={[styles.sheet, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.indicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {ready ? (
          <LeagueCreationWizard
            editLeague={editLeague}
            onClose={handleClose}
            onBackToLanding={handleClose}
            onSuccess={handleSuccess}
          />
        ) : null}
      </View>
    </ActionSheet>
  );
}

/** Edit: the detail screen refreshes via the update mutation's query invalidation. */
export function LeagueEditActionSheet({ payload }: SheetProps<'league-edit'>) {
  const league = payload?.league;
  return <LeagueFormSheet sheetId="league-edit" editLeague={league} ready={!!league} />;
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

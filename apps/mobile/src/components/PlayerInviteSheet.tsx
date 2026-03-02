/**
 * Player Invite Bottom Sheet
 *
 * A modal bottom sheet that wraps the PlayerInviteStep component.
 * Opens when the match host wants to invite players from the MatchDetailSheet.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import {
  lightTheme,
  darkTheme,
  radiusPixels,
  spacingPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import { useTheme, useMatch } from '@rallia/shared-hooks';
import type { MatchParticipantWithPlayer } from '@rallia/shared-types';
import { useMatchDetailSheet } from '../context/MatchDetailSheetContext';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { useTranslation } from '../hooks';
import { PlayerInviteStep } from '../features/matches/components/PlayerInviteStep';

const BASE_WHITE = '#ffffff';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PlayerInviteActionSheet({ payload }: SheetProps<'player-invite'>) {
  const matchId = payload?.matchId ?? '';
  const sportId = payload?.sportId ?? '';
  const hostId = payload?.hostId ?? '';
  const excludePlayerIds = payload?.excludePlayerIds ?? [];

  const { updateSelectedMatch, selectedMatch } = useMatchDetailSheet();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Use the match query to get fresh data after invite
  // This query is automatically invalidated when useInviteToMatch succeeds
  const { refetch: refetchMatch } = useMatch(matchId, {
    enabled: !!matchId,
  });

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.card,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
    }),
    [themeColors, isDark]
  );

  // Handle complete - refetch match data and update context, then close the sheet
  const handleComplete = useCallback(async () => {
    // Refetch the match to get the updated participant list
    const result = await refetchMatch();
    // The refetch returns { data } which contains the match
    const freshMatch = result.data;
    if (freshMatch && selectedMatch) {
      // Update the selected match in context with fresh data
      // Preserve distance_meters from original as it's not in the query result
      updateSelectedMatch({
        ...freshMatch,
        distance_meters: selectedMatch.distance_meters,
      } as MatchDetailData);
    }
    SheetManager.hide('player-invite');
  }, [refetchMatch, selectedMatch, updateSelectedMatch]);

  // Optimistic update: immediately add new participants to the match detail sheet
  const handleInviteSuccess = useCallback(
    (newParticipants: MatchParticipantWithPlayer[]) => {
      if (!selectedMatch || newParticipants.length === 0) return;
      updateSelectedMatch({
        ...selectedMatch,
        participants: [...(selectedMatch.participants ?? []), ...newParticipants],
      } as MatchDetailData);
    },
    [selectedMatch, updateSelectedMatch]
  );

  // Handle close button press
  const handleClose = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('player-invite');
  }, []);

  // Render nothing meaningful if no invite data
  if (!matchId) {
    return null;
  }

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Close button - simple icon, no rounded background (matches other sheets) */}
        <View style={styles.closeButtonContainer}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Player invite content */}
        <PlayerInviteStep
          matchId={matchId}
          sportId={sportId}
          hostId={hostId}
          excludePlayerIds={excludePlayerIds}
          onComplete={handleComplete}
          onInviteSuccess={handleInviteSuccess}
          colors={colors}
          t={t}
          isDark={isDark}
        />
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility
export const PlayerInviteSheet = PlayerInviteActionSheet;

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
  },
  closeButtonContainer: {
    position: 'absolute',
    top: spacingPixels[2],
    right: spacingPixels[4],
    zIndex: 10,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
});

export default PlayerInviteActionSheet;

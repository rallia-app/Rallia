/**
 * Feedback Bottom Sheet
 *
 * A modal bottom sheet that wraps the MatchFeedbackWizard component.
 * Opens when a participant wants to provide post-match feedback.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { lightTheme, darkTheme, radiusPixels, spacingPixels } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';
import { useFeedbackSheet } from '../context/FeedbackSheetContext';
import { useMatchDetailSheet } from '../context/MatchDetailSheetContext';
import { MatchFeedbackWizard } from '../features/matches/components/MatchFeedbackWizard';
import * as Analytics from '../services/analytics';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FeedbackSheet: React.FC = () => {
  const { sheetRef, closeSheet, feedbackData } = useFeedbackSheet();
  const { selectedMatch, updateSelectedMatch } = useMatchDetailSheet();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      muted: themeColors.muted,
    }),
    [themeColors]
  );

  // Single snap point at 95%
  const snapPoints = useMemo(() => ['95%'], []);

  // Backdrop
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  // Handle close (without completing feedback)
  const handleClose = useCallback(() => {
    selectionHaptic();
    Analytics.feedbackAbandoned();
    closeSheet();
  }, [closeSheet]);

  // Handle complete - update the match context to reflect feedback_completed
  const handleComplete = useCallback(() => {
    Analytics.matchFeedbackSubmitted({
      sport: selectedMatch?.sport?.name ?? 'unknown',
    });
    // Update the participant's feedback_completed flag in the match context
    // This ensures the MatchDetailSheet shows the updated UI state
    if (selectedMatch && feedbackData?.reviewerId) {
      const updatedParticipants = selectedMatch.participants?.map(p =>
        p.player_id === feedbackData.reviewerId ? { ...p, feedback_completed: true } : p
      );
      updateSelectedMatch({
        ...selectedMatch,
        participants: updatedParticipants,
      });
    }
    closeSheet();
  }, [closeSheet, selectedMatch, feedbackData, updateSelectedMatch]);

  // Render empty sheet if no data
  if (!feedbackData) {
    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        index={0}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      >
        {null}
      </BottomSheetModal>
    );
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
    >
      <View style={styles.container}>
        <MatchFeedbackWizard
          feedbackData={feedbackData}
          onClose={handleClose}
          onComplete={handleComplete}
        />
      </View>
    </BottomSheetModal>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
  },
  container: {
    flex: 1,
  },
});

export default FeedbackSheet;

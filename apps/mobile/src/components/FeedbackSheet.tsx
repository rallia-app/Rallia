/**
 * Feedback Action Sheet
 *
 * A modal bottom sheet that wraps the MatchFeedbackWizard component.
 * Opens when a participant wants to provide post-match feedback.
 */

import * as React from 'react';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { selectionHaptic } from '@rallia/shared-utils';

import { useFeedbackSheet } from '#/context/FeedbackSheetContext';
import { useMatchDetailSheet } from '#/context/MatchDetailSheetContext';
import { MatchFeedbackWizard } from '#/features/matches/components/MatchFeedbackWizard';
import * as Analytics from '#/services/analytics';

import { BaseActionSheet } from './BaseActionSheet';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FeedbackActionSheet: React.FC = () => {
  const { closeSheet, feedbackData } = useFeedbackSheet();
  const { selectedMatch, updateSelectedMatch } = useMatchDetailSheet();

  const handleClose = useCallback(() => {
    selectionHaptic();
    Analytics.feedbackAbandoned();
    closeSheet();
  }, [closeSheet]);

  // Records completion (analytics + optimistic flip) WITHOUT closing — the
  // wizard may still show its "what's next" prompt after this fires.
  const handleComplete = useCallback(() => {
    Analytics.matchFeedbackSubmitted({
      sport_id: feedbackData?.sportId ?? selectedMatch?.sport?.id ?? 'unknown',
      sport_name: feedbackData?.sportName ?? selectedMatch?.sport?.name ?? 'unknown',
    });
    if (selectedMatch && feedbackData?.reviewerId) {
      const updatedParticipants = selectedMatch.participants?.map(p =>
        p.player_id === feedbackData.reviewerId ? { ...p, feedback_completed: true } : p
      );
      updateSelectedMatch({
        ...selectedMatch,
        participants: updatedParticipants,
      });
    }
  }, [selectedMatch, feedbackData, updateSelectedMatch]);

  // Close after completion — no abandonment analytics.
  const handleDone = useCallback(() => {
    closeSheet();
  }, [closeSheet]);

  return (
    <BaseActionSheet>
      <View style={styles.container}>
        {feedbackData && (
          <MatchFeedbackWizard
            feedbackData={feedbackData}
            onClose={handleClose}
            onComplete={handleComplete}
            onDone={handleDone}
          />
        )}
      </View>
    </BaseActionSheet>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default FeedbackActionSheet;

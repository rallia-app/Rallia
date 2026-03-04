/**
 * Opponent Feedback Step
 *
 * A step in the feedback wizard for rating a single opponent.
 * Includes attendance toggle, late toggle, star rating, and comments.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { BottomSheetTextInput, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { lightHaptic, getProfilePictureUrl, successHaptic } from '@rallia/shared-utils';
import { SheetManager } from 'react-native-actions-sheet';
import { StarRating } from '../../../../components/StarRating';
import type {
  OpponentForFeedback,
  OpponentFeedbackFormState,
  MatchReportReasonEnum,
} from '@rallia/shared-types';
import type { TranslationKey } from '../../../../hooks/useTranslation';

// =============================================================================
// TYPES
// =============================================================================

interface OpponentFeedbackStepProps {
  /** Opponent to provide feedback for */
  opponent: OpponentForFeedback;
  /** Current feedback state */
  feedback: OpponentFeedbackFormState;
  /** Callback when feedback form values change */
  onFeedbackChange: (feedback: OpponentFeedbackFormState) => void;
  /** Callback when report is submitted */
  onReportSubmit?: (reason: MatchReportReasonEnum, details?: string) => void;
  /** Whether report submission is in progress */
  isSubmittingReport?: boolean;
  /** Theme colors */
  colors: {
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    cardBackground: string;
    background?: string;
  };
  /** Translation function */
  t: (key: TranslationKey) => string;
  /** Whether dark mode is active */
  isDark: boolean;
}

// =============================================================================
// TOGGLE COMPONENT
// =============================================================================

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: OpponentFeedbackStepProps['colors'];
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, value, onChange, colors }) => (
  <View style={[styles.toggleRow, { borderColor: colors.border }]}>
    <View style={styles.toggleTextContainer}>
      <Text size="base" weight="medium" color={colors.text}>
        {label}
      </Text>
      {description && (
        <Text size="xs" color={colors.textMuted}>
          {description}
        </Text>
      )}
    </View>
    <View style={styles.toggleButtons}>
      <TouchableOpacity
        style={[
          styles.toggleButton,
          {
            backgroundColor: value ? colors.buttonActive : colors.buttonInactive,
            borderColor: value ? colors.buttonActive : colors.border,
          },
        ]}
        onPress={() => {
          lightHaptic();
          onChange(true);
        }}
        activeOpacity={0.7}
      >
        <Text
          size="sm"
          weight={value ? 'semibold' : 'regular'}
          color={value ? colors.buttonTextActive : colors.textMuted}
        >
          Yes
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.toggleButton,
          {
            backgroundColor: !value ? colors.buttonActive : colors.buttonInactive,
            borderColor: !value ? colors.buttonActive : colors.border,
          },
        ]}
        onPress={() => {
          lightHaptic();
          onChange(false);
        }}
        activeOpacity={0.7}
      >
        <Text
          size="sm"
          weight={!value ? 'semibold' : 'regular'}
          color={!value ? colors.buttonTextActive : colors.textMuted}
        >
          No
        </Text>
      </TouchableOpacity>
    </View>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const OpponentFeedbackStep: React.FC<OpponentFeedbackStepProps> = ({
  opponent,
  feedback,
  onFeedbackChange,
  onReportSubmit,
  isSubmittingReport = false,
  colors,
  t,
  isDark: _isDark,
}) => {
  const { showedUp, wasLate, starRating, comments } = feedback;

  // Handle report submission (called from action sheet via payload)
  const handleReportSubmit = useCallback(
    (reason: MatchReportReasonEnum, details?: string) => {
      if (onReportSubmit) {
        onReportSubmit(reason, details);
        successHaptic();
        SheetManager.hide('report-issue');
      }
    },
    [onReportSubmit]
  );

  // Handle report button press - opens the report action sheet on top
  const handleReportPress = useCallback(() => {
    lightHaptic();
    SheetManager.show('report-issue', {
      payload: {
        opponentName: opponent.name,
        onSubmit: handleReportSubmit,
        isSubmitting: isSubmittingReport,
      },
    });
  }, [opponent.name, handleReportSubmit, isSubmittingReport]);

  const handleShowedUpChange = useCallback(
    (value: boolean) => {
      onFeedbackChange({
        ...feedback,
        showedUp: value,
        wasLate: value ? feedback.wasLate : false,
        starRating: value ? feedback.starRating : undefined,
      });
    },
    [feedback, onFeedbackChange]
  );

  const handleWasLateChange = useCallback(
    (value: boolean) => {
      onFeedbackChange({
        ...feedback,
        wasLate: value,
      });
    },
    [feedback, onFeedbackChange]
  );

  const handleStarRatingChange = useCallback(
    (rating: number) => {
      onFeedbackChange({
        ...feedback,
        starRating: rating,
      });
    },
    [feedback, onFeedbackChange]
  );

  const handleCommentsChange = useCallback(
    (text: string) => {
      onFeedbackChange({
        ...feedback,
        comments: text,
      });
    },
    [feedback, onFeedbackChange]
  );

  // Avatar URL
  const avatarUrl = opponent.avatarUrl ? getProfilePictureUrl(opponent.avatarUrl) : null;

  return (
    <BottomSheetScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Opponent Header */}
      <View style={styles.header}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: avatarUrl ? colors.buttonActive : colors.buttonInactive,
              borderWidth: 1.5,
              borderColor: primary[500],
            },
          ]}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Ionicons name="person-outline" size={32} color={colors.textMuted} />
          )}
        </View>
        <Text size="xl" weight="bold" color={colors.text} style={styles.opponentName}>
          {opponent.fullName}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {t('matchFeedback.opponentStep.rateExperience')}
        </Text>
      </View>

      {/* Attendance Toggle */}
      <View style={styles.fieldGroup}>
        <ToggleRow
          label={t('matchFeedback.opponentStep.showedUp')}
          value={showedUp}
          onChange={handleShowedUpChange}
          colors={colors}
        />
        {showedUp && (
          <View style={[styles.infoBox, { backgroundColor: `${colors.buttonActive}10` }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.buttonActive} />
            <Text size="xs" color={colors.textSecondary} style={styles.infoText}>
              {t('matchFeedback.opponentStep.noShowInfo')}
            </Text>
          </View>
        )}
      </View>

      {/* Late Toggle (only if showed up) */}
      {showedUp && (
        <View style={styles.fieldGroup}>
          <ToggleRow
            label={t('matchFeedback.opponentStep.wasLate')}
            description={t('matchFeedback.opponentStep.wasLateDescription')}
            value={wasLate}
            onChange={handleWasLateChange}
            colors={colors}
          />
        </View>
      )}

      {/* Star Rating (only if showed up) */}
      {showedUp && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
            {t('matchFeedback.opponentStep.rating')}
          </Text>
          <View style={styles.ratingContainer}>
            <StarRating
              value={starRating}
              onChange={handleStarRatingChange}
              size={40}
              activeColor={colors.buttonActive}
              inactiveColor={colors.textMuted}
            />
          </View>
        </View>
      )}

      {/* Comments */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.fieldLabel}>
          {t('matchFeedback.opponentStep.comments')}
        </Text>
        <BottomSheetTextInput
          style={[
            styles.commentsInput,
            {
              borderColor: colors.border,
              backgroundColor: colors.buttonInactive,
              color: colors.text,
            },
          ]}
          value={comments}
          onChangeText={handleCommentsChange}
          placeholder={t('matchFeedback.opponentStep.commentsPlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          maxLength={500}
        />
        <Text size="xs" color={colors.textMuted} style={styles.characterCount}>
          {comments.length}/500
        </Text>
      </View>

      {/* Report Link */}
      {onReportSubmit && (
        <TouchableOpacity style={styles.reportLink} onPress={handleReportPress} activeOpacity={0.7}>
          <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted}>
            {t('matchFeedback.opponentStep.reportIssue')}
          </Text>
        </TouchableOpacity>
      )}
    </BottomSheetScrollView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  header: {
    alignItems: 'center',
    marginBottom: spacingPixels[6],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  opponentName: {
    marginBottom: spacingPixels[1],
    textAlign: 'center',
  },
  fieldGroup: {
    marginBottom: spacingPixels[5],
  },
  fieldLabel: {
    marginBottom: spacingPixels[2],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleButtons: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  toggleButton: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    minWidth: 50,
    alignItems: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  infoText: {
    flex: 1,
  },
  ratingContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
  commentsInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  characterCount: {
    textAlign: 'right',
    marginTop: spacingPixels[1],
  },
  reportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    marginBottom: spacingPixels[4],
  },
});

export default OpponentFeedbackStep;

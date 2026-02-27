/**
 * Match Feedback Wizard
 *
 * A multi-step wizard for post-match feedback collection.
 * Step 0: Match outcome (played vs cancelled)
 * Steps 1-N: Individual opponent feedback (one per opponent)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTheme, useMatchFeedback } from '@rallia/shared-hooks';
import type {
  FeedbackSheetData,
  OpponentFeedbackFormState,
  MatchOutcomeEnum,
  CancellationReasonEnum,
  MatchReportReasonEnum,
} from '@rallia/shared-types';

import { useTranslation, type TranslationKey } from '../../../hooks/useTranslation';
import { MatchOutcomeStep, OpponentFeedbackStep } from './feedback-steps';

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

interface MatchFeedbackWizardProps {
  /** Feedback data from context */
  feedbackData: FeedbackSheetData;
  /** Callback when wizard should close */
  onClose: () => void;
  /** Callback when feedback is completed */
  onComplete?: () => void;
}

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}

// =============================================================================
// PROGRESS BAR COMPONENT
// =============================================================================

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  /** Name of the current step (e.g., "Outcome" or opponent name) */
  currentStepName: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  colors,
  t,
  currentStepName,
}) => {
  const progress = useSharedValue((currentStep / totalSteps) * 100);

  // Animate progress when step changes
  useEffect(() => {
    progress.value = withTiming((currentStep / totalSteps) * 100, { duration: 300 });
  }, [currentStep, totalSteps, progress]);

  const animatedProgressStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressHeader}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {t('matchFeedback.step')
            .replace('{current}', String(currentStep))
            .replace('{total}', String(totalSteps))}
        </Text>
        <Text size="sm" weight="bold" color={colors.progressActive}>
          {currentStepName}
        </Text>
      </View>
      <View style={[styles.progressBarBg, { backgroundColor: colors.progressInactive }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { backgroundColor: colors.progressActive },
            animatedProgressStyle,
          ]}
        />
      </View>
    </View>
  );
};

// =============================================================================
// MAIN WIZARD COMPONENT
// =============================================================================

export const MatchFeedbackWizard: React.FC<MatchFeedbackWizardProps> = ({
  feedbackData,
  onClose,
  onComplete,
}) => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const isDark = theme === 'dark';

  // State
  const [currentStep, setCurrentStep] = useState(0); // 0 = outcome step, 1+ = opponent steps
  const [matchPlayed, setMatchPlayed] = useState(false);

  // Form state for outcome step
  const [outcome, setOutcome] = useState<MatchOutcomeEnum | null>(null);
  const [cancellationReason, setCancellationReason] = useState<CancellationReasonEnum | null>(null);
  const [cancellationNotes, setCancellationNotes] = useState('');
  const [noShowPlayerIds, setNoShowPlayerIds] = useState<string[]>([]);

  // Form state for opponent steps (indexed by opponent index in unratedOpponents)
  const [opponentFeedback, setOpponentFeedback] = useState<
    Record<number, OpponentFeedbackFormState>
  >({});

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = {
    background: themeColors.background,
    cardBackground: themeColors.card,
    text: themeColors.foreground,
    textSecondary: isDark ? primary[300] : neutral[600],
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    buttonActive: isDark ? primary[500] : primary[600],
    buttonInactive: themeColors.muted,
    buttonTextActive: BASE_WHITE,
    progressActive: isDark ? primary[500] : primary[600],
    progressInactive: themeColors.muted,
  };

  // Feedback hook - provides opponent data from database with correct hasExistingFeedback status
  const {
    submitOutcome,
    submitFeedback,
    submitReport,
    isSubmittingOutcome,
    isSubmittingFeedback,
    isSubmittingReport,
    unratedOpponents,
    isLoadingOpponents,
    participant,
    isLoadingParticipant,
    matchContext,
    isLoadingMatchContext,
  } = useMatchFeedback(feedbackData.matchId, feedbackData.reviewerId, {
    onOutcomeSuccess: result => {
      if (result.feedbackCompleted) {
        // Cancelled - close immediately
        successHaptic();
        onComplete?.();
        onClose();
      } else {
        // Played - proceed to opponent steps
        setMatchPlayed(true);
        goToNextStep();
      }
    },
    onOutcomeError: error => {
      warningHaptic();
      console.error('[MatchFeedbackWizard] Outcome error:', error);
    },
    onFeedbackSuccess: result => {
      if (result.allOpponentsRated || currentStep >= totalSteps - 1) {
        // All done - close immediately
        successHaptic();
        onComplete?.();
        onClose();
      } else {
        // Move to next opponent
        goToNextStep();
      }
    },
    onFeedbackError: error => {
      warningHaptic();
      console.error('[MatchFeedbackWizard] Feedback error:', error);
    },
    onReportSuccess: () => {
      // Report submitted successfully - toast is shown by the component
      console.log('[MatchFeedbackWizard] Report submitted successfully');
    },
    onReportError: error => {
      warningHaptic();
      console.error('[MatchFeedbackWizard] Report error:', error);
    },
  });

  // Track if outcome was already submitted when the wizard FIRST opened
  // Uses the React "setState during render" pattern to freeze the initial value
  const [initialOutcomeSubmitted, setInitialOutcomeSubmitted] = useState<boolean | null>(null);
  if (participant && initialOutcomeSubmitted === null) {
    setInitialOutcomeSubmitted(participant.match_outcome === 'played');
  }

  // Track the initial list of opponents when the wizard FIRST opened
  const [initialOpponents, setInitialOpponents] = useState<typeof unratedOpponents | null>(null);
  if (unratedOpponents.length > 0 && initialOpponents === null) {
    setInitialOpponents(unratedOpponents);
  }

  const outcomeAlreadySubmitted = initialOutcomeSubmitted ?? false;
  const opponents = initialOpponents ?? unratedOpponents;

  // Helper: whether we're currently on the outcome step
  const isOnOutcomeStep = !outcomeAlreadySubmitted && currentStep === 0;

  // Helper: get opponent index from current step
  // If outcome is already submitted, step 0 = first opponent
  // If outcome is not submitted, step 0 = outcome, step 1 = first opponent
  const getOpponentIndex = useCallback(
    (step: number) => (outcomeAlreadySubmitted ? step : step - 1),
    [outcomeAlreadySubmitted]
  );

  // Total steps: outcome step (if not already submitted) + opponents count
  const totalSteps = (outcomeAlreadySubmitted ? 0 : 1) + opponents.length;

  // Navigation
  const goToNextStep = () => {
    lightHaptic();
    setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1));
  };

  const goToPrevStep = useCallback(() => {
    lightHaptic();
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  // Handle outcome form changes
  const handleOutcomeChange = useCallback(
    (
      newOutcome: MatchOutcomeEnum | null,
      newCancellationReason?: CancellationReasonEnum | null,
      newCancellationNotes?: string
    ) => {
      setOutcome(newOutcome);
      if (newCancellationReason !== undefined) {
        setCancellationReason(newCancellationReason);
      }
      if (newCancellationNotes !== undefined) {
        setCancellationNotes(newCancellationNotes);
      }
    },
    []
  );

  // Handle opponent feedback form changes
  const handleOpponentFeedbackChange = useCallback(
    (opponentIndex: number, feedback: OpponentFeedbackFormState) => {
      setOpponentFeedback(prev => ({
        ...prev,
        [opponentIndex]: feedback,
      }));
    },
    []
  );

  // Handle outcome confirmation
  const handleOutcomeConfirm = useCallback(() => {
    if (!outcome) return;
    if (outcome === 'mutual_cancel' && !cancellationReason) return;
    if (outcome === 'opponent_no_show' && noShowPlayerIds.length === 0) return;

    submitOutcome({
      participantId: feedbackData.participantId,
      reviewerId: feedbackData.reviewerId,
      outcome,
      cancellationReason: outcome === 'mutual_cancel' ? cancellationReason! : undefined,
      cancellationNotes:
        outcome === 'mutual_cancel' && cancellationReason === 'other'
          ? cancellationNotes
          : undefined,
      noShowPlayerIds: outcome === 'opponent_no_show' ? noShowPlayerIds : undefined,
    });
  }, [
    submitOutcome,
    feedbackData.participantId,
    feedbackData.reviewerId,
    outcome,
    cancellationReason,
    cancellationNotes,
    noShowPlayerIds,
  ]);

  // Handle opponent feedback submission
  const handleOpponentFeedbackSubmit = useCallback(() => {
    const opponentIndex = getOpponentIndex(currentStep);
    const opponent = opponents[opponentIndex];
    const feedback = opponentFeedback[opponentIndex];

    if (!opponent || !feedback) return;

    submitFeedback({
      opponentId: opponent.playerId,
      showedUp: feedback.showedUp,
      wasLate: feedback.wasLate,
      starRating: feedback.starRating,
      comments: feedback.comments,
    });
  }, [submitFeedback, opponents, currentStep, opponentFeedback, getOpponentIndex]);

  // Handle skip
  const handleSkip = useCallback(() => {
    if (currentStep >= totalSteps - 1) {
      // Last opponent - close the wizard
      onClose();
    } else {
      // Move to next opponent
      goToNextStep();
    }
  }, [currentStep, totalSteps, goToNextStep, onClose]);

  // Handle report submission for current opponent
  const handleReportSubmit = useCallback(
    (reason: MatchReportReasonEnum, details?: string) => {
      const opponentIndex = getOpponentIndex(currentStep);
      const opponent = opponents[opponentIndex];
      if (!opponent) return;

      submitReport({
        reportedId: opponent.playerId,
        reason,
        details,
      });
    },
    [submitReport, opponents, currentStep, getOpponentIndex]
  );

  // Determine if current step can proceed
  const canProceed = useMemo(() => {
    if (isOnOutcomeStep) {
      // Outcome step
      if (outcome === 'played') return true;
      if (outcome === 'mutual_cancel') return cancellationReason !== null;
      if (outcome === 'opponent_no_show') return noShowPlayerIds.length > 0;
      return false;
    } else {
      // Opponent step - always can proceed (can skip)
      return true;
    }
  }, [isOnOutcomeStep, outcome, cancellationReason, noShowPlayerIds]);

  // Determine button text and action
  const getFooterButton = useMemo(() => {
    if (isOnOutcomeStep) {
      // Outcome step
      let label = t('matchFeedback.outcomeStep.continue');
      let icon = 'arrow-forward';

      if (outcome === 'mutual_cancel') {
        label = t('matchFeedback.outcomeStep.confirmCancelled');
        icon = 'checkmark';
      } else if (outcome === 'opponent_no_show') {
        label = t('matchFeedback.outcomeStep.confirmNoShows');
        icon = 'checkmark';
      }

      return {
        label,
        icon,
        onPress: handleOutcomeConfirm,
        isLoading: isSubmittingOutcome,
      };
    } else {
      // Opponent step
      const isLastOpponent = currentStep >= totalSteps - 1;
      return {
        label: isLastOpponent
          ? t('matchFeedback.opponentStep.complete')
          : t('matchFeedback.opponentStep.continue'),
        icon: isLastOpponent ? 'checkmark' : 'arrow-forward',
        onPress: handleOpponentFeedbackSubmit,
        isLoading: isSubmittingFeedback,
      };
    }
  }, [
    isOnOutcomeStep,
    outcome,
    totalSteps,
    handleOutcomeConfirm,
    handleOpponentFeedbackSubmit,
    isSubmittingOutcome,
    isSubmittingFeedback,
    t,
    currentStep,
  ]);

  // Loading state while fetching opponents, participant data, and match context
  if (isLoadingOpponents || isLoadingParticipant || isLoadingMatchContext) {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
          <Text size="base" color={colors.textMuted} style={styles.loadingText}>
            {t('common.loading')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          {currentStep > 0 && (matchPlayed || outcomeAlreadySubmitted) && (
            <TouchableOpacity
              onPress={goToPrevStep}
              style={styles.headerButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
            </TouchableOpacity>
          )}
        </View>

        <Text size="lg" weight="semibold" color={colors.text}>
          {t('matchFeedback.title')}
        </Text>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress */}
      <ProgressBar
        currentStep={currentStep + 1}
        totalSteps={totalSteps}
        colors={colors}
        t={t}
        currentStepName={
          isOnOutcomeStep
            ? t('matchFeedback.stepNames.outcome')
            : opponents[getOpponentIndex(currentStep)]?.name ||
              t('matchFeedback.stepNames.feedback')
        }
      />

      {/* Current Step */}
      <View style={styles.stepsViewport}>
        {isOnOutcomeStep ? (
          <MatchOutcomeStep
            outcome={outcome}
            cancellationReason={cancellationReason}
            cancellationNotes={cancellationNotes}
            onOutcomeChange={handleOutcomeChange}
            opponents={opponents}
            noShowPlayerIds={noShowPlayerIds}
            onNoShowPlayerIdsChange={setNoShowPlayerIds}
            matchContext={matchContext}
            colors={colors}
            t={t}
            locale={locale}
            isDark={isDark}
          />
        ) : (
          (() => {
            const opponentIndex = getOpponentIndex(currentStep);
            const opponent = opponents[opponentIndex];
            if (!opponent) return null;
            const feedback = opponentFeedback[opponentIndex] || {
              showedUp: true,
              wasLate: false,
              starRating: undefined,
              comments: '',
            };
            return (
              <OpponentFeedbackStep
                key={opponent.playerId}
                opponent={opponent}
                feedback={feedback}
                onFeedbackChange={newFeedback =>
                  handleOpponentFeedbackChange(opponentIndex, newFeedback)
                }
                onReportSubmit={handleReportSubmit}
                isSubmittingReport={isSubmittingReport}
                colors={colors}
                t={t}
                isDark={isDark}
              />
            );
          })()
        )}
      </View>

      {/* Navigation buttons */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {!isOnOutcomeStep && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            disabled={getFooterButton.isLoading}
            activeOpacity={0.7}
          >
            <Text size="base" color={colors.textSecondary}>
              {t('matchFeedback.opponentStep.skip')}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.nextButton,
            {
              backgroundColor:
                canProceed && !getFooterButton.isLoading
                  ? colors.buttonActive
                  : colors.buttonInactive,
              flex: 1,
            },
          ]}
          onPress={getFooterButton.onPress}
          disabled={!canProceed || getFooterButton.isLoading}
          activeOpacity={0.8}
        >
          {getFooterButton.isLoading ? (
            <ActivityIndicator color={colors.buttonTextActive} />
          ) : (
            <>
              <Text
                size="lg"
                weight="semibold"
                color={canProceed ? colors.buttonTextActive : colors.textMuted}
              >
                {getFooterButton.label}
              </Text>
              <Ionicons
                name={getFooterButton.icon as ComponentProps<typeof Ionicons>['name']}
                size={20}
                color={canProceed ? colors.buttonTextActive : colors.textMuted}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  progressContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  progressBarBg: {
    height: 4,
    borderRadius: radiusPixels.full,
    overflow: 'hidden',
    marginTop: spacingPixels[2],
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radiusPixels.full,
  },
  stepsViewport: {
    flex: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  skipButton: {
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    paddingBottom: spacingPixels[4],
  },
  loadingText: {
    textAlign: 'center',
    marginTop: spacingPixels[4],
  },
});

export default MatchFeedbackWizard;

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
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { useTheme, useMatchFeedback, useCoPlayerUpcomingGames } from '@rallia/shared-hooks';
import type {
  FeedbackSheetData,
  OpponentFeedbackFormState,
  MatchOutcomeEnum,
  CancellationReasonEnum,
  MatchReportReasonEnum,
} from '@rallia/shared-types';

import {
  supabase,
  Logger,
  getMatchWithDetails,
  type CoPlayerUpcomingGame,
} from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '#/hooks/useTranslation';
import { useStoreReviewPrompt } from '#/hooks/useStoreReviewPrompt';
import * as Analytics from '#/services/analytics';
import {
  useActionsSheet,
  useMatchDetailSheet,
  type MatchCreationPrefill,
  type MatchDetailData,
} from '#/context';
import { navigateFromOutside } from '#/navigation/navigationRef';

import { MatchOutcomeStep, OpponentFeedbackStep, CoPlayerGamesSection } from './feedback-steps';

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

interface MatchFeedbackWizardProps {
  /** Feedback data from context */
  feedbackData: FeedbackSheetData;
  /** Callback when the user dismisses the wizard before finishing (abandonment) */
  onClose: () => void;
  /** Callback when feedback is recorded (analytics + optimistic updates; must NOT close) */
  onComplete?: () => void;
  /** Callback to close the sheet after completion (no abandonment analytics) */
  onDone?: () => void;
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
  onDone,
}) => {
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { openSheetForMatchCreation } = useActionsSheet();
  const { openSheet: openMatchDetailSheet } = useMatchDetailSheet();
  const { maybePromptForReview } = useStoreReviewPrompt();
  const isDark = theme === 'dark';
  // State
  const [currentStep, setCurrentStep] = useState(0); // 0 = outcome step, 1+ = opponent steps
  const [matchPlayed, setMatchPlayed] = useState(false);
  // Post-completion "what's next" prompt (played outcome only)
  const [showNextPrompt, setShowNextPrompt] = useState(false);

  // Upcoming open games from the people they just played with. Fetched only
  // once the prompt is showing, so the wizard's main path pays nothing for it.
  const { games: coPlayerGames } = useCoPlayerUpcomingGames({
    matchId: feedbackData.matchId,
    enabled: showNextPrompt,
  });
  const closeCompleted = onDone ?? onClose;

  // Form state for outcome step
  const [outcome, setOutcome] = useState<MatchOutcomeEnum | null>(null);
  const [cancellationReason, setCancellationReason] = useState<CancellationReasonEnum | null>(null);
  const [cancellationNotes, setCancellationNotes] = useState('');
  const [noShowPlayerIds, setNoShowPlayerIds] = useState<string[]>([]);

  // Form state for opponent steps (indexed by opponent index in unratedOpponents)
  const [opponentFeedback, setOpponentFeedback] = useState<
    Record<number, OpponentFeedbackFormState>
  >({});

  // Optimistic tracking of reported player IDs (hides report button immediately)
  const [reportedPlayerIds, setReportedPlayerIds] = useState<Set<string>>(new Set());

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
      Analytics.matchOutcomeSubmitted({
        match_id: feedbackData.matchId,
        sport_id: feedbackData.sportId ?? 'unknown',
        sport_name: (feedbackData.sportName ?? 'unknown').toLowerCase(),
        outcome: result.outcome,
        cancellation_reason:
          result.outcome === 'mutual_cancel' && cancellationReason ? cancellationReason : undefined,
        no_show_count: result.outcome === 'opponent_no_show' ? noShowPlayerIds.length : undefined,
        opponent_count: opponents.length,
        is_auto_generated: matchContext?.isAutoGenerated ?? false,
      });
      if (result.feedbackCompleted) {
        // Cancelled - close immediately
        successHaptic();
        toast.success(t('matchFeedback.success'));
        onComplete?.();
        closeCompleted();
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
      const opponentIndex = getOpponentIndex(currentStep);
      const submittedFeedback = opponentFeedback[opponentIndex];
      if (submittedFeedback) {
        Analytics.opponentFeedbackSubmitted({
          match_id: feedbackData.matchId,
          sport_id: feedbackData.sportId ?? 'unknown',
          sport_name: (feedbackData.sportName ?? 'unknown').toLowerCase(),
          showed_up: submittedFeedback.showedUp,
          was_late: submittedFeedback.showedUp ? submittedFeedback.wasLate : null,
          star_rating: submittedFeedback.showedUp ? (submittedFeedback.starRating ?? null) : null,
          level_assessment: submittedFeedback.showedUp
            ? (submittedFeedback.levelAssessment ?? null)
            : null,
        });
      }
      if (result.allOpponentsRated || currentStep >= totalSteps - 1) {
        // All done - record, then offer the next game instead of dead-ending
        Analytics.matchFeedbackCompleted({
          match_id: feedbackData.matchId,
          sport_id: feedbackData.sportId ?? 'unknown',
          sport_name: (feedbackData.sportName ?? 'unknown').toLowerCase(),
          opponent_count: opponents.length,
          is_auto_generated: matchContext?.isAutoGenerated ?? false,
        });
        successHaptic();
        onComplete?.();
        setShowNextPrompt(true);
        // Primary review-prompt trigger: the player has just finished a
        // reflective, optional, task-complete step with nothing left pending.
        // Eligibility (3+ completed feedback sessions) is checked server-side.
        // The delay lets the "what's next" screen render underneath first.
        void maybePromptForReview('match_feedback_completed', {
          delayMs: 1400,
          opponentStarRating: submittedFeedback?.showedUp
            ? (submittedFeedback.starRating ?? null)
            : null,
        });
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
      // Optimistically hide the report button for the current opponent
      const opponentIndex = getOpponentIndex(currentStep);
      const opponent = opponents[opponentIndex];
      if (opponent) {
        setReportedPlayerIds(prev => new Set(prev).add(opponent.playerId));
      }
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
      levelAssessment: feedback.levelAssessment,
      comments: feedback.comments,
    });
  }, [submitFeedback, opponents, currentStep, opponentFeedback, getOpponentIndex]);

  // Handle skip
  const handleSkip = () => {
    if (currentStep >= totalSteps - 1) {
      // Last opponent - close the wizard
      onClose();
    } else {
      // Move to next opponent
      goToNextStep();
    }
  };

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

  // ---- Post-completion "what's next" handlers ----

  // "Play again": same place, same slot, next week. Fetch the source match and
  // hand a prefill to the creation wizard after this sheet has fully closed.
  const handlePlayAgain = useCallback(async () => {
    lightHaptic();
    Analytics.postFeedbackPromptAction({
      action: 'create',
      match_id: feedbackData.matchId,
      sport_id: feedbackData.sportId ?? 'unknown',
    });
    let prefill: MatchCreationPrefill | undefined;
    try {
      const { data } = await supabase
        .from('match')
        .select(
          'match_date, start_time, end_time, timezone, format, player_expectation, duration, custom_duration_minutes, location_type, facility_id, location_name, location_address'
        )
        .eq('id', feedbackData.matchId)
        .single();
      if (data?.match_date && data.start_time) {
        const next = new Date(`${data.match_date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 7);
        prefill = {
          locationType: (data.location_type ?? 'tbd') as MatchCreationPrefill['locationType'],
          facilityId: data.facility_id ?? undefined,
          locationName: data.location_name ?? undefined,
          locationAddress: data.location_address ?? undefined,
          matchDate: next.toISOString().slice(0, 10),
          startTime: String(data.start_time).slice(0, 5),
          endTime: data.end_time ? String(data.end_time).slice(0, 5) : undefined,
          timezone: data.timezone ?? undefined,
          format: (data.format ?? undefined) as MatchCreationPrefill['format'],
          playerExpectation: (data.player_expectation ??
            undefined) as MatchCreationPrefill['playerExpectation'],
          duration: data.duration ?? undefined,
          customDurationMinutes: data.custom_duration_minutes ?? undefined,
        };
      }
    } catch (error) {
      Logger.error(
        'MatchFeedbackWizard: play-again prefill fetch failed',
        error instanceof Error ? error : undefined
      );
    }
    closeCompleted();
    // Let the feedback sheet finish dismissing before presenting the actions sheet.
    setTimeout(() => openSheetForMatchCreation('post_feedback', prefill), 400);
  }, [feedbackData, closeCompleted, openSheetForMatchCreation]);

  const handleJoinAnother = useCallback(() => {
    lightHaptic();
    Analytics.postFeedbackPromptAction({
      action: 'join',
      match_id: feedbackData.matchId,
      sport_id: feedbackData.sportId ?? 'unknown',
    });
    closeCompleted();
    setTimeout(() => navigateFromOutside('PublicMatches'), 400);
  }, [feedbackData, closeCompleted]);

  const handleCoPlayerGameSelect = useCallback(
    (game: CoPlayerUpcomingGame) => {
      lightHaptic();
      Analytics.postFeedbackPromptAction({
        action: 'co_player_game',
        match_id: feedbackData.matchId,
        sport_id: feedbackData.sportId ?? 'unknown',
        target_match_id: game.matchId,
        target_is_recurring: game.isRecurring,
      });
      closeCompleted();
      // Let the feedback sheet finish dismissing before presenting the next one.
      setTimeout(() => {
        void getMatchWithDetails(game.matchId)
          .then(match => {
            if (match) {
              openMatchDetailSheet(match as MatchDetailData, { source: 'post_feedback' });
            }
          })
          .catch(error => {
            Logger.error(
              'MatchFeedbackWizard: co-player game open failed',
              error instanceof Error ? error : undefined
            );
          });
      }, 400);
    },
    [feedbackData, closeCompleted, openMatchDetailSheet]
  );

  const handleNextPromptDismiss = useCallback(() => {
    Analytics.postFeedbackPromptAction({
      action: 'dismiss',
      match_id: feedbackData.matchId,
      sport_id: feedbackData.sportId ?? 'unknown',
    });
    closeCompleted();
  }, [feedbackData, closeCompleted]);

  // Determine if current step can proceed
  const canProceed = useMemo(() => {
    if (isOnOutcomeStep) {
      // Outcome step
      if (outcome === 'played') return true;
      if (outcome === 'mutual_cancel') return cancellationReason !== null;
      if (outcome === 'opponent_no_show') return noShowPlayerIds.length > 0;
      return false;
    } else {
      // Opponent step - the level assessment is required when the opponent showed up
      const feedback = opponentFeedback[getOpponentIndex(currentStep)];
      const showedUp = feedback?.showedUp ?? true;
      if (!showedUp) return true;
      return !!feedback?.levelAssessment;
    }
  }, [
    isOnOutcomeStep,
    outcome,
    cancellationReason,
    noShowPlayerIds,
    opponentFeedback,
    currentStep,
    getOpponentIndex,
  ]);

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

  // Post-completion "what's next" prompt — replaces the wizard content entirely.
  if (showNextPrompt) {
    return (
      <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.nextPromptContainer}>
          <Ionicons name="checkmark-circle" size={56} color={colors.buttonActive} />
          <Text size="xl" weight="bold" color={colors.text} style={styles.nextPromptTitle}>
            {t('matchFeedback.nextPrompt.title')}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.nextPromptSubtitle}>
            {t('matchFeedback.nextPrompt.subtitle')}
          </Text>

          <CoPlayerGamesSection
            games={coPlayerGames}
            colors={colors}
            locale={locale}
            t={t}
            onSelect={handleCoPlayerGameSelect}
          />

          <TouchableOpacity
            style={[styles.nextPromptButton, { backgroundColor: colors.buttonActive }]}
            onPress={handlePlayAgain}
            activeOpacity={0.8}
          >
            <Ionicons name="repeat-outline" size={20} color={colors.buttonTextActive} />
            <Text size="base" weight="semibold" color={colors.buttonTextActive}>
              {t('matchFeedback.nextPrompt.playAgain')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.nextPromptButton,
              styles.nextPromptButtonSecondary,
              { borderColor: colors.buttonActive },
            ]}
            onPress={handleJoinAnother}
            activeOpacity={0.8}
          >
            <Ionicons name="search-outline" size={20} color={colors.buttonActive} />
            <Text size="base" weight="semibold" color={colors.buttonActive}>
              {t('matchFeedback.nextPrompt.joinAnother')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleNextPromptDismiss} style={styles.nextPromptDismiss}>
            <Text size="base" color={colors.textMuted}>
              {t('matchFeedback.nextPrompt.done')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
              levelAssessment: undefined,
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
                onReportSubmit={
                  opponent.hasExistingReport || reportedPlayerIds.has(opponent.playerId)
                    ? undefined
                    : handleReportSubmit
                }
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
      <View
        style={[styles.footer, { borderTopColor: colors.border, paddingBottom: spacingPixels[4] }]}
      >
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
  nextPromptContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
    gap: spacingPixels[3],
  },
  nextPromptTitle: {
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
  nextPromptSubtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  nextPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[4],
    alignSelf: 'stretch',
  },
  nextPromptButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  nextPromptDismiss: {
    paddingVertical: spacingPixels[3],
  },
  loadingText: {
    textAlign: 'center',
    marginTop: spacingPixels[4],
  },
});

export default MatchFeedbackWizard;

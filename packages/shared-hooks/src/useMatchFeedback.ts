/**
 * useMatchFeedback Hook
 * Custom hook for post-match feedback mutations with TanStack Query.
 * Provides outcome submission and opponent feedback operations.
 */

import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  submitMatchOutcome,
  submitOpponentFeedback,
  submitMatchReport,
  getOpponentsForFeedback,
  getReviewerParticipant,
  getMatchContextForFeedback,
} from '@rallia/shared-services';
import type {
  MatchOutcomeInput,
  MatchOutcomeResult,
  MatchFeedbackInput,
  MatchFeedbackResult,
  MatchReportInput,
  MatchReportResult,
  UseMatchFeedbackOptions,
} from '@rallia/shared-types';
import { matchKeys } from './useCreateMatch';

/**
 * Query keys for feedback-related cache management
 */
export const feedbackKeys = {
  all: ['feedback'] as const,
  opponents: (matchId: string, reviewerId: string) =>
    [...feedbackKeys.all, 'opponents', matchId, reviewerId] as const,
  participant: (matchId: string, reviewerId: string) =>
    [...feedbackKeys.all, 'participant', matchId, reviewerId] as const,
  matchContext: (matchId: string, reviewerId: string) =>
    [...feedbackKeys.all, 'matchContext', matchId, reviewerId] as const,
};

/**
 * Hook for post-match feedback operations (outcome + opponent feedback)
 *
 * @example
 * ```tsx
 * const {
 *   submitOutcome,
 *   submitFeedback,
 *   isSubmittingOutcome,
 *   isSubmittingFeedback,
 *   opponents,
 *   isLoadingOpponents,
 * } = useMatchFeedback(matchId, reviewerId, {
 *   onOutcomeSuccess: (result) => {
 *     if (result.feedbackCompleted) {
 *       closeSheet();
 *     } else {
 *       goToOpponentSteps();
 *     }
 *   },
 *   onFeedbackSuccess: (result) => {
 *     if (result.allOpponentsRated) {
 *       showSuccess();
 *     } else {
 *       goToNextOpponent();
 *     }
 *   },
 * });
 * ```
 */
export function useMatchFeedback(
  matchId: string | undefined,
  reviewerId: string | undefined,
  options: UseMatchFeedbackOptions = {}
) {
  const {
    onOutcomeSuccess,
    onOutcomeError,
    onFeedbackSuccess,
    onFeedbackError,
    onReportSuccess,
    onReportError,
  } = options;

  const queryClient = useQueryClient();

  /**
   * Invalidate relevant queries after feedback operations
   */
  const invalidateFeedbackQueries = async () => {
    if (!matchId || !reviewerId) return;

    // Invalidate opponents list (in case feedback state changed)
    await queryClient.invalidateQueries({
      queryKey: feedbackKeys.opponents(matchId, reviewerId),
    });

    // Invalidate participant record
    await queryClient.invalidateQueries({
      queryKey: feedbackKeys.participant(matchId, reviewerId),
    });

    // Invalidate match detail (feedback_completed may have changed)
    await queryClient.invalidateQueries({
      queryKey: matchKeys.detail(matchId),
    });

    // Invalidate match lists
    await queryClient.invalidateQueries({
      queryKey: matchKeys.lists(),
    });
  };

  // ============================================
  // QUERIES
  // ============================================

  /**
   * Query for opponents to provide feedback for
   * Filters out already-rated opponents for partial feedback resumption
   */
  const opponentsQuery = useQuery({
    queryKey: feedbackKeys.opponents(matchId!, reviewerId!),
    queryFn: () => getOpponentsForFeedback(matchId!, reviewerId!),
    enabled: !!matchId && !!reviewerId,
    staleTime: 30000, // 30 seconds
  });

  /**
   * Query for the reviewer's participant record
   * Used to check match_outcome and feedback_completed status
   */
  const participantQuery = useQuery({
    queryKey: feedbackKeys.participant(matchId!, reviewerId!),
    queryFn: () => getReviewerParticipant(matchId!, reviewerId!),
    enabled: !!matchId && !!reviewerId,
    staleTime: 30000,
  });

  /**
   * Query for match context (date, time, sport, location, opponents)
   * Used to display which match the user is giving feedback for
   */
  const matchContextQuery = useQuery({
    queryKey: feedbackKeys.matchContext(matchId!, reviewerId!),
    queryFn: () => getMatchContextForFeedback(matchId!, reviewerId!),
    enabled: !!matchId && !!reviewerId,
    staleTime: 60000, // 1 minute - match context doesn't change
  });

  // ============================================
  // MUTATIONS
  // ============================================

  /**
   * Submit match outcome (played/cancelled)
   */
  const outcomeMutation = useMutation<
    MatchOutcomeResult,
    Error,
    Omit<MatchOutcomeInput, 'matchId'>
  >({
    mutationFn: async input => {
      if (!matchId) throw new Error('Match ID is required');
      return submitMatchOutcome({ ...input, matchId });
    },
    onSuccess: async result => {
      await invalidateFeedbackQueries();
      onOutcomeSuccess?.(result);
    },
    onError: error => {
      onOutcomeError?.(error);
    },
  });

  /**
   * Submit feedback for a single opponent
   */
  const feedbackMutation = useMutation<
    MatchFeedbackResult,
    Error,
    Omit<MatchFeedbackInput, 'matchId' | 'reviewerId'>
  >({
    mutationFn: async input => {
      if (!matchId) throw new Error('Match ID is required');
      if (!reviewerId) throw new Error('Reviewer ID is required');
      return submitOpponentFeedback({ ...input, matchId, reviewerId });
    },
    onSuccess: async result => {
      await invalidateFeedbackQueries();
      onFeedbackSuccess?.(result);
    },
    onError: error => {
      onFeedbackError?.(error);
    },
  });

  /**
   * Submit a report for a player
   */
  const reportMutation = useMutation<
    MatchReportResult,
    Error,
    Omit<MatchReportInput, 'matchId' | 'reporterId'>
  >({
    mutationFn: async input => {
      if (!matchId) throw new Error('Match ID is required');
      if (!reviewerId) throw new Error('Reporter ID is required');
      return submitMatchReport({ ...input, matchId, reporterId: reviewerId });
    },
    onSuccess: async result => {
      await invalidateFeedbackQueries();
      onReportSuccess?.(result);
    },
    onError: error => {
      onReportError?.(error);
    },
  });

  // ============================================
  // RETURN VALUE
  // ============================================

  return {
    // Queries
    /** List of opponents to provide feedback for (excludes already-rated) */
    opponents: opponentsQuery.data ?? [],
    /** All opponents including already rated ones */
    allOpponents: opponentsQuery.data ?? [],
    /** Whether opponents are loading */
    isLoadingOpponents: opponentsQuery.isLoading,
    /** Error loading opponents */
    opponentsError: opponentsQuery.error,
    /** Refetch opponents */
    refetchOpponents: opponentsQuery.refetch,

    /** Reviewer's participant record */
    participant: participantQuery.data,
    /** Whether participant is loading */
    isLoadingParticipant: participantQuery.isLoading,

    /** Match context for display in feedback wizard */
    matchContext: matchContextQuery.data,
    /** Whether match context is loading */
    isLoadingMatchContext: matchContextQuery.isLoading,

    /** Opponents who haven't been rated yet */
    unratedOpponents: (opponentsQuery.data ?? []).filter(o => !o.hasExistingFeedback),

    // Outcome mutation
    /** Submit match outcome (played/cancelled) */
    submitOutcome: outcomeMutation.mutate,
    submitOutcomeAsync: outcomeMutation.mutateAsync,
    isSubmittingOutcome: outcomeMutation.isPending,
    outcomeError: outcomeMutation.error,
    outcomeResult: outcomeMutation.data,

    // Feedback mutation
    /** Submit feedback for a single opponent */
    submitFeedback: feedbackMutation.mutate,
    submitFeedbackAsync: feedbackMutation.mutateAsync,
    isSubmittingFeedback: feedbackMutation.isPending,
    feedbackError: feedbackMutation.error,
    feedbackResult: feedbackMutation.data,

    // Report mutation
    /** Submit a report for a player */
    submitReport: reportMutation.mutate,
    submitReportAsync: reportMutation.mutateAsync,
    isSubmittingReport: reportMutation.isPending,
    reportError: reportMutation.error,
    reportResult: reportMutation.data,

    // Combined state
    /** Whether any operation is in progress */
    isLoading:
      opponentsQuery.isLoading ||
      participantQuery.isLoading ||
      matchContextQuery.isLoading ||
      outcomeMutation.isPending ||
      feedbackMutation.isPending ||
      reportMutation.isPending,

    /** Whether any mutation is in progress */
    isSubmitting:
      outcomeMutation.isPending || feedbackMutation.isPending || reportMutation.isPending,

    /** Reset all mutation states */
    reset: () => {
      outcomeMutation.reset();
      feedbackMutation.reset();
      reportMutation.reset();
    },
  };
}

export default useMatchFeedback;

/**
 * useReviewPrompt
 *
 * Server-side half of the store review prompt. Platform-agnostic on purpose:
 * the native StoreReview call lives in the mobile app so this package stays
 * importable from web. See specs/14-growth/app-store-ratings.md.
 */

import { useMutation } from '@tanstack/react-query';
import {
  getReviewPromptEligibility,
  recordReviewPromptShown,
  type ReviewPromptEligibility,
  type ReviewPromptTrigger,
} from '@rallia/shared-services';

export interface UseReviewPromptResult {
  /** Point-in-time eligibility check. Never throws, never cached. */
  checkEligibility: () => Promise<ReviewPromptEligibility>;
  /** Marks a prompt as spent. Call only after the native prompt was requested. */
  recordShown: (trigger: ReviewPromptTrigger) => Promise<boolean>;
  isChecking: boolean;
}

export function useReviewPrompt(): UseReviewPromptResult {
  // Mutations rather than queries: eligibility is an imperative check at a
  // moment in time, and caching it would be wrong the instant a prompt is spent.
  const eligibility = useMutation({ mutationFn: getReviewPromptEligibility });
  const record = useMutation({ mutationFn: recordReviewPromptShown });

  return {
    checkEligibility: eligibility.mutateAsync,
    recordShown: record.mutateAsync,
    isChecking: eligibility.isPending,
  };
}

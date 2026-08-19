/**
 * Review Prompt Service
 * Store review prompt eligibility and throttle bookkeeping.
 *
 * All decision rules live in SQL (review_prompt_eligibility). This layer only
 * shapes the payload. See specs/14-growth/app-store-ratings.md.
 */

import { Logger } from '../logger';
import { supabase } from '../supabase';

// ============================================================================
// TYPES
// ============================================================================

export type ReviewPromptTrigger =
  | 'match_feedback_completed'
  | 'streak_milestone'
  | 'event_result_shared'
  | 'auto_match_filled';

export type ReviewPromptReason =
  | 'ok'
  | 'not_authenticated'
  | 'throttled_year'
  | 'throttled_recent'
  | 'not_enough_feedback'
  | 'open_feedback'
  | 'recent_bad_experience'
  | 'lookup_failed';

export interface ReviewPromptEligibility {
  eligible: boolean;
  reason: ReviewPromptReason;
  /** Completed match feedback sessions, counted by distinct match. */
  feedbacksSubmitted: number | null;
  promptsInWindow: number | null;
}

const INELIGIBLE = (reason: ReviewPromptReason): ReviewPromptEligibility => ({
  eligible: false,
  reason,
  feedbacksSubmitted: null,
  promptsInWindow: null,
});

// ============================================================================
// READS
// ============================================================================

/**
 * Whether the current player may be shown a store review prompt right now.
 * Never throws: a rating request must not be able to break the flow it rides on.
 */
export async function getReviewPromptEligibility(): Promise<ReviewPromptEligibility> {
  try {
    const response: { data: unknown; error: Error | null } = await supabase.rpc(
      'review_prompt_eligibility'
    );

    if (response.error) {
      Logger.error('Failed to check review prompt eligibility', response.error);
      return INELIGIBLE('lookup_failed');
    }

    const payload = (response.data ?? {}) as Record<string, unknown>;

    return {
      eligible: payload.eligible === true,
      reason: (payload.reason as ReviewPromptReason) ?? 'lookup_failed',
      feedbacksSubmitted:
        typeof payload.feedbacks_submitted === 'number' ? payload.feedbacks_submitted : null,
      promptsInWindow:
        typeof payload.prompts_in_window === 'number' ? payload.prompts_in_window : null,
    };
  } catch (error) {
    Logger.error('Failed to check review prompt eligibility', error as Error);
    return INELIGIBLE('lookup_failed');
  }
}

// ============================================================================
// WRITES
// ============================================================================

/**
 * Records that a prompt was requested. Means "we asked", not "they saw": neither
 * store reports whether the system dialog was actually displayed.
 *
 * Returns false when the write failed. Callers should treat that as spent
 * anyway, since the prompt has already been shown by that point.
 */
export async function recordReviewPromptShown(trigger: ReviewPromptTrigger): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('record_review_prompt_shown', { p_trigger: trigger });

    if (error) {
      Logger.error('Failed to record review prompt', error);
      return false;
    }

    return true;
  } catch (error) {
    Logger.error('Failed to record review prompt', error as Error);
    return false;
  }
}

/**
 * useStoreReviewPrompt
 *
 * Mobile half of the store review prompt: native call plus the client-side
 * guards the server cannot see. All decision rules that CAN live server-side do
 * (review_prompt_eligibility). See specs/14-growth/app-store-ratings.md.
 *
 * The system dialog is the entire UI. There is deliberately no custom sheet and
 * no "Enjoying Rallia?" pre-prompt: filtering by sentiment before asking is what
 * Apple 5.6.1 and the Google Play In-App Review policy prohibit.
 */

import { useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { useReviewPrompt } from '@rallia/shared-hooks';
import type { ReviewPromptTrigger } from '@rallia/shared-services';

import { reviewPromptRequested, reviewPromptSuppressed } from '#/services/analytics';

/** Lets the celebration UI finish and unmount before the OS dialog appears. */
const SETTLE_DELAY_MS = 900;

type StoreReviewModule = typeof import('expo-store-review');
let cachedModule: StoreReviewModule | null | undefined;

/**
 * Resolved lazily rather than imported statically. A top-level import throws at
 * require time on any binary that predates the native module, which would take
 * the whole app down: an OTA JS update landing on an older build is exactly that
 * situation. Missing module degrades to `unsupported` instead.
 */
function getStoreReview(): StoreReviewModule | null {
  if (cachedModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy; see above
      cachedModule = require('expo-store-review') as StoreReviewModule;
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}

export interface MaybePromptOptions {
  /** Override the delay before the native dialog is requested. */
  delayMs?: number;
  /**
   * Star rating just given to an opponent, for analytics only. Never affects
   * whether the prompt fires: gating on it would mean choosing who to ask by
   * expected positivity.
   */
  opponentStarRating?: number | null;
}

export function useStoreReviewPrompt() {
  const { checkEligibility, recordShown } = useReviewPrompt();

  const maybePromptForReview = useCallback(
    async (trigger: ReviewPromptTrigger, options?: MaybePromptOptions): Promise<boolean> => {
      const suppress = (reason: string) => {
        reviewPromptSuppressed({ trigger, reason });
        return false;
      };

      const storeReview = getStoreReview();
      if (Platform.OS === 'web' || !storeReview) {
        return suppress('unsupported');
      }

      const [available, hasAction] = await Promise.all([
        storeReview.isAvailableAsync(),
        storeReview.hasAction(),
      ]);
      if (!available || !hasAction) {
        return suppress('unsupported');
      }

      const eligibility = await checkEligibility();
      if (!eligibility.eligible) {
        return suppress(eligibility.reason);
      }

      await new Promise(resolve => setTimeout(resolve, options?.delayMs ?? SETTLE_DELAY_MS));

      // Re-checked after the delay: requesting a review while backgrounded burns
      // one of the three yearly slots on a dialog nobody can see.
      if (AppState.currentState !== 'active') {
        return suppress('backgrounded');
      }

      try {
        await storeReview.requestReview();
      } catch {
        return suppress('request_failed');
      }

      // Recorded after the fact, and intentionally not awaited into the return
      // value: the prompt is already spent whether or not bookkeeping lands.
      await recordShown(trigger);
      reviewPromptRequested({
        trigger,
        feedbacks_submitted: eligibility.feedbacksSubmitted,
        prompts_in_window: eligibility.promptsInWindow,
        opponent_star_rating: options?.opponentStarRating ?? null,
      });

      return true;
    },
    [checkEligibility, recordShown]
  );

  return { maybePromptForReview };
}

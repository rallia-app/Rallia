/**
 * LaunchPromptCoordinator — presents at most one deferrable prompt per
 * launch, chosen by registry order (see registry.ts).
 *
 * Replaces the per-feature auto-opener components and the referral-invite
 * effect that lived in Home. Each of those re-implemented the same gates and
 * yield-checks and had to know every other prompt's route; the registry makes
 * priority explicit and the wiring O(1) per prompt.
 *
 * Gates before arbitration: splash done, sport selection done, authed,
 * onboarding complete AND its sheet fully dismissed (the onboarding wizard's
 * success/suggestions steps outlive the onboarding_completed flag;
 * contentMode is the source of truth for what the main-actions sheet shows).
 *
 * The chain is deliberately not cancellable: ranRef makes re-runs no-ops, so
 * dep churn mid-chain can't drop the one evaluation this session gets (same
 * reasoning as the old Série 2 opener).
 */
import React, { useEffect, useRef } from 'react';
import { getSheetStack } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';
import { useAuth, useProfile } from '@rallia/shared-hooks';

import { useActionsSheet, useOverlay } from '#/context';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';
import { navigationRef } from '#/navigation/navigationRef';
import { IS_E2E } from '#/utils/e2e';

import { LAUNCH_PROMPTS } from './registry';
import type { LaunchPrompt, LaunchPromptContext } from './types';

// Let the home screen settle before presenting.
const OPEN_DELAY_MS = 700;

interface LaunchPromptCoordinatorProps {
  isSplashComplete: boolean;
}

export const LaunchPromptCoordinator: React.FC<LaunchPromptCoordinatorProps> = ({
  isSplashComplete,
}) => {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { profile } = useProfile();
  const isOnboardingComplete = !!profile?.onboarding_completed;
  const { contentMode } = useActionsSheet();
  const isOnboardingSheetOpen = contentMode === 'onboarding';
  const { isSportSelectionComplete } = useOverlay();

  // Arbitrate at most once per app session.
  const ranRef = useRef(false);

  useEffect(() => {
    if (IS_E2E) return;
    if (ranRef.current) return;
    if (!isSplashComplete || !isSportSelectionComplete) return;
    if (!userId || !isOnboardingComplete || isOnboardingSheetOpen) return;

    ranRef.current = true;
    const ctx: LaunchPromptContext = { userId };

    void (async () => {
      for (const prompt of LAUNCH_PROMPTS) {
        if (!prompt.onLaunch) continue;
        try {
          await prompt.onLaunch(ctx);
        } catch (err) {
          Logger.error(`Launch prompt ${prompt.id} onLaunch failed`, err as Error);
        }
      }

      let winner: LaunchPrompt | null = null;
      for (const prompt of LAUNCH_PROMPTS) {
        try {
          if (await prompt.isEligible(ctx)) {
            winner = prompt;
            break;
          }
        } catch (err) {
          Logger.error(`Launch prompt ${prompt.id} eligibility failed`, err as Error);
        }
      }
      if (!winner) return;
      const chosen = winner;

      setTimeout(() => {
        // Never stack on another pop-up: the check-in wizard owns the screen
        // when it's presenting, and any open sheet was either user intent or
        // an opener that got there first. Once-flags stay unset, so the
        // prompt retries on a later launch.
        if (isWeeklyCheckInActive() || getSheetStack().length > 0) {
          Logger.logUserAction('launch_prompt_deferred', {
            promptId: chosen.id,
            openSheets: getSheetStack().length,
          });
          return;
        }
        if (!navigationRef.isReady()) return;
        chosen.present(ctx);
      }, OPEN_DELAY_MS);
    })();
  }, [
    isSplashComplete,
    isSportSelectionComplete,
    userId,
    isOnboardingComplete,
    isOnboardingSheetOpen,
  ]);

  return null;
};

export default LaunchPromptCoordinator;

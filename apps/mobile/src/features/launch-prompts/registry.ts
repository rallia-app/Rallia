/**
 * Launch-prompt registry — the single authority on which prompt may open
 * automatically on a given launch.
 *
 * The rule:
 *   1. The weekly check-in wizard sits ABOVE this registry. It is
 *      mandatory-ish, re-fires on mid-session sport switches (not a
 *      launch-scoped concern) and clears sheets rather than yielding to
 *      them, so it keeps its own opener. It yields to an active registry
 *      modal via isLaunchPromptActive(), and the coordinator yields to it.
 *   2. Below it, at most ONE registry prompt presents per launch: the first
 *      eligible entry in LAUNCH_PROMPTS order. Order IS priority.
 *
 * Adding a prompt = one definition file in its feature + one entry here.
 * No prompt needs to know any other prompt exists.
 */
import { milestoneLaunchPrompt } from '#/features/milestone/milestoneLaunchPrompt';
import { referralInviteLaunchPrompt } from '#/features/referral/referralInviteLaunchPrompt';
import { navigationRef } from '#/navigation/navigationRef';

import type { LaunchPrompt } from './types';

export const LAUNCH_PROMPTS: LaunchPrompt[] = [milestoneLaunchPrompt, referralInviteLaunchPrompt];

/**
 * True while a registry prompt's navigator modal is the focused route.
 * getSheetStack() cannot see navigator modals, so launch-time navigation
 * (the check-in opener) consults this before pushing its own route.
 */
export function isLaunchPromptActive(): boolean {
  if (!navigationRef.isReady()) return false;
  const name = navigationRef.getCurrentRoute()?.name;
  return name != null && LAUNCH_PROMPTS.some(p => p.modalRoute === name);
}

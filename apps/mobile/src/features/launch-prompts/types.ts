/**
 * The launch-prompt contract. See registry.ts for the arbitration rules.
 */
export interface LaunchPromptContext {
  /** The signed-in player (auth uid = profile id). */
  userId: string;
}

export interface LaunchPrompt {
  id: string;
  /**
   * Route name when the prompt presents as a navigator modal. Lets
   * isLaunchPromptActive() see it — navigator modals never appear in
   * getSheetStack(), which is exactly how the pre-registry openers ended up
   * stacking on each other.
   */
  modalRoute?: string;
  /**
   * Runs every launch for every prompt, before arbitration — bookkeeping
   * that must tick regardless of what gets presented (e.g. launch counters).
   */
  onLaunch?: (ctx: LaunchPromptContext) => Promise<void>;
  /**
   * Evaluated in registry order; the first prompt to return true wins the
   * launch. May persist "campaign over" flags as a side effect. Must not
   * present anything.
   */
  isEligible: (ctx: LaunchPromptContext) => Promise<boolean>;
  /** Present the prompt. Runs after the settle delay and safety guard. */
  present: (ctx: LaunchPromptContext) => void;
}

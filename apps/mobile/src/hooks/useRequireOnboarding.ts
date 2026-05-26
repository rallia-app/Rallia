/**
 * useRequireOnboarding - Guard actions that require completed onboarding
 *
 * This hook provides a centralized way to check if a user is both authenticated
 * AND has completed onboarding before allowing them to perform protected actions.
 *
 * If the user is not ready (not signed in or not onboarded), the hook will
 * automatically open the Actions sheet which shows either:
 * - Auth flow (if not signed in)
 * - Onboarding wizard at the step where they left off (if signed in but not onboarded)
 *
 * @example
 * // Pattern A - Inline check (simple handlers)
 * const { guardAction } = useRequireOnboarding();
 *
 * const handleJoinMatch = () => {
 *   if (!guardAction()) return;
 *   // Proceed with action - user is authenticated and onboarded
 * };
 *
 * @example
 * // Pattern B - Wrapped callback (for useCallback or complex handlers)
 * const { withGuard } = useRequireOnboarding();
 *
 * const handleJoinMatch = withGuard((matchId: string) => {
 *   // This only executes if user is authenticated and onboarded
 * });
 */

import { useCallback, useMemo } from 'react';
import { useProfile } from '@rallia/shared-hooks';

import { useAuth } from '#/context/AuthContext';
import { useActionsSheet } from '#/context/ActionsSheetContext';

export interface UseRequireOnboardingReturn {
  /**
   * True only if user is authenticated AND onboarding is complete.
   * Use this for conditional rendering or disabling UI elements.
   */
  isReady: boolean;

  /**
   * Opens auth/onboarding sheet if needed, returns true if user is ready.
   * Use this at the start of action handlers for inline checking.
   *
   * @returns true if user can proceed, false if auth/onboarding sheet was opened
   */
  guardAction: () => boolean;

  /**
   * Wraps a callback to guard it - the callback only executes if user is ready.
   * If user is not ready, opens the auth/onboarding sheet and returns early.
   *
   * @param fn - The function to wrap
   * @returns A wrapped function that guards the action
   */
  withGuard: <TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn
  ) => (...args: TArgs) => TReturn | undefined;
}

export function useRequireOnboarding(): UseRequireOnboardingReturn {
  const { session } = useAuth();
  const { profile } = useProfile();
  const { openSheet } = useActionsSheet();

  // Compute if user is ready (authenticated AND onboarded)
  const isReady = useMemo(() => {
    const isSignedIn = Boolean(session?.user);
    const hasCompletedOnboarding = Boolean(profile?.onboarding_completed);
    return isSignedIn && hasCompletedOnboarding;
  }, [session?.user, profile?.onboarding_completed]);

  // Guard function - returns true if ready, opens sheet and returns false if not
  const guardAction = useCallback((): boolean => {
    if (isReady) {
      return true;
    }
    // Open the actions sheet - it will show auth or onboarding as appropriate
    openSheet();
    return false;
  }, [isReady, openSheet]);

  // Higher-order function to wrap callbacks with the guard
  const withGuard = useCallback(
    <TArgs extends unknown[], TReturn>(
      fn: (...args: TArgs) => TReturn
    ): ((...args: TArgs) => TReturn | undefined) => {
      return (...args: TArgs): TReturn | undefined => {
        if (!isReady) {
          openSheet();
          return undefined;
        }
        return fn(...args);
      };
    },
    [isReady, openSheet]
  );

  return {
    isReady,
    guardAction,
    withGuard,
  };
}

export default useRequireOnboarding;

/**
 * Shared Authentication Utilities
 *
 * Centralized utilities for auth-related operations to ensure
 * consistent behavior across different auth flows.
 */

import { ProfileService, Logger } from '@rallia/shared-services';

/**
 * Check if a user needs to complete onboarding
 *
 * This is used after successful authentication to determine
 * whether to navigate to onboarding or the main app.
 *
 * Failure semantics matter here: only a definitive "no profile row"
 * (PGRST116) may answer true. Transient errors (network, DB latency) get one
 * retry and then default to FALSE: sending an already-onboarded player back
 * through the signup wizard is far worse than letting a brand-new user reach
 * the app, where the onboarding gate re-checks with fresh data on the next
 * guarded action anyway.
 *
 * @param userId - The authenticated user's ID
 * @returns true if onboarding is needed, false if already completed
 */
export async function checkOnboardingStatus(userId: string): Promise<boolean> {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data: profile, error } = await ProfileService.getProfile(userId);

      if (!error) {
        const needsOnboarding = !profile?.onboarding_completed;
        Logger.debug('Onboarding status checked', {
          userId,
          needsOnboarding,
          onboardingCompleted: profile?.onboarding_completed ?? false,
        });
        return needsOnboarding;
      }

      const errorCode = (error as { code?: string })?.code;
      // PGRST116 = no rows found, meaning new user without profile
      if (errorCode === 'PGRST116') {
        Logger.debug('No profile found - new user needs onboarding', { userId });
        return true;
      }

      Logger.warn('Failed to fetch profile for onboarding check', {
        userId,
        attempt,
        error: (error as { message?: string })?.message,
      });
    } catch (error) {
      Logger.warn('Error checking onboarding status', {
        userId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Could not determine status: assume onboarded so we never re-onboard a veteran.
  Logger.warn('Onboarding check inconclusive, defaulting to no onboarding', { userId });
  return false;
}

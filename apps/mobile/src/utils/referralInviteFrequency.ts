import AsyncStorage from '@react-native-async-storage/async-storage';

const LAUNCH_COUNT_KEY = '@rallia/referral_launch_count';
const LAST_SHOWN_LAUNCH_KEY = '@rallia/referral_last_shown_launch';

const THRESHOLD_NO_REFERRALS = 3;
const THRESHOLD_HAS_REFERRALS = 7;

// Module-level flag: survives component unmount/remount within the same JS process
// (i.e. the same app session), and only resets on a true app restart.
let sessionLaunchCounted = false;

export async function incrementOnboardedLaunchCount(): Promise<void> {
  if (sessionLaunchCounted) return;
  sessionLaunchCounted = true;

  try {
    const raw = await AsyncStorage.getItem(LAUNCH_COUNT_KEY);
    if (raw === null) {
      // First call ever = the post-onboarding session itself. Seed at 0 without
      // incrementing so the count only rises on the next real app open.
      await AsyncStorage.setItem(LAUNCH_COUNT_KEY, '0');
      return;
    }
    await AsyncStorage.setItem(LAUNCH_COUNT_KEY, String(parseInt(raw, 10) + 1));
  } catch {
    // silently fail
  }
}

export async function shouldShowReferralInvite(hasReferredUser: boolean): Promise<boolean> {
  try {
    const rawCount = await AsyncStorage.getItem(LAUNCH_COUNT_KEY);
    const rawLastShown = await AsyncStorage.getItem(LAST_SHOWN_LAUNCH_KEY);

    const count = rawCount ? parseInt(rawCount, 10) : 0;

    if (!rawLastShown) {
      // Seed last_shown to 0 so the threshold counts from the first post-onboarding launch.
      await AsyncStorage.setItem(LAST_SHOWN_LAUNCH_KEY, '0');
      return false;
    }

    const lastShown = parseInt(rawLastShown, 10);
    const threshold = hasReferredUser ? THRESHOLD_HAS_REFERRALS : THRESHOLD_NO_REFERRALS;
    return count - lastShown >= threshold;
  } catch {
    return false;
  }
}

export async function markSheetShown(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LAUNCH_COUNT_KEY);
    const count = raw ? parseInt(raw, 10) : 0;
    await AsyncStorage.setItem(LAST_SHOWN_LAUNCH_KEY, String(count));
  } catch {
    // silently fail
  }
}

export async function resetReferralPromptState(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([LAUNCH_COUNT_KEY, LAST_SHOWN_LAUNCH_KEY]);
  } catch {
    // silently fail
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@rallia/referral_last_prompt';
const PROMPT_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export async function shouldShowReferralInvite(): Promise<boolean> {
  try {
    const lastPrompt = await AsyncStorage.getItem(STORAGE_KEY);
    if (!lastPrompt) {
      // First time ever — seed the timestamp so the 3-day countdown starts now
      await AsyncStorage.setItem(STORAGE_KEY, new Date().toISOString());
      return false;
    }
    const elapsed = Date.now() - new Date(lastPrompt).getTime();
    return elapsed >= PROMPT_INTERVAL_MS;
  } catch {
    return false;
  }
}

export async function updateLastPromptTimestamp(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
    // silently fail
  }
}

export async function resetLastPromptTimestamp(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently fail
  }
}

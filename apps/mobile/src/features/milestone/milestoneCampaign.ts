/**
 * Campaign constants and the "still owed" check for the 1000-player takeover.
 *
 * Split out of MilestoneAutoOpener so other launch-time prompts can consult
 * the campaign without importing the opener component.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const MILESTONE_SHOWN_KEY = '@rallia/milestone-1000-shown';

// The campaign window. Before the start the takeover is a no-op that retries
// on the next launch; past the end the flag is persisted and it stops checking
// for good. Both are local Montréal time.
export const MILESTONE_START_ISO = '2026-09-01T12:00:00-04:00';
export const MILESTONE_END_ISO = '2026-09-30T00:00:00-04:00';

export function isWithinMilestoneWindow(now: number = Date.now()): boolean {
  return (
    now >= new Date(MILESTONE_START_ISO).getTime() && now <= new Date(MILESTONE_END_ISO).getTime()
  );
}

/**
 * True while the takeover is inside its window and the player has not seen it
 * yet, i.e. the campaign still owes them the moment. Competing launch-time
 * prompts use this to stand down. Storage failures resolve false so a broken
 * read can never silence another prompt indefinitely.
 */
export async function isMilestonePending(): Promise<boolean> {
  if (!isWithinMilestoneWindow()) return false;
  try {
    return (await AsyncStorage.getItem(MILESTONE_SHOWN_KEY)) !== 'true';
  } catch {
    return false;
  }
}

/**
 * The 1000-player milestone takeover as a launch prompt.
 *
 * Once per install, inside a date window. The trigger is a DATE, not a live
 * user count: runtimeVersion follows appVersion, so the campaign ships dark
 * and starts firing when the window opens instead of waiting on a store
 * release. Before the window it's a no-op that retries next launch; past the
 * end the flag is persisted and it stops checking for good.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '@rallia/shared-services';

import type { LaunchPrompt } from '#/features/launch-prompts/types';
import { navigationRef } from '#/navigation/navigationRef';
import { markSheetShown as markReferralPromptShown } from '#/utils/referralInviteFrequency';

const MILESTONE_SHOWN_KEY = '@rallia/milestone-1000-shown';

// The campaign window, local Montréal time. MILESTONE_START_ISO is a
// placeholder pending the real crossing projection.
const MILESTONE_START_ISO = '2026-09-01T12:00:00-04:00';
const MILESTONE_END_ISO = '2026-09-30T00:00:00-04:00';

// ⚠️ TEMPORARY (dev only): set to true to reopen the takeover on every
// launch, bypassing the once-flag and the date window, while iterating on
// the UI. Guarded by __DEV__ so it can never affect production builds.
const FORCE_SHOW = false;

const isForced = () => __DEV__ && FORCE_SHOW;

export const milestoneLaunchPrompt: LaunchPrompt = {
  id: 'milestone-1000',
  modalRoute: 'Milestone1000',

  isEligible: async () => {
    if (isForced()) return true;

    let alreadyShown = false;
    try {
      alreadyShown = (await AsyncStorage.getItem(MILESTONE_SHOWN_KEY)) === 'true';
    } catch (err) {
      Logger.error('Failed to read milestone announcement flag', err as Error);
      return false;
    }
    if (alreadyShown) return false;

    const now = Date.now();
    // Campaign over → persist and never check again.
    if (now > new Date(MILESTONE_END_ISO).getTime()) {
      AsyncStorage.setItem(MILESTONE_SHOWN_KEY, 'true').catch(err =>
        Logger.error('Failed to persist milestone announcement flag', err as Error)
      );
      return false;
    }
    return now >= new Date(MILESTONE_START_ISO).getTime();
  },

  present: () => {
    navigationRef.navigate('Milestone1000');
    if (isForced()) return;
    AsyncStorage.setItem(MILESTONE_SHOWN_KEY, 'true').catch(err =>
      Logger.error('Failed to persist milestone announcement flag', err as Error)
    );
    // The takeover IS this cycle's referral ask. Stamp the invite prompt's
    // counter so it takes its usual breather instead of asking for the same
    // thing again on the very next launch.
    void markReferralPromptShown();
  },
};

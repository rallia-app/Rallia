/**
 * The 1000-player milestone takeover as a launch prompt.
 *
 * Once per install, live immediately: the milestone_1000_reached RPC gate
 * was dropped 2026-08-29 (ship-now call) — the coordinator's authed +
 * onboarded gates and the end-date window are the only conditions left.
 * Past the end date the flag is persisted and it stops checking for good.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '@rallia/shared-services';

import type { LaunchPrompt } from '#/features/launch-prompts/types';
import { navigationRef } from '#/navigation/navigationRef';
import { markSheetShown as markReferralPromptShown } from '#/utils/referralInviteFrequency';

const MILESTONE_SHOWN_KEY = '@rallia/milestone-1000-shown';

// Hard campaign end, local Montréal time: past this the takeover never
// fires and the once-flag is persisted so launches stop checking.
const MILESTONE_END_ISO = '2026-10-31T00:00:00-04:00';

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

    // Campaign over → persist and never check again.
    if (Date.now() > new Date(MILESTONE_END_ISO).getTime()) {
      AsyncStorage.setItem(MILESTONE_SHOWN_KEY, 'true').catch(err =>
        Logger.error('Failed to persist milestone announcement flag', err as Error)
      );
      return false;
    }

    return true;
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

/**
 * The periodic "invite a friend" sheet as a launch prompt — lowest priority:
 * it makes the ask every prompt above it makes better, so anything else
 * eligible wins the launch.
 *
 * Cadence lives in utils/referralInviteFrequency: every 3 launches for a
 * player with no converted referrals, every 7 once they have one. The stats
 * RPC is only paid when the cheap counter already clears the lower bar.
 */
import { SheetManager } from 'react-native-actions-sheet';
import { getReferralStats, Logger } from '@rallia/shared-services';

import type { LaunchPrompt } from '#/features/launch-prompts/types';
import {
  incrementOnboardedLaunchCount,
  markSheetShown,
  shouldShowReferralInvite,
} from '#/utils/referralInviteFrequency';

export const referralInviteLaunchPrompt: LaunchPrompt = {
  id: 'referral-invite',

  // The launch counter ticks whether or not anything gets presented.
  onLaunch: async () => {
    await incrementOnboardedLaunchCount();
  },

  isEligible: async ({ userId }) => {
    // Counter first with the lower threshold; only when that clears do we
    // fetch stats to learn whether the higher threshold applies instead.
    if (!(await shouldShowReferralInvite(false))) return false;
    let hasReferredUser = false;
    try {
      const stats = await getReferralStats(userId);
      hasReferredUser = (stats?.total_converted ?? 0) >= 1;
    } catch (err) {
      Logger.error('Referral stats read failed for invite prompt', err as Error);
    }
    return shouldShowReferralInvite(hasReferredUser);
  },

  present: () => {
    void (async () => {
      await markSheetShown();
      SheetManager.show('referral-invite');
    })();
  },
};

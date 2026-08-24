/**
 * MilestoneAutoOpener — presents the 1000-player takeover once per install,
 * after launch, when it's safe to do so.
 *
 * Same recipe as the Série 2 opener (splash + sport-selection + auth +
 * onboarding gates, settle delay, never on top of the check-in wizard or an
 * open sheet, AsyncStorage once-flag) minus the data fetch: this campaign has
 * nothing to personalise, so the screen renders from translations alone.
 *
 * The trigger is a DATE WINDOW, not a live user count. The takeover ships dark
 * and starts firing when the window opens, so crossing the threshold does not
 * have to wait on a store release. Set MILESTONE_START_ISO once the counter is
 * close; everything before it is a no-op that retries on the next launch.
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSheetStack } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';
import { useAuth, useProfile } from '@rallia/shared-hooks';

import { useOverlay } from '#/context';
import { navigationRef } from '#/navigation/navigationRef';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';
import { IS_E2E } from '#/utils/e2e';

const MILESTONE_SHOWN_KEY = '@rallia/milestone-1000-shown';

// The campaign window. Before the start this is a no-op that retries on the
// next launch; past the end the flag is persisted and we stop checking for
// good. Both are local Montréal time.
const MILESTONE_START_ISO = '2026-09-01T12:00:00-04:00';
const MILESTONE_END_ISO = '2026-09-30T00:00:00-04:00';

// Let the home screen settle before presenting.
const OPEN_DELAY_MS = 700;

// ⚠️ TEMPORARY (dev only): set to true to reopen the takeover on every launch,
// bypassing both the once-per-install flag and the date window, while
// iterating on the UI. Guarded by __DEV__ below so it can never affect
// production builds.
const FORCE_SHOW = false;

interface MilestoneAutoOpenerProps {
  isSplashComplete: boolean;
}

export const MilestoneAutoOpener: React.FC<MilestoneAutoOpenerProps> = ({ isSplashComplete }) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const { profile } = useProfile();
  const isOnboardingComplete = !!profile?.onboarding_completed;
  const { isSportSelectionComplete } = useOverlay();

  // Evaluate at most once per app session.
  const openedRef = useRef(false);

  useEffect(() => {
    if (IS_E2E) return;
    if (openedRef.current) return;
    if (!isSplashComplete || !isSportSelectionComplete) return;
    if (!isAuthed || !isOnboardingComplete) return;

    openedRef.current = true;

    // Deliberately not cancellable: openedRef already makes re-runs no-ops, so
    // the chain just runs to completion rather than being dropped by a cleanup
    // during the storage read + settle delay.
    void (async () => {
      const forceShow = __DEV__ && FORCE_SHOW;

      let alreadyShown = false;
      try {
        alreadyShown = (await AsyncStorage.getItem(MILESTONE_SHOWN_KEY)) === 'true';
      } catch (err) {
        Logger.error('Failed to read milestone announcement flag', err as Error);
        return;
      }
      if (alreadyShown && !forceShow) return;

      const now = Date.now();

      // Campaign over → persist and never check again.
      if (now > new Date(MILESTONE_END_ISO).getTime() && !forceShow) {
        AsyncStorage.setItem(MILESTONE_SHOWN_KEY, 'true').catch(err =>
          Logger.error('Failed to persist milestone announcement flag', err as Error)
        );
        return;
      }

      // Not open yet → leave the flag unset so a later launch retries.
      if (now < new Date(MILESTONE_START_ISO).getTime() && !forceShow) return;

      setTimeout(() => {
        // Never stack on top of another pop-up: skip if the weekly check-in
        // wizard is up or any action sheet is already open. The flag is left
        // unset so the takeover is retried on a later launch.
        if (isWeeklyCheckInActive() || getSheetStack().length > 0) return;
        if (!navigationRef.isReady()) return;

        navigationRef.navigate('Milestone1000');
        // In force-show mode, don't persist the flag so it keeps reopening.
        if (!forceShow) {
          AsyncStorage.setItem(MILESTONE_SHOWN_KEY, 'true').catch(err =>
            Logger.error('Failed to persist milestone announcement flag', err as Error)
          );
        }
      }, OPEN_DELAY_MS);
    })();
  }, [isSplashComplete, isSportSelectionComplete, isAuthed, isOnboardingComplete]);

  return null;
};

export default MilestoneAutoOpener;

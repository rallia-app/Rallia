/**
 * SummerLeagueAnnouncementAutoOpener — opens the Summer League announcement
 * sheet once per player, after launch, when it's safe to do so.
 *
 * Renders nothing (`return null`). Mirrors PendingFeedbackHandler: gate on
 * splash + sport-selection + auth + onboarding, wait a beat for the UI to
 * settle, and never open on top of the weekly check-in wizard (it'll be picked
 * up on a later launch instead).
 *
 * Persistence: once the sheet is actually shown we write an AsyncStorage flag
 * so it never reappears. If we suppress it (wizard active / not yet eligible)
 * the flag is left unset so a later launch can try again.
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SheetManager, getSheetStack } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';
import { useAuth, useProfile } from '@rallia/shared-hooks';

import { useOverlay } from '#/context';
import { summerLeagueAnnouncementViewed } from '#/services/analytics';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';

const SUMMER_LEAGUE_SHOWN_KEY = '@rallia/summer-league-announcement-shown';
// Let the home screen settle before presenting (matches PendingFeedbackHandler).
const OPEN_DELAY_MS = 600;

// ⚠️ TEMPORARY (dev only): set to true to reopen the announcement on every
// launch, bypassing the once-per-install "already shown" flag, while iterating
// on the UI. Guarded by __DEV__ below so it can never affect production builds.
// Flip back to false when done.
const FORCE_SHOW = false;

interface SummerLeagueAnnouncementAutoOpenerProps {
  isSplashComplete: boolean;
}

export const SummerLeagueAnnouncementAutoOpener: React.FC<
  SummerLeagueAnnouncementAutoOpenerProps
> = ({ isSplashComplete }) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const { profile } = useProfile();
  const isOnboardingComplete = !!profile?.onboarding_completed;
  const { isSportSelectionComplete } = useOverlay();

  // Evaluate at most once per app session.
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    if (!isSplashComplete || !isSportSelectionComplete) return;
    if (!isAuthed || !isOnboardingComplete) return;

    openedRef.current = true;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const forceShow = __DEV__ && FORCE_SHOW;

      let alreadyShown = false;
      try {
        alreadyShown = (await AsyncStorage.getItem(SUMMER_LEAGUE_SHOWN_KEY)) === 'true';
      } catch (err) {
        Logger.error('Failed to read summer league announcement flag', err as Error);
        return;
      }
      if (cancelled || (alreadyShown && !forceShow)) return;

      timer = setTimeout(() => {
        // Never stack on top of another pop-up: skip if the weekly check-in
        // wizard is up or any other action sheet is already open. The flag is
        // left unset so the announcement is retried on a later launch.
        if (cancelled || isWeeklyCheckInActive() || getSheetStack().length > 0) return;

        void SheetManager.show('summer-league-announcement');
        summerLeagueAnnouncementViewed();
        // In force-show mode, don't persist the flag so it keeps reopening.
        if (!forceShow) {
          AsyncStorage.setItem(SUMMER_LEAGUE_SHOWN_KEY, 'true').catch(err =>
            Logger.error('Failed to persist summer league announcement flag', err as Error)
          );
        }
      }, OPEN_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isSplashComplete, isSportSelectionComplete, isAuthed, isOnboardingComplete]);

  return null;
};

export default SummerLeagueAnnouncementAutoOpener;

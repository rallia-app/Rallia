/**
 * Serie1AnnouncementAutoOpener — opens the Série 1 tournaments announcement
 * once per player, after launch, when it's safe and RELEVANT to do so.
 *
 * Renders nothing (`return null`). Gates on splash + sport-selection + auth +
 * onboarding, waits a beat for the UI to settle, and never opens on top of the
 * weekly check-in wizard or another sheet (it'll be picked up on a later
 * launch instead).
 *
 * On top of the house gates, this one is data-driven:
 *   - only for players who play tennis (Série 1 is tennis-only);
 *   - only while a Série 1 tournament is actually open for registration — so
 *     it activates by itself the day registrations open in an environment and
 *     stops pitching once they close, no flag flip or deploy needed;
 *   - after the campaign window it marks itself shown, so launches stop
 *     paying for the tournaments query forever.
 *
 * Persistence: once the sheet is actually shown we write an AsyncStorage flag
 * so it never reappears. If we suppress it (wizard active / nothing open yet)
 * the flag is left unset so a later launch can try again.
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SheetManager, getSheetStack } from 'react-native-actions-sheet';
import { Logger, listPublicTournaments } from '@rallia/shared-services';
import { useAuth, useProfile } from '@rallia/shared-hooks';

import { useOverlay, useSport } from '#/context';
import { serie1AnnouncementViewed } from '#/services/analytics';
import { isWeeklyCheckInActive } from '#/features/weekly-checkin/isWizardActive';
import { IS_E2E } from '#/utils/e2e';

const SERIE1_SHOWN_KEY = '@rallia/serie1-announcement-shown';
// Matches the seeded tournament names (data, not copy).
const SERIE1_NAME_PREFIX = 'Tournois Rallia — Série 1';
// Past this date the campaign is over for good: persist the flag and stop
// querying on every launch. Kept a day past the July 25 close as a buffer.
const CAMPAIGN_END_ISO = '2026-07-27T00:00:00-04:00';
// Let the home screen settle before presenting.
const OPEN_DELAY_MS = 700;

// ⚠️ TEMPORARY (dev only): set to true to reopen the announcement on every
// launch, bypassing the once-per-install "already shown" flag, while iterating
// on the UI. Guarded by __DEV__ below so it can never affect production builds.
const FORCE_SHOW = false;

interface Serie1AnnouncementAutoOpenerProps {
  isSplashComplete: boolean;
}

export const Serie1AnnouncementAutoOpener: React.FC<Serie1AnnouncementAutoOpenerProps> = ({
  isSplashComplete,
}) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const { profile } = useProfile();
  const isOnboardingComplete = !!profile?.onboarding_completed;
  const { isSportSelectionComplete } = useOverlay();
  const { userSports, isLoading: sportsLoading } = useSport();

  // Evaluate at most once per app session.
  const openedRef = useRef(false);

  useEffect(() => {
    if (IS_E2E) return;
    if (openedRef.current) return;
    if (!isSplashComplete || !isSportSelectionComplete) return;
    if (!isAuthed || !isOnboardingComplete) return;
    if (sportsLoading) return;

    openedRef.current = true;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const forceShow = __DEV__ && FORCE_SHOW;

      let alreadyShown = false;
      try {
        alreadyShown = (await AsyncStorage.getItem(SERIE1_SHOWN_KEY)) === 'true';
      } catch (err) {
        Logger.error('Failed to read Série 1 announcement flag', err as Error);
        return;
      }
      if (cancelled || (alreadyShown && !forceShow)) return;

      // Campaign over → persist and never query again.
      if (Date.now() > new Date(CAMPAIGN_END_ISO).getTime() && !forceShow) {
        AsyncStorage.setItem(SERIE1_SHOWN_KEY, 'true').catch(err =>
          Logger.error('Failed to persist Série 1 announcement flag', err as Error)
        );
        return;
      }

      // Série 1 is tennis: skip quietly (and retry later — a player can add
      // tennis to their sports at any time during the window).
      if (!userSports.some(s => s.name === 'tennis')) return;

      // Data-driven trigger: only pitch while registration is actually open.
      let hasOpenSerie1 = false;
      try {
        const tournaments = await listPublicTournaments();
        hasOpenSerie1 = tournaments.some(
          tn => tn.status === 'registration_open' && tn.name.startsWith(SERIE1_NAME_PREFIX)
        );
      } catch (err) {
        Logger.error('Failed to check Série 1 tournaments for announcement', err as Error);
        return;
      }
      if (cancelled || (!hasOpenSerie1 && !forceShow)) return;

      timer = setTimeout(() => {
        // Never stack on top of another pop-up: skip if the weekly check-in
        // wizard is up or any other action sheet is already open. The flag is
        // left unset so the announcement is retried on a later launch.
        if (cancelled || isWeeklyCheckInActive() || getSheetStack().length > 0) return;

        void SheetManager.show('serie1-announcement');
        serie1AnnouncementViewed();
        // In force-show mode, don't persist the flag so it keeps reopening.
        if (!forceShow) {
          AsyncStorage.setItem(SERIE1_SHOWN_KEY, 'true').catch(err =>
            Logger.error('Failed to persist Série 1 announcement flag', err as Error)
          );
        }
      }, OPEN_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    isSplashComplete,
    isSportSelectionComplete,
    isAuthed,
    isOnboardingComplete,
    sportsLoading,
    userSports,
  ]);

  return null;
};

export default Serie1AnnouncementAutoOpener;

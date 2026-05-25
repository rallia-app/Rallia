/**
 * WeeklyCheckInAutoOpener — auto-opens the wizard after splash, if needed.
 *
 * Renders nothing visually — it's a non-render component (`return null`)
 * whose only job is to call `navigation.navigate('WeeklyCheckIn')` once
 * per app launch when all gate conditions are met.
 *
 * Gate conditions (all must be true to fire):
 *   1. `isSplashComplete` (passed in by AppContent, same as WelcomeTourModal)
 *   2. `isSportSelectionComplete` (read from OverlayContext)
 *   3. WelcomeTourModal is not pending — welcome tour wins on a fresh install
 *   4. `get_check_in_context().is_pending_check_in === true`
 *   5. `@rallia/availability-refresh-banner-cooldown` is absent or > 24h old
 *      (shared key with the home banner — wizard × dismissal also writes it)
 *   6. Per-session ref `autoOpenedThisSession` is false (fire at most once)
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '@rallia/shared-services';
import { useAuth } from '@rallia/shared-hooks';
import { useOverlay } from '../../context';
import { useTour } from '../../context/TourContext';
import { useCheckInContext } from './api';
import { WEEKLY_CHECKIN_COOLDOWN_KEY } from './useWeeklyCheckInWizard';
// This component is rendered OUTSIDE the NavigationContainer (next to
// WelcomeTourModal in AppContent), so we use the container-ref-based API
// instead of the useNavigation() hook.
import { navigationRef } from '../../navigation';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface WeeklyCheckInAutoOpenerProps {
  isSplashComplete: boolean;
}

export const WeeklyCheckInAutoOpener: React.FC<WeeklyCheckInAutoOpenerProps> = ({
  isSplashComplete,
}) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const { isSportSelectionComplete } = useOverlay();
  const { isTourCompleted } = useTour();

  // Don't fetch the context until splash is done AND the user is authenticated
  // (the RPC throws auth.uid()-null otherwise, which retries 3× and spams logs).
  const { data: context } = useCheckInContext({ enabled: isSplashComplete && isAuthed });

  const autoOpenedRef = useRef(false);

  // ----------------------------------------------------------------------
  // ⚠️ TEMPORARY: force-show mode for local testing.
  // Set FORCE_SHOW = false (or delete this block) to restore the real gates.
  // ----------------------------------------------------------------------
  const FORCE_SHOW = false;
  // ⚠️ TEMPORARY: bypass the AsyncStorage cooldown check for local testing.
  // The cooldown is set whenever the user dismisses via "Exit for now", which
  // blocks the auto-opener for 24h. Flip this back to false (or delete) when
  // done iterating.
  const BYPASS_COOLDOWN = false;

  useEffect(() => {
    console.log('[weekly-checkin-auto-opener] gate check:', {
      autoOpened: autoOpenedRef.current,
      isSplashComplete,
      isAuthed,
      isSportSelectionComplete,
      contextLoaded: !!context,
      currentStreak: context?.currentStreak,
      isPendingCheckIn: context?.isPendingCheckIn,
      welcomeTourDone: isTourCompleted('welcome'),
      FORCE_SHOW,
      BYPASS_COOLDOWN,
    });

    if (autoOpenedRef.current) return;
    if (!isSplashComplete) return;
    if (!isAuthed) return;

    if (!FORCE_SHOW) {
      if (!isSportSelectionComplete) return;
      if (!context) return;
      if (!context.isPendingCheckIn) return;
      const welcomeDone = isTourCompleted('welcome');
      if (!welcomeDone && context.currentStreak === 0) return;
    }

    let cancelled = false;
    (async () => {
      if (!FORCE_SHOW && !BYPASS_COOLDOWN) {
        try {
          const cooldownRaw = await AsyncStorage.getItem(WEEKLY_CHECKIN_COOLDOWN_KEY);
          if (cooldownRaw) {
            const dismissedAt = parseInt(cooldownRaw, 10);
            if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < COOLDOWN_MS) {
              return;
            }
          }
        } catch (err) {
          Logger.error('Weekly check-in auto-opener cooldown read failed', err as Error);
        }
      }

      if (cancelled) return;
      // Wait for the NavigationContainer to actually mount the navigator
      // before pushing a route into it.
      const tryNavigate = () => {
        if (!navigationRef.isReady()) {
          setTimeout(tryNavigate, 100);
          return;
        }
        if (cancelled) return;
        autoOpenedRef.current = true;
        navigationRef.navigate('WeeklyCheckIn');
      };
      tryNavigate();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isSplashComplete,
    isAuthed,
    isSportSelectionComplete,
    context,
    isTourCompleted,
    FORCE_SHOW,
    BYPASS_COOLDOWN,
  ]);

  return null;
};

/**
 * WeeklyCheckInAutoOpener — auto-opens the wizard after splash, if needed.
 *
 * Renders nothing visually — it's a non-render component (`return null`)
 * whose only job is to call `navigation.navigate('WeeklyCheckIn')` once
 * per app launch when all gate conditions are met.
 *
 * Gate conditions (all must be true to fire):
 *   1. `isSplashComplete` (passed in by AppContent)
 *   2. `profile.onboarding_completed === true` (never interrupt onboarding)
 *   3. Actions-sheet `contentMode !== 'onboarding'` — the wizard's post-
 *      completion steps (success + suggestions) still render after the
 *      `onboarding_completed` flag flips true, so we wait for the sheet to
 *      stop presenting onboarding before firing
 *   4. `isSportSelectionComplete` (read from OverlayContext)
 *   5. `get_check_in_context().is_pending_check_in === true`
 *   6. `@rallia/availability-refresh-banner-cooldown` is absent or > 24h old
 *      (shared key with the home banner — dismissing the banner writes it)
 *   7. `@rallia/weekly-checkin-auto-open-at` is absent or > 24h old — stamped
 *      every time we auto-open, so a pending check-in raises the wizard at most
 *      once a day instead of on every cold start. The home banner deliberately
 *      does NOT read this key: the player can still open the wizard themselves
 *      as often as they like.
 *   8. Per-session ref `autoOpenedThisSession` is false (fire at most once)
 */
import React, { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SheetManager } from 'react-native-actions-sheet';
import { Logger } from '@rallia/shared-services';
import { useAuth, useProfile } from '@rallia/shared-hooks';

import { useActionsSheet, useOverlay, useSport } from '#/context';
import { navigationRef } from '#/navigation';
import { isLaunchPromptActive } from '#/features/launch-prompts/registry';
import { IS_E2E } from '#/utils/e2e';

import { useCheckInContext } from './api';
import { isWeeklyCheckInActive } from './isWizardActive';
import {
  WEEKLY_CHECKIN_AUTO_OPEN_AT_KEY,
  WEEKLY_CHECKIN_COOLDOWN_KEY,
} from './useWeeklyCheckInWizard';
// This component is rendered OUTSIDE the NavigationContainer (next to
// WelcomeTourModal in AppContent), so we use the container-ref-based API
// instead of the useNavigation() hook.

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface WeeklyCheckInAutoOpenerProps {
  isSplashComplete: boolean;
}

export const WeeklyCheckInAutoOpener: React.FC<WeeklyCheckInAutoOpenerProps> = ({
  isSplashComplete,
}) => {
  const { session } = useAuth();
  const isAuthed = !!session?.user;
  const { profile } = useProfile();
  // Onboarding must be finished before the check-in wizard may auto-open —
  // otherwise it navigates on top of (and dismisses) the onboarding wizard.
  const isOnboardingComplete = !!profile?.onboarding_completed;
  // The onboarding wizard lives inside the `main-actions` sheet. It flips
  // `onboarding_completed` true while STILL showing its tail steps (success +
  // suggestions), so `isOnboardingComplete` alone isn't enough — we also wait
  // until the sheet is no longer presenting onboarding content before firing.
  // `contentMode` is the single source of truth for what that sheet shows.
  const { contentMode } = useActionsSheet();
  const isOnboardingSheetOpen = contentMode === 'onboarding';
  const { isSportSelectionComplete } = useOverlay();

  // Don't fetch the context until splash is done AND the user is authenticated
  // (the RPC throws auth.uid()-null otherwise, which retries 3× and spams logs).
  // Keyed to the sport mode (streak/goal are per sport) so it shares the cache
  // entry with the Home banner and the wizard; the pending flag it gates on is
  // player-wide either way.
  const { selectedSport } = useSport();
  const { data: context } = useCheckInContext({
    enabled: isSplashComplete && isAuthed,
    sportId: selectedSport?.id ?? null,
  });

  // Fire at most once PER SPORT per session: goal + streak are per sport, so
  // switching to a sport that still owes a check-in this week should present the
  // wizard for it, but only once (the cooldown key handles cross-session nagging).
  const autoOpenedSportsRef = useRef<Set<string>>(new Set());
  const sportKey = selectedSport?.id ?? 'default';

  useEffect(() => {
    if (IS_E2E) return;
    if (autoOpenedSportsRef.current.has(sportKey)) return;
    if (!isSplashComplete) return;
    if (!isAuthed) return;
    // Never auto-open the check-in wizard while the user is still onboarding —
    // it would navigate on top of (and dismiss) the onboarding wizard. We block
    // until BOTH:
    //   1. onboarding is marked complete, and
    //   2. the onboarding wizard sheet is no longer presenting — its post-
    //      completion steps (success + suggestions) still render after the
    //      `onboarding_completed` flag flips true.
    if (!isOnboardingComplete) return;
    if (isOnboardingSheetOpen) return;

    if (!isSportSelectionComplete) return;
    if (!context) return;
    if (!context.isPendingCheckIn) return;

    let cancelled = false;
    (async () => {
      try {
        const [cooldownRaw, lastAutoOpenRaw] = await Promise.all([
          AsyncStorage.getItem(WEEKLY_CHECKIN_COOLDOWN_KEY),
          AsyncStorage.getItem(WEEKLY_CHECKIN_AUTO_OPEN_AT_KEY),
        ]);
        if (cooldownRaw) {
          const dismissedAt = parseInt(cooldownRaw, 10);
          if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < COOLDOWN_MS) {
            return;
          }
        }
        // Already auto-opened within the last 24h — leave the player alone; the
        // home banner is still there if they want it.
        if (lastAutoOpenRaw) {
          const openedAt = parseInt(lastAutoOpenRaw, 10);
          if (Number.isFinite(openedAt) && Date.now() - openedAt < COOLDOWN_MS) {
            return;
          }
        }
      } catch (err) {
        Logger.error('Weekly check-in auto-opener cooldown read failed', err as Error);
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
        // The wizard is already up (or still animating out after a dismissal).
        // Navigating into a modal route mid-transition strands a touch-eating
        // layer on iOS and freezes the app — the same failure mode 1aa391a8
        // fixed for the exit alert. Every other auto-opener guards on this;
        // this one has to guard against re-entering its own route.
        if (isWeeklyCheckInActive()) return;
        // A registry launch prompt (e.g. the milestone takeover) is up. It's
        // a navigator modal, so the hideAll() below can't clear it, and
        // navigating would stack a modal mid-transition — the exact freeze
        // this guard chain exists to prevent. Yield; nothing is marked, so
        // the pending check-in re-fires on a later evaluation.
        if (isLaunchPromptActive()) return;
        autoOpenedSportsRef.current.add(sportKey);
        // Stamp before navigating so a crash mid-wizard still counts as shown.
        AsyncStorage.setItem(WEEKLY_CHECKIN_AUTO_OPEN_AT_KEY, Date.now().toString()).catch(err =>
          Logger.error('Weekly check-in auto-open stamp failed', err as Error)
        );
        // Dismiss any presenting bottom sheet BEFORE navigating, so the wizard
        // isn't presented behind a sheet (actions-sheets render in native
        // modals above the nav stack). The wizard also calls hideAll() on mount
        // as a backstop.
        void SheetManager.hideAll();
        navigationRef.navigate('WeeklyCheckIn', { source: 'auto_opener' });
      };
      tryNavigate();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isSplashComplete,
    isAuthed,
    isOnboardingComplete,
    isOnboardingSheetOpen,
    isSportSelectionComplete,
    context,
    sportKey,
  ]);

  return null;
};

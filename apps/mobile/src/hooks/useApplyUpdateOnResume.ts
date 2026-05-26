import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  checkForUpdateAsync,
  fetchUpdateAsync,
  isEnabled,
  reloadAsync,
  useUpdates,
} from 'expo-updates';
import { getSheetStack } from 'react-native-actions-sheet';

import { isWeeklyCheckInActive } from '../features/weekly-checkin/isWizardActive';
import { Logger } from '../services/logger';

// Conservative on purpose: a Rallia session carries a lot of in-flight UI
// state (action sheets, the weekly check-in wizard, deep-link match flows),
// so only reload after the user has clearly stepped away for a while.
const MIN_BACKGROUND_MS = 30 * 60e3; // 30 minutes

/**
 * Applies a pending OTA update when the app returns to the foreground after a
 * long background, so users who never cold-start still pick up updates.
 *
 * Complements the cold-start fetch in App.tsx's useOTAUpdate: that path stages
 * the bundle and lets it apply on the next launch; this one decides when it's
 * safe to swap it in for users who only background/foreground the app.
 *
 * Pass `enabled` = isSplashComplete so this never fires during launch — the
 * cold-start path owns that window.
 */
export function useApplyUpdateOnResume({ enabled }: { enabled: boolean }) {
  const { isUpdatePending } = useUpdates();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lastBackgrounded = useRef(0);

  useEffect(() => {
    if (!enabled || !isEnabled || __DEV__) return;

    const sub = AppState.addEventListener('change', async next => {
      const cameToForeground = !!appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;

      if (next.match(/inactive|background/)) {
        lastBackgrounded.current = Date.now();
        return;
      }
      if (!cameToForeground) return;

      // Only act after a genuinely long absence.
      if (lastBackgrounded.current > Date.now() - MIN_BACKGROUND_MS) return;

      // Never interrupt an active multi-step flow. The weekly check-in wizard
      // is its own route; everything else (match-detail, feedback, invites,
      // onboarding sheets, etc.) routes through react-native-actions-sheet, so
      // a non-empty sheet stack means a sheet is open on top of the app.
      if (isWeeklyCheckInActive() || getSheetStack().length > 0) {
        Logger.info('OTA resume-reload skipped: active overlay', {
          wizardActive: isWeeklyCheckInActive(),
          openSheets: getSheetStack().length,
        });
        return;
      }

      try {
        if (isUpdatePending) {
          Logger.info('OTA: applying pending update on resume');
          await reloadAsync();
        } else {
          // Nothing staged — opportunistically check + stage for next time.
          const res = await checkForUpdateAsync();
          if (res.isAvailable) await fetchUpdateAsync();
        }
      } catch (e) {
        Logger.warn('OTA resume check/reload failed', { error: e });
      }
    });

    return () => sub.remove();
  }, [enabled, isUpdatePending]);
}

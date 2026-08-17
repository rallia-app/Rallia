/**
 * OverlayContext - Splash and first-time flow management
 *
 * This context manages:
 * 1. Splash animation completion state
 * 2. First-time pre-onboarding state (determines navigation flow)
 *
 * Native permission requests (Location, Notifications) are now handled
 * inside the pre-onboarding wizard itself, not after the flow completes.
 *
 * Flow: Splash -> PreOnboarding Screen (first-time only) -> Main App
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '@rallia/shared-services';

import { supabase } from '#/lib/supabase';

// =============================================================================
// CONSTANTS
// =============================================================================

const SPORT_SELECTION_SHOWN_KEY = '@rallia/sport-selection-shown';

// Force-resolve budget for the status check below. Must stay under
// SplashGate's 5s safety timeout so the navigator is never revealed
// while the status is still 'unknown' (it renders null until resolved).
const SPORT_SELECTION_RESOLVE_TIMEOUT_MS = 4000;

/**
 * 'unknown' until the AsyncStorage flag AND the local Supabase session have
 * been read. The old boolean initialized to false, which encoded "not read
 * yet" and "new user" as the same value: every cold start mounted the
 * navigator on PreOnboarding and relied on the splash to hide the swap.
 */
type SportSelectionStatus = 'unknown' | 'needed' | 'done';

// =============================================================================
// TYPES
// =============================================================================

/** Sport type for the overlay (simplified from database type) */
export interface OverlaySport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

interface OverlayContextType {
  /** Notify that we're on home screen (safe to show permission overlays) */
  setOnHomeScreen: (isOnHome: boolean) => void;
  /** Notify that splash animation has completed */
  setSplashComplete: (complete: boolean) => void;
  /** Whether splash animation has completed (triggers screen entrance animation) */
  isSplashComplete: boolean;
  /** Whether sport selection has been completed (or was already done for returning users) */
  isSportSelectionComplete: boolean;
  /**
   * Whether the sport-selection check has resolved. AppNavigator waits on
   * this before mounting so initialRouteName is computed from a known value.
   */
  isSportSelectionResolved: boolean;
  /** Handle sport selection completion */
  onSportSelectionComplete: (orderedSports: OverlaySport[]) => void;
  /** Whether permissions have been handled (requested or skipped) */
  permissionsHandled: boolean;
}

// =============================================================================
// CONTEXT
// =============================================================================

const OverlayContext = createContext<OverlayContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface OverlayProviderProps {
  children: ReactNode;
}

export const OverlayProvider: React.FC<OverlayProviderProps> = ({ children }) => {
  // ==========================================================================
  // STATE
  // ==========================================================================
  const [, setIsOnHomeScreen] = useState(false);
  const [isSplashComplete, setIsSplashComplete] = useState(false);
  const [sportSelectionStatus, setSportSelectionStatus] = useState<SportSelectionStatus>('unknown');

  const isSportSelectionComplete = sportSelectionStatus === 'done';
  const isSportSelectionResolved = sportSelectionStatus !== 'unknown';

  // Permissions are now requested inside the pre-onboarding wizard, so
  // by the time sport selection is complete, permission dialogs are done.
  // Returning users (sport selection already complete on mount) also fall
  // into this branch, so the WelcomeTourModal can render right away.
  const permissionsHandled = isSportSelectionComplete;

  // ==========================================================================
  // CHECK IF SPORT SELECTION HAS BEEN COMPLETED
  // This determines whether to show SportSelectionScreen or Main in navigation
  //
  // An existing Supabase session overrides the flag: a signed-in player is
  // never a first-time user, no matter what happened to the device flag
  // (lost key, corrupt storage, stalled read). Only "no flag AND no session"
  // may resolve to 'needed'. On timeout, resolve 'done': a true first launch
  // has near-empty storage and resolves in milliseconds, while a stalled
  // launch is almost certainly a returning user with a heavy cache, and a
  // misrouted new user just browses Main as a guest until the next guarded
  // action (or launch) re-gates them.
  // ==========================================================================
  useEffect(() => {
    let resolved = false;
    const resolve = (status: 'needed' | 'done', source: string) => {
      if (resolved) return;
      resolved = true;
      if (status === 'needed') {
        Logger.logNavigation('sport_selection_required', { trigger: source });
      }
      setSportSelectionStatus(status);
    };

    const timeout = setTimeout(() => {
      Logger.warn('Sport selection status unresolved, failing toward the app', {
        timeoutMs: SPORT_SELECTION_RESOLVE_TIMEOUT_MS,
      });
      resolve('done', 'timeout');
    }, SPORT_SELECTION_RESOLVE_TIMEOUT_MS);

    const checkSportSelectionStatus = async () => {
      try {
        const [flag, sessionRes] = await Promise.all([
          AsyncStorage.getItem(SPORT_SELECTION_SHOWN_KEY).catch((error: unknown) => {
            Logger.error('Failed to read sport selection flag', error as Error);
            return null;
          }),
          // Local read (storage/memory), no network.
          supabase.auth.getSession().catch(() => null),
        ]);
        const hasSession = !!sessionRes?.data?.session;

        if (flag === 'true' || hasSession) {
          resolve('done', hasSession ? 'session' : 'flag');
          if (hasSession && flag !== 'true') {
            // Self-heal the flag so consumers that read it directly agree.
            AsyncStorage.setItem(SPORT_SELECTION_SHOWN_KEY, 'true').catch(() => {});
          }
        } else {
          resolve('needed', 'first_time_user');
        }
      } catch (error) {
        Logger.error('Failed to check sport selection status', error as Error);
        resolve('needed', 'error');
      } finally {
        clearTimeout(timeout);
      }
    };

    void checkSportSelectionStatus();

    return () => clearTimeout(timeout);
  }, []);

  // ==========================================================================
  // STATE HANDLERS
  // ==========================================================================

  const handleSetOnHomeScreen = useCallback((isOnHome: boolean) => {
    Logger.logNavigation('home_screen_state', { isOnHome });
    setIsOnHomeScreen(isOnHome);
  }, []);

  const handleSetSplashComplete = useCallback((complete: boolean) => {
    Logger.logNavigation('splash_complete', { complete });
    setIsSplashComplete(complete);
  }, []);

  const handleSportSelectionComplete = useCallback(async (orderedSports: OverlaySport[]) => {
    Logger.logUserAction('sport_selection_complete', {
      sportsCount: orderedSports.length,
      sports: orderedSports.map(s => s.name),
      primarySport: orderedSports[0]?.name,
    });

    // Mark as shown in AsyncStorage
    try {
      await AsyncStorage.setItem(SPORT_SELECTION_SHOWN_KEY, 'true');
    } catch (error) {
      Logger.error('Failed to save sport selection status', error as Error);
    }

    // Mark sport selection as complete (navigation will switch to Main).
    // Permissions are already handled inside the pre-onboarding wizard.
    setSportSelectionStatus('done');
  }, []);

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  const contextValue: OverlayContextType = {
    setOnHomeScreen: handleSetOnHomeScreen,
    setSplashComplete: handleSetSplashComplete,
    isSplashComplete,
    isSportSelectionComplete,
    isSportSelectionResolved,
    onSportSelectionComplete: handleSportSelectionComplete,
    permissionsHandled,
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return <OverlayContext.Provider value={contextValue}>{children}</OverlayContext.Provider>;
};

// =============================================================================
// HOOK
// =============================================================================

export const useOverlay = (): OverlayContextType => {
  const context = useContext(OverlayContext);
  if (context === undefined) {
    throw new Error('useOverlay must be used within an OverlayProvider');
  }
  return context;
};

export default OverlayContext;

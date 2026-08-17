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

// =============================================================================
// CONSTANTS
// =============================================================================

const SPORT_SELECTION_SHOWN_KEY = '@rallia/sport-selection-shown';

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
  const [isSportSelectionComplete, setIsSportSelectionComplete] = useState(false);

  // Permissions are now requested inside the pre-onboarding wizard, so
  // by the time sport selection is complete, permission dialogs are done.
  // Returning users (sport selection already complete on mount) also fall
  // into this branch, so the WelcomeTourModal can render right away.
  const permissionsHandled = isSportSelectionComplete;

  // ==========================================================================
  // CHECK IF SPORT SELECTION HAS BEEN COMPLETED
  // This determines whether to show SportSelectionScreen or Main in navigation
  // ==========================================================================
  useEffect(() => {
    const checkSportSelectionStatus = async () => {
      try {
        const hasSeenOverlay = await AsyncStorage.getItem(SPORT_SELECTION_SHOWN_KEY);
        if (hasSeenOverlay === 'true') {
          // User has already completed sport selection
          setIsSportSelectionComplete(true);
        } else {
          // First-time user: navigation will show SportSelectionScreen
          Logger.logNavigation('sport_selection_required', { trigger: 'first_time_user' });
        }
      } catch (error) {
        Logger.error('Failed to check sport selection status', error as Error);
        // On error, assume sport selection is needed (safer default)
      }
    };

    checkSportSelectionStatus();
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
    setIsSportSelectionComplete(true);
  }, []);

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  const contextValue: OverlayContextType = {
    setOnHomeScreen: handleSetOnHomeScreen,
    setSplashComplete: handleSetSplashComplete,
    isSplashComplete,
    isSportSelectionComplete,
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

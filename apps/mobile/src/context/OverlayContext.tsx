/**
 * OverlayContext - Splash and first-time flow management
 *
 * This context manages:
 * 1. Splash animation completion state
 * 2. First-time pre-onboarding state (determines navigation flow)
 * 3. Requesting native permissions (Notifications) after pre-onboarding
 *
 * Note: Location permission is now handled within the pre-onboarding wizard (step 3),
 * so it's NOT requested here after the flow completes.
 *
 * Flow: Splash -> PreOnboarding Screen (first-time only) -> Main App -> Permission requests
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '@rallia/shared-services';
import { ANIMATION_DELAYS } from '../constants';
import { usePermissions } from '../hooks';
import { setSportSelectionComplete as syncSportSelectionToStore } from '../navigation/deepLinkStore';

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
  // Permission handling
  // Note: Location permission is handled in the pre-onboarding wizard (step 3),
  // so we only request notifications here
  const {
    shouldShowNotificationOverlay,
    requestNotificationPermission,
    loading: permissionsLoading,
  } = usePermissions();

  // ==========================================================================
  // STATE
  // ==========================================================================
  const [, setIsOnHomeScreen] = useState(false);
  const [isSplashComplete, setIsSplashComplete] = useState(false);
  const [isSportSelectionComplete, setIsSportSelectionComplete] = useState(false);
  const [hasCheckedSportSelection, setHasCheckedSportSelection] = useState(false);
  const [permissionsHandled, setPermissionsHandled] = useState(false);

  // Track if we've already requested permissions this session
  const hasRequestedPermissions = useRef(false);

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
      setHasCheckedSportSelection(true);
    };

    checkSportSelectionStatus();
  }, []);

  // Keep the module-level deep link store in sync so getStateFromPath
  // can decide between Main and PreOnboarding synchronously.
  useEffect(() => {
    syncSportSelectionToStore(isSportSelectionComplete);
  }, [isSportSelectionComplete]);

  // ==========================================================================
  // REQUEST NATIVE PERMISSIONS AFTER SPORT SELECTION COMPLETES
  // ==========================================================================
  useEffect(() => {
    // Only request permissions when:
    // 1. Splash animation has completed
    // 2. Sport selection is complete (or was already done)
    // 3. Permissions are loaded
    // 4. We haven't already requested this session
    const shouldRequestPermissions =
      isSplashComplete &&
      hasCheckedSportSelection &&
      isSportSelectionComplete &&
      !permissionsLoading &&
      !hasRequestedPermissions.current;

    if (shouldRequestPermissions) {
      hasRequestedPermissions.current = true;

      const requestPermissions = async () => {
        // Small delay to let the UI settle
        await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.SHORT_DELAY));

        // Request notification permission FIRST (most important for engagement)
        if (shouldShowNotificationOverlay) {
          Logger.logNavigation('request_native_permission', {
            permission: 'notifications',
            trigger: 'post_preonboarding',
          });
          const notificationGranted = await requestNotificationPermission();
          Logger.logUserAction('permission_result', {
            permission: 'notifications',
            granted: notificationGranted,
          });

          // Small delay between permission dialogs
          await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAYS.OVERLAY_STAGGER));
        }

        // Mark permissions as handled
        setPermissionsHandled(true);
      };

      requestPermissions();
    }
  }, [
    isSplashComplete,
    hasCheckedSportSelection,
    isSportSelectionComplete,
    permissionsLoading,
    shouldShowNotificationOverlay,
    requestNotificationPermission,
  ]);

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

    // Mark sport selection as complete (navigation will switch to Main, and permission requests will trigger)
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

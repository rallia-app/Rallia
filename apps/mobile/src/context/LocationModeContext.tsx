/**
 * LocationModeContext
 *
 * Manages the user's selected location mode for nearby matches:
 * - 'current': Uses device GPS location
 * - 'home': Uses saved home/postal code location
 *
 * Persists selection to AsyncStorage for consistency across app restarts.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// =============================================================================
// CONSTANTS
// =============================================================================

const LOCATION_MODE_KEY = '@rallia/location-mode';

// =============================================================================
// TYPES
// =============================================================================

export type LocationMode = 'current' | 'home';

interface LocationModeContextValue {
  /** The currently selected location mode */
  locationMode: LocationMode;
  /** Whether the mode is being loaded from storage */
  isLoading: boolean;
  /** Set the location mode */
  setLocationMode: (mode: LocationMode) => Promise<void>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const LocationModeContext = createContext<LocationModeContextValue | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface LocationModeProviderProps {
  children: ReactNode;
}

export function LocationModeProvider({ children }: LocationModeProviderProps) {
  const [locationMode, setLocationModeState] = useState<LocationMode>('current');
  const [isLoading, setIsLoading] = useState(true);

  // Load saved mode on mount
  useEffect(() => {
    const loadMode = async () => {
      try {
        const storedMode = await AsyncStorage.getItem(LOCATION_MODE_KEY);
        if (storedMode === 'current' || storedMode === 'home') {
          setLocationModeState(storedMode);
        }
      } catch (error) {
        console.error('[LocationModeContext] Failed to load mode:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMode();
  }, []);

  /**
   * Save the selected location mode
   */
  const setLocationMode = useCallback(async (mode: LocationMode): Promise<void> => {
    try {
      await AsyncStorage.setItem(LOCATION_MODE_KEY, mode);
      setLocationModeState(mode);
    } catch (error) {
      console.error('[LocationModeContext] Failed to save mode:', error);
      // Still update state even if storage fails
      setLocationModeState(mode);
    }
  }, []);

  const value: LocationModeContextValue = {
    locationMode,
    isLoading,
    setLocationMode,
  };

  return <LocationModeContext.Provider value={value}>{children}</LocationModeContext.Provider>;
}

// =============================================================================
// HOOK
// =============================================================================

export function useLocationMode(): LocationModeContextValue {
  const context = useContext(LocationModeContext);

  if (context === undefined) {
    throw new Error('useLocationMode must be used within a LocationModeProvider');
  }

  return context;
}

export { LocationModeContext };
export default LocationModeProvider;

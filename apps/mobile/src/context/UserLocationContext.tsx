/**
 * UserLocationContext
 *
 * Manages the user's home/postal code location.
 * Stores in AsyncStorage for persistence before sign-up.
 * Provides sync to database after authentication.
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
import { syncHomeLocation as syncHomeLocationToDb } from '@rallia/shared-services';

// =============================================================================
// CONSTANTS
// =============================================================================

const USER_HOME_LOCATION_KEY = '@rallia/user-home-location';

// =============================================================================
// TYPES
// =============================================================================

export interface UserHomeLocation {
  /** Normalized postal code (uppercase, proper spacing) */
  postalCode: string;
  /** Country code */
  country: 'CA' | 'US';
  /** Human-readable formatted address from Google */
  formattedAddress: string;
  /** Latitude of postal code centroid */
  latitude: number;
  /** Longitude of postal code centroid */
  longitude: number;
}

interface UserLocationContextValue {
  /** The user's saved home location, or null if not set */
  homeLocation: UserHomeLocation | null;
  /** Whether the location is being loaded from storage */
  isLoading: boolean;
  /** Save a new home location */
  setHomeLocation: (location: UserHomeLocation) => Promise<void>;
  /** Clear the stored home location */
  clearHomeLocation: () => Promise<void>;
  /** Check if a home location has been set */
  hasHomeLocation: boolean;
  /** Sync home location to database after authentication */
  syncToDatabase: (playerId: string) => Promise<boolean>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const UserLocationContext = createContext<UserLocationContextValue | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface UserLocationProviderProps {
  children: ReactNode;
}

export function UserLocationProvider({ children }: UserLocationProviderProps) {
  const [homeLocation, setHomeLocationState] = useState<UserHomeLocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved location on mount
  useEffect(() => {
    const loadLocation = async () => {
      try {
        const storedLocation = await AsyncStorage.getItem(USER_HOME_LOCATION_KEY);
        if (storedLocation) {
          const parsed = JSON.parse(storedLocation) as UserHomeLocation;
          setHomeLocationState(parsed);
        }
      } catch (error) {
        console.error('[UserLocationContext] Failed to load location:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadLocation();
  }, []);

  /**
   * Save a new home location to AsyncStorage
   */
  const setHomeLocation = useCallback(async (location: UserHomeLocation): Promise<void> => {
    try {
      await AsyncStorage.setItem(USER_HOME_LOCATION_KEY, JSON.stringify(location));
      setHomeLocationState(location);
    } catch (error) {
      console.error('[UserLocationContext] Failed to save location:', error);
      throw error;
    }
  }, []);

  /**
   * Clear the stored home location
   */
  const clearHomeLocation = useCallback(async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(USER_HOME_LOCATION_KEY);
      setHomeLocationState(null);
    } catch (error) {
      console.error('[UserLocationContext] Failed to clear location:', error);
      throw error;
    }
  }, []);

  /**
   * Sync the current home location to the database.
   * Called after user authentication to persist postal code location.
   */
  const syncToDatabase = useCallback(
    async (playerId: string): Promise<boolean> => {
      if (!homeLocation) {
        return false;
      }

      const result = await syncHomeLocationToDb(playerId, {
        postalCode: homeLocation.postalCode,
        country: homeLocation.country,
        latitude: homeLocation.latitude,
        longitude: homeLocation.longitude,
      });

      if (!result.success) {
        console.error('[UserLocationContext] Failed to sync:', result.error);
      }

      return result.success;
    },
    [homeLocation]
  );

  const value: UserLocationContextValue = {
    homeLocation,
    isLoading,
    setHomeLocation,
    clearHomeLocation,
    hasHomeLocation: homeLocation !== null,
    syncToDatabase,
  };

  return <UserLocationContext.Provider value={value}>{children}</UserLocationContext.Provider>;
}

// =============================================================================
// HOOK
// =============================================================================

export function useUserHomeLocation(): UserLocationContextValue {
  const context = useContext(UserLocationContext);

  if (context === undefined) {
    throw new Error('useUserHomeLocation must be used within a UserLocationProvider');
  }

  return context;
}

export { UserLocationContext };
export default UserLocationProvider;

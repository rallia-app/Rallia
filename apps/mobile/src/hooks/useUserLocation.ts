/**
 * useUserLocation Hook
 * Gets the user's current device location using expo-location.
 *
 * Features:
 * - Fetches location on mount if permission is granted
 * - Re-checks permission when app returns to foreground (user may have changed settings)
 * - Clears location if permission is revoked
 * - Fetches location when permission is newly granted
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { Logger } from '@rallia/shared-services';

export interface UserLocation {
  latitude: number;
  longitude: number;
}

interface UseUserLocationReturn {
  location: UserLocation | null;
  loading: boolean;
  error: string | null;
  /** Whether location permission is currently granted */
  hasPermission: boolean;
  refetch: () => Promise<void>;
}

/**
 * Hook to get the user's current device location.
 * Automatically re-checks permission when app returns to foreground.
 */
export function useUserLocation(): UseUserLocationReturn {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);

  // Track previous permission state to detect changes
  const previousPermissionRef = useRef<boolean | null>(null);

  const fetchLocation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { status } = await Location.getForegroundPermissionsAsync();
      const isGranted = status === 'granted';

      // Update permission state
      setHasPermission(isGranted);

      // Detect permission changes
      const wasGranted = previousPermissionRef.current;
      previousPermissionRef.current = isGranted;

      if (!isGranted) {
        // Permission not granted - clear any existing location
        if (wasGranted === true) {
          Logger.debug('location_permission_revoked', {});
        }
        setLocation(null);
        setError('Location permission not granted');
        setLoading(false);
        return;
      }

      // Permission granted - fetch location
      if (wasGranted === false) {
        Logger.debug('location_permission_granted', {});
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      Logger.debug('user_location_fetched', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isUnavailable =
        message.includes('location is unavailable') || message.includes('location services');
      if (isUnavailable) {
        Logger.debug('user_location_unavailable', { message });
        setError('Location unavailable');
      } else {
        Logger.error('Failed to get user location', err as Error);
        setError('Failed to get location');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch location on mount
  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  // Re-check permission when app returns to foreground
  // User may have granted/revoked permission in device settings
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - re-check permission and location
        fetchLocation();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [fetchLocation]);

  return { location, loading, error, hasPermission, refetch: fetchLocation };
}

export default useUserLocation;

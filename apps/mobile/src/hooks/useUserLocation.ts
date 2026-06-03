/**
 * useUserLocation Hook
 * Gets the user's current device location using expo-location.
 *
 * Cold-start strategy:
 * - On mount, try `getLastKnownPositionAsync` first. It returns the OS's most
 *   recent cached fix instantly (no GPS radio activation), so downstream
 *   consumers (the Home "Just for you" carousel, nearby-match queries) can
 *   start fetching ~1–3s earlier than waiting for a fresh fix.
 * - Then call `getCurrentPositionAsync` in the background to refresh. When it
 *   returns we swap to the fresh coords; query consumers that round lat/lng
 *   (e.g. useJustForYou rounds to 3 decimals) usually won't refetch on this
 *   swap.
 *
 * Foreground refresh:
 * - Re-checks permission when the app returns to foreground (user may have
 *   changed settings) and refreshes the fix in the background — without
 *   blanking `location` or flipping `loading` back to true. Avoids the
 *   "blank UI after backgrounding" flicker.
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
 * Location failures that are environmental, not bugs: services off, permission
 * denied at the OS level (incl. kCLErrorDenied when foreground-only access is
 * requested in the background), or no fix obtainable. Logged at debug so they
 * don't create Sentry issues; genuine failures still go to Logger.error.
 */
function isExpectedLocationError(message: string): boolean {
  return (
    message.includes('location is unavailable') ||
    message.includes('location services') ||
    message.includes('getCurrentPositionAsync') ||
    message.includes('Cannot obtain current location') ||
    message.includes('kCLError') ||
    message.includes('denied')
  );
}

/** Last-known fix freshness threshold — accept fixes up to 5 minutes old. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;
/** Last-known fix accuracy threshold (meters). 1km is plenty for radius-based
 *  nearby-match queries and instant-paint UX; the fresh fix will replace it. */
const LAST_KNOWN_MAX_ACCURACY_M = 1000;

/**
 * Hook to get the user's current device location.
 * Seeds from the OS's last-known fix when available so the UI never sits in
 * a `null` + `loading` state on cold start. Automatically re-checks permission
 * when app returns to foreground.
 */
export function useUserLocation(): UseUserLocationReturn {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);

  // Track previous permission state to detect changes
  const previousPermissionRef = useRef<boolean | null>(null);
  // Stable read of current location for refresh() without re-creating the callback
  const locationRef = useRef<UserLocation | null>(null);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const refresh = useCallback(async () => {
    try {
      setError(null);

      const { status } = await Location.getForegroundPermissionsAsync();
      const isGranted = status === 'granted';
      setHasPermission(isGranted);

      const wasGranted = previousPermissionRef.current;
      previousPermissionRef.current = isGranted;

      if (!isGranted) {
        // Permission not granted — clear any existing location so callers can
        // fall back to home location / anon search radius.
        if (wasGranted === true) {
          Logger.debug('location_permission_revoked', {});
        }
        setLocation(null);
        setError('Location permission not granted');
        setLoading(false);
        return;
      }

      if (wasGranted === false) {
        Logger.debug('location_permission_granted', {});
      }

      // Fast path: seed from the OS's cached fix so dependent fetches can
      // start immediately. Only used on cold start (when we don't already
      // have a location); on foreground refresh we skip straight to the
      // fresh fix to avoid an unnecessary swap.
      if (!locationRef.current) {
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: LAST_KNOWN_MAX_AGE_MS,
            requiredAccuracy: LAST_KNOWN_MAX_ACCURACY_M,
          });
          if (lastKnown) {
            const coords = {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            };
            setLocation(coords);
            setLoading(false);
          }
        } catch {
          // Some platforms / configurations may throw; ignore and fall
          // through to the fresh fix below.
        }
      }

      // Fresh fix. If we already seeded from last-known above this runs in
      // the background and replaces the cached coords; otherwise it's the
      // first time we set `location`.
      // Skip when the app isn't in front: iOS rejects a foreground-only
      // location request with kCLErrorDenied while suspended (e.g. a background
      // launch from a push), which is expected, not a failure worth a fix.
      if (AppState.currentState !== 'active') {
        setLoading(false);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isExpectedLocationError(message)) {
        Logger.debug('user_location_unavailable', { message });
        setError('Location unavailable');
      } else {
        Logger.error('Failed to get user location', err as Error);
        setError('Failed to get location');
      }
      // Intentionally do NOT clear `location` here — a transient fresh-fix
      // failure shouldn't blank a previously good (or last-known-seeded)
      // value. Permission revoke handles its own clear above.
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-check permission when app returns to foreground.
  // User may have granted/revoked permission in device settings.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        refresh();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [refresh]);

  return { location, loading, error, hasPermission, refetch: refresh };
}

export default useUserLocation;

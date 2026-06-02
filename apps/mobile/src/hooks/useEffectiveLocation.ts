/**
 * useEffectiveLocation Hook
 *
 * Provides a unified location based on user preferences and availability.
 * Combines GPS location, home location, and user's selected mode with smart
 * fallbacks so that dependent fetches (nearby matches, "Just for you", map)
 * can start as early as possible on cold start.
 *
 * Resolution order (highest priority first):
 *   1. The user's selected mode — if that source has a value, use it.
 *   2. The other source, if it has a value. Avoids sitting in `null` while
 *      the preferred source is still loading: e.g. mode='current' but GPS
 *      hasn't fixed yet → use home immediately, swap to GPS when it arrives.
 *      `useUserLocation` seeds GPS from the OS's last-known fix on cold
 *      start (see `useUserLocation.ts`) so this swap is rarely visible.
 *   3. The last good location we ever returned, to ride out transient
 *      nulls (e.g. AppState transitions, brief permission re-checks).
 *      Prevents UI flicker where the carousel briefly empties before
 *      re-populating.
 */

import { useMemo, useRef } from 'react';

// Import directly from the defining context files (not the '#/context' barrel)
// to break a require cycle: the barrel re-exports SubscriptionContext, which
// pulls in the navigation barrel → AppNavigator → every screen → back to the
// '#/hooks' barrel that re-exports this hook. Direct imports sever that edge.
import { useLocationMode } from '#/context/LocationModeContext';
import { useUserHomeLocation } from '#/context/UserLocationContext';

import { useUserLocation } from './useUserLocation';

export interface EffectiveLocation {
  latitude: number;
  longitude: number;
}

type LocationSource = 'gps' | 'home' | null;

interface UseEffectiveLocationReturn {
  /** The effective location based on mode and availability */
  location: EffectiveLocation | null;
  /** Whether GPS location is available */
  hasGpsLocation: boolean;
  /** Whether GPS permission is granted */
  hasGpsPermission: boolean;
  /** Whether home location is available */
  hasHomeLocation: boolean;
  /** Whether both location options are available (for showing LocationSelector) */
  hasBothLocationOptions: boolean;
  /** The source of the current location: 'gps', 'home', or null */
  locationSource: LocationSource;
  /** The currently selected location mode */
  locationMode: 'current' | 'home';
  /** Function to change the location mode */
  setLocationMode: (mode: 'current' | 'home') => Promise<void>;
  /** Whether location data is still loading */
  isLoading: boolean;
  /** Manually refresh GPS location */
  refetchGpsLocation: () => Promise<void>;
}

/**
 * Hook that provides the effective user location based on their preferences
 * and what's available. Handles fallback logic when preferred mode isn't
 * available so dependent fetches don't wait on GPS unnecessarily.
 */
export function useEffectiveLocation(): UseEffectiveLocationReturn {
  // Get GPS location (automatically updates when permission changes)
  const {
    location: gpsLocation,
    loading: gpsLoading,
    hasPermission: hasGpsPermission,
    refetch: refetchGpsLocation,
  } = useUserLocation();

  // Get home location from context
  const { homeLocation, hasHomeLocation, isLoading: homeLoading } = useUserHomeLocation();

  // Get user's location mode preference
  const { locationMode, setLocationMode, isLoading: modeLoading } = useLocationMode();

  const hasGpsLocation = !!gpsLocation;

  // Sticky "last good" cache — if both sources are momentarily null (e.g.
  // during an AppState refresh that re-checks permission) we keep returning
  // the previous value rather than blanking it. Once a source resolves
  // again, the memo overwrites this with the fresh value.
  const lastGoodRef = useRef<{ location: EffectiveLocation; source: 'gps' | 'home' } | null>(null);

  const { location, locationSource } = useMemo(() => {
    const homeCoords: EffectiveLocation | null = homeLocation
      ? { latitude: homeLocation.latitude, longitude: homeLocation.longitude }
      : null;

    // 1. Honor the user's selected mode when its source has a value.
    if (locationMode === 'home' && homeCoords) {
      return { location: homeCoords, locationSource: 'home' as const };
    }
    if (locationMode === 'current' && gpsLocation) {
      return { location: gpsLocation, locationSource: 'gps' as const };
    }

    // 2. Preferred source isn't ready — use whatever resolved first so
    //    downstream queries don't wait. The memo recomputes when the
    //    preferred source arrives and swaps to it.
    if (gpsLocation) {
      return { location: gpsLocation, locationSource: 'gps' as const };
    }
    if (homeCoords) {
      return { location: homeCoords, locationSource: 'home' as const };
    }

    // 3. Nothing resolved yet — keep the last good value, if any, to ride
    //    out transient gaps without flickering consumers.
    if (lastGoodRef.current) {
      return {
        location: lastGoodRef.current.location,
        locationSource: lastGoodRef.current.source,
      };
    }

    return { location: null, locationSource: null as LocationSource };
  }, [locationMode, gpsLocation, homeLocation]);

  // Keep the sticky ref in sync with the latest non-null result.
  if (location && locationSource && locationSource !== null) {
    lastGoodRef.current = { location, source: locationSource };
  }

  const hasBothLocationOptions = hasGpsLocation && hasHomeLocation;

  // Only "loading" when we have no usable location at all. If we have any
  // source resolved (or a sticky fallback), we're done.
  const isLoading = !location && (gpsLoading || homeLoading || modeLoading);

  return {
    location,
    hasGpsLocation,
    hasGpsPermission,
    hasHomeLocation,
    hasBothLocationOptions,
    locationSource,
    locationMode,
    setLocationMode,
    isLoading,
    refetchGpsLocation,
  };
}

export default useEffectiveLocation;

/**
 * useEffectiveLocation Hook
 *
 * Provides a unified location based on user preferences and availability.
 * Combines GPS location, home location, and user's selected mode with smart fallbacks.
 *
 * Fallback logic:
 * 1. If selected mode is available, use it
 * 2. If selected mode isn't available, try the other option
 * 3. If neither is available, return null
 */

import { useMemo } from 'react';
import { useUserLocation } from './useUserLocation';
import { useLocationMode, useUserHomeLocation } from '../context';

export interface EffectiveLocation {
  latitude: number;
  longitude: number;
}

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
  locationSource: 'gps' | 'home' | null;
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
 * and what's available. Handles fallback logic when preferred mode isn't available.
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

  // Determine availability
  const hasGpsLocation = !!gpsLocation;

  // Calculate effective location with fallback logic
  const { location, locationSource } = useMemo(() => {
    // Try user's preferred mode first
    if (locationMode === 'home' && homeLocation) {
      return {
        location: {
          latitude: homeLocation.latitude,
          longitude: homeLocation.longitude,
        },
        locationSource: 'home' as const,
      };
    }

    if (locationMode === 'current' && gpsLocation) {
      return {
        location: gpsLocation,
        locationSource: 'gps' as const,
      };
    }

    // Fallback: if preferred mode isn't available, try the other
    if (gpsLocation) {
      return {
        location: gpsLocation,
        locationSource: 'gps' as const,
      };
    }

    if (homeLocation) {
      return {
        location: {
          latitude: homeLocation.latitude,
          longitude: homeLocation.longitude,
        },
        locationSource: 'home' as const,
      };
    }

    // No location available
    return {
      location: null,
      locationSource: null,
    };
  }, [locationMode, gpsLocation, homeLocation]);

  // Check if both options are available (for showing LocationSelector)
  const hasBothLocationOptions = hasGpsLocation && hasHomeLocation;

  // Combined loading state
  const isLoading = gpsLoading || homeLoading || modeLoading;

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

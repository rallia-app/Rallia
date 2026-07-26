'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Merges mobile's UserLocationContext (home location) and LocationModeContext
 * ('current' | 'home') into one provider — on web the two are always consumed
 * together, and there is no pre-signup storage stage: the player row is the
 * authoritative home location, fetched server-side and passed in.
 *
 * Source chain for coords, in order of preference:
 *   1. device GPS — the permission is only ever *requested* on an explicit user
 *      gesture (`requestPreciseLocation`), never auto-prompted on load. Once the
 *      player has granted it, a reload re-reads the position silently (see
 *      POSITION_MAX_AGE_MS), which shows no prompt.
 *   2. home location from the DB
 *   3. IP geolocation via the existing /api/get-location, fetched lazily and only
 *      when nothing better exists
 *
 * Precise coordinates are deliberately kept in memory only. They are sensitive
 * personal information, and web storage is readable by any script on the origin
 * and outlives the page. The browser's own positional cache gives us the same
 * "survives a reload without re-prompting" behaviour for free.
 */

export type LocationMode = 'current' | 'home';
export type LocationSource = 'device' | 'home' | 'ip';

export interface HomeLocation {
  latitude: number;
  longitude: number;
  postalCode: string | null;
}

interface Coords {
  latitude: number;
  longitude: number;
}

type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

interface UserLocationContextValue {
  /** Best coords for the active mode, or null while nothing has resolved. */
  coords: Coords | null;
  source: LocationSource | null;
  homeLocation: HomeLocation | null;
  hasHomeLocation: boolean;
  locationMode: LocationMode;
  setLocationMode: (mode: LocationMode) => void;
  /** Gesture-triggered precise location. Resolves true when coords were obtained. */
  requestPreciseLocation: () => Promise<boolean>;
  permissionState: PermissionState;
  isLoading: boolean;
}

const UserLocationContext = createContext<UserLocationContextValue | undefined>(undefined);

/** Same key mobile uses in AsyncStorage, for conceptual parity in devtools. */
const LOCATION_MODE_KEY = '@rallia/location-mode';
/**
 * How stale a browser-cached fix may be before a new one is acquired. This is
 * what lets a granted position survive a reload: getCurrentPosition returns the
 * cached fix instantly and without a prompt, so we never have to hold
 * coordinates in web storage ourselves.
 */
const POSITION_MAX_AGE_MS = 10 * 60 * 1000;

interface UserLocationProviderProps {
  children: React.ReactNode;
  /** From the (player) layout's server fetch of the player row. */
  initialHomeLocation: HomeLocation | null;
}

export function UserLocationProvider({ children, initialHomeLocation }: UserLocationProviderProps) {
  const [locationMode, setLocationModeState] = useState<LocationMode>('current');
  const [deviceCoords, setDeviceCoords] = useState<Coords | null>(null);
  const [ipCoords, setIpCoords] = useState<Coords | null>(null);
  const [ipFetchDone, setIpFetchDone] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt');
  const [hydrated, setHydrated] = useState(false);

  // Restore the persisted mode after hydration (localStorage is invisible to the
  // server render). Coordinates are not restored from storage — see the header.
  useEffect(() => {
    const storedMode = localStorage.getItem(LOCATION_MODE_KEY);
    if (storedMode === 'home' || storedMode === 'current') {
      setLocationModeState(storedMode);
    }
    setHydrated(true);
  }, []);

  // Track the browser permission without prompting; keeps the UI honest (no "use my
  // location" affordance that is doomed to fail silently).
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setPermissionState('unavailable');
      return;
    }
    if (!navigator.permissions?.query) return;

    let status: PermissionStatus | undefined;
    let cancelled = false;
    const sync = () => {
      if (!cancelled && status) setPermissionState(status.state);
    };
    navigator.permissions
      .query({ name: 'geolocation' })
      .then(result => {
        status = result;
        sync();
        result.addEventListener('change', sync);
      })
      .catch(() => {
        // Permissions API missing or blocked; leave at 'prompt'.
      });
    return () => {
      cancelled = true;
      status?.removeEventListener('change', sync);
    };
  }, []);

  const setLocationMode = useCallback((mode: LocationMode) => {
    setLocationModeState(mode);
    try {
      localStorage.setItem(LOCATION_MODE_KEY, mode);
    } catch {
      // Storage full or blocked; the mode still applies for this session.
    }
  }, []);

  const requestPreciseLocation = useCallback(async (): Promise<boolean> => {
    if (!('geolocation' in navigator)) return false;
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        position => {
          setDeviceCoords({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setPermissionState('granted');
          resolve(true);
        },
        error => {
          if (error.code === error.PERMISSION_DENIED) setPermissionState('denied');
          resolve(false);
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: POSITION_MAX_AGE_MS }
      );
    });
  }, []);

  // Already-granted permission: re-read the position once after hydration so a
  // reload doesn't cost the player another click. This shows no prompt, and with
  // POSITION_MAX_AGE_MS it usually resolves from the browser's cache instantly.
  // Guarded by a ref so a denial or timeout doesn't loop.
  const silentRestoreDone = useRef(false);
  useEffect(() => {
    if (!hydrated || silentRestoreDone.current) return;
    if (permissionState !== 'granted' || deviceCoords) return;
    silentRestoreDone.current = true;
    void requestPreciseLocation();
  }, [hydrated, permissionState, deviceCoords, requestPreciseLocation]);

  // The IP fallback is a third-party hop with rate limits: fetch it once, lazily, and
  // only when there is genuinely nothing better to offer.
  const needsIpFallback = hydrated && !deviceCoords && !initialHomeLocation && !ipFetchDone;
  useEffect(() => {
    if (!needsIpFallback) return;
    let cancelled = false;
    fetch('/api/get-location')
      .then(response => (response.ok ? response.json() : null))
      .then((data: { latitude?: number | null; longitude?: number | null } | null) => {
        if (cancelled) return;
        if (data?.latitude != null && data?.longitude != null) {
          setIpCoords({ latitude: data.latitude, longitude: data.longitude });
        }
        setIpFetchDone(true);
      })
      .catch(() => {
        if (!cancelled) setIpFetchDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsIpFallback]);

  const { coords, source } = useMemo<{
    coords: Coords | null;
    source: LocationSource | null;
  }>(() => {
    const home = initialHomeLocation
      ? { latitude: initialHomeLocation.latitude, longitude: initialHomeLocation.longitude }
      : null;

    if (locationMode === 'home' && home) return { coords: home, source: 'home' };
    if (deviceCoords) return { coords: deviceCoords, source: 'device' };
    if (home) return { coords: home, source: 'home' };
    if (ipCoords) return { coords: ipCoords, source: 'ip' };
    return { coords: null, source: null };
  }, [locationMode, initialHomeLocation, deviceCoords, ipCoords]);

  const value = useMemo<UserLocationContextValue>(
    () => ({
      coords,
      source,
      homeLocation: initialHomeLocation,
      hasHomeLocation: initialHomeLocation !== null,
      locationMode,
      setLocationMode,
      requestPreciseLocation,
      permissionState,
      isLoading: !hydrated || (coords === null && !ipFetchDone),
    }),
    [
      coords,
      source,
      initialHomeLocation,
      locationMode,
      setLocationMode,
      requestPreciseLocation,
      permissionState,
      hydrated,
      ipFetchDone,
    ]
  );

  return <UserLocationContext.Provider value={value}>{children}</UserLocationContext.Provider>;
}

export function useUserLocation(): UserLocationContextValue {
  const context = useContext(UserLocationContext);
  if (!context) {
    throw new Error('useUserLocation must be used within a UserLocationProvider');
  }
  return context;
}

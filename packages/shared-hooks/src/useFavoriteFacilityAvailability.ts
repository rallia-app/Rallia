/**
 * useFavoriteFacilityAvailability Hook
 * Returns the player's favorite facilities that have a booking provider,
 * with their realtime availability slots inlined. Powers the personalized
 * "Open at your favorites" section on Home.
 *
 * Thin wrapper over useFacilitySearch: presets favoritesOnly + distance:'all'
 * (favorites are returned at any distance) and an empty query, then keeps only
 * provider-enabled facilities. Reuses the search hook's stale-while-revalidate
 * refresh — request_facility_refresh fires for the returned provider favorites
 * so cold-start snapshots populate on their own.
 */

import { useMemo } from 'react';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { useFacilitySearch, DEFAULT_FACILITY_FILTERS } from './useFacilitySearch';

interface UseFavoriteFacilityAvailabilityOptions {
  /** Player whose favorites we want (null when signed out). */
  playerId: string | null | undefined;
  /** Active sport — favorites are per-sport. */
  sportId: string | null | undefined;
  /** User location, required so the search RPC can compute/order by distance. */
  latitude: number | undefined;
  longitude: number | undefined;
  /** Caller-side gate (e.g. onboarded + location ready). */
  enabled?: boolean;
}

interface UseFavoriteFacilityAvailabilityReturn {
  /** Favorite facilities that have a booking provider, with inline slots. */
  facilities: FacilitySearchResult[];
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export function useFavoriteFacilityAvailability(
  options: UseFavoriteFacilityAvailabilityOptions
): UseFavoriteFacilityAvailabilityReturn {
  const { playerId, sportId, latitude, longitude, enabled = true } = options;

  const { facilities, isLoading, isFetching, refetch } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude,
    longitude,
    searchQuery: '',
    // distance:'all' → max_distance_km is NULL → favorites at any distance.
    filters: { ...DEFAULT_FACILITY_FILTERS, distance: 'all', favoritesOnly: true },
    playerId,
    // 3 favorites per sport cap → a single page always covers it.
    pageSize: 20,
    enabled: enabled && !!playerId && !!sportId,
  });

  // Keep only provider-enabled favorites. FCFS facilities never yield snapshot
  // slots, so they have no realtime availability to surface here.
  const providerFavorites = useMemo(
    () => facilities.filter(f => !!f.external_provider_id && !f.is_first_come_first_serve),
    [facilities]
  );

  return { facilities: providerFavorites, isLoading, isFetching, refetch };
}

export default useFavoriteFacilityAvailability;

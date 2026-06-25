/**
 * useFavoriteFacilityAvailability Hook
 * Powers the personalized "Open at your favorites" section on Home.
 *
 * Returns the player's favorite provider-enabled facilities that currently have
 * a bookable slot. When none do — a signed-out user (no favorites) or a
 * signed-in user whose favorites are all booked up — it falls back to the
 * closest facilities (within `maxDistanceKm`) that DO have an open slot, so the
 * section always offers something actionable. `source` tells the caller which
 * list it got back so the header copy can adapt.
 *
 * Thin orchestration over two useFacilitySearch queries (favorites + nearby
 * fallback); each reuses the search hook's stale-while-revalidate snapshot
 * refresh, so cold-start availability populates on its own.
 */

import { useCallback, useMemo } from 'react';
import type { FacilitySearchResult } from '@rallia/shared-types';

import { useFacilitySearch, DEFAULT_FACILITY_FILTERS } from './useFacilitySearch';
import { formatInlineSnapshotSlots } from './useCourtAvailability';

// Players have no upper bound on favorites (MIN_FAVORITE_FACILITIES is a floor,
// not a ceiling), so fetch a large page to surface ALL favorites with open
// slots — never a truncated subset.
const FAVORITES_PAGE_SIZE = 500;

// Nearby fallback: how many closest-with-slots facilities to surface.
const FALLBACK_LIMIT = 3;

// Fetch a small buffer above FALLBACK_LIMIT so the timezone-aware future-slot
// filter below can drop an edge slot without starving us under the cap.
const FALLBACK_FETCH_SIZE = 8;

interface UseFavoriteFacilityAvailabilityOptions {
  /** Player whose favorites we want (null/undefined when signed out). */
  playerId: string | null | undefined;
  /** Active sport — favorites are per-sport. */
  sportId: string | null | undefined;
  /** User location, required so the search RPC can compute/order by distance. */
  latitude: number | undefined;
  longitude: number | undefined;
  /** Radius (km) bounding the nearby fallback. Favorites are unbounded. */
  maxDistanceKm?: number;
  /** Caller-side gate (e.g. location ready). */
  enabled?: boolean;
}

interface UseFavoriteFacilityAvailabilityReturn {
  /** Favorites with open slots, or the nearby fallback when none qualify. */
  facilities: FacilitySearchResult[];
  /** 'favorites' when the list is the player's favorites; 'nearby' when it's
   *  the closest-with-slots fallback (always the case when signed out). */
  source: 'favorites' | 'nearby';
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

// A facility surfaces here only if it has at least one future bookable slot.
// The RPC already future-filters, but formatInlineSnapshotSlots re-applies it
// in the facility's local timezone — the same gate the card uses to decide
// whether to render its slot strip.
const hasFutureSlots = (f: FacilitySearchResult): boolean =>
  formatInlineSnapshotSlots(f.availability_slots, f.timezone).slots.length > 0;

export function useFavoriteFacilityAvailability(
  options: UseFavoriteFacilityAvailabilityOptions
): UseFavoriteFacilityAvailabilityReturn {
  const { playerId, sportId, latitude, longitude, maxDistanceKm, enabled = true } = options;

  const baseReady = enabled && !!sportId && latitude !== undefined && longitude !== undefined;
  const sportIds = useMemo(() => (sportId ? [sportId] : undefined), [sportId]);

  // 1. Favorites (provider-enabled), at any distance. Signed-in only.
  const favoritesQuery = useFacilitySearch({
    sportIds,
    latitude,
    longitude,
    searchQuery: '',
    // distance:'all' → max_distance_km is NULL → favorites at any distance.
    filters: { ...DEFAULT_FACILITY_FILTERS, distance: 'all', favoritesOnly: true },
    playerId,
    pageSize: FAVORITES_PAGE_SIZE,
    enabled: baseReady && !!playerId,
  });

  // Provider-enabled favorites that currently have a future slot. FCFS courts
  // never yield snapshot rows, so they can't surface realtime availability.
  const favoritesWithSlots = useMemo(
    () =>
      favoritesQuery.facilities.filter(
        f => !!f.external_provider_id && !f.is_first_come_first_serve && hasFutureSlots(f)
      ),
    [favoritesQuery.facilities]
  );

  // Fall back only when there's no favorite-with-slots to show: a signed-out
  // user (no playerId), or a signed-in user whose favorites have resolved with
  // zero open slots. Holding off while favorites load avoids a wasted fetch.
  const favoritesPending = !!playerId && favoritesQuery.isLoading;
  const shouldUseFallback = baseReady && !favoritesPending && favoritesWithSlots.length === 0;

  // 2. Fallback: the closest facilities (any) with an open snapshot slot.
  //    Fetched at any distance (distance-sorted) then bounded to maxDistanceKm
  //    client-side — maxTravelDistance is an arbitrary km, not one of the
  //    discrete distance-filter options, so the radius can't go through the RPC
  //    filter. hasOpenSlots implies a snapshot row, i.e. a provider facility.
  const fallbackQuery = useFacilitySearch({
    sportIds,
    latitude,
    longitude,
    searchQuery: '',
    filters: { ...DEFAULT_FACILITY_FILTERS, distance: 'all', hasOpenSlots: true },
    playerId,
    pageSize: FALLBACK_FETCH_SIZE,
    enabled: shouldUseFallback,
  });

  // Results are distance-ascending, so the first FALLBACK_LIMIT within radius
  // are exactly the closest within radius.
  const nearbyWithSlots = useMemo(() => {
    const maxMeters = maxDistanceKm != null ? maxDistanceKm * 1000 : null;
    return fallbackQuery.facilities
      .filter(
        f =>
          hasFutureSlots(f) &&
          (maxMeters == null || f.distance_meters == null || f.distance_meters <= maxMeters)
      )
      .slice(0, FALLBACK_LIMIT);
  }, [fallbackQuery.facilities, maxDistanceKm]);

  // Prefer favorites; while a signed-in user's favorites load, optimistically
  // label as favorites so the header doesn't flip mid-skeleton.
  const usingFavorites = favoritesWithSlots.length > 0 || favoritesPending;
  const facilities = usingFavorites ? favoritesWithSlots : nearbyWithSlots;
  const source: 'favorites' | 'nearby' = usingFavorites ? 'favorites' : 'nearby';

  const isLoading = favoritesPending || (shouldUseFallback && fallbackQuery.isLoading);
  const isFetching = favoritesQuery.isFetching || fallbackQuery.isFetching;

  const refetchFavorites = favoritesQuery.refetch;
  const refetchFallback = fallbackQuery.refetch;
  const refetch = useCallback(() => {
    refetchFavorites();
    refetchFallback();
  }, [refetchFavorites, refetchFallback]);

  return { facilities, source, isLoading, isFetching, refetch };
}

export default useFavoriteFacilityAvailability;

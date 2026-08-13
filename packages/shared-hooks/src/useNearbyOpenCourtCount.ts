/**
 * useNearbyOpenCourtCount Hook
 * Number of distinct courts with a future bookable slot around the player.
 *
 * Always geography-scoped, never favorites-scoped: the Home "Book a court"
 * tile promises what is open NEAR the player, so a signed-in player with
 * favorites sees the same number a signed-out visitor at the same spot does.
 * The count comes back as a single integer from count_available_courts_nearby
 * — the client never pulls the underlying slot rows.
 */

import { useQuery } from '@tanstack/react-query';
import { countAvailableCourtsNearby } from '@rallia/shared-services';

interface UseNearbyOpenCourtCountOptions {
  /** Active sport — snapshot slots are sport-scoped. */
  sportId: string | null | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  /** Radius in km; omit for unbounded. */
  maxDistanceKm?: number;
  /** Caller-side gate (e.g. location ready). */
  enabled?: boolean;
}

interface UseNearbyOpenCourtCountReturn {
  count: number | undefined;
  isLoading: boolean;
}

export const nearbyOpenCourtCountKeys = {
  all: ['facilities', 'nearbyOpenCourtCount'] as const,
  withParams: (
    sportId: string | null | undefined,
    latitude: number | undefined,
    longitude: number | undefined,
    maxDistanceKm: number | undefined
  ) => [...nearbyOpenCourtCountKeys.all, sportId, latitude, longitude, maxDistanceKm] as const,
};

export function useNearbyOpenCourtCount(
  options: UseNearbyOpenCourtCountOptions
): UseNearbyOpenCourtCountReturn {
  const { sportId, latitude, longitude, maxDistanceKm, enabled = true } = options;

  const ready = enabled && !!sportId && latitude !== undefined && longitude !== undefined;

  const query = useQuery({
    queryKey: nearbyOpenCourtCountKeys.withParams(sportId, latitude, longitude, maxDistanceKm),
    queryFn: () =>
      countAvailableCourtsNearby({
        sportIds: [sportId as string],
        latitude: latitude as number,
        longitude: longitude as number,
        maxDistanceKm,
      }),
    enabled: ready,
    // Matches the facility-search window: snapshots refresh on the same order.
    staleTime: 1000 * 60,
  });

  return { count: query.data, isLoading: query.isLoading && ready };
}

export default useNearbyOpenCourtCount;

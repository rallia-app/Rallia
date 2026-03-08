/**
 * useMapData Hook
 * Fetches facilities and custom-location matches for the map view.
 */

import { useQuery } from '@tanstack/react-query';
import { getMapFacilities, getCustomLocationMatches } from '@rallia/shared-services';
import type { FacilitySearchResult, MatchWithDetails } from '@rallia/shared-types';

/** Facility with guaranteed lat/lng for map display */
export interface MapFacility extends FacilitySearchResult {
  latitude: number;
  longitude: number;
}

/** Custom-location match with guaranteed coordinates */
export interface MapCustomMatch extends MatchWithDetails {
  custom_latitude: number;
  custom_longitude: number;
}

interface UseMapDataOptions {
  sportIds: string[] | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  maxDistanceKm?: number;
  enabled?: boolean;
}

interface UseMapDataReturn {
  facilities: MapFacility[];
  customMatches: MapCustomMatch[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const mapKeys = {
  all: ['map'] as const,
  facilities: (
    sportIds: string[] | undefined,
    lat: number | undefined,
    lng: number | undefined,
    dist: number
  ) => [...mapKeys.all, 'facilities', sportIds, lat, lng, dist] as const,
  matches: (
    sportIds: string[] | undefined,
    lat: number | undefined,
    lng: number | undefined,
    dist: number
  ) => [...mapKeys.all, 'matches', sportIds, lat, lng, dist] as const,
};

export function useMapData(options: UseMapDataOptions): UseMapDataReturn {
  const { sportIds, latitude, longitude, maxDistanceKm = 25, enabled = true } = options;

  const hasRequiredParams = !!sportIds?.length && latitude !== undefined && longitude !== undefined;

  const facilitiesQuery = useQuery<FacilitySearchResult[], Error>({
    queryKey: mapKeys.facilities(sportIds, latitude, longitude, maxDistanceKm),
    queryFn: () =>
      getMapFacilities({
        sportIds: sportIds!,
        latitude: latitude!,
        longitude: longitude!,
        maxDistanceKm,
      }),
    enabled: enabled && hasRequiredParams,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });

  const matchesQuery = useQuery<MatchWithDetails[], Error>({
    queryKey: mapKeys.matches(sportIds, latitude, longitude, maxDistanceKm),
    queryFn: () =>
      getCustomLocationMatches({
        sportIds: sportIds!,
        latitude: latitude!,
        longitude: longitude!,
        maxDistanceKm,
      }),
    enabled: enabled && hasRequiredParams,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // Filter to entries with guaranteed coordinates
  const facilities = (facilitiesQuery.data ?? []).filter(
    (f): f is MapFacility => f.latitude != null && f.longitude != null
  );

  const customMatches = (matchesQuery.data ?? []).filter(
    (m): m is MapCustomMatch => m.custom_latitude != null && m.custom_longitude != null
  );

  return {
    facilities,
    customMatches,
    isLoading: facilitiesQuery.isLoading || matchesQuery.isLoading,
    error: facilitiesQuery.error || matchesQuery.error,
    refetch: () => {
      facilitiesQuery.refetch();
      matchesQuery.refetch();
    },
  };
}

export default useMapData;

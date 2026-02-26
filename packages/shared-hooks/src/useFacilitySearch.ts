/**
 * useFacilitySearch Hook
 * Custom hook for searching facilities with TanStack Query.
 * Provides infinite scrolling, debounced search, and filtering.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  searchFacilitiesNearby,
  type FacilityTypeFilter,
  type SurfaceTypeFilter,
  type CourtTypeFilter,
  type LightingFilter,
  type MembershipFilter,
} from '@rallia/shared-services';
import type { FacilitiesPage, FacilitySearchResult } from '@rallia/shared-types';
import { useDebounce } from './useDebounce';

// Re-export filter types for convenience
export type {
  FacilityTypeFilter,
  SurfaceTypeFilter,
  CourtTypeFilter,
  LightingFilter,
  MembershipFilter,
};

// Distance filter options in kilometers
export type FacilityDistanceFilter = 'all' | 5 | 10 | 15 | 25 | 50;
export const FACILITY_DISTANCE_OPTIONS: FacilityDistanceFilter[] = ['all', 5, 10, 15, 25, 50];

// Facility type filter options
export const FACILITY_TYPE_OPTIONS: ('all' | FacilityTypeFilter)[] = [
  'all',
  'park',
  'club',
  'indoor_center',
  'municipal',
  'community_center',
  'university',
  'school',
  'private',
  'other',
];

// Surface type filter options
export const SURFACE_TYPE_OPTIONS: ('all' | SurfaceTypeFilter)[] = [
  'all',
  'hard',
  'clay',
  'grass',
  'synthetic',
  'carpet',
];

// Court type filter options (maps to court.indoor boolean: indoor=true, outdoor=false)
export const COURT_TYPE_OPTIONS: ('all' | CourtTypeFilter)[] = ['all', 'indoor', 'outdoor'];

// Lighting filter options
export const LIGHTING_OPTIONS: LightingFilter[] = ['all', 'with_lights', 'no_lights'];

// Membership filter options
export const MEMBERSHIP_OPTIONS: MembershipFilter[] = ['all', 'public', 'members_only'];

// Query keys for cache management
export const facilityKeys = {
  all: ['facilities'] as const,
  search: () => [...facilityKeys.all, 'search'] as const,
  searchWithParams: (
    sportIds: string[] | undefined,
    latitude: number | undefined,
    longitude: number | undefined,
    query: string,
    distance: FacilityDistanceFilter,
    facilityType: 'all' | FacilityTypeFilter,
    surfaceType: 'all' | SurfaceTypeFilter,
    courtType: 'all' | CourtTypeFilter,
    lighting: LightingFilter,
    membership: MembershipFilter
  ) =>
    [
      ...facilityKeys.search(),
      sportIds,
      latitude,
      longitude,
      query,
      distance,
      facilityType,
      surfaceType,
      courtType,
      lighting,
      membership,
    ] as const,
};

/** Facility filter state */
export interface FacilityFilters {
  distance: FacilityDistanceFilter;
  facilityType: 'all' | FacilityTypeFilter;
  surfaceType: 'all' | SurfaceTypeFilter;
  courtType: 'all' | CourtTypeFilter;
  lighting: LightingFilter;
  membership: MembershipFilter;
}

/** Default filter values */
export const DEFAULT_FACILITY_FILTERS: FacilityFilters = {
  distance: 'all',
  facilityType: 'all',
  surfaceType: 'all',
  courtType: 'all',
  lighting: 'all',
  membership: 'all',
};

interface UseFacilitySearchOptions {
  /** Sport IDs to filter facilities by */
  sportIds: string[] | undefined;
  /** User's latitude */
  latitude: number | undefined;
  /** User's longitude */
  longitude: number | undefined;
  /** Search query string */
  searchQuery: string;
  /** Filters to apply */
  filters?: FacilityFilters;
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

interface UseFacilitySearchReturn {
  /** Flattened array of all facilities from all pages */
  facilities: FacilitySearchResult[];
  /** Total number of facilities matching the search criteria (from first page) */
  totalCount: number | undefined;
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** Whether any fetch is in progress */
  isFetching: boolean;
  /** Whether we're fetching the next page */
  isFetchingNextPage: boolean;
  /** Whether there are more pages to load */
  hasNextPage: boolean;
  /** Error if any */
  error: Error | null;
  /** Function to fetch the next page */
  fetchNextPage: () => void;
  /** Function to refetch all data */
  refetch: () => void;
}

/**
 * Hook for searching facilities with infinite scrolling, debounced input, and filters.
 * Facilities are sorted by distance from the user's location.
 */
export function useFacilitySearch(options: UseFacilitySearchOptions): UseFacilitySearchReturn {
  const {
    sportIds,
    latitude,
    longitude,
    searchQuery,
    filters = DEFAULT_FACILITY_FILTERS,
    debounceMs = 300,
    enabled = true,
  } = options;

  // Normalize whitespace before debouncing for consistent cache keys and cleaner queries
  const normalizedQuery = searchQuery.trim().replace(/\s+/g, ' ');
  const debouncedQuery = useDebounce(normalizedQuery, debounceMs);

  // Check if we have all required params
  const hasRequiredParams = !!sportIds?.length && latitude !== undefined && longitude !== undefined;

  const query = useInfiniteQuery<FacilitiesPage, Error>({
    // Include actual values (including undefined) in query key so React Query properly tracks changes
    // This ensures the query refetches when location/sport loads
    queryKey: facilityKeys.searchWithParams(
      sportIds,
      latitude,
      longitude,
      debouncedQuery ?? '',
      filters.distance,
      filters.facilityType,
      filters.surfaceType,
      filters.courtType,
      filters.lighting,
      filters.membership
    ),
    queryFn: async ({ pageParam }) => {
      if (!sportIds?.length || latitude === undefined || longitude === undefined) {
        return { facilities: [], hasMore: false, nextOffset: null };
      }

      // Convert lighting filter to boolean
      const hasLighting =
        filters.lighting === 'all' ? undefined : filters.lighting === 'with_lights';

      // Convert membership filter to boolean
      const membershipRequired =
        filters.membership === 'all' ? undefined : filters.membership === 'members_only';

      return searchFacilitiesNearby({
        sportIds,
        latitude,
        longitude,
        searchQuery: debouncedQuery || undefined,
        maxDistanceKm: filters.distance === 'all' ? undefined : filters.distance,
        facilityTypes: filters.facilityType === 'all' ? undefined : [filters.facilityType],
        surfaceTypes: filters.surfaceType === 'all' ? undefined : [filters.surfaceType],
        courtTypes: filters.courtType === 'all' ? undefined : [filters.courtType],
        hasLighting,
        membershipRequired,
        offset: (pageParam as number) ?? 0,
      });
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && hasRequiredParams,
    staleTime: 1000 * 60, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Always refetch when component mounts if enabled
  });

  // Flatten pages into a single array of facilities
  const allFacilities = query.data?.pages.flatMap(page => page.facilities) ?? [];

  // Get total count from first page (only fetched on first page)
  const totalCount = query.data?.pages[0]?.totalCount;

  return {
    facilities: allFacilities,
    totalCount,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export default useFacilitySearch;

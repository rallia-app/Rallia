/**
 * useFacilitySearch Hook
 * Custom hook for searching facilities with TanStack Query.
 * Provides infinite scrolling, debounced search, and filtering.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  searchFacilitiesNearby,
  supabase,
  type FacilityTypeFilter,
  type SurfaceTypeFilter,
  type CourtTypeFilter,
  type LightingFilter,
  type MembershipFilter,
} from '@rallia/shared-services';
import type { FacilitiesPage, FacilitySearchResult } from '@rallia/shared-types';
import { useDebounce } from './useDebounce';

// How long to wait after firing request_facility_refresh before refetching
// the search query. The edge function fans out to provider APIs and writes
// snapshot rows; 5s comfortably covers a typical batch. The refetch is
// idempotent and only scheduled if the RPC reported > 0 stale facilities.
const SWR_REFETCH_DELAY_MS = 5000;

// request_facility_refresh caps at 50 facility ids per invocation (matches
// the edge function's per-call provider fan-out budget). We chunk our
// payloads to that cap.
const REFRESH_BATCH_SIZE = 50;

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

// Organization nature filter options
export type OrganizationNatureFilter = 'all' | 'public' | 'private';
export const ORGANIZATION_NATURE_OPTIONS: OrganizationNatureFilter[] = ['all', 'public', 'private'];

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
    membership: MembershipFilter,
    hasAvailabilities: boolean,
    hasOpenSlots: boolean,
    userGender?: string | null,
    playerId?: string | null
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
      hasAvailabilities,
      hasOpenSlots,
      userGender,
      playerId,
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
  organizationNature: OrganizationNatureFilter;
  hasAvailabilities: boolean;
  hasOpenSlots: boolean;
  favoritesOnly: boolean;
}

/** Default filter values */
export const DEFAULT_FACILITY_FILTERS: FacilityFilters = {
  distance: 'all',
  facilityType: 'all',
  surfaceType: 'all',
  courtType: 'all',
  lighting: 'all',
  membership: 'all',
  organizationNature: 'all',
  hasAvailabilities: false,
  hasOpenSlots: false,
  favoritesOnly: false,
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
  /** The viewing user's gender for match eligibility filtering */
  userGender?: string | null;
  /** Player ID for favorite-first sorting */
  playerId?: string | null;
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Number of results per page (default: 20). Use a large value (e.g. 500) to fetch all at once. */
  pageSize?: number;
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
    userGender,
    playerId,
    debounceMs = 300,
    pageSize,
    enabled = true,
  } = options;

  // Normalize whitespace before debouncing for consistent cache keys and cleaner queries
  const normalizedQuery = (searchQuery ?? '').trim().replace(/\s+/g, ' ');
  const debouncedQuery = useDebounce(normalizedQuery, debounceMs);

  // Check if we have all required params
  const hasRequiredParams = !!sportIds?.length && latitude !== undefined && longitude !== undefined;

  const query = useInfiniteQuery<FacilitiesPage, Error>({
    // Include actual values (including undefined) in query key so React Query properly tracks changes
    // This ensures the query refetches when location/sport loads
    queryKey: [
      ...facilityKeys.searchWithParams(
        sportIds,
        latitude,
        longitude,
        debouncedQuery ?? '',
        filters.distance,
        filters.facilityType,
        filters.surfaceType,
        filters.courtType,
        filters.lighting,
        filters.membership,
        filters.hasAvailabilities,
        filters.hasOpenSlots,
        userGender,
        playerId
      ),
      filters.favoritesOnly,
      filters.organizationNature,
      pageSize,
    ],
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
        hasAvailabilities: filters.hasAvailabilities ? true : undefined,
        hasOpenSlots: filters.hasOpenSlots ? true : undefined,
        favoritesOnly: filters.favoritesOnly ? true : undefined,
        organizationNature:
          filters.organizationNature === 'all' ? undefined : filters.organizationNature,
        userGender,
        playerId,
        limit: pageSize,
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

  // Flatten pages into a single array of facilities. Memoized so the returned
  // reference is stable between renders that didn't change the page set — the
  // mobile FlatList downstream uses identity equality on this array to decide
  // whether to re-render rows.
  const allFacilities = useMemo(
    () => query.data?.pages.flatMap(page => page.facilities) ?? [],
    [query.data]
  );

  // SWR availability refresh. After each successful fetch we ask the DB which
  // of the currently-loaded facility ids are stale (request_facility_refresh
  // applies snapshot_needs_refresh internally) and fan out to the refresh
  // edge function. If anything was actually stale, schedule a single refetch
  // so the freshly-snapshotted slots land in the cards without user action.
  // Subsequent fires return 0 and don't reschedule, so this self-stabilizes.
  //
  // Page-aware: on scroll (fetchNextPage appended a page) we refresh-check
  // only the newly-arrived page's ids, so later pages are covered without
  // re-firing for ids we already checked. On a full refetch (pull-to-refresh
  // or invalidation, page count unchanged or shrunk) we re-check every
  // loaded page so stale rows on earlier pages don't slip through. Payloads
  // are chunked to REFRESH_BATCH_SIZE so the per-call cap never truncates.
  const dataUpdatedAt = query.dataUpdatedAt;
  const refetch = query.refetch;
  const triggeredPageCountRef = useRef(0);
  useEffect(() => {
    const pages = query.data?.pages;
    if (!pages || pages.length === 0) {
      triggeredPageCountRef.current = 0;
      return;
    }

    // If page count grew → newly-appended page(s); check just those.
    // Otherwise → refetch (or filter switch); check everything visible.
    const grew = pages.length > triggeredPageCountRef.current;
    const pagesToCheck = grew ? pages.slice(triggeredPageCountRef.current) : pages;
    triggeredPageCountRef.current = pages.length;

    // Only refreshable facilities go to the RPC. Non-provider facilities
    // (community parks, FCFS courts) never yield snapshot rows, so flagging
    // them as "needs refresh" would loop fruitlessly — the RPC would count
    // them stale, we'd schedule a refetch, the next pass would find them
    // stale again. The card's slot strip uses the same gate
    // (external_provider_id) to decide whether to render slots at all.
    const allIds = pagesToCheck
      .flatMap(p => p.facilities)
      .filter(f => !!f.external_provider_id)
      .map(f => f.id);
    if (allIds.length === 0) return;

    // Chunk into <=50 (request_facility_refresh's per-call cap) so a single
    // large refetch can still cover every loaded facility.
    const batches: string[][] = [];
    for (let i = 0; i < allIds.length; i += REFRESH_BATCH_SIZE) {
      batches.push(allIds.slice(i, i + REFRESH_BATCH_SIZE));
    }

    let cancelled = false;
    let refetchHandle: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const results = await Promise.all(
        batches.map(ids => supabase.rpc('request_facility_refresh', { p_facility_ids: ids }))
      );
      if (cancelled) return;
      const anyStale = results.some(r => !r.error && typeof r.data === 'number' && r.data > 0);
      if (anyStale) {
        refetchHandle = setTimeout(() => {
          if (!cancelled) refetch();
        }, SWR_REFETCH_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (refetchHandle) clearTimeout(refetchHandle);
    };
    // dataUpdatedAt ticks on every successful page fetch / refetch, which is
    // exactly when we want to re-evaluate staleness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt]);

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

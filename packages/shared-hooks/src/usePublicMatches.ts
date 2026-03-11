/**
 * usePublicMatches Hook
 * Custom hook for fetching public matches with search and filtering.
 * Uses TanStack Query for infinite scrolling and caching.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { getPublicMatches } from '@rallia/shared-services';
import type { MatchWithDetails } from '@rallia/shared-types';
import { useMemo, useCallback } from 'react';
import { matchKeys } from './useCreateMatch';
import type { PublicMatchFilters } from './usePublicMatchFilters';

/** Default page size for infinite queries */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Match with distance information
 */
export interface PublicMatch extends MatchWithDetails {
  distance_meters: number | null;
}

/**
 * Page structure for infinite queries
 */
interface PublicMatchesPage {
  matches: PublicMatch[];
  nextOffset: number | null;
  hasMore: boolean;
}

/**
 * Options for the usePublicMatches hook
 */
export interface UsePublicMatchesOptions {
  /** User's current latitude */
  latitude: number | undefined;
  /** User's current longitude */
  longitude: number | undefined;
  /** Maximum distance in km, or 'all' for no distance filter (shows all location types) */
  maxDistanceKm: number | 'all' | undefined;
  /** Sport ID to filter matches by */
  sportId: string | undefined;
  /** Filter state from usePublicMatchFilters */
  filters: PublicMatchFilters;
  /** Debounced search query from usePublicMatchFilters */
  debouncedSearchQuery: string;
  /** The viewing user's gender for eligibility filtering */
  userGender?: string | null;
  /** Optional facility ID to filter matches to a specific facility */
  facilityId?: string;
  /** Favorite player IDs for client-side favorites filtering */
  favoritePlayerIds?: string[];
  /** Maximum number of matches to fetch per page */
  limit?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

/**
 * Hook for fetching public matches with search and filters.
 * Uses TanStack Query infinite scrolling for efficient pagination.
 * Automatically refetches when filters change.
 *
 * @example
 * ```tsx
 * const { filters, debouncedSearchQuery } = usePublicMatchFilters();
 * const { location } = useUserLocation();
 * const { maxTravelDistanceKm } = usePlayer();
 * const { selectedSport } = useSport();
 *
 * const {
 *   matches,
 *   isLoading,
 *   isFetchingNextPage,
 *   hasNextPage,
 *   fetchNextPage,
 *   refetch,
 * } = usePublicMatches({
 *   latitude: location?.latitude,
 *   longitude: location?.longitude,
 *   maxDistanceKm: maxTravelDistanceKm,
 *   sportId: selectedSport?.id,
 *   filters,
 *   debouncedSearchQuery,
 *   enabled: !!location && !!selectedSport,
 * });
 * ```
 */
export function usePublicMatches(options: UsePublicMatchesOptions) {
  const {
    latitude,
    longitude,
    maxDistanceKm,
    sportId,
    filters,
    debouncedSearchQuery,
    userGender,
    facilityId,
    favoritePlayerIds,
    limit = DEFAULT_PAGE_SIZE,
    enabled = true,
  } = options;

  // Only enable query when we have all required params
  // Note: maxDistanceKm can be 'all' (no distance filter) or a number
  const hasRequiredParams =
    latitude !== undefined &&
    longitude !== undefined &&
    maxDistanceKm !== undefined &&
    sportId !== undefined;

  const query = useInfiniteQuery<PublicMatchesPage, Error>({
    // Include all filter params in query key for automatic refetch when filters change
    queryKey: matchKeys.list('public', {
      latitude,
      longitude,
      maxDistanceKm,
      sportId,
      facilityId,
      searchQuery: debouncedSearchQuery,
      format: filters.format,
      matchType: filters.matchType,
      dateRange: filters.dateRange,
      timeOfDay: filters.timeOfDay,
      skillLevel: filters.skillLevel,
      gender: filters.gender,
      cost: filters.cost,
      joinMode: filters.joinMode,
      duration: filters.duration,
      courtStatus: filters.courtStatus,
      matchTier: filters.matchTier,
      specificDate: filters.specificDate,
      spotsAvailable: filters.spotsAvailable,
      specificTime: filters.specificTime,
      favoritePlayerIds,
      userGender,
      limit,
    }),
    queryFn: async ({ pageParam = 0 }) => {
      if (!hasRequiredParams) {
        return { matches: [], nextOffset: null, hasMore: false };
      }

      const result = await getPublicMatches({
        latitude: latitude!,
        longitude: longitude!,
        maxDistanceKm: maxDistanceKm!, // Can be 'all' or a number
        sportId: sportId!,
        facilityId,
        searchQuery: debouncedSearchQuery || undefined,
        format: filters.format,
        matchType: filters.matchType,
        dateRange: filters.dateRange,
        timeOfDay: filters.timeOfDay,
        skillLevel: filters.skillLevel,
        gender: filters.gender,
        cost: filters.cost,
        joinMode: filters.joinMode,
        duration: filters.duration,
        courtStatus: filters.courtStatus,
        matchTier: filters.matchTier,
        specificDate: filters.specificDate,
        spotsAvailable: filters.spotsAvailable,
        specificTime: filters.specificTime,
        userGender,
        limit,
        offset: pageParam as number,
      });

      return {
        matches: result.matches as PublicMatch[],
        nextOffset: result.nextOffset,
        hasMore: result.hasMore,
      };
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && hasRequiredParams,
    staleTime: 1000 * 60 * 2, // 2 minutes - data stays fresh
    refetchOnWindowFocus: false, // Use pull-to-refresh instead
    refetchOnReconnect: true,
  });

  // Flatten all pages into a single array of matches
  const matches = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.matches);
  }, [query.data]);

  // Stable refetch callback for pull-to-refresh
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    /**
     * The flattened list of all public matches across pages
     */
    matches,

    /**
     * Whether the initial load is in progress
     */
    isLoading: query.isLoading,

    /**
     * Whether any fetch is in progress (initial or refetch)
     */
    isFetching: query.isFetching,

    /**
     * Whether a refetch (pull-to-refresh) is in progress
     */
    isRefetching: query.isRefetching,

    /**
     * Whether fetching the next page
     */
    isFetchingNextPage: query.isFetchingNextPage,

    /**
     * Whether there are more pages to fetch
     */
    hasNextPage: query.hasNextPage ?? false,

    /**
     * Fetch the next page of matches
     */
    fetchNextPage: query.fetchNextPage,

    /**
     * Whether the query was successful
     */
    isSuccess: query.isSuccess,

    /**
     * Whether the query failed
     */
    isError: query.isError,

    /**
     * The error if query failed
     */
    error: query.error,

    /**
     * Refetch all pages (for pull-to-refresh)
     */
    refetch: refresh,
  };
}

export default usePublicMatches;

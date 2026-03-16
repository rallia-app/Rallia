/**
 * useNearbyMatches Hook
 * Custom hook for fetching matches at facilities near the user's location.
 * Filters by max travel distance from player preferences.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { getNearbyMatches } from '@rallia/shared-services';
import type { MatchWithDetails } from '@rallia/shared-types';
import { useMemo, useCallback } from 'react';
import { matchKeys } from './useCreateMatch';

/** Default page size for infinite queries */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Match with distance information
 */
export interface NearbyMatch extends MatchWithDetails {
  distance_meters: number | null;
}

/**
 * Page structure for infinite queries
 */
interface NearbyMatchesPage {
  matches: NearbyMatch[];
  nextOffset: number | null;
  hasMore: boolean;
}

/**
 * Options for the useNearbyMatches hook
 */
export interface UseNearbyMatchesOptions {
  /** User's current latitude */
  latitude: number | undefined;
  /** User's current longitude */
  longitude: number | undefined;
  /** Maximum distance in kilometers to search */
  maxDistanceKm: number | undefined;
  /** Sport ID to filter matches by */
  sportId: string | undefined;
  /** The viewing user's gender for eligibility filtering */
  userGender?: string | null;
  /** Maximum number of matches to fetch per page */
  limit?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

/**
 * Hook for fetching matches at facilities within a given distance.
 * Uses PostGIS for efficient distance filtering on the server.
 * Refetches automatically when sportId changes.
 *
 * @example
 * ```tsx
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
 * } = useNearbyMatches({
 *   latitude: location?.latitude,
 *   longitude: location?.longitude,
 *   maxDistanceKm: maxTravelDistanceKm,
 *   sportId: selectedSport?.id,
 *   enabled: !!location && !!selectedSport,
 * });
 * ```
 */
export function useNearbyMatches(options: UseNearbyMatchesOptions) {
  const {
    latitude,
    longitude,
    maxDistanceKm,
    sportId,
    userGender,
    limit = DEFAULT_PAGE_SIZE,
    enabled = true,
  } = options;

  // Only enable query when we have all required params including sportId
  const hasRequiredParams =
    latitude !== undefined &&
    longitude !== undefined &&
    maxDistanceKm !== undefined &&
    sportId !== undefined;

  const query = useInfiniteQuery<NearbyMatchesPage, Error>({
    // Include sportId and userGender in query key to refetch when they change
    queryKey: matchKeys.list('nearby', {
      latitude,
      longitude,
      maxDistanceKm,
      sportId,
      userGender,
      limit,
    }),
    queryFn: async ({ pageParam = 0 }) => {
      if (!hasRequiredParams) {
        return { matches: [], nextOffset: null, hasMore: false };
      }

      const result = await getNearbyMatches({
        latitude: latitude!,
        longitude: longitude!,
        maxDistanceKm: maxDistanceKm!,
        sportId: sportId!,
        userGender,
        limit,
        offset: pageParam as number,
      });

      return {
        matches: result.matches as NearbyMatch[],
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

  // Flatten all pages into a single array of matches, deduplicating by ID
  const matches = useMemo(() => {
    if (!query.data?.pages) return [];
    const seen = new Set<string>();
    return query.data.pages
      .flatMap(page => page.matches)
      .filter(match => {
        if (seen.has(match.id)) return false;
        seen.add(match.id);
        return true;
      });
  }, [query.data]);

  // Stable refetch callback for pull-to-refresh
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    /**
     * The flattened list of all nearby matches across pages
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

export default useNearbyMatches;

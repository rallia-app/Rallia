/**
 * usePlayerMatches Hook
 * Custom hook for fetching matches where the user is a creator or participant.
 * Supports filtering by upcoming/past and pagination.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { getPlayerMatchesWithDetails } from '@rallia/shared-services';
import type { MatchWithDetails, UpcomingMatchFilter, PastMatchFilter } from '@rallia/shared-types';
import { useMemo, useCallback } from 'react';
import { matchKeys } from './useCreateMatch';

/** @deprecated Use UpcomingMatchFilter from @rallia/shared-types */
export type UpcomingStatusFilter = UpcomingMatchFilter;
/** @deprecated Use PastMatchFilter from @rallia/shared-types */
export type PastStatusFilter = PastMatchFilter;

/** Default page size for infinite queries */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Page structure for infinite queries
 */
interface PlayerMatchesPage {
  matches: MatchWithDetails[];
  nextOffset: number | null;
  hasMore: boolean;
}

/**
 * Options for the usePlayerMatches hook
 */
export interface UsePlayerMatchesOptions {
  /** User ID to fetch matches for */
  userId: string | undefined;
  /** Filter by upcoming or past matches */
  timeFilter: 'upcoming' | 'past';
  /** Optional sport ID to filter matches by */
  sportId?: string;
  /** Optional status filter for filtering by participant status, role, or match state */
  statusFilter?: UpcomingStatusFilter | PastStatusFilter;
  /** Maximum number of matches to fetch per page */
  limit?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

/**
 * Hook for fetching matches where the user is a creator or confirmed participant.
 * Supports filtering by upcoming/past and infinite scroll pagination.
 *
 * @example
 * ```tsx
 * const { session } = useAuth();
 *
 * const {
 *   matches,
 *   isLoading,
 *   isFetchingNextPage,
 *   hasNextPage,
 *   fetchNextPage,
 *   refetch,
 * } = usePlayerMatches({
 *   userId: session?.user?.id,
 *   timeFilter: 'upcoming',
 *   limit: 5,
 *   enabled: !!session?.user?.id,
 * });
 * ```
 */
export function usePlayerMatches(options: UsePlayerMatchesOptions) {
  const {
    userId,
    timeFilter,
    sportId,
    statusFilter = 'all',
    limit = DEFAULT_PAGE_SIZE,
    enabled = true,
  } = options;

  // Only enable query when we have userId
  const hasRequiredParams = userId !== undefined;

  const query = useInfiniteQuery<PlayerMatchesPage, Error>({
    // Include timeFilter, sportId, and statusFilter in query key to refetch when they change
    queryKey: matchKeys.list('player', { userId, timeFilter, sportId, statusFilter, limit }),
    queryFn: async ({ pageParam = 0 }) => {
      if (!hasRequiredParams) {
        return { matches: [], nextOffset: null, hasMore: false };
      }

      const result = await getPlayerMatchesWithDetails({
        userId: userId!,
        timeFilter,
        sportId,
        statusFilter,
        limit,
        offset: pageParam as number,
      });

      return {
        matches: result.matches,
        nextOffset: result.nextOffset,
        hasMore: result.hasMore,
      };
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && hasRequiredParams,
    staleTime: 0, // Always refetch in background when query is accessed
    refetchOnWindowFocus: false, // Don't refetch on navigation back (use pull-to-refresh instead)
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
     * The flattened list of all player matches across pages
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

export default usePlayerMatches;

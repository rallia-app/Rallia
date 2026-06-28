/**
 * usePlayerMatchHistory Hook
 * Fetches a player's past games that have a verified score, for the game-history
 * section on another player's profile. Paginated via "show more".
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { getPlayerMatchHistory } from '@rallia/shared-services';
import type { PlayerMatchHistoryItem } from '@rallia/shared-types';
import { useCallback, useMemo } from 'react';

/** Default page size — small, since this is a profile section, not a feed. */
const DEFAULT_PAGE_SIZE = 10;

interface PlayerMatchHistoryPage {
  matches: PlayerMatchHistoryItem[];
  nextOffset: number | null;
  hasMore: boolean;
}

export interface UsePlayerMatchHistoryOptions {
  /** The player whose history to fetch (the profile being viewed). */
  playerId: string | undefined;
  /** Optional sport filter (matches the route's selected sport). */
  sportId?: string;
  /** Page size. */
  limit?: number;
  /** Enable/disable the query. */
  enabled?: boolean;
}

/**
 * Hook for fetching a player's verified-score game history with "show more"
 * pagination.
 */
export function usePlayerMatchHistory(options: UsePlayerMatchHistoryOptions) {
  const { playerId, sportId, limit = DEFAULT_PAGE_SIZE, enabled = true } = options;

  const hasRequiredParams = playerId !== undefined;

  const query = useInfiniteQuery<PlayerMatchHistoryPage, Error>({
    queryKey: ['playerMatchHistory', playerId, sportId, limit],
    queryFn: async ({ pageParam }) => {
      if (playerId === undefined) {
        return { matches: [], nextOffset: null, hasMore: false };
      }
      const result = await getPlayerMatchHistory({
        playerId,
        sportId,
        limit,
        offset: typeof pageParam === 'number' ? pageParam : 0,
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
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const matches = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.matches);
  }, [query.data]);

  const fetchMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  return {
    /** Flattened list of history items across pages. */
    matches,
    /** Initial load in progress. */
    isLoading: query.isLoading,
    /** Query failed. */
    isError: query.isError,
    /** The error, if any. */
    error: query.error,
    /** Whether another page is available. */
    hasMore: query.hasNextPage ?? false,
    /** Whether the next page is currently loading. */
    isFetchingMore: query.isFetchingNextPage,
    /** Load the next page. */
    fetchMore,
    /** Refetch all pages. */
    refetch: query.refetch,
  };
}

export default usePlayerMatchHistory;

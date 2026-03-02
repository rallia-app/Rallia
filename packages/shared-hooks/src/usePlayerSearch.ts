/**
 * usePlayerSearch Hook
 * Custom hook for searching players in a specific sport with TanStack Query.
 * Provides infinite scrolling and debounced search.
 */

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { searchPlayersForSport } from '@rallia/shared-services';
import type { PlayersPage, PlayerSearchResult, PlayerFilters } from '@rallia/shared-services';
import { useDebounce } from './useDebounce';

// Query keys for cache management
export const playerKeys = {
  all: ['players'] as const,
  search: () => [...playerKeys.all, 'search'] as const,
  searchWithParams: (
    sportId: string,
    currentUserId: string,
    query: string,
    filters: PlayerFilters,
    favoritePlayerIds: string[],
    blockedPlayerIds: string[],
    excludePlayerIds: string[],
    latitude?: number,
    longitude?: number
  ) =>
    [
      ...playerKeys.search(),
      sportId,
      currentUserId,
      query,
      JSON.stringify(filters),
      JSON.stringify(favoritePlayerIds),
      JSON.stringify(blockedPlayerIds),
      JSON.stringify(excludePlayerIds),
      latitude ?? null,
      longitude ?? null,
    ] as const,
};

/** Default number of players to load per page */
const DEFAULT_PAGE_SIZE = 10;

interface UsePlayerSearchOptions {
  /** Sport ID to filter players by (required) */
  sportId: string | undefined;
  /** Current user ID to exclude from results */
  currentUserId: string | undefined;
  /** Search query string */
  searchQuery: string;
  /** Player IDs to exclude (e.g., already invited) */
  excludePlayerIds?: string[];
  /** Filters to apply (gender, skill level, availability, etc.) */
  filters?: PlayerFilters;
  /** Favorite player IDs (used when filtering by favorites) */
  favoritePlayerIds?: string[];
  /** Blocked player IDs (used when filtering by blocked or excluding blocked) */
  blockedPlayerIds?: string[];
  /** Number of players to load per page (default: 10) */
  pageSize?: number;
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Enable/disable the query */
  enabled?: boolean;
  /** User's current latitude (for distance calculation) */
  latitude?: number;
  /** User's current longitude (for distance calculation) */
  longitude?: number;
}

interface UsePlayerSearchReturn {
  /** Flattened array of all players from all pages */
  players: PlayerSearchResult[];
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
 * Hook for searching players in a specific sport with infinite scrolling.
 * Only returns players who are active in the specified sport.
 * Includes sport-specific ratings for each player.
 *
 * @example
 * ```tsx
 * const {
 *   players,
 *   isLoading,
 *   hasNextPage,
 *   fetchNextPage,
 * } = usePlayerSearch({
 *   sportId: 'tennis-id',
 *   currentUserId: session.user.id,
 *   searchQuery: 'John',
 * });
 * ```
 */
export function usePlayerSearch(options: UsePlayerSearchOptions): UsePlayerSearchReturn {
  const {
    sportId,
    currentUserId,
    searchQuery,
    excludePlayerIds = [],
    filters = {},
    favoritePlayerIds = [],
    blockedPlayerIds = [],
    pageSize = DEFAULT_PAGE_SIZE,
    debounceMs = 300,
    enabled = true,
    latitude,
    longitude,
  } = options;

  // Debounce the search query
  const debouncedQuery = useDebounce(searchQuery, debounceMs);

  // Check if we have all required params (only sportId is required)
  const hasRequiredParams = !!sportId;

  const query = useInfiniteQuery<PlayersPage, Error>({
    queryKey: playerKeys.searchWithParams(
      sportId ?? '',
      currentUserId ?? '',
      debouncedQuery,
      filters,
      favoritePlayerIds,
      blockedPlayerIds,
      excludePlayerIds,
      latitude,
      longitude
    ),
    queryFn: async ({ pageParam }) => {
      if (!sportId) {
        return { players: [], hasMore: false, nextOffset: null };
      }

      return searchPlayersForSport({
        sportId,
        currentUserId: currentUserId || undefined,
        searchQuery: debouncedQuery || undefined,
        offset: (pageParam as number) ?? 0,
        limit: pageSize,
        excludePlayerIds,
        filters,
        favoritePlayerIds,
        blockedPlayerIds,
        latitude,
        longitude,
      });
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && hasRequiredParams,
    staleTime: 1000 * 60 * 2, // 2 minutes - players don't change often
    refetchOnWindowFocus: false,
  });

  // Flatten pages into a single array of players
  const allPlayers = useMemo(
    () => query.data?.pages.flatMap(page => page.players) ?? [],
    [query.data?.pages]
  );

  return {
    players: allPlayers,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export type { PlayerSearchResult };
export default usePlayerSearch;

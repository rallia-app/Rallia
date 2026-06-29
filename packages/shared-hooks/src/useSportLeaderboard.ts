/**
 * useSportLeaderboard + useMySportRank
 * Infinite-scroll pagination for the monthly GMA per-sport leaderboard, plus the
 * caller's own rank (kept correct regardless of how far the list is paged).
 */

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getSportLeaderboardPage,
  getMySportRank,
  type SportLeaderboardEntry,
  type SportLeaderboardPage,
  type MySportRank,
} from '@rallia/shared-services';

const PAGE_SIZE = 25;

export const sportLeaderboardKeys = {
  all: ['sport_leaderboard'] as const,
  list: (sportId?: string, month?: string) =>
    [...sportLeaderboardKeys.all, 'list', sportId ?? 'none', month ?? 'current'] as const,
  myRank: (sportId?: string, month?: string) =>
    [...sportLeaderboardKeys.all, 'my-rank', sportId ?? 'none', month ?? 'current'] as const,
};

/**
 * Paginated monthly GMA leaderboard for `sportId`. Omit `month` for the current
 * month. Disabled until a sport is selected.
 */
export function useSportLeaderboard(sportId?: string, month?: string) {
  const query = useInfiniteQuery<SportLeaderboardPage, Error>({
    queryKey: sportLeaderboardKeys.list(sportId, month),
    queryFn: ({ pageParam = 0 }) =>
      getSportLeaderboardPage({
        sportId: sportId!,
        month,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: !!sportId,
    staleTime: 2 * 60 * 1000,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: SportLeaderboardEntry[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const entry of page.items) {
        if (seen.has(entry.playerId)) continue;
        seen.add(entry.playerId);
        out.push(entry);
      }
    }
    return out;
  }, [query.data]);

  const fetchNextPage = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage,
    refetch: query.refetch,
  };
}

/**
 * The caller's own rank on the sport's monthly board (null when no games yet).
 */
export function useMySportRank(sportId?: string, month?: string) {
  return useQuery({
    queryKey: sportLeaderboardKeys.myRank(sportId, month),
    queryFn: () => getMySportRank({ sportId: sportId!, month }),
    enabled: !!sportId,
    staleTime: 2 * 60 * 1000,
  });
}

export type { SportLeaderboardEntry, MySportRank };

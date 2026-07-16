/**
 * useTournamentRanking + useMyTournamentRanking
 * Infinite-scroll pagination for the Points-Rallia season board, plus the
 * caller's own standing for the selected sport (kept correct regardless of how
 * far the list is paged).
 */

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  getTournamentRankingPage,
  getMyTournamentRanking,
  type TournamentRankingEntry,
  type TournamentRankingPage,
  type MyTournamentRanking,
  type RankingLevelFilter,
} from '@rallia/shared-services';

const PAGE_SIZE = 25;

export const tournamentRankingKeys = {
  all: ['tournament_ranking'] as const,
  list: (
    sportId?: string,
    seasonCode?: string,
    levelFilter?: RankingLevelFilter,
    ratingScoreFilter?: string
  ) =>
    [
      ...tournamentRankingKeys.all,
      'list',
      sportId ?? 'none',
      seasonCode ?? 'current',
      levelFilter ?? 'all',
      ratingScoreFilter ?? 'all',
    ] as const,
  myRank: (seasonCode?: string) =>
    [...tournamentRankingKeys.all, 'my-rank', seasonCode ?? 'current'] as const,
};

/**
 * Paginated Circuit-Rallia board for `sportId` + season (default current).
 * `levelFilter` narrows to the "my level" (bucket) view; `ratingScoreFilter`
 * to the exact "my rating" view. Disabled until a sport is set.
 */
export function useTournamentRanking(
  sportId?: string,
  seasonCode?: string,
  levelFilter?: RankingLevelFilter,
  ratingScoreFilter?: string
) {
  const query = useInfiniteQuery<TournamentRankingPage, Error>({
    queryKey: tournamentRankingKeys.list(sportId, seasonCode, levelFilter, ratingScoreFilter),
    queryFn: ({ pageParam = 0 }) =>
      getTournamentRankingPage({
        sportId: sportId!,
        seasonCode,
        levelFilter,
        ratingScoreFilter,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: !!sportId,
    staleTime: 2 * 60 * 1000,
    // Keep the previous board on screen while a level-filter/sport switch loads.
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: TournamentRankingEntry[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const entry of page.items) {
        if (seen.has(entry.userId)) continue;
        seen.add(entry.userId);
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
 * The caller's own standing on the common board for `sportId` in the season
 * (null when they have no points there yet).
 */
export function useMyTournamentRanking(sportId?: string, seasonCode?: string) {
  const query = useQuery({
    queryKey: tournamentRankingKeys.myRank(seasonCode),
    queryFn: () => getMyTournamentRanking({ seasonCode }),
    enabled: !!sportId,
    staleTime: 2 * 60 * 1000,
  });

  const mine = useMemo<MyTournamentRanking | null>(
    () => query.data?.find(r => r.sportId === sportId) ?? null,
    [query.data, sportId]
  );

  return { data: mine, isLoading: query.isLoading };
}

export type { TournamentRankingEntry, MyTournamentRanking, RankingLevelFilter };

/**
 * useMatchInviteCandidates Hook
 * Compatibility-ranked invite candidates for a match the caller hosts,
 * backed by the get_match_invite_candidates RPC. Infinite scrolling.
 */

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getMatchInviteCandidates } from '@rallia/shared-services';
import type { InviteCandidate, InviteCandidatesPage } from '@rallia/shared-services';

const DEFAULT_PAGE_SIZE = 20;

export const inviteCandidateKeys = {
  all: ['inviteCandidates'] as const,
  forMatch: (matchId: string, excludeIds: string[]) =>
    [...inviteCandidateKeys.all, matchId, JSON.stringify(excludeIds)] as const,
};

interface UseMatchInviteCandidatesOptions {
  /** Match to rank candidates for (caller must be its host) */
  matchId: string | undefined;
  /** Player IDs to hide client-side (e.g. invited during this session) */
  excludePlayerIds?: string[];
  pageSize?: number;
  enabled?: boolean;
}

interface UseMatchInviteCandidatesReturn {
  candidates: InviteCandidate[];
  totalCount: number | undefined;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => void;
  refetch: () => void;
}

export function useMatchInviteCandidates(
  options: UseMatchInviteCandidatesOptions
): UseMatchInviteCandidatesReturn {
  const { matchId, excludePlayerIds = [], pageSize = DEFAULT_PAGE_SIZE, enabled = true } = options;

  const query = useInfiniteQuery<InviteCandidatesPage, Error>({
    queryKey: inviteCandidateKeys.forMatch(matchId ?? '', excludePlayerIds),
    queryFn: async ({ pageParam }) => {
      if (!matchId) {
        return { players: [], hasMore: false, nextOffset: null, totalCount: 0 };
      }
      return getMatchInviteCandidates({
        matchId,
        limit: pageSize,
        offset: (pageParam as number) ?? 0,
      });
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && !!matchId,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });

  const candidates = useMemo(() => {
    const all = query.data?.pages.flatMap(page => page.players) ?? [];
    if (excludePlayerIds.length === 0) return all;
    const excluded = new Set(excludePlayerIds);
    return all.filter(candidate => !excluded.has(candidate.id));
  }, [query.data?.pages, excludePlayerIds]);

  return {
    candidates,
    totalCount: query.data?.pages[0]?.totalCount,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    error: query.error,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export type { InviteCandidate };
export default useMatchInviteCandidates;

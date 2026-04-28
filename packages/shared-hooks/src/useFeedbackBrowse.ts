/**
 * useFeedbackBrowse + useToggleFeedbackVote
 *
 * Browse-list pagination and vote-toggle mutation for the public feedback
 * sheet. Backed by TanStack Query so the browse list and the detail view
 * share a single source of truth: a vote toggled from either surface
 * updates every cached page in place.
 */

import { useCallback, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  listPublicFeedback,
  removeFeedbackUpvote,
  upvoteFeedback,
  type PublicFeedback,
  type PublicFeedbackCategory,
  type PublicFeedbackPage,
} from '@rallia/shared-services';

const PAGE_SIZE = 25;

/**
 * Query keys for feedback-related cache management.
 */
export const publicFeedbackKeys = {
  all: ['feedback'] as const,
  lists: () => [...publicFeedbackKeys.all, 'list'] as const,
  list: (params: { category: PublicFeedbackCategory; playerId: string; search: string }) =>
    [...publicFeedbackKeys.lists(), params] as const,
};

interface UseFeedbackBrowseOptions {
  category: PublicFeedbackCategory;
  playerId: string | null | undefined;
  /** Caller is expected to debounce upstream. */
  search?: string;
}

interface UseFeedbackBrowseResult {
  items: PublicFeedback[];
  isLoading: boolean;
  isFetching: boolean;
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  isError: boolean;
  error: Error | null;
  fetchNextPage: () => void;
  refresh: () => Promise<void>;
}

export function useFeedbackBrowse({
  category,
  playerId,
  search = '',
}: UseFeedbackBrowseOptions): UseFeedbackBrowseResult {
  const enabled = !!playerId;

  const query = useInfiniteQuery<PublicFeedbackPage, Error>({
    queryKey: publicFeedbackKeys.list({ category, playerId: playerId ?? '', search }),
    queryFn: ({ pageParam = 0 }) =>
      listPublicFeedback({
        category,
        playerId: playerId!,
        search,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  // Flatten + dedupe by id (a vote-driven re-sort across pages can in theory
  // surface the same row twice during a brief window).
  const items = useMemo(() => {
    if (!query.data?.pages) return [];
    const seen = new Set<string>();
    const out: PublicFeedback[] = [];
    for (const page of query.data.pages) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [query.data]);

  const fetchNextPage = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    items,
    isLoading: enabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isError: query.isError,
    error: query.error ?? null,
    fetchNextPage,
    refresh,
  };
}

// =============================================================================
// VOTE TOGGLE MUTATION
// =============================================================================

interface ToggleFeedbackVoteVariables {
  feedbackId: string;
  /** Current vote state — what flipping should produce in the cache. */
  wasVoted: boolean;
  playerId: string;
}

interface ToggleFeedbackVoteContext {
  snapshots: Array<{
    queryKey: readonly unknown[];
    data: InfiniteData<PublicFeedbackPage> | undefined;
  }>;
}

/**
 * Apply a vote toggle to a single feedback row across every cached page of
 * every browse query. Returns a new InfiniteData reference only when the row
 * is found, so React Query subscribers re-render minimally.
 */
function applyVoteToggle(
  data: InfiniteData<PublicFeedbackPage> | undefined,
  feedbackId: string,
  wasVoted: boolean
): InfiniteData<PublicFeedbackPage> | undefined {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map(page => {
    if (!page.items.some(item => item.id === feedbackId)) return page;
    found = true;
    return {
      ...page,
      items: page.items.map(item =>
        item.id === feedbackId
          ? {
              ...item,
              has_voted: !wasVoted,
              upvote_count: Math.max(0, item.upvote_count + (wasVoted ? -1 : 1)),
            }
          : item
      ),
    };
  });
  if (!found) return data;
  return { ...data, pages };
}

/**
 * Optimistically toggle the user's vote on a feedback row. Rolls back on
 * server error. The Postgres trigger on `feedback_vote` keeps the underlying
 * `feedback.upvote_count` in sync, so we deliberately skip a settle-time
 * invalidate to avoid pulling fresh pages on every tap.
 */
export function useToggleFeedbackVote() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ToggleFeedbackVoteVariables, ToggleFeedbackVoteContext>({
    mutationFn: async ({ feedbackId, wasVoted, playerId }) => {
      if (wasVoted) {
        await removeFeedbackUpvote(feedbackId, playerId);
      } else {
        await upvoteFeedback(feedbackId, playerId);
      }
    },
    onMutate: async ({ feedbackId, wasVoted }) => {
      await queryClient.cancelQueries({ queryKey: publicFeedbackKeys.lists() });

      const entries = queryClient.getQueriesData<InfiniteData<PublicFeedbackPage>>({
        queryKey: publicFeedbackKeys.lists(),
      });

      const snapshots: ToggleFeedbackVoteContext['snapshots'] = entries.map(([key, data]) => ({
        queryKey: key,
        data,
      }));

      for (const [key, data] of entries) {
        const next = applyVoteToggle(data, feedbackId, wasVoted);
        if (next !== data) {
          queryClient.setQueryData(key, next);
        }
      }

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const { queryKey, data } of context.snapshots) {
        queryClient.setQueryData(queryKey, data);
      }
    },
  });
}

/**
 * Look up a single feedback row from any cached browse page, falling back to
 * undefined when the id isn't currently materialized. Useful for a detail
 * view that needs to stay in sync with the list.
 */
export function getCachedFeedbackById(
  queryClient: ReturnType<typeof useQueryClient>,
  feedbackId: string
): PublicFeedback | undefined {
  const entries = queryClient.getQueriesData<InfiniteData<PublicFeedbackPage>>({
    queryKey: publicFeedbackKeys.lists(),
  });
  for (const [, data] of entries) {
    if (!data) continue;
    for (const page of data.pages) {
      const hit = page.items.find(item => item.id === feedbackId);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * useFeedbackBrowse
 *
 * Loads paginated public bug/feature reports for the browse-first feedback
 * sheet, and exposes an optimistic toggleVote action.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listPublicFeedback,
  removeFeedbackUpvote,
  upvoteFeedback,
  type PublicFeedback,
  type PublicFeedbackCategory,
} from '@rallia/shared-services';

const PAGE_SIZE = 25;

interface UseFeedbackBrowseOptions {
  category: PublicFeedbackCategory;
  playerId: string | null | undefined;
  search?: string;
}

interface UseFeedbackBrowseResult {
  items: PublicFeedback[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  toggleVote: (feedbackId: string) => Promise<void>;
}

export function useFeedbackBrowse({
  category,
  playerId,
  search,
}: UseFeedbackBrowseOptions): UseFeedbackBrowseResult {
  const [items, setItems] = useState<PublicFeedback[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Guard against stale responses when category/search/playerId change.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (mode: 'refresh' | 'append') => {
      if (!playerId) {
        setItems([]);
        setHasMore(false);
        return;
      }

      const reqId = ++requestIdRef.current;
      if (mode === 'refresh') {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const offset = mode === 'append' ? items.length : 0;
        const page = await listPublicFeedback({
          category,
          playerId,
          search,
          limit: PAGE_SIZE,
          offset,
        });

        if (reqId !== requestIdRef.current) return;

        setItems(prev => (mode === 'append' ? [...prev, ...page] : page));
        setHasMore(page.length === PAGE_SIZE);
      } catch (e) {
        if (reqId !== requestIdRef.current) return;
        setError(e as Error);
      } finally {
        if (reqId === requestIdRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [category, playerId, search, items.length]
  );

  // Refresh on category / search / player change.
  useEffect(() => {
    void load('refresh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, search, playerId]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await load('append');
  }, [hasMore, isLoading, isLoadingMore, load]);

  const toggleVote = useCallback(
    async (feedbackId: string) => {
      if (!playerId) return;

      let reverted = false;
      const target = items.find(i => i.id === feedbackId);
      if (!target) return;

      const wasVoted = target.has_voted;

      // Optimistic update.
      setItems(prev =>
        prev.map(i =>
          i.id === feedbackId
            ? {
                ...i,
                has_voted: !wasVoted,
                upvote_count: Math.max(0, i.upvote_count + (wasVoted ? -1 : 1)),
              }
            : i
        )
      );

      try {
        if (wasVoted) {
          await removeFeedbackUpvote(feedbackId, playerId);
        } else {
          await upvoteFeedback(feedbackId, playerId);
        }
      } catch (e) {
        reverted = true;
        // Roll back on error.
        setItems(prev =>
          prev.map(i =>
            i.id === feedbackId
              ? {
                  ...i,
                  has_voted: wasVoted,
                  upvote_count: Math.max(0, i.upvote_count + (wasVoted ? 1 : -1)),
                }
              : i
          )
        );
        setError(e as Error);
      }

      if (!reverted) {
        // No-op; success path keeps optimistic state.
      }
    },
    [items, playerId]
  );

  return {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    toggleVote,
  };
}

/**
 * useMatchSuggestions Hook
 *
 * Fetches personalized match suggestions for the current player.
 * Reusable across onboarding, home screen, and any other surface.
 */

import { useQuery } from '@tanstack/react-query';
import { getMatchSuggestions } from '@rallia/shared-services';
import type { MatchSuggestion } from '@rallia/shared-services';
import { useCallback } from 'react';

export type { MatchSuggestion } from '@rallia/shared-services';

/** Query key factory for match suggestions */
export const suggestionKeys = {
  all: ['matches', 'suggestions'] as const,
  list: (params: { playerId: string; sportId: string }) => [...suggestionKeys.all, params] as const,
};

export interface UseMatchSuggestionsOptions {
  /** Player ID to fetch suggestions for */
  playerId: string | undefined | null;
  /** Sport ID to filter by */
  sportId: string | undefined | null;
  /** Sport name for external provider search filtering */
  sportName?: string;
  /** Max number of suggestions to return */
  limit?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

export interface UseMatchSuggestionsResult {
  /** List of match suggestions */
  suggestions: MatchSuggestion[];
  /** Whether the initial fetch is loading */
  isLoading: boolean;
  /** Whether a refetch is in progress */
  isRefetching: boolean;
  /** Whether the query has errored */
  isError: boolean;
  /** Error object if query failed */
  error: Error | null;
  /** Manually refetch suggestions */
  refetch: () => Promise<void>;
}

export function useMatchSuggestions(
  options: UseMatchSuggestionsOptions
): UseMatchSuggestionsResult {
  const { playerId, sportId, sportName, limit = 10, enabled = true } = options;

  const queryEnabled = enabled && !!playerId && !!sportId;

  const {
    data,
    isLoading,
    isRefetching,
    isError,
    error,
    refetch: queryRefetch,
  } = useQuery({
    queryKey: suggestionKeys.list({
      playerId: playerId ?? '',
      sportId: sportId ?? '',
    }),
    queryFn: () =>
      getMatchSuggestions({
        playerId: playerId!,
        sportId: sportId!,
        sportName,
        limit,
      }),
    enabled: queryEnabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    suggestions: data ?? [],
    isLoading: queryEnabled ? isLoading : false,
    isRefetching,
    isError,
    error: error as Error | null,
    refetch,
  };
}

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
  list: (
    params:
      | { mode: 'auth'; playerId: string; sportId: string }
      | { mode: 'anon'; lat: number; lng: number; sportId: string; maxDistanceKm: number }
  ) => [...suggestionKeys.all, params] as const,
};

export interface UseMatchSuggestionsOptions {
  /** Player ID to fetch suggestions for. Omit for anon mode (provide lat/lng instead). */
  playerId?: string | undefined | null;
  /** Sport ID to filter by */
  sportId: string | undefined | null;
  /** Sport name for external provider search filtering */
  sportName?: string;
  /** Anon mode: caller latitude */
  latitude?: number | null;
  /** Anon mode: caller longitude */
  longitude?: number | null;
  /** Anon mode: search radius in km (default 25) */
  maxDistanceKm?: number;
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
  const {
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm = 25,
    limit = 10,
    enabled = true,
  } = options;

  const hasAuth = !!playerId;
  const hasAnonInputs = latitude != null && longitude != null;
  const queryEnabled = enabled && !!sportId && (hasAuth || hasAnonInputs);

  // Round lat/lng to ~3 decimals (~110m) to dedupe small movements in the cache key
  const roundedLat = latitude != null ? Math.round(latitude * 1000) / 1000 : 0;
  const roundedLng = longitude != null ? Math.round(longitude * 1000) / 1000 : 0;

  const queryKey = hasAuth
    ? suggestionKeys.list({
        mode: 'auth' as const,
        playerId: playerId!,
        sportId: sportId ?? '',
      })
    : suggestionKeys.list({
        mode: 'anon' as const,
        lat: roundedLat,
        lng: roundedLng,
        sportId: sportId ?? '',
        maxDistanceKm,
      });

  const {
    data,
    isLoading,
    isRefetching,
    isError,
    error,
    refetch: queryRefetch,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      getMatchSuggestions({
        playerId: playerId ?? undefined,
        sportId: sportId!,
        sportName,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        maxDistanceKm,
        limit,
        signal,
      }),
    enabled: queryEnabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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

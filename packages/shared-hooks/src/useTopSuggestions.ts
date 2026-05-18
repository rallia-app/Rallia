/**
 * useTopSuggestions Hook
 *
 * Returns a flat list of up to `maxItems` personalized match suggestions for
 * the current player (or for an anon caller when only lat/lng + sport are
 * known), opponent-deduped globally and sorted by score desc.
 *
 * Use this for surfaces that don't want a per-day grid:
 *   - Suggestion sheet (15)
 *   - Onboarding final step (5)
 *   - Public Matches feed padding
 *   - Daily digest composer padding
 */

import { useQuery } from '@tanstack/react-query';
import { getTopSuggestions } from '@rallia/shared-services';
import type { SlotSuggestion } from '@rallia/shared-services';
import { useCallback } from 'react';

export type { SlotSuggestion } from '@rallia/shared-services';

export const topSuggestionKeys = {
  all: ['matches', 'topSuggestions'] as const,
  list: (
    params:
      | {
          mode: 'auth';
          playerId: string;
          sportId: string;
          maxItems: number;
          lat?: number;
          lng?: number;
        }
      | {
          mode: 'anon';
          lat: number;
          lng: number;
          sportId: string;
          maxDistanceKm: number;
          maxItems: number;
        }
  ) => [...topSuggestionKeys.all, params] as const,
};

export interface UseTopSuggestionsOptions {
  /** Player ID. Omit for anon mode (provide lat/lng instead). */
  playerId?: string | undefined | null;
  sportId: string | undefined | null;
  sportName?: string;
  latitude?: number | null;
  longitude?: number | null;
  maxDistanceKm?: number;
  /** Maximum number of suggestions to return after global opponent dedup. */
  maxItems: number;
  enabled?: boolean;
}

export interface UseTopSuggestionsResult {
  suggestions: SlotSuggestion[];
  isLoading: boolean;
  isRefetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useTopSuggestions(options: UseTopSuggestionsOptions): UseTopSuggestionsResult {
  const {
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm = 25,
    maxItems,
    enabled = true,
  } = options;

  const hasAuth = !!playerId;
  const hasAnonInputs = latitude != null && longitude != null;
  const queryEnabled = enabled && !!sportId && (hasAuth || hasAnonInputs);
  const hasLocationOverride = latitude != null && longitude != null;

  const roundedLat = latitude != null ? Math.round(latitude * 1000) / 1000 : 0;
  const roundedLng = longitude != null ? Math.round(longitude * 1000) / 1000 : 0;

  const queryKey = hasAuth
    ? topSuggestionKeys.list({
        mode: 'auth' as const,
        playerId: playerId!,
        sportId: sportId ?? '',
        maxItems,
        ...(hasLocationOverride ? { lat: roundedLat, lng: roundedLng } : {}),
      })
    : topSuggestionKeys.list({
        mode: 'anon' as const,
        lat: roundedLat,
        lng: roundedLng,
        sportId: sportId ?? '',
        maxDistanceKm,
        maxItems,
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
      getTopSuggestions({
        playerId: playerId ?? undefined,
        sportId: sportId!,
        sportName,
        latitude: hasLocationOverride ? (latitude ?? undefined) : undefined,
        longitude: hasLocationOverride ? (longitude ?? undefined) : undefined,
        maxDistanceKm,
        maxItems,
        signal,
      }),
    enabled: queryEnabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
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

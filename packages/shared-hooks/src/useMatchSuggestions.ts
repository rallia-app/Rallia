/**
 * useMatchSuggestions Hook
 *
 * Returns the 7-day grid of personalized match suggestions for the current
 * player (or for an anon caller when only lat/lng + sport are known).
 */

import { useQuery } from '@tanstack/react-query';
import { getMatchSuggestions } from '@rallia/shared-services';
import type { DaySuggestions } from '@rallia/shared-services';
import { useCallback } from 'react';

export type { DaySuggestions, SlotSuggestion } from '@rallia/shared-services';

export const suggestionKeys = {
  all: ['matches', 'suggestions'] as const,
  list: (
    params:
      | { mode: 'auth'; playerId: string; sportId: string; lat?: number; lng?: number }
      | { mode: 'anon'; lat: number; lng: number; sportId: string; maxDistanceKm: number }
  ) => [...suggestionKeys.all, params] as const,
};

export interface UseMatchSuggestionsOptions {
  /** Player ID. Omit for anon mode (provide lat/lng instead). */
  playerId?: string | undefined | null;
  sportId: string | undefined | null;
  sportName?: string;
  latitude?: number | null;
  longitude?: number | null;
  maxDistanceKm?: number;
  enabled?: boolean;
}

export interface UseMatchSuggestionsResult {
  /** Always 7 entries (one per upcoming day, oldest first). May contain empty days. */
  days: DaySuggestions[];
  isLoading: boolean;
  isRefetching: boolean;
  isError: boolean;
  error: Error | null;
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
    enabled = true,
  } = options;

  const hasAuth = !!playerId;
  const hasAnonInputs = latitude != null && longitude != null;
  const queryEnabled = enabled && !!sportId && (hasAuth || hasAnonInputs);
  const hasLocationOverride = latitude != null && longitude != null;

  const roundedLat = latitude != null ? Math.round(latitude * 1000) / 1000 : 0;
  const roundedLng = longitude != null ? Math.round(longitude * 1000) / 1000 : 0;

  const queryKey = hasAuth
    ? suggestionKeys.list({
        mode: 'auth' as const,
        playerId: playerId!,
        sportId: sportId ?? '',
        ...(hasLocationOverride ? { lat: roundedLat, lng: roundedLng } : {}),
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
        latitude: hasLocationOverride ? (latitude ?? undefined) : undefined,
        longitude: hasLocationOverride ? (longitude ?? undefined) : undefined,
        maxDistanceKm,
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
    days: data ?? [],
    isLoading: queryEnabled ? isLoading : false,
    isRefetching,
    isError,
    error: error as Error | null,
    refetch,
  };
}

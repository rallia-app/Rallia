/**
 * useJustForYou Hook
 *
 * TanStack wrapper around `composeJustForYou` from `@rallia/shared-services`.
 * Returns the same `{matches, suggestions}` shape, plus standard query state.
 */

import { useQuery } from '@tanstack/react-query';
import { composeJustForYou } from '@rallia/shared-services';
import type {
  Scorable,
  MatchScoringPreferences,
  SlotSuggestion,
  JustForYouItem,
} from '@rallia/shared-services';
import { useCallback } from 'react';

export const justForYouKeys = {
  all: ['matches', 'justForYou'] as const,
  list: (params: {
    playerId: string;
    sportId: string;
    lat: number;
    lng: number;
    maxDistanceKm: number;
    matchLimit: number;
    /** Stable hash of scoring prefs so cache invalidates when prefs change. */
    prefsHash: string;
  }) => [...justForYouKeys.all, params] as const,
};

export interface UseJustForYouOptions {
  playerId: string | undefined | null;
  sportId: string | undefined | null;
  sportName?: string;
  latitude: number | undefined;
  longitude: number | undefined;
  maxDistanceKm: number | undefined;
  userGender?: string | null;
  scoringPreferences: MatchScoringPreferences;
  excludeUserIds?: string[];
  matchLimit?: number;
  enabled?: boolean;
}

export interface UseJustForYouResult {
  /** Ordered (score-desc) merged feed — the canonical output of the composer. */
  items: JustForYouItem[];
  /** Matches that made it into `items`. Kept for analytics / dismiss state. */
  matches: Scorable[];
  /** Suggestions that made it into `items`. Kept for analytics / dismiss state. */
  suggestions: SlotSuggestion[];
  isLoading: boolean;
  isRefetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/** Stable string hash of the scoring prefs (cheap, just for cache keying). */
function hashPrefs(p: MatchScoringPreferences): string {
  return [
    p.playerGender ?? '',
    p.playerRatingValue ?? '',
    p.preferredMatchDuration ?? '',
    p.preferredMatchType ?? '',
    (p.favoriteFacilityIds ?? []).slice().sort().join(','),
    p.maxTravelDistanceKm ?? '',
  ].join('|');
}

export function useJustForYou(options: UseJustForYouOptions): UseJustForYouResult {
  const {
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm,
    userGender,
    scoringPreferences,
    excludeUserIds,
    matchLimit = 5,
    enabled = true,
  } = options;

  // Anon callers can use this hook too — composer runs without playerId.
  // Required for both modes: sportId + lat/lng + maxDistanceKm.
  const hasRequired =
    !!sportId && latitude !== undefined && longitude !== undefined && maxDistanceKm !== undefined;

  const queryEnabled = enabled && hasRequired;
  const prefsHash = hashPrefs(scoringPreferences);

  const queryKey = justForYouKeys.list({
    playerId: playerId ?? '',
    sportId: sportId ?? '',
    lat: Math.round((latitude ?? 0) * 1000) / 1000,
    lng: Math.round((longitude ?? 0) * 1000) / 1000,
    maxDistanceKm: maxDistanceKm ?? 0,
    matchLimit,
    prefsHash,
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
      composeJustForYou({
        playerId: playerId ?? undefined,
        sportId: sportId!,
        sportName,
        latitude: latitude!,
        longitude: longitude!,
        maxDistanceKm: maxDistanceKm!,
        userGender,
        scoringPreferences,
        excludeUserIds,
        matchLimit,
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
    items: data?.items ?? [],
    matches: data?.matches ?? [],
    suggestions: data?.suggestions ?? [],
    isLoading: queryEnabled ? isLoading : false,
    isRefetching,
    isError,
    error: error as Error | null,
    refetch,
  };
}

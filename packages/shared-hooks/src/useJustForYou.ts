/**
 * useJustForYou Hook
 *
 * TanStack wrapper around `getJustForYou` from `@rallia/shared-services` — a
 * single-round-trip RPC that owns scoring + slot expansion + cross-pool dedup
 * server-side. Anon callers fall through to the legacy `composeJustForYou`
 * orchestration inside the service wrapper, so the hook API is identical
 * across both paths.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { getJustForYou } from '@rallia/shared-services';
import type {
  Scorable,
  MatchScoringPreferences,
  SlotSuggestion,
  JustForYouItem,
  ComposeJustForYouResult,
} from '@rallia/shared-services';
import { useCallback } from 'react';

/**
 * TEMP: Home "Just for you" fetches matches only while suggestion RPC perf
 * is investigated. Flip to true to restore padded suggestions.
 */
export const JUST_FOR_YOU_INCLUDE_SUGGESTIONS = false;

export const justForYouKeys = {
  all: ['matches', 'justForYou'] as const,
  list: (params: {
    playerId: string;
    sportId: string;
    lat: number;
    lng: number;
    maxDistanceKm: number;
    matchLimit: number;
    includeSuggestions: boolean;
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
  /** When false, skip suggestion fetch (matches-only). Defaults to {@link JUST_FOR_YOU_INCLUDE_SUGGESTIONS}. */
  includeSuggestions?: boolean;
  enabled?: boolean;
}

/** Coordinate rounding precision (~110m). Centralized so prefetch + hook share. */
function roundCoord(value: number | undefined): number {
  return Math.round((value ?? 0) * 1000) / 1000;
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

/**
 * Build the React Query options for the "Just for you" carousel. Shared
 * between {@link useJustForYou} (which spreads it into `useQuery`) and the
 * mobile app's splash-time prefetch component (which spreads it into
 * `queryClient.prefetchQuery`), so the query key + queryFn cannot drift
 * between the two call sites.
 *
 * Returns a `queryKey` even when inputs are incomplete (so the prefetch can
 * still check cache state without crashing). `enabled` reflects the gate.
 */
export function justForYouQueryOptions(
  options: UseJustForYouOptions
): UseQueryOptions<
  ComposeJustForYouResult,
  Error,
  ComposeJustForYouResult,
  ReturnType<typeof justForYouKeys.list>
> {
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
    includeSuggestions = JUST_FOR_YOU_INCLUDE_SUGGESTIONS,
    enabled = true,
  } = options;

  // Anon callers can use this hook too — composer runs without playerId.
  // Required for both modes: sportId + lat/lng + maxDistanceKm.
  const hasRequired =
    !!sportId && latitude !== undefined && longitude !== undefined && maxDistanceKm !== undefined;

  const prefsHash = hashPrefs(scoringPreferences);

  const queryKey = justForYouKeys.list({
    playerId: playerId ?? '',
    sportId: sportId ?? '',
    lat: roundCoord(latitude),
    lng: roundCoord(longitude),
    maxDistanceKm: maxDistanceKm ?? 0,
    matchLimit,
    includeSuggestions,
    prefsHash,
  });

  return {
    queryKey,
    queryFn: ({ signal }) =>
      getJustForYou({
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
        includeSuggestions,
        signal,
      }),
    enabled: enabled && hasRequired,
    // The RPC scores the full opponent + match pool against the caller and is
    // the most expensive query on Home. The carousel's value doesn't decay
    // minute-to-minute — bumping staleTime keeps cold reopens within a 10-min
    // window instant, and pull-to-refresh still lets the user force a fetch.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Override the global `refetchOnMount: 'always'` so the bumped staleTime
    // is actually honored on Home remount (back-nav, splash transitions) and
    // on cold-start hydration from the AsyncStorage persister.
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  };
}

export function useJustForYou(options: UseJustForYouOptions): UseJustForYouResult {
  const queryOptions = justForYouQueryOptions(options);
  const {
    data,
    isLoading,
    isRefetching,
    isError,
    error,
    refetch: queryRefetch,
  } = useQuery(queryOptions);

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    items: data?.items ?? [],
    matches: data?.matches ?? [],
    suggestions: data?.suggestions ?? [],
    isLoading: queryOptions.enabled ? isLoading : false,
    isRefetching,
    isError,
    error: error as Error | null,
    refetch,
  };
}

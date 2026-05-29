import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@rallia/shared-services';
import type { Sport } from './useSports';
import { getStorageAdapter } from './storage';

// TEMP perf instrumentation (REMOVE after diagnosis). Shared global clock so
// deltas are continuous across files. Grep `[perf⏱]` to remove.
function perfLog(label: string, extra?: Record<string, unknown>) {
  const g = globalThis as unknown as { __ralliaPerfLast?: number };
  const now = Date.now();
  const since = g.__ralliaPerfLast ? now - g.__ralliaPerfLast : 0;
  g.__ralliaPerfLast = now;
  // eslint-disable-next-line no-console
  console.log(
    `[perf⏱] ${new Date(now).toISOString().slice(11, 23)} +${String(since).padStart(6)}ms  ${label}`,
    extra ?? ''
  );
}

/** Storage key for guest-selected sports (must match SportContext) */
const GUEST_SPORTS_STORAGE_KEY = '@rallia/guest-selected-sports';

/** Stable empty reference so consumers' memos don't churn before data loads. */
const EMPTY_PLAYER_SPORTS: PlayerSport[] = [];

/**
 * Guest sport format stored by SportSelectionScreen
 */
interface GuestSport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

/**
 * Player sport data with nested sport information
 */
export interface PlayerSport {
  player_id: string;
  sport_id: string;
  is_primary: boolean;
  is_active: boolean;
  preferred_match_duration?: string;
  preferred_match_type?: string;
  preferred_facility_id?: string | null;
  sport?: Sport | Sport[];
}

/** Query key factory — exported so callers can invalidate after mutations. */
export const playerSportsKeys = {
  all: ['playerSports'] as const,
  byPlayer: (playerId: string) => ['playerSports', playerId] as const,
};

/**
 * Load guest-selected sports from storage and transform to PlayerSport format.
 * Used as a fallback when an authenticated user has no player_sport records yet.
 */
async function loadGuestSportsAsFallback(currentPlayerId: string): Promise<PlayerSport[]> {
  try {
    const storage = getStorageAdapter();
    const savedSportsJson = await storage.getItem(GUEST_SPORTS_STORAGE_KEY);
    if (!savedSportsJson) return [];

    const guestSports: GuestSport[] = JSON.parse(savedSportsJson);
    if (!guestSports || guestSports.length === 0) return [];

    return guestSports.map((guestSport, index) => ({
      player_id: currentPlayerId,
      sport_id: guestSport.id,
      is_primary: index === 0, // First selected sport is primary
      is_active: true,
      sport: {
        id: guestSport.id,
        name: guestSport.name,
        display_name: guestSport.display_name,
        icon_url: guestSport.icon_url ?? null,
        is_active: true,
      },
    }));
  } catch (parseError) {
    console.error('Failed to parse guest sports fallback:', parseError);
    return [];
  }
}

/** Single source of truth for the player_sport fetch (shared by every caller). */
async function fetchPlayerSportsData(playerId: string): Promise<PlayerSport[]> {
  const __t0 = Date.now();
  perfLog('usePlayerSports fetch START (shared)', { playerId });

  const { data, error } = await supabase
    .from('player_sport')
    .select(
      `
      player_id,
      sport_id,
      is_primary,
      is_active,
      preferred_match_duration,
      preferred_match_type,
      preferred_facility_id,
      sport:sport_id (
        id,
        name,
        display_name,
        icon_url,
        is_active
      )
    `
    )
    .eq('player_id', playerId);

  perfLog('usePlayerSports fetch DONE (shared)', {
    ms: Date.now() - __t0,
    rows: data?.length ?? 0,
    err: error?.message,
  });

  if (error) {
    throw new Error(error.message);
  }

  // Authenticated user with no player sports yet — fall back to guest selection.
  if (!data || data.length === 0) {
    const guestSports = await loadGuestSportsAsFallback(playerId);
    if (guestSports.length > 0) return guestSports;
  }

  return (data as PlayerSport[]) || [];
}

/**
 * Custom hook for fetching a player's sports with sport details.
 *
 * Backed by React Query so the many concurrent call sites (Home, SportContext,
 * JustForYouPrefetch, useSuggestionInviteHandler, AppHeader, …) share a single
 * cached request keyed by playerId instead of each firing its own `player_sport`
 * fetch. React Query collapses concurrent same-key requests into one in-flight
 * fetch, and `staleTime` prevents refetch churn across the sign-in/mount burst.
 *
 * Return shape is unchanged from the previous hand-rolled hook, so call sites
 * need no changes.
 *
 * @param playerId - The player ID to fetch sports for. Pass user?.id from auth.
 *
 * @example
 * ```tsx
 * const { playerSports, loading, error, refetch } = usePlayerSports(user?.id);
 * ```
 */
export const usePlayerSports = (playerId: string | undefined) => {
  const {
    data,
    isLoading,
    error,
    refetch: rqRefetch,
  } = useQuery({
    queryKey: ['playerSports', playerId ?? null],
    queryFn: () => fetchPlayerSportsData(playerId as string),
    enabled: !!playerId,
    // Sports change rarely; keep the burst of mounts on one cached result and
    // avoid refetch-on-mount storms during cold start / sign-in.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const refetch = useCallback(async () => {
    await rqRefetch();
  }, [rqRefetch]);

  return {
    playerSports: data ?? EMPTY_PLAYER_SPORTS,
    // A disabled (anon) query reports isLoading=false; gate on playerId so the
    // anon path doesn't render a perpetual spinner.
    loading: !!playerId && isLoading,
    error: (error as Error) ?? null,
    refetch,
  };
};

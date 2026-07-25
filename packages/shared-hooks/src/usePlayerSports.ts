import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@rallia/shared-services';
import type { Sport } from './useSports';
import { getStorageAdapter } from './storage';

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
  /** The player_rating_score the player has marked active for this sport (null = none chosen). */
  active_rating_score_id?: string | null;
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
 * The subset of a sport that selection UI needs. Structurally what both platforms'
 * sport contexts already build by hand.
 */
export interface ActiveSport {
  id: string;
  name: string;
  display_name: string;
  icon_url?: string | null;
}

/**
 * Flattens player_sport rows into the sports a player can actually switch between.
 *
 * Keeps a row only when both the membership and the sport itself are active — a
 * retired sport must not linger in the switcher just because the player once
 * registered for it. `sport` arrives as an object or a single-element array
 * depending on how the caller shaped the embed, so both are handled.
 *
 * Pure and platform-agnostic on purpose: the mobile SportContext and the web
 * sport provider both derive their list from this, so the two cannot drift.
 */
export function deriveActiveSports(playerSports: PlayerSport[] | null | undefined): {
  userSports: ActiveSport[];
  primarySport: ActiveSport | null;
} {
  if (!playerSports || playerSports.length === 0) {
    return { userSports: [], primarySport: null };
  }

  const userSports: ActiveSport[] = [];
  let primarySport: ActiveSport | null = null;

  for (const playerSport of playerSports) {
    const sportData = Array.isArray(playerSport.sport) ? playerSport.sport[0] : playerSport.sport;

    if (
      !sportData ||
      typeof sportData !== 'object' ||
      playerSport.is_active !== true ||
      sportData.is_active !== true
    ) {
      continue;
    }

    const sport: ActiveSport = {
      id: sportData.id,
      name: sportData.name,
      display_name: sportData.display_name,
      icon_url: sportData.icon_url,
    };
    userSports.push(sport);

    if (playerSport.is_primary) {
      primarySport = sport;
    }
  }

  return { userSports, primarySport };
}

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
  const { data, error } = await supabase
    .from('player_sport')
    .select(
      `
      player_id,
      sport_id,
      is_primary,
      is_active,
      active_rating_score_id,
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

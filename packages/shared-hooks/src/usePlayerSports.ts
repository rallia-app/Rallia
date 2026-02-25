import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@rallia/shared-services';
import type { Sport } from './useSports';
import { getStorageAdapter } from './storage';

/** Storage key for guest-selected sports (must match SportContext) */
const GUEST_SPORTS_STORAGE_KEY = '@rallia/guest-selected-sports';

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
  sport?: Sport | Sport[];
}

/**
 * Custom hook for fetching player's sports with sport details
 * Eliminates duplicate player sports fetching code across components
 *
 * @param playerId - The player ID to fetch sports for. Pass user?.id from your auth context.
 * @returns Object containing player sports array, loading state, error, and refetch function
 *
 * @example
 * ```tsx
 * const { user } = useAuth();
 * const { playerSports, loading, error, refetch } = usePlayerSports(user?.id);
 *
 * if (loading) return <Spinner />;
 * if (error) return <ErrorMessage message={error.message} />;
 *
 * return playerSports.map(ps => {
 *   const sport = Array.isArray(ps.sport) ? ps.sport[0] : ps.sport;
 *   return <Text key={ps.sport_id}>{sport?.display_name}</Text>;
 * });
 * ```
 */
export const usePlayerSports = (playerId: string | undefined) => {
  const [playerSports, setPlayerSports] = useState<PlayerSport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPlayerSports = useCallback(async () => {
    // No playerId means not authenticated - return empty
    if (!playerId) {
      setPlayerSports([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch player's sports with sport details
      const { data, error: sportsError } = await supabase
        .from('player_sport')
        .select(
          `
          player_id,
          sport_id,
          is_primary,
          is_active,
          preferred_match_duration,
          preferred_match_type,
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

      if (sportsError) {
        throw new Error(sportsError.message);
      }

      // If authenticated user has no player sports, check for guest-selected sports
      if (!data || data.length === 0) {
        const guestSports = await loadGuestSportsAsFallback(playerId);
        if (guestSports.length > 0) {
          setPlayerSports(guestSports);
          return;
        }
      }

      setPlayerSports(data || []);
    } catch (err) {
      console.error('Error fetching player sports:', err);
      setError(err as Error);
      setPlayerSports([]);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  /**
   * Load guest-selected sports from storage and transform to PlayerSport format.
   * This is used as a fallback when an authenticated user has no player sport records.
   */
  const loadGuestSportsAsFallback = async (currentPlayerId: string): Promise<PlayerSport[]> => {
    try {
      const storage = getStorageAdapter();
      const savedSportsJson = await storage.getItem(GUEST_SPORTS_STORAGE_KEY);
      if (!savedSportsJson) return [];

      const guestSports: GuestSport[] = JSON.parse(savedSportsJson);
      if (!guestSports || guestSports.length === 0) return [];

      // Transform guest sports to PlayerSport format
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
  };

  // Fetch when playerId changes
  useEffect(() => {
    fetchPlayerSports();
  }, [fetchPlayerSports]);

  return {
    playerSports,
    loading,
    error,
    refetch: fetchPlayerSports,
  };
};

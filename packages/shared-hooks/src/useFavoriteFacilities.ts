/**
 * Hook for managing player's favorite facilities
 * Fetches, adds, and removes favorites from the player_favorite_facility table
 */
import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, Logger, isRealSportId } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { facilityKeys } from './useFacilitySearch';

/** Minimum favorites a player must keep per sport. Exported so screens that
 *  expose an unfavorite affordance can render consistent messaging. */
export const MIN_FAVORITE_FACILITIES = 3;

export interface FavoriteFacility {
  id: string;
  facilityId: string;
  sportId: string;
  facility: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    /** IANA zone. Callers stamping a game's wall-clock need the COURT's zone. */
    timezone: string | null;
  };
  displayOrder: number;
}

interface UseFavoriteFacilitiesResult {
  /** Array of favorite facilities ordered by display_order */
  favorites: FavoriteFacility[];
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Add a facility to favorites */
  addFavorite: (facility: FacilitySearchResult) => Promise<boolean>;
  /** Remove a facility from favorites */
  removeFavorite: (facilityId: string) => Promise<boolean>;
  /** Check if a facility is a favorite */
  isFavorite: (facilityId: string) => boolean;
  /** Number of favorites */
  count: number;
  /** Whether minimum favorites requirement is met */
  hasMinimum: boolean;
  /** True when removing one more favorite would still satisfy the per-sport
   *  minimum. Callers should gate their unfavorite affordance on this. */
  canRemoveFavorite: boolean;
  /** @deprecated Use hasMinimum instead */
  isMaxReached: boolean;
  /** Refetch favorites */
  refetch: () => Promise<void>;
}

/**
 * Fetches and manages player's favorite facilities
 * @param playerId - The player's UUID (required)
 * @param sportId - Optional sport UUID to filter favorites to only facilities linked to this sport
 */
export function useFavoriteFacilities(
  playerId: string | null,
  sportId?: string | null
): UseFavoriteFacilitiesResult {
  const [favorites, setFavorites] = useState<FavoriteFacility[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

  const fetchFavorites = useCallback(async () => {
    if (!playerId) {
      setFavorites([]);
      return;
    }

    // A synthetic sport id (or any non-uuid) can't match a row and would make
    // Postgres reject the whole query. Treat it as "no favorites yet".
    if (!isRealSportId(playerId) || (sportId != null && !isRealSportId(sportId))) {
      setFavorites([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('player_favorite_facility')
        .select(
          `
          id,
          facility_id,
          sport_id,
          display_order,
          facility:facility_id (
            id,
            name,
            address,
            city,
            latitude,
            longitude,
            timezone
          )
        `
        )
        .eq('player_id', playerId)
        .order('display_order', { ascending: true });

      // Filter by sport at the DB level
      if (sportId) {
        query = query.eq('sport_id', sportId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const mappedFavorites: FavoriteFacility[] = (data || []).map(
        (item: {
          id: string;
          facility_id: string;
          sport_id: string;
          display_order: number;
          facility: unknown;
        }) => {
          const facilityData = item.facility as FavoriteFacility['facility'];
          return {
            id: item.id,
            facilityId: item.facility_id,
            sportId: item.sport_id,
            facility: facilityData,
            displayOrder: item.display_order,
          };
        }
      );

      setFavorites(mappedFavorites);
    } catch (err) {
      Logger.error('Failed to fetch favorite facilities', err as Error, { playerId });
      setError(err instanceof Error ? err : new Error('Failed to fetch favorites'));
    } finally {
      setLoading(false);
    }
  }, [playerId, sportId]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const addFavorite = useCallback(
    async (facility: FacilitySearchResult): Promise<boolean> => {
      if (!playerId || !sportId) return false;
      if (!isRealSportId(playerId) || !isRealSportId(sportId)) return false;
      if (favorites.some(f => f.facilityId === facility.id)) return false;

      try {
        const nextDisplayOrder = favorites.length + 1;

        const { data, error: insertError } = await supabase
          .from('player_favorite_facility')
          .insert({
            player_id: playerId,
            facility_id: facility.id,
            sport_id: sportId,
            display_order: nextDisplayOrder,
          })
          .select(
            `
          id,
          facility_id,
          sport_id,
          display_order,
          facility:facility_id (
            id,
            name,
            address,
            city,
            latitude,
            longitude
          )
        `
          )
          .single();

        if (insertError) throw insertError;

        const facilityData = data.facility as unknown as FavoriteFacility['facility'];
        const newFavorite: FavoriteFacility = {
          id: data.id,
          facilityId: data.facility_id,
          sportId: data.sport_id,
          facility: facilityData,
          displayOrder: data.display_order,
        };

        setFavorites(prev => [...prev, newFavorite]);
        // Refresh any in-flight facility list so the RPC-computed
        // `is_favorite` flag matches what we just wrote.
        queryClient.invalidateQueries({ queryKey: facilityKeys.search() });
        return true;
      } catch (err) {
        Logger.error('Failed to add favorite facility', err as Error, {
          playerId,
          facilityId: facility.id,
        });
        return false;
      }
    },
    [playerId, favorites, sportId, queryClient]
  );

  const removeFavorite = useCallback(
    async (facilityId: string): Promise<boolean> => {
      if (!playerId) return false;

      const favoriteToRemove = favorites.find(f => f.facilityId === facilityId);
      if (!favoriteToRemove) return false;

      // Enforce per-sport minimum at the data layer so every entry point
      // (FacilitiesDirectory, FacilityDetail, Map, …) is protected uniformly.
      if (favorites.length <= MIN_FAVORITE_FACILITIES) return false;

      try {
        // Delete the favorite
        const { error: deleteError } = await supabase
          .from('player_favorite_facility')
          .delete()
          .eq('id', favoriteToRemove.id);

        if (deleteError) throw deleteError;

        // Update local state and reorder display_order
        const remainingFavorites = favorites
          .filter(f => f.facilityId !== facilityId)
          .map((f, index) => ({ ...f, displayOrder: index + 1 }));

        // Update display_order in database
        for (const fav of remainingFavorites) {
          if (fav.displayOrder !== favorites.find(f => f.id === fav.id)?.displayOrder) {
            await supabase
              .from('player_favorite_facility')
              .update({ display_order: fav.displayOrder })
              .eq('id', fav.id);
          }
        }

        setFavorites(remainingFavorites);
        queryClient.invalidateQueries({ queryKey: facilityKeys.search() });
        return true;
      } catch (err) {
        Logger.error('Failed to remove favorite facility', err as Error, { playerId, facilityId });
        return false;
      }
    },
    [playerId, favorites, queryClient]
  );

  const isFavorite = useCallback(
    (facilityId: string): boolean => {
      return favorites.some(f => f.facilityId === facilityId);
    },
    [favorites]
  );

  return {
    favorites,
    loading,
    error,
    addFavorite,
    removeFavorite,
    isFavorite,
    count: favorites.length,
    hasMinimum: favorites.length >= MIN_FAVORITE_FACILITIES,
    canRemoveFavorite: favorites.length > MIN_FAVORITE_FACILITIES,
    isMaxReached: false,
    refetch: fetchFavorites,
  };
}

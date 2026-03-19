/**
 * Hook for managing player's favorite facilities
 * Fetches, adds, and removes favorites from the player_favorite_facility table
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, Logger } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

const MAX_FAVORITES = 3;

export interface FavoriteFacility {
  id: string;
  facilityId: string;
  facility: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
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
  /** Add a facility to favorites (max 3) */
  addFavorite: (facility: FacilitySearchResult) => Promise<boolean>;
  /** Remove a facility from favorites */
  removeFavorite: (facilityId: string) => Promise<boolean>;
  /** Check if a facility is a favorite */
  isFavorite: (facilityId: string) => boolean;
  /** Number of favorites */
  count: number;
  /** Whether max favorites is reached */
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

  const fetchFavorites = useCallback(async () => {
    if (!playerId) {
      setFavorites([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Always include facility_sport so we can filter by sport when needed.
      // PostgREST uses a LEFT JOIN by default, so facility_sport is [] for
      // facilities not linked to any sport — no rows are lost.
      const { data, error: fetchError } = await supabase
        .from('player_favorite_facility')
        .select(
          `
          id,
          facility_id,
          display_order,
          facility:facility_id (
            id,
            name,
            address,
            city,
            latitude,
            longitude,
            facility_sport (
              sport_id
            )
          )
        `
        )
        .eq('player_id', playerId)
        .order('display_order', { ascending: true });

      if (fetchError) throw fetchError;

      // Filter by sport if sportId provided — only show facilities linked to this sport
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filteredData: any[] = data || [];
      if (sportId) {
        filteredData = filteredData.filter(item => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const facilitySports = (item.facility as { facility_sport?: Array<{ sport_id: string }> })
            ?.facility_sport;
          return (
            Array.isArray(facilitySports) && facilitySports.some(fs => fs.sport_id === sportId)
          );
        });
      }

      const mappedFavorites: FavoriteFacility[] = filteredData.map(
        (item: { id: string; facility_id: string; display_order: number; facility: unknown }) => {
          // Supabase returns the joined relation as an object (single) when using FK reference
          const facilityData = item.facility as FavoriteFacility['facility'];
          return {
            id: item.id,
            facilityId: item.facility_id,
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
      if (!playerId) return false;
      if (favorites.length >= MAX_FAVORITES) return false;
      if (favorites.some(f => f.facilityId === facility.id)) return false;

      try {
        // Calculate next display_order — when sport-filtered, query global max
        // to avoid display_order conflicts with other sports' favorites
        let nextDisplayOrder: number;
        if (sportId) {
          const { data: maxOrderData } = await supabase
            .from('player_favorite_facility')
            .select('display_order')
            .eq('player_id', playerId)
            .order('display_order', { ascending: false })
            .limit(1);
          nextDisplayOrder =
            ((maxOrderData?.[0] as { display_order?: number } | undefined)?.display_order || 0) + 1;
        } else {
          nextDisplayOrder = favorites.length + 1;
        }

        const { data, error: insertError } = await supabase
          .from('player_favorite_facility')
          .insert({
            player_id: playerId,
            facility_id: facility.id,
            display_order: nextDisplayOrder,
          })
          .select(
            `
          id,
          facility_id,
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

        // Supabase returns the joined relation as an object (single) when using FK reference
        const facilityData = data.facility as unknown as FavoriteFacility['facility'];
        const newFavorite: FavoriteFacility = {
          id: data.id,
          facilityId: data.facility_id,
          facility: facilityData,
          displayOrder: data.display_order,
        };

        setFavorites(prev => [...prev, newFavorite]);
        return true;
      } catch (err) {
        Logger.error('Failed to add favorite facility', err as Error, {
          playerId,
          facilityId: facility.id,
        });
        return false;
      }
    },
    [playerId, favorites, sportId]
  );

  const removeFavorite = useCallback(
    async (facilityId: string): Promise<boolean> => {
      if (!playerId) return false;

      const favoriteToRemove = favorites.find(f => f.facilityId === facilityId);
      if (!favoriteToRemove) return false;

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
        return true;
      } catch (err) {
        Logger.error('Failed to remove favorite facility', err as Error, { playerId, facilityId });
        return false;
      }
    },
    [playerId, favorites]
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
    isMaxReached: favorites.length >= MAX_FAVORITES,
    refetch: fetchFavorites,
  };
}

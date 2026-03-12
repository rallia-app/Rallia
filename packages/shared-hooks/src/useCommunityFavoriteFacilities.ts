/**
 * Hook for managing community/network's favorite facilities
 * Fetches, adds, and removes favorites from the network_favorite_facility table
 * Only moderators/owners can modify favorites
 * Unlike player favorites, communities have no limit on favorite facilities
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, Logger } from '@rallia/shared-services';
import type { FacilitySearchResult } from '@rallia/shared-types';

export interface CommunityFavoriteFacility {
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
  /** Distance in meters from user's location (calculated client-side) */
  distanceMeters: number | null;
  /** Number of courts at this facility */
  courtCount: number;
}

interface UseCommunityFavoriteFacilitiesResult {
  /** Array of favorite facilities ordered by display_order */
  favorites: CommunityFavoriteFacility[];
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Add a facility to favorites. Only moderators/owners can add. */
  addFavorite: (facility: FacilitySearchResult) => Promise<boolean>;
  /** Remove a facility from favorites. Only moderators/owners can remove. */
  removeFavorite: (facilityId: string) => Promise<boolean>;
  /** Check if a facility is a favorite */
  isFavorite: (facilityId: string) => boolean;
  /** Number of favorites */
  count: number;
  /** Whether current user can manage favorites (is moderator/owner) */
  canManage: boolean;
  /** Refetch favorites */
  refetch: () => Promise<void>;
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in meters
 */
function calculateDistance(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null
): number | null {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) {
    return null;
  }

  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Fetches and manages community's favorite facilities
 * @param networkId - The network/community UUID (required)
 * @param currentPlayerId - The current player's UUID (for permission check)
 * @param userLatitude - User's latitude for distance calculation (optional)
 * @param userLongitude - User's longitude for distance calculation (optional)
 */
export function useCommunityFavoriteFacilities(
  networkId: string | null,
  currentPlayerId: string | null,
  userLatitude?: number | null,
  userLongitude?: number | null
): UseCommunityFavoriteFacilitiesResult {
  const [favorites, setFavorites] = useState<CommunityFavoriteFacility[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [canManage, setCanManage] = useState(false);

  const checkCanManage = useCallback(async () => {
    if (!networkId || !currentPlayerId) {
      setCanManage(false);
      return;
    }

    try {
      const { data, error: memberError } = await supabase
        .from('network_member')
        .select('role')
        .eq('network_id', networkId)
        .eq('player_id', currentPlayerId)
        .eq('status', 'active')
        .single();

      if (memberError || !data) {
        setCanManage(false);
        return;
      }

      setCanManage(data.role === 'owner' || data.role === 'moderator');
    } catch (err) {
      Logger.error('Failed to check manage permission', err as Error, {
        networkId,
        currentPlayerId,
      });
      setCanManage(false);
    }
  }, [networkId, currentPlayerId]);

  const fetchFavorites = useCallback(async () => {
    if (!networkId) {
      setFavorites([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('network_favorite_facility')
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
            court (count)
          )
        `
        )
        .eq('network_id', networkId)
        .order('display_order', { ascending: true });

      if (fetchError) throw fetchError;

      const mappedFavorites: CommunityFavoriteFacility[] = (data || []).map(item => {
        // Supabase returns the joined relation as an object (single) when using FK reference
        const facilityData = item.facility as unknown as {
          id: string;
          name: string;
          address: string | null;
          city: string | null;
          latitude: number | null;
          longitude: number | null;
          court: { count: number }[] | null;
        };

        // Calculate distance from user's location
        const distanceMeters = calculateDistance(
          userLatitude ?? null,
          userLongitude ?? null,
          facilityData?.latitude ?? null,
          facilityData?.longitude ?? null
        );

        // Get court count from aggregate
        const courtCount = facilityData?.court?.[0]?.count ?? 0;

        return {
          id: item.id,
          facilityId: item.facility_id,
          facility: {
            id: facilityData?.id ?? '',
            name: facilityData?.name ?? '',
            address: facilityData?.address ?? null,
            city: facilityData?.city ?? null,
            latitude: facilityData?.latitude ?? null,
            longitude: facilityData?.longitude ?? null,
          },
          displayOrder: item.display_order,
          distanceMeters,
          courtCount,
        };
      });

      setFavorites(mappedFavorites);
    } catch (err) {
      Logger.error('Failed to fetch community favorite facilities', err as Error, { networkId });
      setError(err instanceof Error ? err : new Error('Failed to fetch favorites'));
    } finally {
      setLoading(false);
    }
  }, [networkId, userLatitude, userLongitude]);

  useEffect(() => {
    fetchFavorites();
    checkCanManage();
  }, [fetchFavorites, checkCanManage]);

  const addFavorite = useCallback(
    async (facility: FacilitySearchResult): Promise<boolean> => {
      if (!networkId) return false;
      if (!canManage) {
        Logger.warn('User does not have permission to add favorites', { networkId });
        return false;
      }
      if (favorites.some(f => f.facilityId === facility.id)) return false;

      try {
        // Calculate next display_order (1-based)
        const nextDisplayOrder = favorites.length + 1;

        const { data, error: insertError } = await supabase
          .from('network_favorite_facility')
          .insert({
            network_id: networkId,
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
        const facilityData = data.facility as unknown as CommunityFavoriteFacility['facility'];

        // Calculate distance for newly added favorite
        const distanceMeters = calculateDistance(
          userLatitude ?? null,
          userLongitude ?? null,
          facilityData.latitude,
          facilityData.longitude
        );

        const newFavorite: CommunityFavoriteFacility = {
          id: data.id,
          facilityId: data.facility_id,
          facility: facilityData,
          displayOrder: data.display_order,
          distanceMeters,
          courtCount: 0, // Will be populated on next fetch
        };

        setFavorites(prev => [...prev, newFavorite]);
        return true;
      } catch (err) {
        Logger.error('Failed to add community favorite facility', err as Error, {
          networkId,
          facilityId: facility.id,
        });
        return false;
      }
    },
    [networkId, favorites, canManage, userLatitude, userLongitude]
  );

  const removeFavorite = useCallback(
    async (facilityId: string): Promise<boolean> => {
      if (!networkId) return false;
      if (!canManage) {
        Logger.warn('User does not have permission to remove favorites', { networkId });
        return false;
      }

      const favoriteToRemove = favorites.find(f => f.facilityId === facilityId);
      if (!favoriteToRemove) return false;

      try {
        // Delete the favorite
        const { error: deleteError } = await supabase
          .from('network_favorite_facility')
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
              .from('network_favorite_facility')
              .update({ display_order: fav.displayOrder })
              .eq('id', fav.id);
          }
        }

        setFavorites(remainingFavorites);
        return true;
      } catch (err) {
        Logger.error('Failed to remove community favorite facility', err as Error, {
          networkId,
          facilityId,
        });
        return false;
      }
    },
    [networkId, favorites, canManage]
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
    canManage,
    refetch: fetchFavorites,
  };
}

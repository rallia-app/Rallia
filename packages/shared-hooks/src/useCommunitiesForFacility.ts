/**
 * Hook that fetches public communities that have a given facility as a favorite.
 * This is the reverse of useCommunityFavoriteFacilities — given a facility,
 * find all communities that play there.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase, Logger } from '@rallia/shared-services';

export interface CommunityForFacility {
  id: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  memberCount: number;
  sportId: string | null;
  isCertified: boolean;
}

interface UseCommunitiesForFacilityResult {
  communities: CommunityForFacility[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useCommunitiesForFacility(
  facilityId: string | null
): UseCommunitiesForFacilityResult {
  const [communities, setCommunities] = useState<CommunityForFacility[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchCommunities = useCallback(async () => {
    if (!facilityId) {
      setCommunities([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('network_favorite_facility')
        .select(
          `
          network:network_id (
            id,
            name,
            description,
            cover_image_url,
            member_count,
            is_private,
            sport_id,
            is_certified
          )
        `
        )
        .eq('facility_id', facilityId);

      if (fetchError) throw fetchError;

      const mapped: CommunityForFacility[] = (data || [])
        .map(item => {
          const network = item.network as unknown as {
            id: string;
            name: string;
            description: string | null;
            cover_image_url: string | null;
            member_count: number;
            is_private: boolean;
            sport_id: string | null;
            is_certified: boolean;
          };

          // Only include public communities
          if (!network || network.is_private) return null;

          return {
            id: network.id,
            name: network.name,
            description: network.description,
            coverImageUrl: network.cover_image_url,
            memberCount: network.member_count,
            sportId: network.sport_id,
            isCertified: network.is_certified ?? false,
          };
        })
        .filter((c): c is CommunityForFacility => c !== null);

      setCommunities(mapped);
    } catch (err) {
      Logger.error('Failed to fetch communities for facility', err as Error, { facilityId });
      setError(err instanceof Error ? err : new Error('Failed to fetch communities'));
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    fetchCommunities();
  }, [fetchCommunities]);

  return {
    communities,
    isLoading,
    error,
    refetch: fetchCommunities,
  };
}

/**
 * useRatingScoreReferees Hook
 *
 * Fetches the list of players who gave valid references for a given
 * player_rating_score. Uses the get_rating_score_referees RPC which
 * bypasses the rating_reference_request RLS safely (public-safe fields only).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@rallia/shared-services';
import type { Database } from '@rallia/shared-types';

type RefereeRow = Database['public']['Functions']['get_rating_score_referees']['Returns'][number];

export type RatingScoreReferee = RefereeRow;

interface UseRatingScoreRefereesResult {
  referees: RatingScoreReferee[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRatingScoreReferees(
  playerRatingScoreId: string | null | undefined
): UseRatingScoreRefereesResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ratingScoreReferees', playerRatingScoreId],
    queryFn: async (): Promise<RatingScoreReferee[]> => {
      if (!playerRatingScoreId) return [];

      const { data, error } = await supabase.rpc('get_rating_score_referees', {
        p_player_rating_score_id: playerRatingScoreId,
      });

      if (error) {
        throw new Error(error.message || 'Failed to fetch references');
      }

      return data || [];
    },
    enabled: !!playerRatingScoreId,
    staleTime: 1000 * 60, // 1 min — fresh enough for most interactions
  });

  return {
    referees: data || [],
    isLoading,
    error: error as Error | null,
    refetch,
  };
}

export default useRatingScoreReferees;

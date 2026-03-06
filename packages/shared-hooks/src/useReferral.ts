/**
 * useReferral Hook
 * React Query hook for managing player referral codes, stats, and attribution
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrCreateReferralCode,
  getReferralLink,
  getReferralStats,
  attributeReferral,
  matchReferralFingerprint,
  type ReferralStats,
} from '@rallia/shared-services';

// Query Keys
export const referralKeys = {
  all: ['referral'] as const,
  code: (playerId: string) => [...referralKeys.all, 'code', playerId] as const,
  stats: (playerId: string) => [...referralKeys.all, 'stats', playerId] as const,
};

/**
 * Unified referral hook exposing code, stats, and attribution actions
 */
export function useReferral(playerId?: string) {
  const queryClient = useQueryClient();

  // Fetch or generate referral code
  const { data: code, isLoading: codeLoading } = useQuery({
    queryKey: referralKeys.code(playerId ?? ''),
    queryFn: () => getOrCreateReferralCode(playerId!),
    enabled: !!playerId,
    staleTime: Infinity,
  });

  // Derive referral link from code
  const referralLink = code ? getReferralLink(code) : undefined;

  // Fetch referral stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: referralKeys.stats(playerId ?? ''),
    queryFn: () => getReferralStats(playerId!),
    enabled: !!playerId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Attribute referral mutation
  const attributeReferralMutation = useMutation({
    mutationFn: ({
      referralCode,
      newPlayerId,
      newPlayerEmail,
    }: {
      referralCode: string;
      newPlayerId: string;
      newPlayerEmail?: string;
    }) => attributeReferral(referralCode, newPlayerId, newPlayerEmail),
  });

  return {
    code,
    codeLoading,
    referralLink,
    stats,
    statsLoading,
    attributeReferral: attributeReferralMutation.mutateAsync,
    isAttributing: attributeReferralMutation.isPending,
    matchReferralFingerprint,
  };
}

// Re-export types for convenience
export type { ReferralStats };

/**
 * useReferral Hook
 * React Query hook for managing player referral codes, stats, and invite tracking
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrCreateReferralCode,
  getReferralLink,
  getReferralStats,
  recordReferralInvites,
  attributeReferral,
  type ReferralStats,
  type RecordReferralInvitesInput,
} from '@rallia/shared-services';

// Query Keys
export const referralKeys = {
  all: ['referral'] as const,
  code: (playerId: string) => [...referralKeys.all, 'code', playerId] as const,
  stats: (playerId: string) => [...referralKeys.all, 'stats', playerId] as const,
};

/**
 * Unified referral hook exposing code, stats, and invite actions
 */
export function useReferral(playerId?: string) {
  const queryClient = useQueryClient();

  // Fetch or generate referral code
  const {
    data: code,
    isLoading: codeLoading,
  } = useQuery({
    queryKey: referralKeys.code(playerId ?? ''),
    queryFn: () => getOrCreateReferralCode(playerId!),
    enabled: !!playerId,
    staleTime: Infinity,
  });

  // Derive referral link from code
  const referralLink = code ? getReferralLink(code) : undefined;

  // Fetch referral stats
  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery({
    queryKey: referralKeys.stats(playerId ?? ''),
    queryFn: () => getReferralStats(playerId!),
    enabled: !!playerId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Record invites mutation
  const recordInvitesMutation = useMutation({
    mutationFn: (input: RecordReferralInvitesInput) => recordReferralInvites(input),
    onSuccess: () => {
      if (playerId) {
        queryClient.invalidateQueries({ queryKey: referralKeys.stats(playerId) });
      }
    },
  });

  // Attribute referral mutation
  const attributeReferralMutation = useMutation({
    mutationFn: ({ referralCode, newPlayerId }: { referralCode: string; newPlayerId: string }) =>
      attributeReferral(referralCode, newPlayerId),
  });

  return {
    code,
    codeLoading,
    referralLink,
    stats,
    statsLoading,
    recordInvites: recordInvitesMutation.mutateAsync,
    isRecording: recordInvitesMutation.isPending,
    attributeReferral: attributeReferralMutation.mutateAsync,
    isAttributing: attributeReferralMutation.isPending,
  };
}

// Re-export types for convenience
export type { ReferralStats, RecordReferralInvitesInput };

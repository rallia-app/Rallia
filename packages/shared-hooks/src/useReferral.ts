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
  getActiveContest,
  getReferralLeaderboard,
  getMyContestRank,
  localizeContest,
  type ReferralStats,
  type ReferralContest,
  type ReferralLeaderboardEntry,
  type ContestRank,
} from '@rallia/shared-services';

// Query Keys
export const referralKeys = {
  all: ['referral'] as const,
  code: (playerId: string) => [...referralKeys.all, 'code', playerId] as const,
  stats: (playerId: string) => [...referralKeys.all, 'stats', playerId] as const,
  contest: () => [...referralKeys.all, 'contest'] as const,
  leaderboard: (contestId: string) => [...referralKeys.all, 'leaderboard', contestId] as const,
  myRank: (contestId: string, playerId: string) =>
    [...referralKeys.all, 'rank', contestId, playerId] as const,
};

/**
 * Unified referral hook exposing code, stats, and attribution actions.
 * Pass `locale` to get contest title/prize in the correct language.
 */
export function useReferral(playerId?: string, locale?: string) {
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

  // Active contest
  const { data: rawContest = null, isLoading: contestLoading } = useQuery({
    queryKey: referralKeys.contest(),
    queryFn: getActiveContest,
    staleTime: 5 * 60 * 1000,
  });
  const contest = rawContest && locale ? localizeContest(rawContest, locale) : rawContest;

  // Leaderboard (only fetched when a contest is active)
  const { data: leaderboard = [] } = useQuery({
    queryKey: referralKeys.leaderboard(contest?.id ?? ''),
    queryFn: () => getReferralLeaderboard(contest!.id),
    enabled: !!contest,
    staleTime: 2 * 60 * 1000,
  });

  // My rank within the contest
  const { data: myRank = null } = useQuery({
    queryKey: referralKeys.myRank(contest?.id ?? '', playerId ?? ''),
    queryFn: () => getMyContestRank(contest!.id, playerId!),
    enabled: !!contest && !!playerId,
    staleTime: 2 * 60 * 1000,
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
    contest,
    contestLoading,
    leaderboard,
    myRank,
    attributeReferral: attributeReferralMutation.mutateAsync,
    isAttributing: attributeReferralMutation.isPending,
    matchReferralFingerprint,
  };
}

// Re-export types for convenience
export type { ReferralStats, ReferralContest, ReferralLeaderboardEntry, ContestRank };

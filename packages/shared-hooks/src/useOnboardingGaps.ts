/**
 * useOnboardingGaps
 *
 * Which onboarding-minimum pieces the signed-in player still lacks
 * (specs/01-authentication/onboarding-minimum.md, "Repair"). Read-only: it
 * never flips onboarding_completed. Only runs for players already marked
 * onboarded; the wizard owns the incomplete case.
 */

import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOnboardingGaps } from '@rallia/shared-services';
import { parseOnboardingGaps, hasOnboardingGaps, type OnboardingGaps } from '@rallia/shared-utils';

import ProfileContext from './ProfileContext';

export const onboardingGapsKeys = {
  all: ['onboardingGaps'] as const,
  byPlayer: (playerId: string) => [...onboardingGapsKeys.all, playerId] as const,
};

const NO_GAPS: OnboardingGaps = {
  postalCode: false,
  sport: false,
  unratedSportIds: [],
  underFavoritedSportIds: [],
};

interface UseOnboardingGapsOptions {
  /** Defaults to the ProfileContext player. */
  playerId?: string | null;
  /** Defaults to the ProfileContext flag. */
  onboardingCompleted?: boolean | null;
  /** Caller-side gate, ANDed with the signed-in + onboarded check. */
  enabled?: boolean;
}

export interface UseOnboardingGapsResult {
  gaps: OnboardingGaps;
  hasGaps: boolean;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

export function useOnboardingGaps(options: UseOnboardingGapsOptions = {}): UseOnboardingGapsResult {
  const profileContext = useContext(ProfileContext);
  const playerId = options.playerId ?? profileContext?.profile?.id ?? null;
  const onboardingCompleted =
    options.onboardingCompleted ?? profileContext?.profile?.onboarding_completed ?? false;
  const enabled = (options.enabled ?? true) && !!playerId && onboardingCompleted === true;

  const query = useQuery({
    queryKey: onboardingGapsKeys.byPlayer(playerId ?? 'anonymous'),
    queryFn: async () => parseOnboardingGaps(await getOnboardingGaps()),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const gaps = enabled ? (query.data ?? NO_GAPS) : NO_GAPS;

  return {
    gaps,
    hasGaps: hasOnboardingGaps(gaps),
    isLoading: enabled && query.isLoading,
    refetch: query.refetch,
  };
}

export default useOnboardingGaps;

/**
 * useSharedAvailability Hook
 *
 * Hours where every one of `playerIds` is free, as an HourGrid of
 * `${day}-${hour}` cell keys.
 *
 * Powers the opponent overlay on HourlyAvailabilityGrid. When the availability
 * picker is opened from a pairing context (tournament round chat, league
 * pairing) it draws these underneath the player's own selection, so mutual
 * hours are visible while they paint instead of the player guessing blind.
 *
 * Intersection, not union — matches `match_organizer_options`' `free_count = n`
 * rule, which is what actually decides whether a suggestion is playable.
 */

import { useQuery } from '@tanstack/react-query';
import { AvailabilityService } from '@rallia/shared-services';

export const sharedAvailabilityKeys = {
  all: ['shared-availability'] as const,
  forPlayers: (playerIds: string[]) =>
    [...sharedAvailabilityKeys.all, [...playerIds].sort().join(',')] as const,
};

export function useSharedAvailability(playerIds: string[] | undefined) {
  const ids = playerIds ?? [];

  return useQuery({
    queryKey: sharedAvailabilityKeys.forPlayers(ids),
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const { data, error } = await AvailabilityService.getSharedAvailabilityCells(ids);
      if (error) throw new Error(error.message);
      return new Set(data ?? []);
    },
    enabled: ids.length > 0,
    // Availability is recurring and rarely edited mid-session; the pairing
    // save path invalidates this key explicitly when it changes.
    staleTime: 5 * 60 * 1000,
  });
}

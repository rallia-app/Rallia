/**
 * useCoPlayerUpcomingGames Hook
 *
 * Upcoming open games belonging to the other players from a game you just
 * finished. Powers the post-feedback next-step list: right after rating the
 * people you played with, their next game is the most joinable thing on offer.
 */

import { useQuery } from '@tanstack/react-query';
import { getUpcomingGamesFromCoPlayers, type CoPlayerUpcomingGame } from '@rallia/shared-services';

export const coPlayerGameKeys = {
  all: ['coPlayerUpcomingGames'] as const,
  forMatch: (matchId: string) => [...coPlayerGameKeys.all, matchId] as const,
};

interface UseCoPlayerUpcomingGamesOptions {
  /** The game the feedback is about. */
  matchId: string | undefined;
  /** Skip the query until the prompt is actually shown. */
  enabled?: boolean;
  limit?: number;
}

export function useCoPlayerUpcomingGames({
  matchId,
  enabled = true,
  limit = 3,
}: UseCoPlayerUpcomingGamesOptions) {
  const query = useQuery<CoPlayerUpcomingGame[]>({
    queryKey: coPlayerGameKeys.forMatch(matchId ?? 'none'),
    queryFn: () => getUpcomingGamesFromCoPlayers(matchId as string, limit),
    enabled: Boolean(matchId) && enabled,
    staleTime: 60_000,
  });

  return {
    games: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * Format-neutral event lists.
 *
 * Discovery and "my events" both need tournaments and leagues as one list.
 * These compose the two per-format queries and normalize the rows, so screens
 * see events rather than two parallel trees. Each underlying query keeps its
 * own cache key and freshness policy, so nothing about caching changes.
 *
 * Phase 4 of the event unification may replace the client-side fan-out with a
 * single `v_events` read; the hook signature is the seam for that.
 */

import { useMemo } from 'react';
import {
  leagueToEventSummary,
  tournamentToEventSummary,
  type EventSummary,
} from '@rallia/shared-services';

import { usePublicLeagues, useMyLeagues } from './useLeagues';
import { usePublicTournaments, useMyTournaments } from './useTournaments';

interface EventsQueryResult {
  data: EventSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

/** Every public event for the sport, both formats, normalized. */
export function usePublicEvents(sportId?: string): EventsQueryResult {
  const tournaments = usePublicTournaments(sportId);
  const leagues = usePublicLeagues(sportId);

  const data = useMemo<EventSummary[]>(
    () => [
      ...(tournaments.data ?? []).map(tournamentToEventSummary),
      ...(leagues.data ?? []).map(leagueToEventSummary),
    ],
    [tournaments.data, leagues.data]
  );

  return {
    data,
    // Either list still loading means the merged list is incomplete, so the
    // screen keeps its skeletons rather than flashing a half list.
    isLoading: tournaments.isLoading || leagues.isLoading,
    isError: tournaments.isError || leagues.isError,
    refetch: () => Promise.all([tournaments.refetch(), leagues.refetch()]),
  };
}

/** Events the caller organizes or takes part in, both formats, normalized. */
export function useMyEvents(userId: string | undefined, sportId?: string): EventsQueryResult {
  const tournaments = useMyTournaments(userId, sportId);
  const leagues = useMyLeagues(userId, sportId);

  const data = useMemo<EventSummary[]>(
    () => [
      ...(tournaments.data ?? []).map(tournamentToEventSummary),
      ...(leagues.data ?? []).map(leagueToEventSummary),
    ],
    [tournaments.data, leagues.data]
  );

  return {
    data,
    isLoading: tournaments.isLoading || leagues.isLoading,
    isError: tournaments.isError || leagues.isError,
    refetch: () => Promise.all([tournaments.refetch(), leagues.refetch()]),
  };
}

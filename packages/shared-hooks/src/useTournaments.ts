/**
 * Tournament Hooks
 *
 * TanStack Query wrappers for the tournament service surface — list/detail
 * queries, registration lifecycle mutations, bracket generation, attach,
 * cancel/archive. Plus useProfilesByIds for the bracket name lookup.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTournament,
  getTournament,
  listVisibleTournaments,
  listActiveRegistrations,
  listMyActiveRegistrations,
  getMyRegistration,
  openTournamentRegistration,
  closeTournamentRegistration,
  registerForTournament,
  withdrawFromTournament,
  listTournamentMatches,
  generateTournamentBracket,
  listLinkableMatchesForSlot,
  attachMatchToTournamentSlot,
  overrideTournamentMatchScore,
  cancelTournament,
  archiveTournament,
  getProfilesByIds,
  type CreateTournamentInput,
  type Tournament,
  type TournamentRegistration,
  type TournamentMatch,
  type LinkableMatch,
  type PlayerProfile,
} from '@rallia/shared-services';

export const tournamentKeys = {
  all: ['tournaments'] as const,
  lists: () => [...tournamentKeys.all, 'list'] as const,
  list: (sportId?: string) => [...tournamentKeys.lists(), sportId ?? 'all'] as const,
  detail: (tournamentId: string) => [...tournamentKeys.all, 'detail', tournamentId] as const,
  registrations: (tournamentId: string) =>
    [...tournamentKeys.all, 'registrations', tournamentId] as const,
  myRegistration: (tournamentId: string, userId: string) =>
    [...tournamentKeys.all, 'myRegistration', tournamentId, userId] as const,
  myActiveRegistrations: (userId: string) =>
    [...tournamentKeys.all, 'myActiveRegistrations', userId] as const,
  matches: (tournamentId: string) => [...tournamentKeys.all, 'matches', tournamentId] as const,
};

/**
 * Batch-fetch player profiles by id (display_name, profile_picture_url).
 */
export function useProfilesByIds(ids: string[]) {
  // Stable key: sorted unique ids joined.
  const sortedIds = [...new Set(ids)].sort();
  return useQuery<Map<string, PlayerProfile>>({
    queryKey: ['profiles', 'byIds', sortedIds.join(',')],
    queryFn: () => getProfilesByIds(sortedIds),
    enabled: sortedIds.length > 0,
  });
}

/**
 * List all of the caller's active registrations across visible tournaments.
 */
export function useMyActiveRegistrations(userId: string | undefined) {
  return useQuery<TournamentRegistration[]>({
    queryKey: tournamentKeys.myActiveRegistrations(userId ?? ''),
    queryFn: () => listMyActiveRegistrations(userId!),
    enabled: !!userId,
  });
}

/**
 * List tournaments visible to the caller, optionally scoped to a sport.
 */
export function useVisibleTournaments(sportId?: string) {
  return useQuery<Tournament[]>({
    queryKey: tournamentKeys.list(sportId),
    queryFn: () => listVisibleTournaments({ sportId, excludeArchived: true }),
  });
}

/**
 * Fetch a single tournament by ID.
 */
export function useTournament(tournamentId: string | undefined) {
  return useQuery<Tournament | null>({
    queryKey: tournamentKeys.detail(tournamentId ?? ''),
    queryFn: () => getTournament(tournamentId!),
    enabled: !!tournamentId,
  });
}

/**
 * List active registrations (registered + pending) for a tournament.
 */
export function useTournamentRegistrations(tournamentId: string | undefined) {
  return useQuery<TournamentRegistration[]>({
    queryKey: tournamentKeys.registrations(tournamentId ?? ''),
    queryFn: () => listActiveRegistrations(tournamentId!),
    enabled: !!tournamentId,
  });
}

/**
 * Fetch the caller's own registration row for a tournament (or null).
 */
export function useMyTournamentRegistration(
  tournamentId: string | undefined,
  userId: string | undefined
) {
  return useQuery<TournamentRegistration | null>({
    queryKey: tournamentKeys.myRegistration(tournamentId ?? '', userId ?? ''),
    queryFn: () => getMyRegistration(tournamentId!, userId!),
    enabled: !!tournamentId && !!userId,
  });
}

interface MutationOptions<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
}

function useTournamentDetailInvalidator() {
  const qc = useQueryClient();
  return (tournamentId: string) => {
    qc.invalidateQueries({ queryKey: tournamentKeys.detail(tournamentId) });
    qc.invalidateQueries({ queryKey: tournamentKeys.registrations(tournamentId) });
    qc.invalidateQueries({ queryKey: tournamentKeys.matches(tournamentId) });
    qc.invalidateQueries({ queryKey: [...tournamentKeys.all, 'myRegistration', tournamentId] });
    qc.invalidateQueries({ queryKey: [...tournamentKeys.all, 'myActiveRegistrations'] });
  };
}

/**
 * List all matches for a tournament's bracket.
 */
export function useTournamentMatches(tournamentId: string | undefined) {
  return useQuery<TournamentMatch[]>({
    queryKey: tournamentKeys.matches(tournamentId ?? ''),
    queryFn: () => listTournamentMatches(tournamentId!),
    enabled: !!tournamentId,
  });
}

/**
 * Linkable matches the caller can attach to a tournament_match slot.
 * Filters server-side by tournament's sport and verified result; eligibility
 * (both bracket players are joined participants) is computed client-side.
 */
export function useLinkableMatchesForSlot(params: {
  tournamentMatchId: string | undefined;
  player1UserId: string | undefined;
  player2UserId: string | undefined;
  sportId: string | undefined;
  enabled?: boolean;
}) {
  const enabled =
    (params.enabled ?? true) &&
    !!params.tournamentMatchId &&
    !!params.player1UserId &&
    !!params.player2UserId &&
    !!params.sportId;

  return useQuery<LinkableMatch[]>({
    queryKey: [
      ...tournamentKeys.all,
      'linkable',
      params.tournamentMatchId ?? '',
      params.player1UserId ?? '',
      params.player2UserId ?? '',
    ],
    queryFn: () =>
      listLinkableMatchesForSlot({
        tournamentMatchId: params.tournamentMatchId!,
        player1UserId: params.player1UserId!,
        player2UserId: params.player2UserId!,
        sportId: params.sportId!,
      }),
    enabled,
  });
}

export function useCancelTournament(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<
    Tournament,
    Error,
    { tournamentId: string; reason: string; versionWas: number }
  >({
    mutationFn: ({ tournamentId, reason, versionWas }) =>
      cancelTournament(tournamentId, reason, versionWas),
    onSuccess: t => {
      invalidate(t.id);
      qc.invalidateQueries({ queryKey: tournamentKeys.lists() });
      options.onSuccess?.(t);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useArchiveTournament(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<Tournament, Error, { tournamentId: string; versionWas: number }>({
    mutationFn: ({ tournamentId, versionWas }) => archiveTournament(tournamentId, versionWas),
    onSuccess: t => {
      invalidate(t.id);
      qc.invalidateQueries({ queryKey: tournamentKeys.lists() });
      options.onSuccess?.(t);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * Attach a verified match to a pending bracket slot.
 */
export function useAttachMatchToTournamentSlot(options: MutationOptions<TournamentMatch> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch,
    Error,
    { tournamentMatchId: string; matchId: string; tournamentId: string }
  >({
    mutationFn: ({ tournamentMatchId, matchId }) =>
      attachMatchToTournamentSlot(tournamentMatchId, matchId),
    onSuccess: (tm, vars) => {
      invalidate(vars.tournamentId);
      options.onSuccess?.(tm);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * Organizer/admin authoritative score override for a stalled or disputed
 * bracket match. Completes the match with the chosen winner and advances the
 * bracket.
 */
export function useOverrideTournamentMatchScore(options: MutationOptions<TournamentMatch> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch,
    Error,
    {
      tournamentMatchId: string;
      winnerRegistrationId: string;
      score?: string;
      tournamentId: string;
    }
  >({
    mutationFn: ({ tournamentMatchId, winnerRegistrationId, score }) =>
      overrideTournamentMatchScore(tournamentMatchId, winnerRegistrationId, score),
    onSuccess: (tm, vars) => {
      invalidate(vars.tournamentId);
      options.onSuccess?.(tm);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * Organizer generates the bracket for a registration_closed tournament.
 */
export function useGenerateTournamentBracket(options: MutationOptions<TournamentMatch[]> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch[],
    Error,
    { tournamentId: string; versionWas: number }
  >({
    mutationFn: ({ tournamentId, versionWas }) =>
      generateTournamentBracket(tournamentId, versionWas),
    onSuccess: (matches, vars) => {
      invalidate(vars.tournamentId);
      options.onSuccess?.(matches);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useOpenTournamentRegistration(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<Tournament, Error, { tournamentId: string; versionWas: number }>({
    mutationFn: ({ tournamentId, versionWas }) =>
      openTournamentRegistration(tournamentId, versionWas),
    onSuccess: t => {
      invalidate(t.id);
      options.onSuccess?.(t);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useCloseTournamentRegistration(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<Tournament, Error, { tournamentId: string; versionWas: number }>({
    mutationFn: ({ tournamentId, versionWas }) =>
      closeTournamentRegistration(tournamentId, versionWas),
    onSuccess: t => {
      invalidate(t.id);
      options.onSuccess?.(t);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useRegisterForTournament(options: MutationOptions<TournamentRegistration> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<TournamentRegistration, Error, { tournamentId: string }>({
    mutationFn: ({ tournamentId }) => registerForTournament(tournamentId),
    onSuccess: r => {
      invalidate(r.tournament_id);
      options.onSuccess?.(r);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useWithdrawFromTournament(options: MutationOptions<TournamentRegistration> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string }
  >({
    mutationFn: ({ registrationId, versionWas }) =>
      withdrawFromTournament(registrationId, versionWas),
    onSuccess: (r, vars) => {
      invalidate(vars.tournamentId);
      options.onSuccess?.(r);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

interface UseCreateTournamentOptions {
  onSuccess?: (tournament: Tournament) => void;
  onError?: (error: Error) => void;
  invalidateOnSuccess?: boolean;
}

export function useCreateTournament(options: UseCreateTournamentOptions = {}) {
  const { onSuccess, onError, invalidateOnSuccess = true } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<Tournament, Error, CreateTournamentInput>({
    mutationFn: createTournament,

    onSuccess: tournament => {
      if (invalidateOnSuccess) {
        queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
      }
      onSuccess?.(tournament);
    },

    onError: error => {
      onError?.(error);
    },
  });

  return {
    createTournament: mutation.mutate,
    createTournamentAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    createdTournament: mutation.data,
    reset: mutation.reset,
  };
}

export default useCreateTournament;

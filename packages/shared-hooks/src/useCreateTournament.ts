/**
 * useCreateTournament Hook
 *
 * TanStack Query mutation wrapping createTournament. Mirrors useCreateMatch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTournament,
  getTournament,
  listActiveRegistrations,
  getMyRegistration,
  openTournamentRegistration,
  closeTournamentRegistration,
  registerForTournament,
  withdrawFromTournament,
  type CreateTournamentInput,
  type Tournament,
  type TournamentRegistration,
} from '@rallia/shared-services';

export const tournamentKeys = {
  all: ['tournaments'] as const,
  lists: () => [...tournamentKeys.all, 'list'] as const,
  detail: (tournamentId: string) => [...tournamentKeys.all, 'detail', tournamentId] as const,
  byOrganizer: (userId: string) => [...tournamentKeys.all, 'byOrganizer', userId] as const,
  registrations: (tournamentId: string) =>
    [...tournamentKeys.all, 'registrations', tournamentId] as const,
  myRegistration: (tournamentId: string, userId: string) =>
    [...tournamentKeys.all, 'myRegistration', tournamentId, userId] as const,
};

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
    qc.invalidateQueries({ queryKey: [...tournamentKeys.all, 'myRegistration', tournamentId] });
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
        queryClient.invalidateQueries({
          queryKey: tournamentKeys.byOrganizer(tournament.organizer_id),
        });
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

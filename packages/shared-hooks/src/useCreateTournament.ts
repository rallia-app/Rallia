/**
 * useCreateTournament Hook
 *
 * TanStack Query mutation wrapping createTournament. Mirrors useCreateMatch.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createTournament,
  type CreateTournamentInput,
  type Tournament,
} from '@rallia/shared-services';

export const tournamentKeys = {
  all: ['tournaments'] as const,
  lists: () => [...tournamentKeys.all, 'list'] as const,
  detail: (tournamentId: string) => [...tournamentKeys.all, 'detail', tournamentId] as const,
  byOrganizer: (userId: string) => [...tournamentKeys.all, 'byOrganizer', userId] as const,
};

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

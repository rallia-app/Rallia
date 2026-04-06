/**
 * useInviteToMatch Hook
 * Mutation hook for inviting players to a match.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invitePlayersToMatch } from '@rallia/shared-services';
import type { InvitePlayersResult } from '@rallia/shared-services';
import { matchKeys } from './useCreateMatch';

/**
 * Variables passed to the invite mutation
 */
interface InviteVariables {
  matchId: string;
  playerIds: string[];
}

/**
 * Options for the useInviteToMatch hook
 */
interface UseInviteToMatchOptions {
  /** Host ID (current user) */
  hostId: string;
  /** Callback when invitation succeeds */
  onSuccess?: (result: InvitePlayersResult) => void;
  /** Callback when invitation fails */
  onError?: (error: Error) => void;
}

/**
 * Hook for inviting players to a match.
 * The matchId is passed at call time (not at hook instantiation) to avoid
 * stale-closure race conditions when inviting from a list of matches.
 *
 * @example
 * ```tsx
 * const { invitePlayers, isInviting, error } = useInviteToMatch({
 *   hostId: session.user.id,
 *   onSuccess: (result) => {
 *     showToast(`Invited ${result.invited.length} players`);
 *   },
 * });
 *
 * // Invite selected players to a specific match
 * invitePlayers({ matchId: 'match-123', playerIds: ['player-1', 'player-2'] });
 * ```
 */
export function useInviteToMatch(options: UseInviteToMatchOptions) {
  const { hostId, onSuccess, onError } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<InvitePlayersResult, Error, InviteVariables>({
    mutationFn: async ({ matchId, playerIds }: InviteVariables) => {
      return invitePlayersToMatch(matchId, playerIds, hostId);
    },
    onSuccess: (result, { matchId }) => {
      // Invalidate match detail query to refresh participant list
      queryClient.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      // Also invalidate the player's matches list
      queryClient.invalidateQueries({ queryKey: matchKeys.list('player') });
      onSuccess?.(result);
    },
    onError: error => {
      onError?.(error);
    },
  });

  return {
    /** Function to invite players - pass matchId and array of player IDs */
    invitePlayers: mutation.mutate,
    /** Async version of invitePlayers */
    invitePlayersAsync: mutation.mutateAsync,
    /** Whether invitation is in progress */
    isInviting: mutation.isPending,
    /** Error if invitation failed */
    error: mutation.error,
    /** Reset mutation state */
    reset: mutation.reset,
  };
}

export default useInviteToMatch;

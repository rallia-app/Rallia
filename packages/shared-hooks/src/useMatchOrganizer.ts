/**
 * useMatchOrganizer Hooks
 * React Query hooks for the chat Match Organizer card (suggest times/places,
 * vote on options, create the agreed-upon game).
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMatchOrganizerOptions,
  getSharedSports,
  postMatchOrganizerCard,
  getMatchTimeVotes,
  toggleMatchTimeVote,
  createCasualMatch,
  getOrCreateTournamentRoundChat,
  getTournamentMatchSportId,
  subscribeToMatchVotes,
  unsubscribeFromChannel,
} from '@rallia/shared-services';

import { chatKeys } from './useChat';

// ============================================================================
// QUERY KEYS
// ============================================================================

const sortedKey = (ids: string[]) => [...ids].sort().join(',');

export const matchOrganizerKeys = {
  all: ['matchOrganizer'] as const,
  sharedSports: (playerIds: string[]) =>
    [...matchOrganizerKeys.all, 'sharedSports', sortedKey(playerIds)] as const,
  options: (playerIds: string[], sportId: string) =>
    [...matchOrganizerKeys.all, 'options', sortedKey(playerIds), sportId] as const,
  votes: (messageId: string) => [...matchOrganizerKeys.all, 'votes', messageId] as const,
  tournamentSport: (tournamentMatchId: string) =>
    [...matchOrganizerKeys.all, 'tournamentSport', tournamentMatchId] as const,
};

// ============================================================================
// SETUP (sport + option preview)
// ============================================================================

/** Sports the listed players share (for the organizer sport picker). */
export function useSharedSports(playerIds: string[] | undefined) {
  return useQuery({
    queryKey: matchOrganizerKeys.sharedSports(playerIds ?? []),
    queryFn: () => getSharedSports(playerIds ?? []),
    enabled: !!playerIds && playerIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The tournament's sport behind a round chat. Used to force the organizer flow
 * onto the tournament sport instead of a guessed shared one. Enabled only when
 * a tournament_match_id is present (i.e. the chat is a tournament round chat).
 */
export function useTournamentMatchSport(tournamentMatchId: string | null | undefined) {
  return useQuery({
    queryKey: matchOrganizerKeys.tournamentSport(tournamentMatchId ?? ''),
    queryFn: () => getTournamentMatchSportId(tournamentMatchId ?? ''),
    enabled: !!tournamentMatchId,
    staleTime: 10 * 60 * 1000,
  });
}

/** Live preview of ranked options for a player set + sport. */
export function useMatchOrganizerOptions(
  playerIds: string[] | undefined,
  sportId: string | undefined,
  options: { enabled?: boolean; windowDays?: number; limit?: number } = {}
) {
  const { enabled = true, windowDays, limit } = options;
  return useQuery({
    queryKey: matchOrganizerKeys.options(playerIds ?? [], sportId ?? ''),
    queryFn: () => getMatchOrganizerOptions(playerIds ?? [], sportId ?? '', { windowDays, limit }),
    enabled: enabled && !!playerIds && playerIds.length >= 2 && !!sportId,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// CARD POSTING
// ============================================================================

export function usePostMatchOrganizerCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postMatchOrganizerCard,
    onSuccess: (_message, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.conversationId),
      });
    },
  });
}

// ============================================================================
// VOTES
// ============================================================================

export function useMatchTimeVotes(messageId: string | undefined) {
  return useQuery({
    queryKey: matchOrganizerKeys.votes(messageId ?? ''),
    queryFn: () => getMatchTimeVotes(messageId ?? ''),
    enabled: !!messageId,
  });
}

export function useToggleMatchTimeVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      playerId,
      optionIndex,
      hasVoted,
    }: {
      messageId: string;
      playerId: string;
      optionIndex: number;
      hasVoted: boolean;
    }) => toggleMatchTimeVote(messageId, playerId, optionIndex, hasVoted),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.votes(variables.messageId),
      });
    },
  });
}

/**
 * Subscribe to live vote changes in a conversation. Both players see each
 * other's option votes refresh in real time (no polling).
 */
export function useMatchVotesRealtime(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const channel = subscribeToMatchVotes(conversationId, ({ messageId }) => {
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.votes(messageId),
      });
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [conversationId, queryClient]);
}

// ============================================================================
// MATCH CREATION
// ============================================================================

/**
 * Open (get-or-create) the per-pairing tournament round chat for a bracket
 * match. Returns the conversation id to navigate to.
 */
export function useOpenTournamentRoundChat() {
  return useMutation({
    mutationFn: (tournamentMatchId: string) => getOrCreateTournamentRoundChat(tournamentMatchId),
  });
}

export function useCreateCasualMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId: _conversationId,
      ...params
    }: Parameters<typeof createCasualMatch>[0] & { conversationId?: string }) =>
      createCasualMatch(params),
    onSuccess: (_matchId, variables) => {
      if (variables.conversationId) {
        queryClient.invalidateQueries({
          queryKey: chatKeys.messages(variables.conversationId),
        });
      }
      if (variables.sourceMessageId) {
        queryClient.invalidateQueries({
          queryKey: matchOrganizerKeys.votes(variables.sourceMessageId),
        });
      }
    },
  });
}

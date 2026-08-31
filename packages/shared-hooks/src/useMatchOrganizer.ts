/**
 * useMatchOrganizer Hooks
 * React Query hooks for the chat Match Organizer card (suggest times/places,
 * vote on options, create the agreed-upon game).
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bookMutualOption,
  acceptPairingBooking,
  reproposePairingSlot,
  getPairingBooking,
  type PairingBooking,
  getMatchOrganizerOptions,
  getSharedSports,
  postMatchOrganizerCard,
  getMatchTimeVotes,
  toggleMatchTimeVote,
  createCasualMatch,
  addCustomOrganizerOption,
  getOrCreateTournamentRoundChat,
  getTournamentMatchSportId,
  getOrCreateSessionPairingChat,
  getSessionMatchSportId,
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
  booking: (tournamentMatchId: string) =>
    [...matchOrganizerKeys.all, 'booking', tournamentMatchId] as const,
  sessionSport: (sessionMatchId: string) =>
    [...matchOrganizerKeys.all, 'sessionSport', sessionMatchId] as const,
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

/**
 * The league's sport behind a session pairing chat. Used to force the organizer
 * flow onto the league sport instead of a guessed shared one. Enabled only when
 * a session_match_id is present (i.e. the chat is a session pairing chat).
 */
export function useSessionMatchSport(sessionMatchId: string | null | undefined) {
  return useQuery({
    queryKey: matchOrganizerKeys.sessionSport(sessionMatchId ?? ''),
    queryFn: () => getSessionMatchSportId(sessionMatchId ?? ''),
    enabled: !!sessionMatchId,
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
 * Gated on playerId so we never join the private channel before auth is ready.
 */
export function useMatchVotesRealtime(
  conversationId: string | undefined,
  playerId: string | undefined
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId || !playerId) return;

    const channel = subscribeToMatchVotes(conversationId, ({ messageId }) => {
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.votes(messageId),
      });
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [conversationId, playerId, queryClient]);
}

/**
 * Propose your own time/place on a card. Refreshes both the card (its options
 * live in the message metadata) and the votes, since proposing also votes.
 */
export function useAddCustomOrganizerOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId: _conversationId,
      ...params
    }: Parameters<typeof addCustomOrganizerOption>[0] & { conversationId?: string }) =>
      addCustomOrganizerOption(params),
    onSuccess: (_optionIndex, variables) => {
      if (variables.conversationId) {
        queryClient.invalidateQueries({
          queryKey: chatKeys.messages(variables.conversationId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.votes(variables.messageId),
      });
    },
  });
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

/**
 * Open (get-or-create) the per-pairing chat for a league session sheet match.
 * Returns the conversation id to navigate to, or null when the pairing has no
 * game to organize (a drill or a 3-player rotation).
 */
export function useOpenSessionPairingChat() {
  return useMutation({
    mutationFn: (sessionMatchId: string) => getOrCreateSessionPairingChat(sessionMatchId),
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

// ============================================================================
// SCHEDULING FUNNEL — ONE-TAP BOOKING
// ============================================================================

/** The pairing's tentative booking, if any. */
export function usePairingBooking(tournamentMatchId: string | undefined, enabled = true) {
  return useQuery<PairingBooking | null>({
    queryKey: matchOrganizerKeys.booking(tournamentMatchId ?? ''),
    queryFn: () => getPairingBooking(tournamentMatchId!),
    enabled: !!tournamentMatchId && enabled,
  });
}

/**
 * One-tap booking of a mutual option. Invalidates the card's thread and the
 * booking, so the tentative state replaces the option list in place.
 */
export function useBookMutualOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      optionIndex,
    }: {
      messageId: string;
      optionIndex: number;
      conversationId?: string;
      tournamentMatchId?: string;
    }) => bookMutualOption(messageId, optionIndex),
    onSuccess: (_matchId, variables) => {
      if (variables.conversationId) {
        queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.conversationId) });
      }
      if (variables.tournamentMatchId) {
        queryClient.invalidateQueries({
          queryKey: matchOrganizerKeys.booking(variables.tournamentMatchId),
        });
      }
    },
  });
}

/** "Ça marche": the other side makes the tentative agreement firm. */
export function useAcceptPairingBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tournamentMatchId }: { tournamentMatchId: string; conversationId?: string }) =>
      acceptPairingBooking(tournamentMatchId),
    onSuccess: (_booking, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.booking(variables.tournamentMatchId),
      });
      if (variables.conversationId) {
        queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.conversationId) });
      }
    },
  });
}

/** "Proposer un autre moment": counter the tentative booking, once per pairing. */
export function useReproposePairingSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId: _conversationId,
      ...params
    }: Parameters<typeof reproposePairingSlot>[0] & { conversationId?: string }) =>
      reproposePairingSlot(params),
    onSuccess: (_messageId, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchOrganizerKeys.booking(variables.tournamentMatchId),
      });
      if (variables.conversationId) {
        queryClient.invalidateQueries({ queryKey: chatKeys.messages(variables.conversationId) });
      }
    },
  });
}

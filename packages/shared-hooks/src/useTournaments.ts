/**
 * Tournament Hooks
 *
 * TanStack Query wrappers for the tournament service surface — list/detail
 * queries, registration lifecycle mutations, bracket generation, attach,
 * cancel/archive. Plus useProfilesByIds for the bracket name lookup.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Enums } from '@rallia/shared-types';
import {
  createTournament,
  getTournament,
  listPublicTournaments,
  listMyTournaments,
  listActiveRegistrations,
  listMyActiveRegistrations,
  getMyRegistration,
  openTournamentRegistration,
  closeTournamentRegistration,
  reopenTournamentRegistration,
  registerForTournament,
  withdrawFromTournament,
  removeTournamentRegistration,
  approveTournamentRegistration,
  listTournamentMatches,
  generateTournamentBracket,
  listLinkableMatchesForSlot,
  attachMatchToTournamentSlot,
  overrideTournamentMatchScore,
  cancelTournament,
  archiveTournament,
  updateTournament,
  getProfilesByIds,
  listTournamentParticipants,
  getOrCreateTournamentInvite,
  resetTournamentInvite,
  getTournamentByInviteToken,
  joinTournamentViaInvite,
  listRecentDoublesPartners,
  type CreateTournamentInput,
  type TournamentUpdatePatch,
  type TournamentInviteLink,
  type TournamentInvitePreview,
  type Tournament,
  type TournamentListItem,
  type TournamentRegistration,
  type TournamentMatch,
  type LinkableMatch,
  type PlayerProfile,
  type PlayerSearchResult,
} from '@rallia/shared-services';

export const tournamentKeys = {
  all: ['tournaments'] as const,
  lists: () => [...tournamentKeys.all, 'list'] as const,
  publicList: (sportId?: string) =>
    [...tournamentKeys.lists(), 'public', sportId ?? 'all'] as const,
  myList: (userId: string, sportId?: string) =>
    [...tournamentKeys.lists(), 'mine', userId, sportId ?? 'all'] as const,
  detail: (tournamentId: string) => [...tournamentKeys.all, 'detail', tournamentId] as const,
  registrations: (tournamentId: string) =>
    [...tournamentKeys.all, 'registrations', tournamentId] as const,
  participants: (tournamentId: string) =>
    [...tournamentKeys.all, 'participants', tournamentId] as const,
  myRegistration: (tournamentId: string, userId: string) =>
    [...tournamentKeys.all, 'myRegistration', tournamentId, userId] as const,
  myActiveRegistrations: (userId: string) =>
    [...tournamentKeys.all, 'myActiveRegistrations', userId] as const,
  matches: (tournamentId: string) => [...tournamentKeys.all, 'matches', tournamentId] as const,
  inviteLink: (tournamentId: string) =>
    [...tournamentKeys.all, 'inviteLink', tournamentId] as const,
  invitePreview: (token: string) => [...tournamentKeys.all, 'invitePreview', token] as const,
};

/**
 * Batch-fetch player profiles by id (display_name, profile_picture_url).
 */
export function useProfilesByIds(ids: string[]) {
  // Stable key: sorted unique ids joined.
  const sortedIds = [...new Set(ids)].sort();
  return useQuery<Record<string, PlayerProfile>>({
    queryKey: ['profiles', 'byIds', sortedIds.join(',')],
    queryFn: () => getProfilesByIds(sortedIds),
    enabled: sortedIds.length > 0,
  });
}

/**
 * Visible tournament participants enriched with rating/reputation/online so the
 * Players tab can render them with the shared community PlayerCard. Seed-ordered.
 */
export function useTournamentParticipants(tournamentId: string | undefined) {
  return useQuery<PlayerSearchResult[]>({
    queryKey: tournamentKeys.participants(tournamentId ?? ''),
    queryFn: () => listTournamentParticipants(tournamentId!),
    enabled: !!tournamentId,
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
 * The caller's most recent doubles teammates in a sport — feeds the
 * "recent partners" section of the tournament partner picker.
 */
export function useRecentDoublesPartners(
  userId: string | undefined,
  sportId: string | undefined,
  enabled = true
) {
  return useQuery<PlayerProfile[]>({
    queryKey: [...tournamentKeys.all, 'recentDoublesPartners', userId ?? '', sportId ?? ''],
    queryFn: () => listRecentDoublesPartners(userId!, sportId!),
    enabled: enabled && !!userId && !!sportId,
  });
}

/**
 * List public tournaments for the discovery surface, optionally scoped to a sport.
 */
export function usePublicTournaments(sportId?: string) {
  return useQuery<TournamentListItem[]>({
    queryKey: tournamentKeys.publicList(sportId),
    queryFn: () => listPublicTournaments({ sportId }),
  });
}

/**
 * List the caller's tournaments — organized (incl. drafts) plus registered.
 */
export function useMyTournaments(userId: string | undefined, sportId?: string) {
  return useQuery<TournamentListItem[]>({
    queryKey: tournamentKeys.myList(userId ?? '', sportId),
    queryFn: () => listMyTournaments(userId!, { sportId }),
    enabled: !!userId,
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
    qc.invalidateQueries({ queryKey: tournamentKeys.participants(tournamentId) });
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
 * (every bracket-entry member is a joined participant — 2 for singles,
 * 4 for doubles) is computed client-side.
 */
export function useLinkableMatchesForSlot(params: {
  tournamentMatchId: string | undefined;
  team1UserIds: string[] | undefined;
  team2UserIds: string[] | undefined;
  sportId: string | undefined;
  entryFormat: Enums<'entry_format'> | undefined;
  enabled?: boolean;
}) {
  const enabled =
    (params.enabled ?? true) &&
    !!params.tournamentMatchId &&
    !!params.team1UserIds?.length &&
    !!params.team2UserIds?.length &&
    !!params.sportId &&
    !!params.entryFormat;

  return useQuery<LinkableMatch[]>({
    queryKey: [
      ...tournamentKeys.all,
      'linkable',
      params.tournamentMatchId ?? '',
      (params.team1UserIds ?? []).join('+'),
      (params.team2UserIds ?? []).join('+'),
    ],
    queryFn: () =>
      listLinkableMatchesForSlot({
        tournamentMatchId: params.tournamentMatchId!,
        team1UserIds: params.team1UserIds!,
        team2UserIds: params.team2UserIds!,
        sportId: params.sportId!,
        entryFormat: params.entryFormat!,
      }),
    enabled,
  });
}

/**
 * Organizer partial-update of tournament fields. The server enforces which
 * fields are editable in the tournament's current state.
 */
export function useUpdateTournament(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<
    Tournament,
    Error,
    { tournamentId: string; versionWas: number; patch: TournamentUpdatePatch }
  >({
    mutationFn: ({ tournamentId, versionWas, patch }) =>
      updateTournament(tournamentId, versionWas, patch),
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

export function useReopenTournamentRegistration(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<Tournament, Error, { tournamentId: string; versionWas: number }>({
    mutationFn: ({ tournamentId, versionWas }) =>
      reopenTournamentRegistration(tournamentId, versionWas),
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
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { tournamentId: string; partnerId?: string }
  >({
    mutationFn: ({ tournamentId, partnerId }) => registerForTournament(tournamentId, partnerId),
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

/**
 * Organizer removes a registrant pre-bracket. Permanent: the removed player
 * cannot re-register for this tournament.
 */
export function useRemoveTournamentRegistration(
  options: MutationOptions<TournamentRegistration> = {}
) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string }
  >({
    mutationFn: ({ registrationId, versionWas }) =>
      removeTournamentRegistration(registrationId, versionWas),
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

/**
 * Organizer approves a pending registration (approval-mode tournaments).
 * The approved player flips to 'registered'; detail/registration/participant
 * queries are invalidated so the pending queue and roster refresh.
 */
export function useApproveTournamentRegistration(
  options: MutationOptions<TournamentRegistration> = {}
) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string }
  >({
    mutationFn: ({ registrationId, versionWas }) =>
      approveTournamentRegistration(registrationId, versionWas),
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

/**
 * Organizer's active invite link, minted on first fetch. Only enable when
 * the share UI is actually open — fetching mints a link server-side.
 */
export function useTournamentInviteLink(tournamentId: string | undefined, enabled = true) {
  return useQuery<TournamentInviteLink>({
    queryKey: tournamentKeys.inviteLink(tournamentId ?? ''),
    queryFn: () => getOrCreateTournamentInvite(tournamentId!),
    enabled: !!tournamentId && enabled,
  });
}

/**
 * Revoke the active invite link and mint a fresh one.
 */
export function useResetTournamentInvite(options: MutationOptions<TournamentInviteLink> = {}) {
  const qc = useQueryClient();
  const mutation = useMutation<TournamentInviteLink, Error, { tournamentId: string }>({
    mutationFn: ({ tournamentId }) => resetTournamentInvite(tournamentId),
    onSuccess: link => {
      qc.setQueryData(tournamentKeys.inviteLink(link.tournament_id), link);
      options.onSuccess?.(link);
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
 * Invite-token preview: tournament + active count for a valid token, even
 * when the tournament is private (RLS would hide it pre-registration).
 * INVITE_INVALID is terminal — don't retry.
 */
export function useTournamentInvitePreview(token: string | undefined, enabled = true) {
  return useQuery<TournamentInvitePreview>({
    queryKey: tournamentKeys.invitePreview(token ?? ''),
    queryFn: () => getTournamentByInviteToken(token!),
    enabled: !!token && enabled,
    retry: false,
  });
}

/**
 * Register via an invite token (bypasses registration_mode; idempotent).
 */
export function useJoinTournamentViaInvite(options: MutationOptions<TournamentRegistration> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { token: string; tournamentId: string; partnerId?: string }
  >({
    mutationFn: ({ token, partnerId }) => joinTournamentViaInvite(token, partnerId),
    onSuccess: (reg, vars) => {
      invalidate(vars.tournamentId);
      qc.invalidateQueries({ queryKey: tournamentKeys.lists() });
      qc.invalidateQueries({ queryKey: tournamentKeys.invitePreview(vars.token) });
      options.onSuccess?.(reg);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

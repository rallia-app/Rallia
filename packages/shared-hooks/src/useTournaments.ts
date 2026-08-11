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
  getRegistrationReceiptUrl,
  openTournamentRegistration,
  closeTournamentRegistration,
  reopenTournamentRegistration,
  inviteTournamentPlayers,
  acceptTournamentInvite,
  revokeTournamentInvite,
  registerForTournament,
  getTournamentFeeQuote,
  getEventEarnings,
  getMyPayoutAccount,
  getServiceFeeParams,
  createTournamentRegistrationPayment,
  refundTournamentRegistration,
  withdrawFromTournament,
  removeTournamentRegistration,
  approveTournamentRegistration,
  listTournamentMatches,
  generateTournamentBracket,
  setTournamentSeeds,
  previewTournamentBracket,
  previewTournamentPools,
  generateTournamentPools,
  getTournamentPoolStandings,
  generateTournamentKnockout,
  forfeitTournamentRegistration,
  getTournamentRoundDeadlines,
  setTournamentRoundDeadlines,
  extendTournamentMatchDeadline,
  getTournamentCoOrganizers,
  addTournamentCoOrganizer,
  removeTournamentCoOrganizer,
  amITournamentOrganizer,
  isCertifiedOrganizer,
  listLinkableMatchesForSlot,
  attachMatchToTournamentSlot,
  overrideTournamentMatchScore,
  cancelTournament,
  archiveTournament,
  unarchiveTournament,
  updateTournament,
  getProfilesByIds,
  getPlayersRatingReputation,
  listTournamentParticipants,
  getOrCreateTournamentInvite,
  resetTournamentInvite,
  getTournamentByInviteToken,
  joinTournamentViaInvite,
  listRecentDoublesPartners,
  listMyUnscheduledTournamentMatches,
  type UnscheduledTournamentMatch,
  type CreateTournamentInput,
  type TournamentUpdatePatch,
  type TournamentInviteLink,
  type TournamentInvitePreview,
  type Tournament,
  type TournamentListItem,
  type TournamentRegistration,
  type TournamentMatch,
  type PreviewBracketMatch,
  type PreviewPoolSlot,
  type PoolStandingRow,
  type TournamentRoundDeadline,
  type RoundDeadlineInput,
  type TournamentCoOrganizer,
  type LinkableMatch,
  type PlayerProfile,
  type PlayerRatingReputation,
  type PlayerSearchResult,
  type TournamentFeeQuote,
  type EventEarnings,
  type PayoutAccountStatus,
  type RegistrationPaymentIntent,
  type TournamentRefundResult,
} from '@rallia/shared-services';

export const tournamentKeys = {
  all: ['tournaments'] as const,
  lists: () => [...tournamentKeys.all, 'list'] as const,
  publicList: (sportId?: string) =>
    [...tournamentKeys.lists(), 'public', sportId ?? 'all'] as const,
  myList: (userId: string, sportId?: string, archived = false) =>
    [...tournamentKeys.lists(), 'mine', userId, sportId ?? 'all', archived] as const,
  detail: (tournamentId: string) => [...tournamentKeys.all, 'detail', tournamentId] as const,
  registrations: (tournamentId: string) =>
    [...tournamentKeys.all, 'registrations', tournamentId] as const,
  participants: (tournamentId: string) =>
    [...tournamentKeys.all, 'participants', tournamentId] as const,
  myRegistration: (tournamentId: string, userId: string) =>
    [...tournamentKeys.all, 'myRegistration', tournamentId, userId] as const,
  myActiveRegistrations: (userId: string) =>
    [...tournamentKeys.all, 'myActiveRegistrations', userId] as const,
  registrationReceipt: (registrationId: string) =>
    [...tournamentKeys.all, 'registrationReceipt', registrationId] as const,
  myUnscheduledMatches: (userId: string, sportId?: string) =>
    [...tournamentKeys.all, 'myUnscheduledMatches', userId, sportId ?? 'all'] as const,
  matches: (tournamentId: string) => [...tournamentKeys.all, 'matches', tournamentId] as const,
  bracketPreview: (tournamentId: string) =>
    [...tournamentKeys.all, 'bracketPreview', tournamentId] as const,
  poolPreview: (tournamentId: string) =>
    [...tournamentKeys.all, 'poolPreview', tournamentId] as const,
  poolStandings: (tournamentId: string) =>
    [...tournamentKeys.all, 'poolStandings', tournamentId] as const,
  roundDeadlines: (tournamentId: string) =>
    [...tournamentKeys.all, 'roundDeadlines', tournamentId] as const,
  coOrganizers: (tournamentId: string) =>
    [...tournamentKeys.all, 'coOrganizers', tournamentId] as const,
  amIOrganizer: (tournamentId: string) =>
    [...tournamentKeys.all, 'amIOrganizer', tournamentId] as const,
  inviteLink: (tournamentId: string) =>
    [...tournamentKeys.all, 'inviteLink', tournamentId] as const,
  invitePreview: (token: string) => [...tournamentKeys.all, 'invitePreview', token] as const,
  feeQuote: (tournamentId: string) => [...tournamentKeys.all, 'feeQuote', tournamentId] as const,
  earnings: (eventId: string) => [...tournamentKeys.all, 'earnings', eventId] as const,
  myPayoutAccount: (userId: string) => [...tournamentKeys.all, 'myPayoutAccount', userId] as const,
  myServiceFeeParams: (userId: string) =>
    [...tournamentKeys.all, 'myServiceFeeParams', userId] as const,
  certifiedOrganizer: (playerId: string) =>
    [...tournamentKeys.all, 'certifiedOrganizer', playerId] as const,
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
 * Batch-fetch sport-scoped rating + reputation for a set of players, keyed by
 * player id. Feeds roster rows whose base data lacks badges (e.g. league
 * members, season rosters).
 */
export function usePlayersRatingReputation(playerIds: string[], sportId: string | undefined) {
  // Stable key: sorted unique ids joined.
  const sortedIds = [...new Set(playerIds)].sort();
  return useQuery<Record<string, PlayerRatingReputation>>({
    queryKey: ['players', 'ratingReputation', sportId ?? '', sortedIds.join(',')],
    queryFn: () => getPlayersRatingReputation(sortedIds, sportId!),
    enabled: !!sportId && sortedIds.length > 0,
  });
}

/**
 * Visible tournament participants enriched with rating/reputation/online so the
 * Players tab can render them as roster rows. Seed-ordered.
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
 * The caller's released bracket matches awaiting a linked game — feeds the
 * home competitive action banners.
 */
export function useMyUnscheduledTournamentMatches(userId: string | undefined, sportId?: string) {
  return useQuery<UnscheduledTournamentMatch[]>({
    queryKey: tournamentKeys.myUnscheduledMatches(userId ?? '', sportId),
    queryFn: () => listMyUnscheduledTournamentMatches(userId!, { sportId }),
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
export function useMyTournaments(
  userId: string | undefined,
  sportId?: string,
  opts: { archived?: boolean; enabled?: boolean } = {}
) {
  const archived = opts.archived ?? false;
  return useQuery<TournamentListItem[]>({
    queryKey: tournamentKeys.myList(userId ?? '', sportId, archived),
    queryFn: () => listMyTournaments(userId!, { sportId, archived }),
    enabled: !!userId && (opts.enabled ?? true),
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

/** Stripe receipt link for the caller's paid registration (null until the
 *  webhook stores it). Pass enabled=false for free tournaments. */
export function useRegistrationReceiptUrl(registrationId: string | undefined, enabled = true) {
  return useQuery<string | null>({
    queryKey: tournamentKeys.registrationReceipt(registrationId ?? ''),
    queryFn: () => getRegistrationReceiptUrl(registrationId!),
    enabled: !!registrationId && enabled,
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
    qc.invalidateQueries({ queryKey: tournamentKeys.poolStandings(tournamentId) });
    qc.invalidateQueries({ queryKey: tournamentKeys.roundDeadlines(tournamentId) });
    qc.invalidateQueries({ queryKey: [...tournamentKeys.all, 'myRegistration', tournamentId] });
    qc.invalidateQueries({ queryKey: [...tournamentKeys.all, 'myActiveRegistrations'] });
    // The card's "5/16" chip comes from registration_count, which the list query
    // computes from an embed and bakes into its cached payload. Without this the
    // chip keeps the pre-mutation number, and the persisted cache carries it
    // across restarts.
    qc.invalidateQueries({ queryKey: tournamentKeys.lists() });
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

/** Restores an archived tournament to completed or cancelled, whichever it was. */
export function useUnarchiveTournament(options: MutationOptions<Tournament> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<Tournament, Error, { tournamentId: string; versionWas: number }>({
    mutationFn: ({ tournamentId, versionWas }) => unarchiveTournament(tournamentId, versionWas),
    onSuccess: t => {
      invalidate(t.id);
      // Both views change: the row leaves the archive and rejoins the library.
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
    onError: (e, vars) => {
      // The slot changed under us (opponent linked first / already settled):
      // refetch so the bracket stops offering it.
      if (e.message === 'ALREADY_LINKED' || e.message === 'MATCH_NOT_PENDING') {
        invalidate(vars.tournamentId);
      }
      options.onError?.(e);
    },
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

/**
 * Read-only bracket preview for the current seeds. Organizer-only; enable it
 * while the seeding screen is open (status registration_closed, no bracket yet).
 */
export function useTournamentBracketPreview(tournamentId: string | undefined, enabled: boolean) {
  return useQuery<PreviewBracketMatch[]>({
    queryKey: tournamentKeys.bracketPreview(tournamentId ?? ''),
    queryFn: () => previewTournamentBracket(tournamentId!),
    enabled: !!tournamentId && enabled,
  });
}

/**
 * Read-only serpentine pool preview (pool_knockout, organizer only). Enable
 * while the setup screen is open (registration_closed, no pools yet).
 */
export function useTournamentPoolPreview(tournamentId: string | undefined, enabled: boolean) {
  return useQuery<PreviewPoolSlot[]>({
    queryKey: tournamentKeys.poolPreview(tournamentId ?? ''),
    queryFn: () => previewTournamentPools(tournamentId!),
    enabled: !!tournamentId && enabled,
  });
}

/** Organizer publishes the pool phase (pool_knockout twin of bracket gen). */
export function useGenerateTournamentPools(options: MutationOptions<TournamentMatch[]> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch[],
    Error,
    { tournamentId: string; versionWas: number }
  >({
    mutationFn: ({ tournamentId, versionWas }) => generateTournamentPools(tournamentId, versionWas),
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

/**
 * Derived pool standings. Other players' results move this, so keep it fresh
 * on every mount like the other cross-player reads.
 */
export function useTournamentPoolStandings(tournamentId: string | undefined, enabled = true) {
  return useQuery<PoolStandingRow[]>({
    queryKey: tournamentKeys.poolStandings(tournamentId ?? ''),
    queryFn: () => getTournamentPoolStandings(tournamentId!),
    enabled: !!tournamentId && enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Organizer launches the knockout once every pool match is settled. */
export function useGenerateTournamentKnockout(options: MutationOptions<TournamentMatch[]> = {}) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch[],
    Error,
    { tournamentId: string; versionWas: number }
  >({
    mutationFn: ({ tournamentId, versionWas }) =>
      generateTournamentKnockout(tournamentId, versionWas),
    onSuccess: (matches, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.poolStandings(vars.tournamentId) });
      qc.invalidateQueries({ queryKey: tournamentKeys.roundDeadlines(vars.tournamentId) });
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

/** Organizer removes a player mid-pools (walkovers for the opponents). */
export function useForfeitTournamentRegistration(
  options: MutationOptions<TournamentRegistration> = {}
) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string; reason?: string }
  >({
    mutationFn: ({ registrationId, versionWas, reason }) =>
      forfeitTournamentRegistration(registrationId, versionWas, reason),
    onSuccess: (reg, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.poolStandings(vars.tournamentId) });
      invalidate(vars.tournamentId);
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

/** Phase/round deadlines (advisory read model for countdowns). */
export function useTournamentRoundDeadlines(tournamentId: string | undefined, enabled = true) {
  return useQuery<TournamentRoundDeadline[]>({
    queryKey: tournamentKeys.roundDeadlines(tournamentId ?? ''),
    queryFn: () => getTournamentRoundDeadlines(tournamentId!),
    enabled: !!tournamentId && enabled,
  });
}

/** Organizer upserts phase/round deadlines. */
export function useSetTournamentRoundDeadlines(
  options: MutationOptions<TournamentRoundDeadline[]> = {}
) {
  const qc = useQueryClient();
  const mutation = useMutation<
    TournamentRoundDeadline[],
    Error,
    { tournamentId: string; rounds: RoundDeadlineInput[] }
  >({
    mutationFn: ({ tournamentId, rounds }) => setTournamentRoundDeadlines(tournamentId, rounds),
    onSuccess: (rows, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.roundDeadlines(vars.tournamentId) });
      options.onSuccess?.(rows);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/** Organizer extends one match's deadline. */
export function useExtendTournamentMatchDeadline(options: MutationOptions<TournamentMatch> = {}) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentMatch,
    Error,
    { tournamentMatchId: string; tournamentId: string; deadlineAt: string; reason?: string }
  >({
    mutationFn: ({ tournamentMatchId, deadlineAt, reason }) =>
      extendTournamentMatchDeadline(tournamentMatchId, deadlineAt, reason),
    onSuccess: (row, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.roundDeadlines(vars.tournamentId) });
      invalidate(vars.tournamentId);
      options.onSuccess?.(row);
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
 * Organizer sets the seed order (seed 1 first). Refreshes the bracket preview
 * and detail surfaces so the tree re-renders against the new seeds.
 */
export function useSetTournamentSeeds(options: MutationOptions<TournamentRegistration[]> = {}) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration[],
    Error,
    { tournamentId: string; orderedRegistrationIds: string[]; versionWas: number }
  >({
    mutationFn: ({ tournamentId, orderedRegistrationIds, versionWas }) =>
      setTournamentSeeds(tournamentId, orderedRegistrationIds, versionWas),
    onSuccess: (regs, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.bracketPreview(vars.tournamentId) });
      invalidate(vars.tournamentId);
      options.onSuccess?.(regs);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/** Whether the caller is an organizer (primary or co-organizer) of the tournament. */
export function useIsTournamentOrganizer(tournamentId: string | undefined) {
  return useQuery<boolean>({
    queryKey: tournamentKeys.amIOrganizer(tournamentId ?? ''),
    queryFn: () => amITournamentOrganizer(tournamentId!),
    enabled: !!tournamentId,
  });
}

/**
 * Whether the given organizer is certified — i.e. whether this tournament's
 * results will actually award Circuit Rallia points.
 */
export function useIsCertifiedOrganizer(organizerId: string | undefined) {
  return useQuery<boolean>({
    queryKey: tournamentKeys.certifiedOrganizer(organizerId ?? ''),
    queryFn: () => isCertifiedOrganizer(organizerId!),
    enabled: !!organizerId,
  });
}

/** A tournament's co-organizers (organizer-only read). */
export function useTournamentCoOrganizers(tournamentId: string | undefined) {
  return useQuery<TournamentCoOrganizer[]>({
    queryKey: tournamentKeys.coOrganizers(tournamentId ?? ''),
    queryFn: () => getTournamentCoOrganizers(tournamentId!),
    enabled: !!tournamentId,
  });
}

export function useAddTournamentCoOrganizer(
  options: MutationOptions<TournamentCoOrganizer[]> = {}
) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentCoOrganizer[],
    Error,
    { tournamentId: string; userId: string }
  >({
    mutationFn: ({ tournamentId, userId }) => addTournamentCoOrganizer(tournamentId, userId),
    onSuccess: (rows, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.coOrganizers(vars.tournamentId) });
      invalidate(vars.tournamentId);
      options.onSuccess?.(rows);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useRemoveTournamentCoOrganizer(
  options: MutationOptions<TournamentCoOrganizer[]> = {}
) {
  const qc = useQueryClient();
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentCoOrganizer[],
    Error,
    { tournamentId: string; userId: string }
  >({
    mutationFn: ({ tournamentId, userId }) => removeTournamentCoOrganizer(tournamentId, userId),
    onSuccess: (rows, vars) => {
      qc.invalidateQueries({ queryKey: tournamentKeys.coOrganizers(vars.tournamentId) });
      invalidate(vars.tournamentId);
      options.onSuccess?.(rows);
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

/**
 * Server-authoritative price breakdown for registering in a tournament. Only
 * runs for paid tournaments (entryFeeCents > 0); the quote returns null for
 * free events.
 */
export function useTournamentFeeQuote(tournamentId: string | undefined, enabled = true) {
  return useQuery<TournamentFeeQuote | null>({
    queryKey: tournamentKeys.feeQuote(tournamentId ?? ''),
    queryFn: () => getTournamentFeeQuote(tournamentId as string),
    enabled: !!tournamentId && enabled,
  });
}

/**
 * Organizer-only money summary for one paid event. Pass exactly one id; gate
 * `enabled` on being the organizer of a paid event — the RPC raises
 * NOT_ORGANIZER for anyone else.
 */
export function useEventEarnings(
  ids: { tournamentId?: string; seasonId?: string },
  enabled = true
) {
  const eventId = ids.tournamentId ?? ids.seasonId;
  return useQuery<EventEarnings>({
    queryKey: tournamentKeys.earnings(eventId ?? ''),
    queryFn: () =>
      getEventEarnings(
        ids.tournamentId ? { tournamentId: ids.tournamentId } : { seasonId: ids.seasonId as string }
      ),
    enabled: !!eventId && enabled,
  });
}

/**
 * The current organizer's payout (Stripe Express) account status. Drives the
 * payout status pill + manage/onboard affordance on paid events. Returns null
 * when they've never set up payouts. `userId` only scopes the cache key — the
 * read itself is RLS-scoped to the caller.
 */
export function useMyPayoutAccount(userId: string | undefined, enabled = true) {
  return useQuery<PayoutAccountStatus | null>({
    queryKey: tournamentKeys.myPayoutAccount(userId ?? ''),
    queryFn: () => getMyPayoutAccount(),
    enabled: !!userId && enabled,
  });
}

/**
 * Effective service-fee parameters for the caller as an organizer (organizer
 * override → admin-managed global default). Feeds the creation wizards' fee
 * previews; callers should fall back to DEFAULT_SERVICE_FEE_PARAMS while
 * loading.
 */
export function useMyServiceFeeParams(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: tournamentKeys.myServiceFeeParams(userId ?? ''),
    queryFn: () => getServiceFeeParams(userId!),
    enabled: !!userId && enabled,
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Reserve a slot + open a Stripe PaymentIntent for a paid registration. The
 * screen drives the PaymentSheet with the returned clientSecret; the webhook
 * finalizes the registration on success. Throws TournamentPaymentError(code)
 * on guard failures.
 */
export function useCreateRegistrationPayment(
  options: MutationOptions<RegistrationPaymentIntent> = {}
) {
  const mutation = useMutation<
    RegistrationPaymentIntent,
    Error,
    { tournamentId: string; partnerId?: string }
  >({
    mutationFn: ({ tournamentId, partnerId }) =>
      createTournamentRegistrationPayment(tournamentId, partnerId),
    onSuccess: r => options.onSuccess?.(r),
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * Withdraw from a paid tournament + issue the entry refund (lt-refund-registration).
 * The webhook already finalized the registration on payment; this reverses it.
 */
export function useRefundRegistration(options: MutationOptions<TournamentRefundResult> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRefundResult,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string }
  >({
    mutationFn: ({ registrationId, versionWas }) =>
      refundTournamentRegistration(registrationId, versionWas),
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

export function useInviteTournamentPlayers(options: MutationOptions<number> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<number, Error, { tournamentId: string; userIds: string[] }>({
    mutationFn: ({ tournamentId, userIds }) => inviteTournamentPlayers(tournamentId, userIds),
    onSuccess: (count, { tournamentId }) => {
      invalidate(tournamentId);
      options.onSuccess?.(count);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useAcceptTournamentInvite(options: MutationOptions<TournamentRegistration> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { tournamentId: string; partnerId?: string }
  >({
    mutationFn: ({ tournamentId, partnerId }) => acceptTournamentInvite(tournamentId, partnerId),
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

export function useRevokeTournamentInvite(options: MutationOptions<TournamentRegistration> = {}) {
  const invalidate = useTournamentDetailInvalidator();
  const mutation = useMutation<
    TournamentRegistration,
    Error,
    { registrationId: string; versionWas: number; tournamentId: string }
  >({
    mutationFn: ({ registrationId, versionWas }) =>
      revokeTournamentInvite(registrationId, versionWas),
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
    // Every failure mode here is terminal (NOT_ORGANIZER, TOURNAMENT_TERMINAL,
    // TOURNAMENT_NOT_FOUND) — retrying only delays the error state the share
    // sheet now renders, and the sheet offers an explicit retry.
    retry: false,
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

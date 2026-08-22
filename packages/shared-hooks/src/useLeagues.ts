/**
 * League Hooks — TanStack Query wrappers for V6 league/season flows.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Enums } from '@rallia/shared-types';
import {
  acceptLeagueInvite,
  approveLeagueMember,
  cancelLeagueSession,
  closeSeason,
  inviteLeagueMembers,
  revokeLeagueInvite,
  leaveLeague,
  removeLeagueMember,
  suspendLeagueMember,
  reinstateLeagueMember,
  listLinkableMatchesForSessionSlot,
  attachMatchToSessionSlot,
  confirmSessionPresence,
  withdrawSessionMember,
  remindPendingSessionMembers,
  createLeague,
  createLeagueSession,
  createLeagueSessionSeries,
  createSeason,
  enrollInSeason,
  withdrawFromSeason,
  removeSeasonMember,
  listSeasonMembers,
  getMySeasonMembership,
  getSeasonReceiptUrl,
  generateSessionSheet,
  getLeague,
  getLeagueSession,
  getMyLeagueMembership,
  getMyLeagueWaitlistStatus,
  listLeagueWaitlist,
  type LeagueWaitlistStatus,
  type LeagueWaitlistEntry,
  getMySessionPresence,
  getOrCreateLeagueInvite,
  resetLeagueInvite,
  getLeagueByInviteToken,
  joinLeagueViaInvite,
  type LeagueInviteLink,
  type LeagueInvitePreview,
  joinLeague,
  listLeagueMembers,
  listLeagueSessions,
  listMyLeagues,
  listMyUnscheduledSessionMatches,
  listPublicLeagues,
  listSeasonRankings,
  listSeasons,
  listSessionMatches,
  listSessionPresence,
  openSeason,
  publishSession,
  recordSessionScore,
  publishSessionSheet,
  regenerateSessionSheet,
  setSessionMatchLock,
  swapSessionPlayer,
  updateLeague,
  pauseLeague,
  resumeLeague,
  closeLeague,
  getSeasonFeeQuote,
  createSeasonEnrollmentPayment,
  refundSeasonEnrollment,
  updateSeason,
  cancelSeason,
  type CreateLeagueInput,
  type League,
  type LeagueListItem,
  type LeagueMember,
  type LeagueMemberWithProfile,
  type LeagueUpdatePatch,
  type SeasonFeeQuote,
  type SeasonUpdatePatch,
  type RegistrationPaymentIntent,
  type PresenceStatus,
  type Season,
  type SeasonMember,
  type SeasonMemberWithProfile,
  type SeasonRankingWithProfile,
  type Session,
  type SessionMatch,
  type SessionPresence,
  type SessionPresenceWithProfile,
  type UnscheduledSessionMatch,
  type PairingTeam,
  type MatchStatus,
  type LinkableMatch,
} from '@rallia/shared-services';

export const leagueKeys = {
  all: ['leagues'] as const,
  lists: () => [...leagueKeys.all, 'list'] as const,
  publicList: (sportId?: string) => [...leagueKeys.lists(), 'public', sportId ?? 'all'] as const,
  myList: (userId: string, sportId?: string) =>
    [...leagueKeys.lists(), 'mine', userId, sportId ?? 'all'] as const,
  detail: (leagueId: string) => [...leagueKeys.all, 'detail', leagueId] as const,
  members: (leagueId: string) => [...leagueKeys.all, 'members', leagueId] as const,
  myMembership: (leagueId: string, userId: string) =>
    [...leagueKeys.all, 'myMembership', leagueId, userId] as const,
  waitlist: (leagueId: string) => [...leagueKeys.all, 'waitlist', leagueId] as const,
  myWaitlistStatus: (leagueId: string, userId: string) =>
    [...leagueKeys.all, 'myWaitlistStatus', leagueId, userId] as const,
  seasons: (leagueId: string) => [...leagueKeys.all, 'seasons', leagueId] as const,
  seasonFeeQuote: (seasonId: string) => [...leagueKeys.all, 'seasonFeeQuote', seasonId] as const,
  sessions: (seasonId: string) => [...leagueKeys.all, 'sessions', seasonId] as const,
  myUnscheduledSessionMatches: (userId: string, sportId?: string) =>
    [...leagueKeys.all, 'myUnscheduledSessionMatches', userId, sportId ?? 'all'] as const,
  session: (sessionId: string) => [...leagueKeys.all, 'session', sessionId] as const,
  sessionPresence: (sessionId: string) =>
    [...leagueKeys.all, 'sessionPresence', sessionId] as const,
  mySessionPresence: (sessionId: string, userId: string) =>
    [...leagueKeys.all, 'mySessionPresence', sessionId, userId] as const,
  sessionMatches: (sessionId: string) => [...leagueKeys.all, 'sessionMatches', sessionId] as const,
  rankings: (seasonId: string) => [...leagueKeys.all, 'rankings', seasonId] as const,
  seasonMembers: (seasonId: string) => [...leagueKeys.all, 'seasonMembers', seasonId] as const,
  mySeasonMembership: (seasonId: string, userId: string) =>
    [...leagueKeys.all, 'mySeasonMembership', seasonId, userId] as const,
  seasonReceipt: (seasonMemberId: string) =>
    [...leagueKeys.all, 'seasonReceipt', seasonMemberId] as const,
  inviteLink: (leagueId: string) => [...leagueKeys.all, 'inviteLink', leagueId] as const,
  invitePreview: (token: string) => [...leagueKeys.all, 'invitePreview', token] as const,
};

/**
 * Opt out of the app-wide 2-minute staleTime (App.tsx) for queries whose value
 * can change without this device doing anything. The default is right for most
 * data; these few reflect other people's actions, so a stale copy is a wrong
 * copy on screen.
 */
const ALWAYS_FRESH = { staleTime: 0, refetchOnMount: 'always' } as const;

interface MutationOptions<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
}

function useLeagueDetailInvalidator() {
  const qc = useQueryClient();
  return (leagueId: string) => {
    qc.invalidateQueries({ queryKey: leagueKeys.detail(leagueId) });
    qc.invalidateQueries({ queryKey: leagueKeys.members(leagueId) });
    qc.invalidateQueries({ queryKey: leagueKeys.seasons(leagueId) });
    qc.invalidateQueries({ queryKey: leagueKeys.lists() });
    // Any membership change can reshape the queue (joins queue up, departures
    // and capacity edits promote).
    qc.invalidateQueries({ queryKey: leagueKeys.waitlist(leagueId) });
    qc.invalidateQueries({ queryKey: [...leagueKeys.all, 'myWaitlistStatus', leagueId] });
  };
}

function useSeasonRosterInvalidator() {
  const qc = useQueryClient();
  return (seasonId: string) => {
    qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(seasonId) });
    qc.invalidateQueries({ queryKey: [...leagueKeys.all, 'mySeasonMembership', seasonId] });
    qc.invalidateQueries({ queryKey: leagueKeys.rankings(seasonId) });
  };
}

export function usePublicLeagues(sportId?: string) {
  return useQuery<LeagueListItem[]>({
    queryKey: leagueKeys.publicList(sportId),
    queryFn: () => listPublicLeagues({ sportId }),
    // A directory is only useful if it lists what exists right now: leagues
    // appear and fill up without this device doing anything, so opening the
    // screen always re-reads rather than serving the 2-minute-fresh cache.
    // Cheap, and confined to the two league list screens (not the nav path).
    ...ALWAYS_FRESH,
  });
}

export function useMyLeagues(userId: string | undefined, sportId?: string) {
  return useQuery<LeagueListItem[]>({
    queryKey: leagueKeys.myList(userId ?? '', sportId),
    queryFn: () => listMyLeagues(userId!, { sportId }),
    enabled: !!userId,
    // Being admitted from a waitlist adds a league here with no action from
    // this device.
    ...ALWAYS_FRESH,
  });
}

export function useLeague(leagueId: string | undefined) {
  return useQuery<League | null>({
    queryKey: leagueKeys.detail(leagueId ?? ''),
    queryFn: () => getLeague(leagueId!),
    enabled: !!leagueId,
  });
}

export function useLeagueMembers(leagueId: string | undefined) {
  return useQuery<LeagueMemberWithProfile[]>({
    queryKey: leagueKeys.members(leagueId ?? ''),
    queryFn: () => listLeagueMembers(leagueId!),
    enabled: !!leagueId,
  });
}

export function useMyLeagueMembership(leagueId: string | undefined, userId: string | undefined) {
  return useQuery<LeagueMember | null>({
    queryKey: leagueKeys.myMembership(leagueId ?? '', userId ?? ''),
    queryFn: () => getMyLeagueMembership(leagueId!, userId!),
    enabled: !!leagueId && !!userId,
    // Promotion off the waitlist, approval, suspension and removal all happen
    // on someone else's action, so a cached copy can say "in line" long after
    // you are in. One row; re-read every time the screen opens.
    ...ALWAYS_FRESH,
  });
}

/** Place in line for a queued joiner; null when not queued. */
export function useMyLeagueWaitlistStatus(
  leagueId: string | undefined,
  userId: string | undefined,
  enabled = true
) {
  return useQuery<LeagueWaitlistStatus | null>({
    queryKey: leagueKeys.myWaitlistStatus(leagueId ?? '', userId ?? ''),
    queryFn: () => getMyLeagueWaitlistStatus(leagueId!),
    enabled: enabled && !!leagueId && !!userId,
    // Your place in line moves as people ahead of you are seated.
    ...ALWAYS_FRESH,
  });
}

/** The un-promoted queue in order (organizer sees all rows; others their own). */
export function useLeagueWaitlist(leagueId: string | undefined, enabled = true) {
  return useQuery<LeagueWaitlistEntry[]>({
    queryKey: leagueKeys.waitlist(leagueId ?? ''),
    queryFn: () => listLeagueWaitlist(leagueId!),
    enabled: enabled && !!leagueId,
    ...ALWAYS_FRESH,
  });
}

export function useLeagueSeasons(leagueId: string | undefined) {
  return useQuery<Season[]>({
    queryKey: leagueKeys.seasons(leagueId ?? ''),
    queryFn: () => listSeasons(leagueId!),
    enabled: !!leagueId,
  });
}

export function useSeasonMembers(seasonId: string | undefined) {
  return useQuery<SeasonMemberWithProfile[]>({
    queryKey: leagueKeys.seasonMembers(seasonId ?? ''),
    queryFn: () => listSeasonMembers(seasonId!),
    enabled: !!seasonId,
  });
}

export function useMySeasonMembership(seasonId: string | undefined, userId: string | undefined) {
  return useQuery<SeasonMember | null>({
    queryKey: leagueKeys.mySeasonMembership(seasonId ?? '', userId ?? ''),
    queryFn: () => getMySeasonMembership(seasonId!, userId!),
    enabled: !!seasonId && !!userId,
  });
}

/** Stripe receipt link for the caller's paid season enrollment (null until the
 *  webhook stores it). Pass enabled=false for free seasons. */
export function useSeasonReceiptUrl(seasonMemberId: string | undefined, enabled = true) {
  return useQuery<string | null>({
    queryKey: leagueKeys.seasonReceipt(seasonMemberId ?? ''),
    queryFn: () => getSeasonReceiptUrl(seasonMemberId!),
    enabled: !!seasonMemberId && enabled,
  });
}

export function useCreateLeague(options: MutationOptions<League> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: CreateLeagueInput) => createLeague(input),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.lists() });
      invalidate(result.id);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
  return {
    createLeague: mutation.mutate,
    createLeagueAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useUpdateLeague(options: MutationOptions<League> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<
    League,
    Error,
    { leagueId: string; versionWas: number; patch: LeagueUpdatePatch }
  >({
    mutationFn: ({ leagueId, versionWas, patch }) => updateLeague(leagueId, versionWas, patch),
    onSuccess: league => {
      invalidate(league.id);
      qc.invalidateQueries({ queryKey: leagueKeys.lists() });
      options.onSuccess?.(league);
    },
    onError: e => options.onError?.(e),
  });
  return {
    updateLeague: mutation.mutate,
    updateLeagueAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Lifecycle transitions share a shape: version-guarded, invalidate the detail +
 * lists (status drives list filtering and every organizer control).
 */
function useLeagueLifecycleMutation(
  fn: (leagueId: string, versionWas: number) => Promise<League>,
  options: MutationOptions<League> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  return useMutation<League, Error, { leagueId: string; versionWas: number }>({
    mutationFn: ({ leagueId, versionWas }) => fn(leagueId, versionWas),
    onSuccess: league => {
      invalidate(league.id);
      qc.invalidateQueries({ queryKey: leagueKeys.lists() });
      options.onSuccess?.(league);
    },
    onError: e => options.onError?.(e),
  });
}

export function usePauseLeague(options: MutationOptions<League> = {}) {
  const mutation = useLeagueLifecycleMutation(pauseLeague, options);
  return { pauseLeagueAsync: mutation.mutateAsync, isPausing: mutation.isPending };
}

export function useResumeLeague(options: MutationOptions<League> = {}) {
  const mutation = useLeagueLifecycleMutation(resumeLeague, options);
  return { resumeLeagueAsync: mutation.mutateAsync, isResuming: mutation.isPending };
}

export function useCloseLeague(options: MutationOptions<League> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<
    League,
    Error,
    { leagueId: string; reason: string | null; versionWas: number }
  >({
    mutationFn: ({ leagueId, reason, versionWas }) => closeLeague(leagueId, reason, versionWas),
    onSuccess: league => {
      invalidate(league.id);
      qc.invalidateQueries({ queryKey: leagueKeys.lists() });
      options.onSuccess?.(league);
    },
    onError: e => options.onError?.(e),
  });
  return { closeLeagueAsync: mutation.mutateAsync, isClosing: mutation.isPending };
}

export function useJoinLeague(leagueId: string, options: MutationOptions<LeagueMember> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: () => joinLeague(leagueId),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

/**
 * The caller's active share link for the league (organizer or player kind,
 * decided server-side). Every failure mode is terminal (LEAGUE_NOT_FOUND,
 * LEAGUE_NOT_ACTIVE, SHARING_NOT_AVAILABLE) — the share sheet renders the
 * error state and offers its own retry.
 */
export function useLeagueInviteLink(leagueId: string | undefined, enabled = true) {
  return useQuery<LeagueInviteLink>({
    queryKey: leagueKeys.inviteLink(leagueId ?? ''),
    queryFn: () => getOrCreateLeagueInvite(leagueId!),
    enabled: !!leagueId && enabled,
    retry: false,
  });
}

/**
 * Revoke the active organizer link and mint a fresh one (player links are
 * untouched — they redeem through the normal rules).
 */
export function useResetLeagueInvite(options: MutationOptions<LeagueInviteLink> = {}) {
  const qc = useQueryClient();
  const mutation = useMutation<LeagueInviteLink, Error, { leagueId: string }>({
    mutationFn: ({ leagueId }) => resetLeagueInvite(leagueId),
    onSuccess: link => {
      qc.setQueryData(leagueKeys.inviteLink(link.league_id), link);
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
 * Invite-token preview: league + active member count for a valid token, even
 * when the league is private (RLS would hide it pre-join). INVITE_INVALID is
 * terminal — don't retry.
 */
export function useLeagueInvitePreview(token: string | undefined, enabled = true) {
  return useQuery<LeagueInvitePreview>({
    queryKey: leagueKeys.invitePreview(token ?? ''),
    queryFn: () => getLeagueByInviteToken(token!),
    enabled: !!token && enabled,
    retry: false,
  });
}

/**
 * Join via an invite token (organizer links bypass join_mode and the gates;
 * player links go through the normal rules; idempotent).
 */
export function useJoinLeagueViaInvite(options: MutationOptions<LeagueMember> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  const mutation = useMutation<LeagueMember, Error, { token: string; leagueId: string }>({
    mutationFn: ({ token }) => joinLeagueViaInvite(token),
    onSuccess: (member, vars) => {
      invalidate(vars.leagueId);
      qc.invalidateQueries({ queryKey: leagueKeys.lists() });
      qc.invalidateQueries({ queryKey: leagueKeys.invitePreview(vars.token) });
      options.onSuccess?.(member);
    },
    onError: e => options.onError?.(e),
  });
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useApproveLeagueMember(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({ memberId, versionWas }: { memberId: string; versionWas: number }) =>
      approveLeagueMember(memberId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useCreateSeason(leagueId: string, options: MutationOptions<Season> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: (input: {
      name: string;
      startDate: string;
      endDate: string;
      rulesOverride?: Record<string, unknown>;
      /** Omit or 0 for a free season. Fees lock once the season opens. */
      entryFeeCents?: number;
      feePayer?: Enums<'fee_payer_enum'>;
      payoutTiming?: Enums<'payout_timing_enum'>;
      refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
      refundPartialBps?: number | null;
      refundCutoffAt?: string | null;
    }) => createSeason({ leagueId, ...input }),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useOpenSeason(leagueId: string, options: MutationOptions<Season> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({ seasonId, versionWas }: { seasonId: string; versionWas: number }) =>
      openSeason(seasonId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useEnrollInSeason(seasonId: string, options: MutationOptions<SeasonMember> = {}) {
  const invalidateRoster = useSeasonRosterInvalidator();
  return useMutation({
    mutationFn: () => enrollInSeason(seasonId),
    onSuccess: result => {
      invalidateRoster(seasonId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useWithdrawFromSeason(
  seasonId: string,
  options: MutationOptions<SeasonMember> = {}
) {
  const invalidateRoster = useSeasonRosterInvalidator();
  return useMutation({
    mutationFn: () => withdrawFromSeason(seasonId),
    onSuccess: result => {
      invalidateRoster(seasonId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useRemoveSeasonMember(
  seasonId: string,
  options: MutationOptions<SeasonMember> = {}
) {
  const invalidateRoster = useSeasonRosterInvalidator();
  return useMutation({
    mutationFn: ({ seasonMemberId, versionWas }: { seasonMemberId: string; versionWas: number }) =>
      removeSeasonMember(seasonMemberId, versionWas),
    onSuccess: result => {
      invalidateRoster(seasonId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Sessions (V7 slice)
// ---------------------------------------------------------------------------

export function useSeasonSessions(seasonId: string | undefined) {
  return useQuery<Session[]>({
    queryKey: leagueKeys.sessions(seasonId ?? ''),
    queryFn: () => listLeagueSessions(seasonId!),
    enabled: !!seasonId,
  });
}

/**
 * The caller's released session matchups awaiting a linked game — feeds the
 * home competitive action banners.
 */
export function useMyUnscheduledSessionMatches(userId: string | undefined, sportId?: string) {
  return useQuery<UnscheduledSessionMatch[]>({
    queryKey: leagueKeys.myUnscheduledSessionMatches(userId ?? '', sportId),
    queryFn: () => listMyUnscheduledSessionMatches(userId!, { sportId }),
    enabled: !!userId,
  });
}

export function useSession(sessionId: string | undefined) {
  return useQuery<Session | null>({
    queryKey: leagueKeys.session(sessionId ?? ''),
    queryFn: () => getLeagueSession(sessionId!),
    enabled: !!sessionId,
  });
}

export function useSessionPresence(sessionId: string | undefined) {
  return useQuery<SessionPresenceWithProfile[]>({
    queryKey: leagueKeys.sessionPresence(sessionId ?? ''),
    queryFn: () => listSessionPresence(sessionId!),
    enabled: !!sessionId,
  });
}

export function useMySessionPresence(sessionId: string | undefined, userId: string | undefined) {
  return useQuery<SessionPresence | null>({
    queryKey: leagueKeys.mySessionPresence(sessionId ?? '', userId ?? ''),
    queryFn: () => getMySessionPresence(sessionId!, userId!),
    enabled: !!sessionId && !!userId,
  });
}

function useSessionInvalidator() {
  const qc = useQueryClient();
  return (sessionId: string) => {
    qc.invalidateQueries({ queryKey: leagueKeys.session(sessionId) });
    qc.invalidateQueries({ queryKey: leagueKeys.sessionPresence(sessionId) });
    qc.invalidateQueries({ queryKey: [...leagueKeys.all, 'mySessionPresence', sessionId] });
  };
}

export function useCreateSession(seasonId: string, options: MutationOptions<Session> = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      scheduledAt: string;
      timezone?: string;
      durationMinutes?: number;
      facilityId?: string;
      venueName?: string;
      capacity?: number;
      rounds?: number;
      pairingMode?: Enums<'pairing_mode'>;
      playWindowEndsAt?: string;
    }) => createLeagueSession({ seasonId, ...input }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessions(seasonId) });
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useCreateSessionSeries(seasonId: string, options: MutationOptions<Session[]> = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      firstAt: string;
      repeatEveryDays: number;
      occurrences: number;
      timezone?: string;
      capacity?: number;
      rounds?: number;
      pairingMode?: Enums<'pairing_mode'>;
      windowDays?: number;
    }) => createLeagueSessionSeries({ seasonId, ...input }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessions(seasonId) });
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function usePublishSession(seasonId: string, options: MutationOptions<Session> = {}) {
  const qc = useQueryClient();
  const invalidate = useSessionInvalidator();
  return useMutation({
    mutationFn: ({
      sessionId,
      versionWas,
      deadline,
    }: {
      sessionId: string;
      versionWas: number;
      deadline?: string;
    }) => publishSession(sessionId, versionWas, deadline),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessions(seasonId) });
      invalidate(result.id);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

/**
 * Organizer frees a seat by withdrawing a member from a session. The waitlist
 * promotion happens server-side, so invalidating the session is enough for the
 * promoted player to appear.
 */
export function useWithdrawSessionMember(
  sessionId: string,
  options: MutationOptions<SessionPresence> = {}
) {
  const invalidate = useSessionInvalidator();
  return useMutation({
    mutationFn: ({ userId, versionWas }: { userId: string; versionWas: number }) =>
      withdrawSessionMember(sessionId, userId, versionWas),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

/**
 * Nudges the members who have not answered. Sends notifications only, so
 * nothing local changes and there is nothing to invalidate.
 */
export function useRemindPendingSessionMembers(
  sessionId: string,
  options: MutationOptions<number> = {}
) {
  return useMutation({
    mutationFn: () => remindPendingSessionMembers(sessionId),
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useConfirmSessionPresence(
  sessionId: string,
  options: MutationOptions<SessionPresence> = {}
) {
  const invalidate = useSessionInvalidator();
  return useMutation({
    mutationFn: ({ status, partnerId }: { status: PresenceStatus; partnerId?: string }) =>
      confirmSessionPresence(sessionId, status, partnerId),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useCancelSession(seasonId: string, options: MutationOptions<Session> = {}) {
  const qc = useQueryClient();
  const invalidate = useSessionInvalidator();
  return useMutation({
    mutationFn: ({
      sessionId,
      versionWas,
      reason,
    }: {
      sessionId: string;
      versionWas: number;
      reason?: string;
    }) => cancelLeagueSession(sessionId, versionWas, reason),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessions(seasonId) });
      invalidate(result.id);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Match sheet (V8 slice)
// ---------------------------------------------------------------------------

export function useSessionMatches(sessionId: string | undefined) {
  return useQuery<SessionMatch[]>({
    queryKey: leagueKeys.sessionMatches(sessionId ?? ''),
    queryFn: () => listSessionMatches(sessionId!),
    enabled: !!sessionId,
  });
}

function useSheetInvalidator() {
  const qc = useQueryClient();
  return (sessionId: string) => {
    qc.invalidateQueries({ queryKey: leagueKeys.sessionMatches(sessionId) });
    qc.invalidateQueries({ queryKey: leagueKeys.session(sessionId) });
  };
}

export function useGenerateSessionSheet(sessionId: string, options: MutationOptions<Session> = {}) {
  const invalidate = useSheetInvalidator();
  return useMutation({
    mutationFn: ({ versionWas, regenerate }: { versionWas: number; regenerate?: boolean }) =>
      regenerate
        ? regenerateSessionSheet(sessionId, versionWas)
        : generateSessionSheet(sessionId, versionWas),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function usePublishSessionSheet(sessionId: string, options: MutationOptions<Session> = {}) {
  const invalidate = useSheetInvalidator();
  return useMutation({
    mutationFn: ({ versionWas }: { versionWas: number }) =>
      publishSessionSheet(sessionId, versionWas),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useSwapSessionPlayer(sessionId: string, options: MutationOptions<Session> = {}) {
  const invalidate = useSheetInvalidator();
  return useMutation({
    mutationFn: ({
      matchId,
      userOut,
      userIn,
      versionWas,
    }: {
      matchId: string;
      userOut: string;
      userIn: string;
      versionWas: number;
    }) => swapSessionPlayer(sessionId, matchId, userOut, userIn, versionWas),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useSetSessionMatchLock(
  sessionId: string,
  options: MutationOptions<SessionMatch> = {}
) {
  const invalidate = useSheetInvalidator();
  return useMutation({
    mutationFn: ({
      sessionMatchId,
      locked,
      versionWas,
    }: {
      sessionMatchId: string;
      locked: boolean;
      versionWas: number;
    }) => setSessionMatchLock(sessionMatchId, locked, versionWas),
    onSuccess: result => {
      invalidate(sessionId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Scoring + ranking (V9 slice)
// ---------------------------------------------------------------------------

export function useSeasonRankings(seasonId: string | undefined) {
  return useQuery<SeasonRankingWithProfile[]>({
    queryKey: leagueKeys.rankings(seasonId ?? ''),
    queryFn: () => listSeasonRankings(seasonId!),
    enabled: !!seasonId,
  });
}

export function useRecordSessionScore(
  sessionId: string,
  seasonId: string,
  options: MutationOptions<SessionMatch> = {}
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionMatchId: string;
      winnerTeam: PairingTeam;
      score?: string;
      status?: MatchStatus;
      versionWas: number;
    }) => recordSessionScore(input),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessionMatches(sessionId) });
      qc.invalidateQueries({ queryKey: leagueKeys.session(sessionId) });
      qc.invalidateQueries({ queryKey: leagueKeys.rankings(seasonId) });
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useCloseSeason(leagueId: string, options: MutationOptions<Season> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seasonId, versionWas }: { seasonId: string; versionWas: number }) =>
      closeSeason(seasonId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      qc.invalidateQueries({ queryKey: leagueKeys.rankings(result.id) });
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Member invites (intra-app)
// ---------------------------------------------------------------------------

export function useInviteLeagueMembers(leagueId: string, options: MutationOptions<number> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: (userIds: string[]) => inviteLeagueMembers(leagueId, userIds),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useAcceptLeagueInvite(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: () => acceptLeagueInvite(leagueId),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useRevokeLeagueInvite(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({ memberId, versionWas }: { memberId: string; versionWas: number }) =>
      revokeLeagueInvite(memberId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Member lifecycle (leave / remove / suspend / reinstate)
// ---------------------------------------------------------------------------

export function useLeaveLeague(leagueId: string, options: MutationOptions<LeagueMember> = {}) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: () => leaveLeague(leagueId),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useRemoveLeagueMember(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({ memberId, versionWas }: { memberId: string; versionWas: number }) =>
      removeLeagueMember(memberId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useSuspendLeagueMember(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({
      memberId,
      versionWas,
      reason,
      until,
    }: {
      memberId: string;
      versionWas: number;
      reason?: string;
      until?: string;
    }) => suspendLeagueMember(memberId, versionWas, { reason, until }),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

export function useReinstateLeagueMember(
  leagueId: string,
  options: MutationOptions<LeagueMember> = {}
) {
  const invalidate = useLeagueDetailInvalidator();
  return useMutation({
    mutationFn: ({ memberId, versionWas }: { memberId: string; versionWas: number }) =>
      reinstateLeagueMember(memberId, versionWas),
    onSuccess: result => {
      invalidate(leagueId);
      options.onSuccess?.(result);
    },
    onError: options.onError,
  });
}

// ---------------------------------------------------------------------------
// Session match bridge — link a verified casual match to a session pairing
// ---------------------------------------------------------------------------

export function useLinkableMatchesForSessionSlot(params: {
  sessionMatchId: string | undefined;
  team1UserIds: string[] | undefined;
  team2UserIds: string[] | undefined;
  sportId: string | undefined;
  entryFormat: Enums<'entry_format'> | undefined;
  enabled?: boolean;
}) {
  const enabled =
    (params.enabled ?? true) &&
    !!params.sessionMatchId &&
    !!params.team1UserIds?.length &&
    !!params.team2UserIds?.length &&
    !!params.sportId &&
    !!params.entryFormat;

  return useQuery<LinkableMatch[]>({
    queryKey: [
      ...leagueKeys.all,
      'linkableSession',
      params.sessionMatchId ?? '',
      (params.team1UserIds ?? []).join('+'),
      (params.team2UserIds ?? []).join('+'),
    ],
    queryFn: () =>
      listLinkableMatchesForSessionSlot({
        sessionMatchId: params.sessionMatchId!,
        team1UserIds: params.team1UserIds!,
        team2UserIds: params.team2UserIds!,
        sportId: params.sportId!,
        entryFormat: params.entryFormat!,
      }),
    enabled,
  });
}

export function useAttachMatchToSessionSlot(
  sessionId: string,
  seasonId: string,
  options: MutationOptions<SessionMatch> = {}
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionMatchId, matchId }: { sessionMatchId: string; matchId: string }) =>
      attachMatchToSessionSlot(sessionMatchId, matchId),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: leagueKeys.sessionMatches(sessionId) });
      qc.invalidateQueries({ queryKey: leagueKeys.session(sessionId) });
      qc.invalidateQueries({ queryKey: leagueKeys.sessionPresence(sessionId) });
      qc.invalidateQueries({ queryKey: leagueKeys.rankings(seasonId) });
      options.onSuccess?.(result);
    },
    onError: e => {
      // The pairing changed under us (opponent linked first / already settled):
      // refetch so the session stops offering it.
      if (
        e instanceof Error &&
        (e.message === 'ALREADY_LINKED' || e.message === 'MATCH_NOT_PENDING')
      ) {
        qc.invalidateQueries({ queryKey: leagueKeys.sessionMatches(sessionId) });
        qc.invalidateQueries({ queryKey: leagueKeys.session(sessionId) });
      }
      options.onError?.(e);
    },
  });
}

export type { CreateLeagueInput, League, LeagueListItem, LeagueMember, Season };
export type {
  Session,
  SessionPresence,
  SessionPresenceWithProfile,
  SessionMatch,
  SeasonRankingWithProfile,
  PresenceStatus,
};

// ---------------------------------------------------------------------------
// Paid seasons
// ---------------------------------------------------------------------------

/** Null for a free season. */
export function useSeasonFeeQuote(seasonId: string | undefined, enabled = true) {
  return useQuery<SeasonFeeQuote | null>({
    queryKey: leagueKeys.seasonFeeQuote(seasonId ?? ''),
    queryFn: () => getSeasonFeeQuote(seasonId as string),
    enabled: !!seasonId && enabled,
  });
}

/**
 * Claim a season slot + open a Stripe PaymentIntent. The screen drives the
 * PaymentSheet with the returned clientSecret; the webhook flips the member to
 * 'enrolled'. Throws TournamentPaymentError(code) on guard failures.
 */
export function useCreateSeasonEnrollmentPayment(
  options: MutationOptions<RegistrationPaymentIntent> = {}
) {
  const mutation = useMutation<RegistrationPaymentIntent, Error, { seasonId: string }>({
    mutationFn: ({ seasonId }) => createSeasonEnrollmentPayment(seasonId),
    onSuccess: r => options.onSuccess?.(r),
    onError: e => options.onError?.(e),
  });
  return {
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/** Withdraw from a paid season + refund the entry per policy. */
export function useRefundSeasonEnrollment(
  options: MutationOptions<{ withdrawn: boolean; refundedCents: number }> = {}
) {
  const qc = useQueryClient();
  const mutation = useMutation<
    { withdrawn: boolean; refundedCents: number },
    Error,
    { seasonMemberId: string; versionWas: number; seasonId: string; leagueId: string }
  >({
    mutationFn: ({ seasonMemberId, versionWas }) =>
      refundSeasonEnrollment(seasonMemberId, versionWas),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: leagueKeys.seasons(vars.leagueId) });
      qc.invalidateQueries({ queryKey: leagueKeys.seasonMembers(vars.seasonId) });
      options.onSuccess?.(r);
    },
    onError: e => options.onError?.(e),
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
}

export function useUpdateSeason(options: MutationOptions<Season> = {}) {
  const qc = useQueryClient();
  const mutation = useMutation<
    Season,
    Error,
    { seasonId: string; versionWas: number; patch: SeasonUpdatePatch; leagueId: string }
  >({
    mutationFn: ({ seasonId, versionWas, patch }) => updateSeason(seasonId, versionWas, patch),
    onSuccess: (season, vars) => {
      qc.invalidateQueries({ queryKey: leagueKeys.seasons(vars.leagueId) });
      qc.invalidateQueries({ queryKey: leagueKeys.seasonFeeQuote(season.id) });
      options.onSuccess?.(season);
    },
    onError: e => options.onError?.(e),
  });
  return { updateSeasonAsync: mutation.mutateAsync, isUpdatingSeason: mutation.isPending };
}

export function useCancelSeason(options: MutationOptions<Season> = {}) {
  const qc = useQueryClient();
  const mutation = useMutation<
    Season,
    Error,
    { seasonId: string; reason: string | null; versionWas: number; leagueId: string }
  >({
    mutationFn: ({ seasonId, reason, versionWas }) => cancelSeason(seasonId, reason, versionWas),
    onSuccess: (season, vars) => {
      qc.invalidateQueries({ queryKey: leagueKeys.seasons(vars.leagueId) });
      qc.invalidateQueries({ queryKey: leagueKeys.sessions(season.id) });
      options.onSuccess?.(season);
    },
    onError: e => options.onError?.(e),
  });
  return { cancelSeasonAsync: mutation.mutateAsync, isCancellingSeason: mutation.isPending };
}

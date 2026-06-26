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
  confirmSessionPresence,
  createLeague,
  createLeagueSession,
  createSeason,
  generateSessionSheet,
  getLeague,
  getLeagueSession,
  getMyLeagueMembership,
  getMySessionPresence,
  joinLeague,
  listLeagueMembers,
  listLeagueSessions,
  listMyLeagues,
  listPublicLeagues,
  listSeasonRankings,
  listSeasons,
  listSessionMatches,
  listSessionPresence,
  openSeason,
  publishSession,
  recordSessionScore,
  regenerateSessionSheet,
  setSessionMatchLock,
  type CreateLeagueInput,
  type League,
  type LeagueListItem,
  type LeagueMember,
  type LeagueMemberWithProfile,
  type PresenceStatus,
  type Season,
  type SeasonRankingWithProfile,
  type Session,
  type SessionMatch,
  type SessionPresence,
  type SessionPresenceWithProfile,
  type PairingTeam,
  type MatchStatus,
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
  seasons: (leagueId: string) => [...leagueKeys.all, 'seasons', leagueId] as const,
  sessions: (seasonId: string) => [...leagueKeys.all, 'sessions', seasonId] as const,
  session: (sessionId: string) => [...leagueKeys.all, 'session', sessionId] as const,
  sessionPresence: (sessionId: string) =>
    [...leagueKeys.all, 'sessionPresence', sessionId] as const,
  mySessionPresence: (sessionId: string, userId: string) =>
    [...leagueKeys.all, 'mySessionPresence', sessionId, userId] as const,
  sessionMatches: (sessionId: string) => [...leagueKeys.all, 'sessionMatches', sessionId] as const,
  rankings: (seasonId: string) => [...leagueKeys.all, 'rankings', seasonId] as const,
};

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
  };
}

export function usePublicLeagues(sportId?: string) {
  return useQuery<LeagueListItem[]>({
    queryKey: leagueKeys.publicList(sportId),
    queryFn: () => listPublicLeagues({ sportId }),
  });
}

export function useMyLeagues(userId: string | undefined, sportId?: string) {
  return useQuery<LeagueListItem[]>({
    queryKey: leagueKeys.myList(userId ?? '', sportId),
    queryFn: () => listMyLeagues(userId!, { sportId }),
    enabled: !!userId,
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
  });
}

export function useLeagueSeasons(leagueId: string | undefined) {
  return useQuery<Season[]>({
    queryKey: leagueKeys.seasons(leagueId ?? ''),
    queryFn: () => listSeasons(leagueId!),
    enabled: !!leagueId,
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
    }) => createLeagueSession({ seasonId, ...input }),
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

export type { CreateLeagueInput, League, LeagueListItem, LeagueMember, Season };
export type {
  Session,
  SessionPresence,
  SessionPresenceWithProfile,
  SessionMatch,
  SeasonRankingWithProfile,
  PresenceStatus,
};

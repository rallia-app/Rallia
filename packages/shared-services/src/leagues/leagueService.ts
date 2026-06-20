/**
 * League Service
 *
 * Wraps the L&T Postgres RPCs for leagues and seasons (V6 slice).
 */

import type { Tables, Enums } from '@rallia/shared-types';

import { getProfilesByIds, type PlayerProfile } from '../tournaments/tournamentService';
import { supabase } from '../supabase';

export type League = Tables<'leagues'>;
export type LeagueMember = Tables<'league_members'>;
export type Season = Tables<'seasons'>;
export type Session = Tables<'sessions'>;
export type SessionPresence = Tables<'session_presence'>;
export type SessionMatch = Tables<'session_matches'>;
export type SeasonRanking = Tables<'season_rankings'>;
export type PresenceStatus = Enums<'session_presence_status'>;
export type MatchStatus = Enums<'session_match_status'>;
export type PairingTeam = Enums<'pairing_team'>;

export interface SeasonRankingWithProfile extends SeasonRanking {
  profile?: PlayerProfile | null;
}

export interface SessionPresenceWithProfile extends SessionPresence {
  profile?: PlayerProfile | null;
}

export type LeagueListItem = League & { member_count: number };

const LIST_SELECT = '*, league_members(count)';

function toListItem(row: Record<string, unknown>): LeagueListItem {
  const { league_members, ...league } = row as League & {
    league_members?: { count: number }[];
  };
  return {
    ...(league as League),
    member_count: league_members?.[0]?.count ?? 0,
  };
}

export interface CreateLeagueInput {
  name: string;
  sportId: string;
  description?: string;
  visibility?: Enums<'tournament_visibility'>;
  joinMode?: Enums<'tournament_registration_mode'>;
  facilityId?: string;
  venueName?: string;
  networkId?: string;
  minRating?: number;
  maxRating?: number;
  minReputation?: number;
}

export interface LeagueMemberWithProfile extends LeagueMember {
  profile?: PlayerProfile | null;
}

export async function listPublicLeagues(
  opts: { sportId?: string } = {}
): Promise<LeagueListItem[]> {
  let query = supabase
    .from('leagues')
    .select(LIST_SELECT)
    .eq('visibility', 'public')
    .eq('status', 'active')
    .eq('league_members.status', 'active')
    .order('created_at', { ascending: false });
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toListItem);
}

export async function listMyLeagues(
  userId: string,
  opts: { sportId?: string } = {}
): Promise<LeagueListItem[]> {
  const { data: memberships, error: memError } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', userId)
    .in('status', ['active', 'pending']);
  if (memError) throw new Error(memError.message);

  const memberLeagueIds = [...new Set((memberships ?? []).map(m => m.league_id))];

  let query = supabase
    .from('leagues')
    .select(LIST_SELECT)
    .neq('status', 'closed')
    .eq('league_members.status', 'active')
    .order('created_at', { ascending: false });

  query = memberLeagueIds.length
    ? query.or(`organizer_id.eq.${userId},id.in.(${memberLeagueIds.join(',')})`)
    : query.eq('organizer_id', userId);

  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toListItem);
}

export async function getLeague(leagueId: string): Promise<League | null> {
  const { data, error } = await supabase.from('leagues').select('*').eq('id', leagueId).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }
  return data as League;
}

export async function createLeague(input: CreateLeagueInput): Promise<League> {
  const { data, error } = await supabase.rpc('league_create', {
    p_name: input.name,
    p_sport_id: input.sportId,
    p_description: input.description ?? null,
    p_visibility: input.visibility ?? 'private',
    p_join_mode: input.joinMode ?? 'approval',
    p_facility_id: input.facilityId ?? null,
    p_venue_name: input.venueName ?? null,
    p_network_id: input.networkId ?? null,
    p_min_rating: input.minRating ?? null,
    p_max_rating: input.maxRating ?? null,
    p_min_reputation: input.minReputation ?? null,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

export async function joinLeague(leagueId: string): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_join', { p_league_id: leagueId });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function approveLeagueMember(
  memberId: string,
  versionWas: number
): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_approve_member', {
    p_member_id: memberId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function listLeagueMembers(leagueId: string): Promise<LeagueMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select('*')
    .eq('league_id', leagueId)
    .in('status', ['active', 'pending', 'suspended'])
    .order('joined_at', { ascending: true });
  if (error) throw new Error(error.message);
  const members = (data ?? []) as LeagueMember[];
  if (members.length === 0) return [];

  const profiles = await getProfilesByIds(members.map(m => m.user_id));
  return members.map(m => ({
    ...m,
    profile: profiles[m.user_id] ?? null,
  }));
}

export async function getMyLeagueMembership(
  leagueId: string,
  userId: string
): Promise<LeagueMember | null> {
  const { data, error } = await supabase
    .from('league_members')
    .select('*')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as LeagueMember | null;
}

export async function listSeasons(leagueId: string): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('league_id', leagueId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Season[];
}

export async function createSeason(input: {
  leagueId: string;
  name: string;
  startDate: string;
  endDate: string;
  rulesOverride?: Record<string, unknown>;
}): Promise<Season> {
  const { data, error } = await supabase.rpc('season_create', {
    p_league_id: input.leagueId,
    p_name: input.name,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_rules_override: input.rulesOverride ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Season;
}

export async function openSeason(seasonId: string, versionWas: number): Promise<Season> {
  const { data, error } = await supabase.rpc('season_open', {
    p_season_id: seasonId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Season;
}

export function isLeagueOrganizer(league: League, userId: string | undefined): boolean {
  if (!userId) return false;
  return league.organizer_id === userId;
}

// ---------------------------------------------------------------------------
// Sessions (V7 slice)
// ---------------------------------------------------------------------------

export async function listLeagueSessions(seasonId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('season_id', seasonId)
    .order('scheduled_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Session[];
}

export async function getLeagueSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Session | null;
}

export async function listSessionPresence(
  sessionId: string
): Promise<SessionPresenceWithProfile[]> {
  const { data, error } = await supabase
    .from('session_presence')
    .select('*')
    .eq('session_id', sessionId)
    .order('waitlist_position', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SessionPresence[];
  if (rows.length === 0) return [];

  const profiles = await getProfilesByIds(rows.map(r => r.user_id));
  return rows.map(r => ({ ...r, profile: profiles[r.user_id] ?? null }));
}

export async function getMySessionPresence(
  sessionId: string,
  userId: string
): Promise<SessionPresence | null> {
  const { data, error } = await supabase
    .from('session_presence')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SessionPresence | null;
}

export async function createLeagueSession(input: {
  seasonId: string;
  name: string;
  scheduledAt: string;
  timezone?: string;
  durationMinutes?: number;
  facilityId?: string;
  venueName?: string;
  capacity?: number;
  rounds?: number;
  pairingMode?: Enums<'pairing_mode'>;
}): Promise<Session> {
  const { data, error } = await supabase.rpc('session_create', {
    p_season_id: input.seasonId,
    p_name: input.name,
    p_scheduled_at: input.scheduledAt,
    p_timezone: input.timezone ?? null,
    p_duration_minutes: input.durationMinutes ?? 90,
    p_facility_id: input.facilityId ?? null,
    p_venue_name: input.venueName ?? null,
    p_capacity: input.capacity ?? null,
    p_rounds: input.rounds ?? 1,
    p_pairing_mode: input.pairingMode ?? 'by_rank',
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

export async function publishSession(
  sessionId: string,
  versionWas: number,
  deadline?: string
): Promise<Session> {
  const { data, error } = await supabase.rpc('session_publish', {
    p_session_id: sessionId,
    p_deadline: deadline ?? null,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

export async function confirmSessionPresence(
  sessionId: string,
  status: PresenceStatus,
  partnerId?: string
): Promise<SessionPresence> {
  const { data, error } = await supabase.rpc('session_confirm_presence', {
    p_session_id: sessionId,
    p_status: status,
    p_partner_id: partnerId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SessionPresence;
}

export async function cancelLeagueSession(
  sessionId: string,
  versionWas: number,
  reason?: string
): Promise<Session> {
  const { data, error } = await supabase.rpc('session_cancel', {
    p_session_id: sessionId,
    p_reason: reason ?? null,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

// ---------------------------------------------------------------------------
// Match sheet (V8 slice)
// ---------------------------------------------------------------------------

export async function listSessionMatches(sessionId: string): Promise<SessionMatch[]> {
  const { data, error } = await supabase
    .from('session_matches')
    .select('*')
    .eq('session_id', sessionId)
    .order('round_number', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SessionMatch[];
}

export async function generateSessionSheet(
  sessionId: string,
  versionWas: number
): Promise<Session> {
  const { data, error } = await supabase.rpc('session_generate_sheet', {
    p_session_id: sessionId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

export async function regenerateSessionSheet(
  sessionId: string,
  versionWas: number
): Promise<Session> {
  const { data, error } = await supabase.rpc('session_regenerate_sheet', {
    p_session_id: sessionId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

export async function setSessionMatchLock(
  sessionMatchId: string,
  locked: boolean,
  versionWas: number
): Promise<SessionMatch> {
  const { data, error } = await supabase.rpc('session_set_match_lock', {
    p_session_match_id: sessionMatchId,
    p_locked: locked,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as SessionMatch;
}

// ---------------------------------------------------------------------------
// Scoring + ranking (V9 slice)
// ---------------------------------------------------------------------------

export async function recordSessionScore(input: {
  sessionMatchId: string;
  winnerTeam: PairingTeam;
  score?: string;
  status?: MatchStatus;
  versionWas: number;
}): Promise<SessionMatch> {
  const { data, error } = await supabase.rpc('session_record_score', {
    p_session_match_id: input.sessionMatchId,
    p_winner_team: input.winnerTeam,
    p_score: input.score ?? null,
    p_status: input.status ?? 'completed',
    p_version_was: input.versionWas,
  });
  if (error) throw new Error(error.message);
  return data as SessionMatch;
}

export async function closeSeason(seasonId: string, versionWas: number): Promise<Season> {
  const { data, error } = await supabase.rpc('season_close', {
    p_season_id: seasonId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Season;
}

export async function listSeasonRankings(seasonId: string): Promise<SeasonRankingWithProfile[]> {
  const { data, error } = await supabase
    .from('season_rankings')
    .select('*')
    .eq('season_id', seasonId)
    .order('rank', { ascending: true, nullsFirst: false })
    .order('points', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SeasonRanking[];
  if (rows.length === 0) return [];

  const profiles = await getProfilesByIds(rows.map(r => r.user_id));
  return rows.map(r => ({ ...r, profile: profiles[r.user_id] ?? null }));
}

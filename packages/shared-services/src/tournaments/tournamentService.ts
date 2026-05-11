/**
 * Tournament Service
 *
 * Wraps the L&T Postgres RPCs. Each function maps 1:1 to a SECURITY DEFINER
 * RPC defined in supabase/migrations/20260510170002_*.sql onward.
 */

import type { Tables, Enums } from '@rallia/shared-types';

import { supabase } from '../supabase';

export type Tournament = Tables<'tournaments'>;
export type TournamentRegistration = Tables<'tournament_registrations'>;
export type TournamentMatch = Tables<'tournament_matches'>;

export interface CreateTournamentInput {
  name: string;
  sportId: string;
  maxParticipants: 4 | 8 | 16 | 32 | 64 | 128;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  description?: string;
  visibility?: Enums<'tournament_visibility'>;
  registrationMode?: Enums<'tournament_registration_mode'>;
  bracketType?: Enums<'bracket_type'>;
  matchFormat?: Enums<'match_format'>;
  entryFormat?: Enums<'entry_format'>;
  facilityId?: string;
  venueName?: string;
  networkId?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
}

/**
 * List tournaments visible to the caller, optionally scoped to a sport.
 * RLS gates which rows are returned (organizer / public / community-member /
 * registrant). Most-recent first.
 */
export async function listVisibleTournaments(
  opts: {
    sportId?: string;
    excludeArchived?: boolean;
  } = {}
): Promise<Tournament[]> {
  let query = supabase.from('tournaments').select('*').order('created_at', { ascending: false });
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);
  if (opts.excludeArchived) query = query.neq('status', 'archived');

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Tournament[];
}

/**
 * Fetch a single tournament by ID. Returns null if not found or not visible
 * to the caller (RLS hides rows the caller doesn't have permission to see).
 */
export async function getTournament(tournamentId: string): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found / RLS hidden
    throw new Error(error.message);
  }

  return data as Tournament;
}

/**
 * Create a draft tournament.
 *
 * Throws if the caller doesn't play the requested sport, the network
 * isn't a community, or the rate limit is exceeded.
 */
export async function createTournament(input: CreateTournamentInput): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_create', {
    p_name: input.name,
    p_sport_id: input.sportId,
    p_max_participants: input.maxParticipants,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_description: input.description,
    p_visibility: input.visibility,
    p_registration_mode: input.registrationMode,
    p_bracket_type: input.bracketType,
    p_match_format: input.matchFormat,
    p_entry_format: input.entryFormat,
    p_facility_id: input.facilityId,
    p_venue_name: input.venueName,
    p_network_id: input.networkId,
    p_registration_opens_at: input.registrationOpensAt,
    p_registration_closes_at: input.registrationClosesAt,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Tournament;
}

export interface PlayerProfile {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
}

/**
 * Batch-fetch profile info for a set of player ids. Returns a Map keyed
 * by id. Used by tournament screens to render player names in brackets,
 * registrant lists, etc.
 */
export async function getProfilesByIds(ids: string[]): Promise<Map<string, PlayerProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profile')
    .select('id, display_name, first_name, last_name, profile_picture_url')
    .in('id', ids);
  if (error) throw new Error(error.message);
  const map = new Map<string, PlayerProfile>();
  for (const p of data ?? []) map.set(p.id, p as PlayerProfile);
  return map;
}

/**
 * List active registrations (registered + pending) for a tournament.
 * RLS gates visibility per the treg_select policy.
 */
export async function listActiveRegistrations(
  tournamentId: string
): Promise<TournamentRegistration[]> {
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', tournamentId)
    .in('status', ['registered', 'pending'])
    .order('registered_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentRegistration[];
}

/**
 * List the caller's active registrations across all tournaments.
 * Used by the discovery list to mark which tournaments the user is
 * already registered in.
 */
export async function listMyActiveRegistrations(userId: string): Promise<TournamentRegistration[]> {
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['registered', 'pending']);
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentRegistration[];
}

/**
 * Fetch the caller's registration row for a tournament, if any.
 * Returns null when the caller has never registered.
 */
export async function getMyRegistration(
  tournamentId: string,
  userId: string
): Promise<TournamentRegistration | null> {
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as TournamentRegistration | null;
}

/**
 * Organizer opens registration on a draft tournament.
 */
export async function openTournamentRegistration(
  tournamentId: string,
  versionWas: number
): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_open_registration', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

/**
 * Organizer closes registration manually.
 */
export async function closeTournamentRegistration(
  tournamentId: string,
  versionWas: number
): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_close_registration', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

/**
 * Self-register for a tournament. Initial status depends on the
 * tournament's registration_mode: open → 'registered', approval → 'pending',
 * invite_only → flips an existing pending invite to 'registered'.
 */
export async function registerForTournament(tournamentId: string): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_register', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

/**
 * List all matches for a tournament, ordered by round + position.
 */
export async function listTournamentMatches(tournamentId: string): Promise<TournamentMatch[]> {
  const { data, error } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round_number', { ascending: true })
    .order('match_position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentMatch[];
}

/**
 * Organizer generates the bracket for a registration_closed tournament.
 * Status transitions to in_progress and all match rows are created.
 */
export async function generateTournamentBracket(
  tournamentId: string,
  versionWas: number
): Promise<TournamentMatch[]> {
  const { data, error } = await supabase.rpc('tournament_generate_bracket', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentMatch[];
}

export interface LinkableMatch {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  match_result_id: string;
  winning_team: 1 | 2 | null;
  team1_score: number | null;
  team2_score: number | null;
  verified_at: string | null;
}

/**
 * List the caller's verified matches that could be linked to the given
 * tournament_match slot — both bracket players are joined participants,
 * the match is in the tournament's sport, has a verified result, and is
 * not already linked to another tournament_match.
 *
 * Filters happen client-side via the server-fetched two-sided join; the
 * eligible set is small (caller's recent matches).
 */
export async function listLinkableMatchesForSlot(params: {
  tournamentMatchId: string;
  player1UserId: string;
  player2UserId: string;
  sportId: string;
}): Promise<LinkableMatch[]> {
  // Two-sided IN: matches that include BOTH players as joined participants.
  // We start by fetching the caller's matches with verified results in this
  // sport, then filter to those whose participants are exactly the two
  // bracket players (no third party).
  const { data, error } = await supabase
    .from('match')
    .select(
      `id, match_date, start_time, end_time,
       match_result!inner ( id, is_verified, verified_at, winning_team, team1_score, team2_score ),
       match_participant!inner ( player_id, status )`
    )
    .eq('sport_id', params.sportId)
    .order('match_date', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  // match_result.match_id is UNIQUE, so PostgREST returns it as a single
  // object (not an array). match_participant is to-many → array.
  type MatchResultEmbed = {
    id: string;
    is_verified: boolean;
    verified_at: string | null;
    winning_team: number | null;
    team1_score: number | null;
    team2_score: number | null;
  };
  type Row = {
    id: string;
    match_date: string;
    start_time: string;
    end_time: string;
    match_result: MatchResultEmbed | MatchResultEmbed[] | null;
    match_participant: Array<{ player_id: string; status: string }>;
  };

  const rows = (data ?? []) as unknown as Row[];

  const expected = new Set([params.player1UserId, params.player2UserId]);
  const eligible: LinkableMatch[] = [];

  for (const row of rows) {
    const mr = Array.isArray(row.match_result) ? row.match_result[0] : row.match_result;
    if (!mr || !mr.is_verified) continue;

    const joinedUsers = row.match_participant
      .filter(p => p.status === 'joined')
      .map(p => p.player_id);
    if (joinedUsers.length !== 2) continue;
    if (!joinedUsers.every(u => expected.has(u))) continue;
    if (!Array.from(expected).every(u => joinedUsers.includes(u))) continue;

    eligible.push({
      id: row.id,
      match_date: row.match_date,
      start_time: row.start_time,
      end_time: row.end_time,
      match_result_id: mr.id,
      winning_team: (mr.winning_team as 1 | 2 | null) ?? null,
      team1_score: mr.team1_score,
      team2_score: mr.team2_score,
      verified_at: mr.verified_at,
    });
  }

  // Server-side check that none are already linked to another bracket slot.
  if (eligible.length === 0) return eligible;
  const { data: linked, error: linkedErr } = await supabase
    .from('tournament_matches')
    .select('match_id')
    .in(
      'match_id',
      eligible.map(m => m.id)
    )
    .neq('id', params.tournamentMatchId);
  if (linkedErr) throw new Error(linkedErr.message);
  const taken = new Set((linked ?? []).map(r => r.match_id).filter((x): x is string => !!x));

  return eligible.filter(m => !taken.has(m.id));
}

/**
 * Attach a verified, played match to a pending tournament_match slot. The
 * server validates participation, sport, and verified result.
 */
export async function attachMatchToTournamentSlot(
  tournamentMatchId: string,
  matchId: string
): Promise<TournamentMatch> {
  const { data, error } = await supabase.rpc('tournament_attach_match', {
    p_tournament_match_id: tournamentMatchId,
    p_match_id: matchId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentMatch;
}

/**
 * Withdraw the caller's own registration. Status flips to 'withdrawn';
 * the row is preserved for audit/history.
 */
export async function withdrawFromTournament(
  registrationId: string,
  versionWas: number
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_withdraw', {
    p_registration_id: registrationId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

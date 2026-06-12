/**
 * Tournament Service
 *
 * Wraps the L&T Postgres RPCs. Each function maps 1:1 to a SECURITY DEFINER
 * RPC defined in supabase/migrations/20260510170002_*.sql onward.
 */

import type { Tables, Enums } from '@rallia/shared-types';

import { supabase } from '../supabase';
import type { PlayerSearchResult } from '../players/playerService';

export type Tournament = Tables<'tournaments'>;
export type TournamentRegistration = Tables<'tournament_registrations'>;
export type TournamentMatch = Tables<'tournament_matches'>;

/** List-surface row: tournament plus its confirmed-registration count. */
export type TournamentListItem = Tournament & { registration_count: number };

const LIST_SELECT = '*, tournament_registrations(count)';

function toListItem(row: Record<string, unknown>): TournamentListItem {
  const { tournament_registrations, ...tournament } = row as Tournament & {
    tournament_registrations?: { count: number }[];
  };
  return {
    ...(tournament as Tournament),
    registration_count: tournament_registrations?.[0]?.count ?? 0,
  };
}

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
 * List public tournaments for the discovery surface, optionally scoped to a
 * sport. Only upcoming/live tournaments: drafts, completed, cancelled and
 * archived are excluded; soonest start date first.
 */
export async function listPublicTournaments(
  opts: { sportId?: string } = {}
): Promise<TournamentListItem[]> {
  let query = supabase
    .from('tournaments')
    .select(LIST_SELECT)
    .eq('visibility', 'public')
    .in('status', ['registration_open', 'registration_closed', 'in_progress'])
    .eq('tournament_registrations.status', 'registered')
    .order('start_date', { ascending: true });
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toListItem);
}

/**
 * List the caller's tournaments — ones they organize (any status, incl.
 * drafts) plus ones they hold an active registration in. Archived rows are
 * excluded; most-recent first.
 */
export async function listMyTournaments(
  userId: string,
  opts: { sportId?: string } = {}
): Promise<TournamentListItem[]> {
  const { data: regs, error: regsError } = await supabase
    .from('tournament_registrations')
    .select('tournament_id')
    .eq('user_id', userId)
    .in('status', ['registered', 'pending']);
  if (regsError) throw new Error(regsError.message);

  const registeredIds = [...new Set((regs ?? []).map(r => r.tournament_id))];
  let query = supabase
    .from('tournaments')
    .select(LIST_SELECT)
    .neq('status', 'archived')
    .eq('tournament_registrations.status', 'registered')
    .order('created_at', { ascending: false });
  query = registeredIds.length
    ? query.or(`organizer_id.eq.${userId},id.in.(${registeredIds.join(',')})`)
    : query.eq('organizer_id', userId);
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toListItem);
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

export interface TournamentUpdatePatch {
  name?: string;
  description?: string | null;
  visibility?: Enums<'tournament_visibility'>;
  registrationMode?: Enums<'tournament_registration_mode'>;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  startDate?: string;
  endDate?: string;
  maxParticipants?: 4 | 8 | 16 | 32 | 64 | 128;
  bracketType?: Enums<'bracket_type'>;
  matchFormat?: Enums<'match_format'>;
  facilityId?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
}

const UPDATE_PATCH_COLUMNS: Record<keyof TournamentUpdatePatch, string> = {
  name: 'name',
  description: 'description',
  visibility: 'visibility',
  registrationMode: 'registration_mode',
  registrationOpensAt: 'registration_opens_at',
  registrationClosesAt: 'registration_closes_at',
  startDate: 'start_date',
  endDate: 'end_date',
  maxParticipants: 'max_participants',
  bracketType: 'bracket_type',
  matchFormat: 'match_format',
  facilityId: 'facility_id',
  venueName: 'venue_name',
  venueAddress: 'venue_address',
};

/**
 * Organizer partial-update. Only keys present in the patch are sent; the
 * server gates each field on the tournament's current status (the
 * editable-fields-by-state matrix) and bumps `version`.
 */
export async function updateTournament(
  tournamentId: string,
  versionWas: number,
  patch: TournamentUpdatePatch
): Promise<Tournament> {
  const snakePatch: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      snakePatch[UPDATE_PATCH_COLUMNS[key as keyof TournamentUpdatePatch]] = value as
        | string
        | number
        | boolean
        | null;
    }
  }

  const { data, error } = await supabase.rpc('tournament_update', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
    p_patch: snakePatch,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

export interface PlayerProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
}

/**
 * Batch-fetch profile info for a set of player ids. Returns a Map keyed
 * by id. Used by tournament screens to render player names in brackets,
 * registrant lists, etc. display_name is intentionally excluded — see
 * @rallia/shared-utils/getHumanName for the app-wide convention.
 */
export async function getProfilesByIds(ids: string[]): Promise<Record<string, PlayerProfile>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('profile')
    .select('id, first_name, last_name, profile_picture_url')
    .in('id', ids);
  if (error) throw new Error(error.message);
  // Plain object (not a Map): React Query persists this query to AsyncStorage,
  // and a Map serializes to `{}` then rehydrates without its methods — which
  // crashes consumers calling `.get`. A Record round-trips cleanly as JSON.
  const byId: Record<string, PlayerProfile> = {};
  for (const p of data ?? []) byId[p.id] = p as PlayerProfile;
  return byId;
}

/**
 * Visible participants of a tournament as PlayerSearchResult rows, enriched
 * with sport rating, reputation, and online status so the Players tab can
 * render them with the shared community PlayerCard.
 *
 * Which registrants are visible is RLS-gated by the registrations select
 * (same treg_select policy as listActiveRegistrations). The per-player card
 * data — profile, rating (via player_sport.active_rating_score_id, the
 * canonical read path), reputation, last_seen_at — is public and batch-fetched
 * by id, mirroring getProfilesByIds. Rows return in seed order (seed_rank then
 * registration time) so the list matches the bracket.
 */
export async function listTournamentParticipants(
  tournamentId: string
): Promise<PlayerSearchResult[]> {
  const { data: regs, error: regErr } = await supabase
    .from('tournament_registrations')
    .select('user_id, seed_rank, registered_at, id')
    .eq('tournament_id', tournamentId)
    .in('status', ['registered', 'pending']);
  if (regErr) throw new Error(regErr.message);
  if (!regs || regs.length === 0) return [];

  // Seed order: seed_rank asc (nulls last), then earliest registration, then id.
  const ordered = [...regs].sort((a, b) => {
    const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    const ta = new Date(a.registered_at).getTime();
    const tb = new Date(b.registered_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  const playerIds = ordered.map(r => r.user_id);

  // Sport drives the rating lookup (ratings are per-sport).
  const { data: tourney, error: tErr } = await supabase
    .from('tournaments')
    .select('sport_id')
    .eq('id', tournamentId)
    .single();
  if (tErr) throw new Error(tErr.message);
  const sportId = tourney.sport_id;

  const [profilesRes, playersRes, repRes, ratingRes] = await Promise.all([
    supabase
      .from('profile')
      .select('id, first_name, last_name, profile_picture_url')
      .in('id', playerIds),
    supabase.from('player').select('id, last_seen_at').in('id', playerIds),
    supabase
      .from('player_reputation')
      .select('player_id, reputation_tier, reputation_score, is_public')
      .in('player_id', playerIds),
    supabase
      .from('player_sport')
      .select(
        'player_id, player_rating_score!active_rating_score_id ( is_certified, badge_status, rating_score!rating_score_id ( label, value ) )'
      )
      .in('player_id', playerIds)
      .eq('sport_id', sportId),
  ]);
  for (const res of [profilesRes, playersRes, repRes, ratingRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const profileById = new Map((profilesRes.data ?? []).map(p => [p.id, p]));
  const lastSeenById = new Map((playersRes.data ?? []).map(p => [p.id, p.last_seen_at]));
  const repById = new Map((repRes.data ?? []).map(r => [r.player_id, r]));

  type RatingRow = {
    player_id: string;
    player_rating_score: {
      is_certified: boolean | null;
      badge_status: Enums<'badge_status_enum'> | null;
      rating_score: { label: string | null; value: number | null } | null;
    } | null;
  };
  const ratingByPlayer = new Map<string, PlayerSearchResult['rating']>();
  for (const row of (ratingRes.data ?? []) as unknown as RatingRow[]) {
    const prs = row.player_rating_score;
    const rs = prs?.rating_score;
    if (!prs || !rs?.label) continue;
    ratingByPlayer.set(row.player_id, {
      label: rs.label,
      value: rs.value,
      is_certified: prs.is_certified ?? false,
      badge_status: prs.badge_status ?? 'self_declared',
    });
  }

  return ordered.map(r => {
    const prof = profileById.get(r.user_id);
    const rep = repById.get(r.user_id);
    return {
      id: r.user_id,
      first_name: prof?.first_name ?? '',
      last_name: prof?.last_name ?? '',
      display_name: null,
      profile_picture_url: prof?.profile_picture_url ?? null,
      city: null,
      gender: null,
      rating: ratingByPlayer.get(r.user_id) ?? null,
      latitude: null,
      longitude: null,
      distance_meters: null,
      reputation_tier: rep?.reputation_tier ?? null,
      reputation_score: rep?.reputation_score ?? null,
      reputation_is_public: rep?.is_public ?? false,
      last_seen_at: lastSeenById.get(r.user_id) ?? null,
    };
  });
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
  /** User id on each team, so callers can show the right player by score. */
  team1_user_id: string | null;
  team2_user_id: string | null;
  /** Per-set scores (team1 vs team2), ordered by set number. */
  sets: Array<{ team1: number; team2: number }>;
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
       match_result!inner ( id, is_verified, verified_at, winning_team, team1_score, team2_score,
         match_set ( set_number, team1_score, team2_score ) ),
       match_participant!inner ( player_id, status, team_number )`
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
    match_set?: Array<{ set_number: number; team1_score: number; team2_score: number }> | null;
  };
  type Row = {
    id: string;
    match_date: string;
    start_time: string;
    end_time: string;
    match_result: MatchResultEmbed | MatchResultEmbed[] | null;
    match_participant: Array<{ player_id: string; status: string; team_number: number | null }>;
  };

  const rows = (data ?? []) as unknown as Row[];

  const expected = new Set([params.player1UserId, params.player2UserId]);
  const eligible: LinkableMatch[] = [];

  for (const row of rows) {
    const mr = Array.isArray(row.match_result) ? row.match_result[0] : row.match_result;
    if (!mr || !mr.is_verified) continue;

    const joined = row.match_participant.filter(p => p.status === 'joined');
    const joinedUsers = joined.map(p => p.player_id);
    if (joinedUsers.length !== 2) continue;
    if (!joinedUsers.every(u => expected.has(u))) continue;
    if (!Array.from(expected).every(u => joinedUsers.includes(u))) continue;

    // Map each score column to its player via team_number. Fall back to join
    // order if team_number is missing so the card still labels both sides.
    const t1 = joined.find(p => p.team_number === 1)?.player_id ?? null;
    const t2 = joined.find(p => p.team_number === 2)?.player_id ?? null;
    const team1_user_id = t1 ?? joinedUsers.find(u => u !== t2) ?? null;
    const team2_user_id = t2 ?? joinedUsers.find(u => u !== team1_user_id) ?? null;

    const sets = (mr.match_set ?? [])
      .slice()
      .sort((a, b) => a.set_number - b.set_number)
      .map(s => ({ team1: s.team1_score, team2: s.team2_score }));

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
      team1_user_id,
      team2_user_id,
      sets,
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
 * Organizer/admin authoritative result for a stalled or disputed bracket
 * match. Sets the winner (and optional score string), completes the match,
 * and advances the bracket. Used when an opponent never confirms a score or
 * a result is disputed. Does not modify any linked casual match row.
 */
export async function overrideTournamentMatchScore(
  tournamentMatchId: string,
  winnerRegistrationId: string,
  score?: string
): Promise<TournamentMatch> {
  const { data, error } = await supabase.rpc('tournament_override_score', {
    p_tournament_match_id: tournamentMatchId,
    p_winner_registration_id: winnerRegistrationId,
    p_score: score,
  });
  if (error) throw new Error(error.message);
  return data as TournamentMatch;
}

/**
 * Organizer cancels a tournament (any non-terminal state). Pending and
 * in-progress matches are also cancelled.
 */
export async function cancelTournament(
  tournamentId: string,
  reason: string,
  versionWas: number
): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_cancel', {
    p_tournament_id: tournamentId,
    p_reason: reason,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

/**
 * Organizer archives a completed or cancelled tournament — hides it from
 * active discovery feeds.
 */
export async function archiveTournament(
  tournamentId: string,
  versionWas: number
): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_archive', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
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

/**
 * Organizer removes a registrant pre-bracket. Status flips to 'disqualified',
 * which is terminal — the removed player cannot re-register.
 */
export async function removeTournamentRegistration(
  registrationId: string,
  versionWas: number
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_remove_registration', {
    p_registration_id: registrationId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

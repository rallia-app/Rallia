/**
 * Tournament Service
 *
 * Wraps the L&T Postgres RPCs. Each function maps 1:1 to a SECURITY DEFINER
 * RPC defined in supabase/migrations/20260510170002_*.sql onward.
 */

import type { Database, Tables, Enums } from '@rallia/shared-types';
import type { UtmParams } from '@rallia/shared-utils';

import { supabase } from '../supabase';
import type { PlayerSearchResult } from '../players/playerService';
import { generateInvitationLink } from '../invitation/invitationLinkService';

export type Tournament = Tables<'tournaments'>;
export type TournamentRegistration = Tables<'tournament_registrations'>;
export type TournamentMatch = Tables<'tournament_matches'>;

/** A registered player surfaced on a tournament card's avatar stack. */
export type RegistrantPreview = { id: string; avatarUrl: string | null; name: string };

/** List-surface row: tournament plus its confirmed-registration count and a
 *  small avatar preview of the earliest registrants (like game cards). */
export type TournamentListItem = Tournament & {
  registration_count: number;
  registrant_preview: RegistrantPreview[];
  /** True when the caller co-organizes this tournament (they are not the
   *  primary organizer_id, but hold the same powers). Only set by
   *  listMyTournaments — undefined on caller-agnostic surfaces like discovery. */
  is_co_organizer?: boolean;
};

/** How many registrant avatars to surface on a list card. */
const PREVIEW_LIMIT = 5;

// Pull the registrant rows (not just a count) so we can both count them and
// show a few faces. The status='registered' filter is applied by the caller.
const LIST_SELECT = '*, tournament_registrations(user_id, registered_at)';

type ListRow = Tournament & {
  tournament_registrations?: { user_id: string; registered_at: string }[];
};

/**
 * Shape raw list rows into list items, attaching an avatar preview. Avatars
 * live in the `profile` table (registrations only FK to `player`), so we
 * batch-fetch them by id in one round trip across the whole list.
 */
async function toListItems(rows: ListRow[]): Promise<TournamentListItem[]> {
  const staged = rows.map(row => {
    const { tournament_registrations, ...tournament } = row;
    const regs = (tournament_registrations ?? [])
      .slice()
      .sort((a, b) => a.registered_at.localeCompare(b.registered_at));
    return {
      tournament: tournament as Tournament,
      count: regs.length,
      previewIds: regs.slice(0, PREVIEW_LIMIT).map(r => r.user_id),
    };
  });

  const allIds = [...new Set(staged.flatMap(s => s.previewIds))];
  const profiles = await getProfilesByIds(allIds);

  return staged.map(s => ({
    ...s.tournament,
    registration_count: s.count,
    registrant_preview: s.previewIds.map(id => {
      const p = profiles[id];
      return {
        id,
        avatarUrl: p?.profile_picture_url ?? null,
        name: p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : '',
      };
    }),
  }));
}

export interface CreateTournamentInput {
  name: string;
  sportId: string;
  maxParticipants: 4 | 8 | 16 | 32 | 64 | 128;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  description?: string;
  rules?: string;
  logoUrl?: string;
  minRating?: number;
  visibility?: Enums<'tournament_visibility'>;
  registrationMode?: Enums<'tournament_registration_mode'>;
  bracketType?: Enums<'bracket_type'>;
  matchFormat?: Enums<'match_format'>;
  entryFormat?: Enums<'entry_format'>;
  facilityId?: string;
  venueName?: string;
  venueAddress?: string;
  /** City label — the facility's city (denormalized) or a city-only entry. */
  city?: string;
  /** Advertised prize, in the tournament currency. */
  prizeMoneyCents?: number;
  networkId?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  // Paid-event settings. Omit (or entryFeeCents 0) for a free tournament.
  entryFeeCents?: number;
  currency?: string;
  feePayer?: Enums<'fee_payer_enum'>;
  payoutTiming?: Enums<'payout_timing_enum'>;
  refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
  refundPartialBps?: number | null;
  refundCutoffAt?: string | null;
}

/** Fee/refund settings shaped for the tournament_create `p_fee` jsonb param. */
export interface TournamentFeeSettingsInput {
  entryFeeCents?: number;
  currency?: string;
  feePayer?: Enums<'fee_payer_enum'>;
  payoutTiming?: Enums<'payout_timing_enum'>;
  refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
  refundPartialBps?: number | null;
  refundCutoffAt?: string | null;
}

/** Build the `p_fee` jsonb payload, omitting undefined keys so the server
 *  COALESCEs them to defaults. Returns undefined for a plain free event. */
function buildFeePayload(input: TournamentFeeSettingsInput): Record<string, unknown> | undefined {
  if (input.entryFeeCents == null || input.entryFeeCents <= 0) return undefined;
  const fee: Record<string, unknown> = { entry_fee_cents: input.entryFeeCents };
  if (input.currency) fee.currency = input.currency;
  if (input.feePayer) fee.fee_payer = input.feePayer;
  if (input.payoutTiming) fee.payout_timing = input.payoutTiming;
  if (input.refundPolicyKind) fee.refund_policy_kind = input.refundPolicyKind;
  if (input.refundPartialBps != null) fee.refund_partial_bps = input.refundPartialBps;
  if (input.refundCutoffAt) fee.refund_cutoff_at = input.refundCutoffAt;
  return fee;
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
  return toListItems((data ?? []) as ListRow[]);
}

/**
 * List the caller's tournaments — ones they organize (any status, incl.
 * drafts) plus ones they hold an active registration in (as captain or
 * doubles partner). Archived rows are excluded; most-recent first.
 */
export async function listMyTournaments(
  userId: string,
  opts: { sportId?: string } = {}
): Promise<TournamentListItem[]> {
  // Imperative refetches bypass the hook's enabled:!!userId gate — never interpolate undefined.
  if (!userId) return [];
  const { data: regs, error: regsError } = await supabase
    .from('tournament_registrations')
    .select('tournament_id')
    .or(`user_id.eq.${userId},partner_user_id.eq.${userId}`)
    .in('status', ['registered', 'pending']);
  if (regsError) throw new Error(regsError.message);

  const registeredIds = [...new Set((regs ?? []).map(r => r.tournament_id))];

  // Co-organizers hold the same powers as the organizer (is_tournament_organizer
  // covers both), so their events belong in their own library too — organizer_id
  // alone would hide a tournament they can generate the bracket for.
  const { data: coOrg, error: coOrgError } = await supabase
    .from('tournament_co_organizers')
    .select('tournament_id')
    .eq('user_id', userId);
  if (coOrgError) throw new Error(coOrgError.message);
  const coOrganizedIds = new Set((coOrg ?? []).map(c => c.tournament_id));

  const relatedIds = [...new Set([...registeredIds, ...coOrganizedIds])];
  let query = supabase
    .from('tournaments')
    .select(LIST_SELECT)
    .neq('status', 'archived')
    .eq('tournament_registrations.status', 'registered')
    .order('created_at', { ascending: false });
  query = relatedIds.length
    ? query.or(`organizer_id.eq.${userId},id.in.(${relatedIds.join(',')})`)
    : query.eq('organizer_id', userId);
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const items = await toListItems((data ?? []) as ListRow[]);
  return items.map(item =>
    coOrganizedIds.has(item.id) ? { ...item, is_co_organizer: true } : item
  );
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
    p_rules: input.rules,
    p_logo_url: input.logoUrl,
    p_min_rating: input.minRating,
    p_fee: buildFeePayload(input),
    p_venue_address: input.venueAddress,
    p_city: input.city,
    p_prize_money_cents: input.prizeMoneyCents,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Tournament;
}

export interface TournamentUpdatePatch {
  name?: string;
  description?: string | null;
  rules?: string | null;
  logoUrl?: string | null;
  minRating?: number | null;
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
  city?: string | null;
  prizeMoneyCents?: number | null;
  // Fee settings — server gates these to 'draft' only.
  entryFeeCents?: number;
  currency?: string;
  feePayer?: Enums<'fee_payer_enum'>;
  payoutTiming?: Enums<'payout_timing_enum'>;
  refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
  refundPartialBps?: number | null;
  refundCutoffAt?: string | null;
}

const UPDATE_PATCH_COLUMNS: Record<keyof TournamentUpdatePatch, string> = {
  name: 'name',
  description: 'description',
  rules: 'rules',
  logoUrl: 'logo_url',
  minRating: 'min_rating',
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
  city: 'city',
  prizeMoneyCents: 'prize_money_cents',
  entryFeeCents: 'entry_fee_cents',
  currency: 'currency',
  feePayer: 'fee_payer',
  payoutTiming: 'payout_timing',
  refundPolicyKind: 'refund_policy_kind',
  refundPartialBps: 'refund_partial_bps',
  refundCutoffAt: 'refund_cutoff_at',
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
    .select('user_id, partner_user_id, seed_rank, registered_at, id')
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
  // One row per pair member, captain first, entry order preserved.
  const playerIds = ordered.flatMap(r =>
    r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]
  );

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

  return playerIds.map(playerId => {
    const prof = profileById.get(playerId);
    const rep = repById.get(playerId);
    return {
      id: playerId,
      first_name: prof?.first_name ?? '',
      last_name: prof?.last_name ?? '',
      display_name: null,
      profile_picture_url: prof?.profile_picture_url ?? null,
      city: null,
      gender: null,
      rating: ratingByPlayer.get(playerId) ?? null,
      latitude: null,
      longitude: null,
      distance_meters: null,
      reputation_tier: rep?.reputation_tier ?? null,
      reputation_score: rep?.reputation_score ?? null,
      reputation_is_public: rep?.is_public ?? false,
      last_seen_at: lastSeenById.get(playerId) ?? null,
    };
  });
}

/**
 * The caller's most recent doubles teammates in a sport — players who shared
 * their side (same team_number) in a joined doubles game. Most recent first,
 * deduped, capped at 5. Feeds the "recent partners" section of the tournament
 * partner picker.
 */
export async function listRecentDoublesPartners(
  userId: string,
  sportId: string
): Promise<PlayerProfile[]> {
  const { data: mine, error: mineErr } = await supabase
    .from('match_participant')
    .select('match_id, team_number, match!inner ( id, sport_id, format, match_date )')
    .eq('player_id', userId)
    .eq('status', 'joined')
    .eq('match.format', 'doubles')
    .eq('match.sport_id', sportId)
    .limit(50);
  if (mineErr) throw new Error(mineErr.message);

  type MineRow = {
    match_id: string;
    team_number: number | null;
    match: { match_date: string } | { match_date: string }[] | null;
  };
  const myRows = ((mine ?? []) as unknown as MineRow[])
    .map(r => ({
      match_id: r.match_id,
      team_number: r.team_number,
      match_date: (Array.isArray(r.match) ? r.match[0] : r.match)?.match_date ?? '',
    }))
    .filter(r => r.team_number !== null)
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime());
  if (myRows.length === 0) return [];

  const myTeamByMatch = new Map(myRows.map(r => [r.match_id, r.team_number]));
  const { data: mates, error: matesErr } = await supabase
    .from('match_participant')
    .select('match_id, player_id, team_number')
    .in(
      'match_id',
      myRows.map(r => r.match_id)
    )
    .eq('status', 'joined')
    .neq('player_id', userId);
  if (matesErr) throw new Error(matesErr.message);

  const teammatesByMatch = new Map<string, string[]>();
  for (const row of mates ?? []) {
    if (row.team_number !== myTeamByMatch.get(row.match_id)) continue;
    const list = teammatesByMatch.get(row.match_id) ?? [];
    list.push(row.player_id);
    teammatesByMatch.set(row.match_id, list);
  }

  const partnerIds: string[] = [];
  for (const r of myRows) {
    for (const mate of teammatesByMatch.get(r.match_id) ?? []) {
      if (!partnerIds.includes(mate)) partnerIds.push(mate);
    }
    if (partnerIds.length >= 5) break;
  }
  if (partnerIds.length === 0) return [];

  const profiles = await getProfilesByIds(partnerIds.slice(0, 5));
  return partnerIds
    .slice(0, 5)
    .map(id => profiles[id])
    .filter((p): p is PlayerProfile => !!p);
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
  // Imperative refetches bypass the hook's enabled:!!userId gate — never interpolate undefined.
  if (!userId) return [];
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .or(`user_id.eq.${userId},partner_user_id.eq.${userId}`)
    .in('status', ['registered', 'pending']);
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentRegistration[];
}

/**
 * Fetch the caller's registration row for a tournament, if any — as captain
 * or doubles partner. A user can match several rows (e.g. their own withdrawn
 * captain row plus an active row where they're the partner); the active one
 * wins, then the most recent. Returns null when the caller has never
 * registered.
 */
export async function getMyRegistration(
  tournamentId: string,
  userId: string
): Promise<TournamentRegistration | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', tournamentId)
    .or(`user_id.eq.${userId},partner_user_id.eq.${userId}`);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TournamentRegistration[];
  if (rows.length === 0) return null;
  const isActive = (r: TournamentRegistration) =>
    r.status === 'registered' || r.status === 'pending' || r.status === 'waitlisted';
  const byRecency = (a: TournamentRegistration, b: TournamentRegistration) =>
    new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime();
  return rows.filter(isActive).sort(byRecency)[0] ?? rows.sort(byRecency)[0];
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
 * Organizer reopens a closed registration window (→ registration_open) while
 * the bracket hasn't been generated yet, for late entrants.
 */
export async function reopenTournamentRegistration(
  tournamentId: string,
  versionWas: number
): Promise<Tournament> {
  const { data, error } = await supabase.rpc('tournament_reopen_registration', {
    p_tournament_id: tournamentId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

/**
 * Organizer/co-organizer invites existing players. Each becomes a 'pending'
 * registration the invitee accepts via acceptTournamentInvite. Returns how many
 * invites were actually created (already-registered / unknown players skipped).
 */
export async function inviteTournamentPlayers(
  tournamentId: string,
  userIds: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc('tournament_invite_players', {
    p_tournament_id: tournamentId,
    p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/**
 * Invitee accepts their pending organizer invite. Doubles tournaments require
 * a partner (supplied at accept); singles must omit it.
 */
export async function acceptTournamentInvite(
  tournamentId: string,
  partnerId?: string
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_accept_invite', {
    p_tournament_id: tournamentId,
    p_partner_id: partnerId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

/**
 * Organizer retracts an outstanding invite. Non-terminal: the invited row goes
 * to 'withdrawn' (frees the slot, clears the invitation notification, and lets
 * the player be re-invited later) — unlike removal, which disqualifies.
 */
export async function revokeTournamentInvite(
  registrationId: string,
  versionWas: number
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_revoke_invite', {
    p_registration_id: registrationId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

/**
 * Self-register for a tournament. Initial status depends on the
 * tournament's registration_mode: open → 'registered', approval → 'pending',
 * invite_only → flips an existing pending invite to 'registered'.
 * Doubles tournaments require a partner; the caller registers the pair.
 */
export async function registerForTournament(
  tournamentId: string,
  partnerId?: string
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_register', {
    p_tournament_id: tournamentId,
    p_partner_id: partnerId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

/** All-in price breakdown shown before a player pays. Mirrors tournament_fee_quote. */
export interface TournamentFeeQuote {
  entryCents: number;
  serviceFeeCents: number;
  /** GST/QST on the service fee (Rallia remits). */
  feeTaxCents: number;
  /** What the player is charged. */
  totalCents: number;
  organizerReceivesCents: number;
  feePayer: Enums<'fee_payer_enum'>;
  currency: string;
  refundPolicyKind: Enums<'refund_policy_kind_enum'>;
  refundPartialBps: number | null;
  refundCutoffAt: string | null;
}

/**
 * Server-authoritative price breakdown for registering in a tournament. Use
 * this for the pay screen (the wizard preview can use the local
 * `quoteRegistration` helper). Returns null for a free event (entry 0).
 */
export async function getTournamentFeeQuote(
  tournamentId: string
): Promise<TournamentFeeQuote | null> {
  const { data, error } = await supabase.rpc('tournament_fee_quote', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    entryCents: row.entry_cents,
    serviceFeeCents: row.service_fee_cents,
    feeTaxCents: row.fee_tax_cents,
    totalCents: row.total_cents,
    organizerReceivesCents: row.organizer_receives_cents,
    feePayer: row.fee_payer,
    currency: row.currency,
    refundPolicyKind: row.refund_policy_kind,
    refundPartialBps: row.refund_partial_bps,
    refundCutoffAt: row.refund_cutoff_at,
  };
}

/** The caller's payout (Stripe Express) account status, mirrored from Stripe by
 *  stripe-connect-webhook. `null` when the organizer has never onboarded. */
export interface PayoutAccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** True once the account can settle registration charges (== chargesEnabled). */
  onboardingCompleted: boolean;
}

/**
 * Read the current organizer's own payout account status. RLS scopes the select
 * to the caller's row, so no id is needed. Returns null when they've never set
 * up payouts (the UI then offers onboarding instead of management).
 */
export async function getMyPayoutAccount(): Promise<PayoutAccountStatus | null> {
  const { data, error } = await supabase
    .from('player_stripe_account')
    .select('charges_enabled, payouts_enabled, details_submitted, onboarding_completed')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    chargesEnabled: data.charges_enabled,
    payoutsEnabled: data.payouts_enabled,
    detailsSubmitted: data.details_submitted,
    onboardingCompleted: data.onboarding_completed,
  };
}

/** A guard-code error from the create-registration-payment edge function
 *  (e.g. 'tournament_full', 'already_registered', 'organizer_not_ready'). */
export class TournamentPaymentError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'TournamentPaymentError';
  }
}

export interface RegistrationPaymentIntent {
  clientSecret: string;
  paymentId: string;
  entryCents: number;
  serviceFeeCents: number;
  feeTaxCents: number;
  amountChargedCents: number;
  currency: string;
}

/**
 * Reserve a slot and open a Stripe PaymentIntent for a paid registration via
 * the lt-create-registration-payment edge function. The caller then drives the
 * Stripe PaymentSheet with `clientSecret`; the webhook finalizes the
 * registration on success. Throws TournamentPaymentError(code) on guard
 * failures so the UI can map them to specific messages.
 */
export async function createTournamentRegistrationPayment(
  tournamentId: string,
  partnerId?: string
): Promise<RegistrationPaymentIntent> {
  const { data, error } = await supabase.functions.invoke('lt-create-registration-payment', {
    body: { tournamentId, ...(partnerId ? { partnerId } : {}) },
  });

  // Guard failures come back as { error: code }. supabase-js surfaces non-2xx
  // as `error` (with the body on error.context) and may leave data null, so
  // check both.
  let code: string | undefined = (data as { error?: string } | null)?.error;
  if (!code && error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx?.json) {
      try {
        code = (await ctx.json())?.error;
      } catch {
        // body wasn't JSON — fall through to the generic throw below
      }
    }
  }
  if (code) throw new TournamentPaymentError(code);
  if (error || !data?.clientSecret) throw new Error(error?.message ?? 'no_client_secret');

  return {
    clientSecret: data.clientSecret,
    paymentId: data.paymentId,
    entryCents: data.entryCents,
    serviceFeeCents: data.serviceFeeCents,
    feeTaxCents: data.feeTaxCents,
    amountChargedCents: data.amountChargedCents,
    currency: data.currency,
  };
}

export interface TournamentRefundResult {
  withdrawn: boolean;
  refundedCents: number;
}

/**
 * Withdraw from a PAID tournament and issue the entry refund (per the
 * organizer's policy + cutoff; the service fee is never refunded) via the
 * lt-refund-registration edge function. Free registrations use
 * `withdrawFromTournament` instead. Throws TournamentPaymentError(code) on
 * guard failures (e.g. 'withdraw_not_allowed', 'no_paid_registration').
 */
export async function refundTournamentRegistration(
  registrationId: string,
  versionWas: number
): Promise<TournamentRefundResult> {
  const { data, error } = await supabase.functions.invoke('lt-refund-registration', {
    body: { registrationId, versionWas },
  });

  let code: string | undefined = (data as { error?: string } | null)?.error;
  if (!code && error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx?.json) {
      try {
        code = (await ctx.json())?.error;
      } catch {
        // non-JSON body — fall through
      }
    }
  }
  if (code) throw new TournamentPaymentError(code);
  if (error) throw new Error(error.message);

  return { withdrawn: !!data?.withdrawn, refundedCents: data?.refundedCents ?? 0 };
}

/** A released bracket slot with no linked game yet — a home call-to-action. */
export type UnscheduledTournamentMatch = TournamentMatch & {
  tournament: Pick<Tournament, 'id' | 'name' | 'sport_id'>;
};

/**
 * List the caller's playable bracket matches that are waiting for a game to
 * be linked (match_id IS NULL) in tournaments that are underway. Both
 * participants must be resolved — slots still waiting on a previous round
 * don't qualify. These are calls to action, not agenda items: once a game is
 * linked, the slot flows through the regular match rails as a `match` row.
 */
export async function listMyUnscheduledTournamentMatches(
  userId: string,
  opts: { sportId?: string; limit?: number } = {}
): Promise<UnscheduledTournamentMatch[]> {
  const regs = await listMyActiveRegistrations(userId);
  const regIds = regs.map(r => r.id);
  if (regIds.length === 0) return [];

  const regList = regIds.join(',');
  let query = supabase
    .from('tournament_matches')
    .select('*, tournament:tournaments!inner(id, name, sport_id)')
    .eq('status', 'pending')
    .is('match_id', null)
    .not('player1_registration_id', 'is', null)
    .not('player2_registration_id', 'is', null)
    .eq('player1_is_bye', false)
    .eq('player2_is_bye', false)
    .eq('tournament.status', 'in_progress')
    .or(`player1_registration_id.in.(${regList}),player2_registration_id.in.(${regList})`)
    .order('round_number', { ascending: true })
    .limit(opts.limit ?? 10);
  if (opts.sportId) query = query.eq('tournament.sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as UnscheduledTournamentMatch[];
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

/** A single computed bracket slot returned by the read-only preview RPC. */
export type PreviewBracketMatch =
  Database['public']['Functions']['tournament_preview_bracket']['Returns'][number];

/**
 * Organizer assigns seeds before generating the bracket. `orderedRegistrationIds`
 * must be exactly the tournament's registered set (seed 1 first). Returns the
 * registrations with their new seed_rank. Does not bump tournament.version.
 */
export async function setTournamentSeeds(
  tournamentId: string,
  orderedRegistrationIds: string[],
  versionWas: number
): Promise<TournamentRegistration[]> {
  const { data, error } = await supabase.rpc('tournament_set_seeds', {
    p_tournament_id: tournamentId,
    p_ordered_registration_ids: orderedRegistrationIds,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentRegistration[];
}

/**
 * Read-only dry run of the bracket for the current seeds — computes the full
 * single-elimination tree without inserting rows or changing status. Organizer
 * only. Used to live-preview the bracket on the seeding screen before publish.
 */
export async function previewTournamentBracket(
  tournamentId: string
): Promise<PreviewBracketMatch[]> {
  const { data, error } = await supabase.rpc('tournament_preview_bracket', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PreviewBracketMatch[];
}

export type TournamentCoOrganizer = Tables<'tournament_co_organizers'>;

/** List a tournament's co-organizers (organizer-only). */
export async function getTournamentCoOrganizers(
  tournamentId: string
): Promise<TournamentCoOrganizer[]> {
  const { data, error } = await supabase.rpc('get_tournament_co_organizers', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentCoOrganizer[];
}

/**
 * Primary organizer adds a co-organizer (full organizer rights + tournament
 * chat). Returns the updated co-organizer roster.
 */
export async function addTournamentCoOrganizer(
  tournamentId: string,
  userId: string
): Promise<TournamentCoOrganizer[]> {
  const { data, error } = await supabase.rpc('tournament_add_co_organizer', {
    p_tournament_id: tournamentId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentCoOrganizer[];
}

/** Primary organizer removes a co-organizer. Returns the updated roster. */
export async function removeTournamentCoOrganizer(
  tournamentId: string,
  userId: string
): Promise<TournamentCoOrganizer[]> {
  const { data, error } = await supabase.rpc('tournament_remove_co_organizer', {
    p_tournament_id: tournamentId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TournamentCoOrganizer[];
}

/**
 * Whether the caller is an organizer of this tournament — primary organizer
 * OR a co-organizer. Lets the client surface organizer controls to co-orgs.
 */
export async function amITournamentOrganizer(tournamentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_tournament_organizer', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return !!data;
}

/**
 * Whether a player is a certified organizer — the gate that decides if their
 * tournaments award Circuit Rallia points (see award_tournament_ranking_points).
 * The ranking ceiling is stamped on every tournament regardless, so this is the
 * only honest signal that points will actually be paid.
 */
export async function isCertifiedOrganizer(playerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('player')
    .select('is_certified_organizer')
    .eq('id', playerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.is_certified_organizer === true;
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
  /** User ids on each score side (1 for singles, 2 for doubles). */
  team1_user_ids: string[];
  team2_user_ids: string[];
  /** Per-set scores (team1 vs team2), ordered by set number. */
  sets: Array<{ team1: number; team2: number }>;
}

/**
 * List the caller's verified matches that could be linked to the given
 * tournament_match slot — every member of both bracket entries is a joined
 * participant (2 players for singles, 4 for doubles), the game is in the
 * tournament's sport with the matching format, has a verified result, and
 * is not already linked to another tournament_match.
 *
 * Filters happen client-side via the server-fetched two-sided join; the
 * eligible set is small (caller's recent matches).
 */
export async function listLinkableMatchesForSlot(params: {
  tournamentMatchId: string;
  team1UserIds: string[];
  team2UserIds: string[];
  sportId: string;
  entryFormat: Enums<'entry_format'>;
}): Promise<LinkableMatch[]> {
  // Fetch the caller's matches with verified results in this sport, then
  // filter to those whose joined participants are exactly the bracket
  // entries' members (no third party).
  const { data, error } = await supabase
    .from('match')
    .select(
      `id, match_date, start_time, end_time, format,
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
    format: string | null;
    match_result: MatchResultEmbed | MatchResultEmbed[] | null;
    match_participant: Array<{ player_id: string; status: string; team_number: number | null }>;
  };

  const rows = (data ?? []) as unknown as Row[];

  const isDoubles = params.entryFormat !== 'singles';
  const expected = new Set([...params.team1UserIds, ...params.team2UserIds]);
  const expectedSize = isDoubles ? 4 : 2;
  const eligible: LinkableMatch[] = [];

  for (const row of rows) {
    const mr = Array.isArray(row.match_result) ? row.match_result[0] : row.match_result;
    if (!mr || !mr.is_verified) continue;
    if ((row.format ?? 'singles') !== (isDoubles ? 'doubles' : 'singles')) continue;

    const joined = row.match_participant.filter(p => p.status === 'joined');
    const joinedUsers = joined.map(p => p.player_id);
    if (expected.size !== expectedSize || joinedUsers.length !== expectedSize) continue;
    if (!joinedUsers.every(u => expected.has(u))) continue;
    if (!Array.from(expected).every(u => joinedUsers.includes(u))) continue;

    // Map each score column to its players via team_number. Singles keeps the
    // join-order fallback for legacy rows without team_number; doubles teams
    // are always assigned at score submission.
    let team1_user_ids = joined.filter(p => p.team_number === 1).map(p => p.player_id);
    let team2_user_ids = joined.filter(p => p.team_number === 2).map(p => p.player_id);
    if (!isDoubles && (team1_user_ids.length === 0 || team2_user_ids.length === 0)) {
      const t1 = team1_user_ids[0] ?? joinedUsers.find(u => u !== team2_user_ids[0]) ?? null;
      const t2 = team2_user_ids[0] ?? joinedUsers.find(u => u !== t1) ?? null;
      team1_user_ids = t1 ? [t1] : [];
      team2_user_ids = t2 ? [t2] : [];
    }

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
      team1_user_ids,
      team2_user_ids,
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

/**
 * Organizer approves a pending registration (approval-mode tournaments).
 * Status flips 'pending' -> 'registered'; the approved notification fires
 * automatically via the registrations trigger. No capacity re-check — a pending
 * row already counts toward the bracket.
 */
export async function approveTournamentRegistration(
  registrationId: string,
  versionWas: number
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_approve_registration', {
    p_registration_id: registrationId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

export type TournamentInviteLink = Tables<'tournament_invite_links'>;

export interface TournamentInvitePreview {
  tournament: Tournament;
  activeCount: number;
}

/**
 * Organizer's active default invite link, minted on first call.
 */
export async function getOrCreateTournamentInvite(
  tournamentId: string
): Promise<TournamentInviteLink> {
  const { data, error } = await supabase.rpc('tournament_invite_get_or_create', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentInviteLink;
}

/**
 * Revokes the active invite link and mints a fresh one. Old links stop
 * resolving immediately.
 */
export async function resetTournamentInvite(tournamentId: string): Promise<TournamentInviteLink> {
  const { data, error } = await supabase.rpc('tournament_invite_reset', {
    p_tournament_id: tournamentId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentInviteLink;
}

/**
 * Token preview: resolves a valid invite token to its tournament — bypassing
 * RLS so invitees can see private tournaments before registering — plus the
 * active registration count (RLS hides other players' registrations on
 * private tournaments, so the client can't compute it). Throws
 * INVITE_INVALID for unknown / revoked / expired tokens.
 */
export async function getTournamentByInviteToken(token: string): Promise<TournamentInvitePreview> {
  const { data, error } = await supabase.rpc('tournament_get_by_invite_token', {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { tournament: Tournament; active_count: number };
  return { tournament: payload.tournament, activeCount: payload.active_count };
}

/**
 * Registers the caller via an invite token. Bypasses registration_mode
 * (status 'registered' even on approval/invite_only tournaments) and is
 * idempotent for already-active registrations (captain or partner).
 * Doubles tournaments require a partner.
 */
export async function joinTournamentViaInvite(
  token: string,
  partnerId?: string
): Promise<TournamentRegistration> {
  const { data, error } = await supabase.rpc('tournament_join_via_invite', {
    p_token: token,
    p_partner_id: partnerId,
  });
  if (error) throw new Error(error.message);
  return data as TournamentRegistration;
}

/**
 * Shareable tournament invite URL on the unified /invite format — the
 * sender's referral code rides along for signup attribution.
 */
export function getTournamentInviteLink(
  token: string,
  tournamentId: string,
  referralCode: string,
  utm?: UtmParams
): string {
  return generateInvitationLink({
    type: 'tournament',
    referralCode,
    targetId: tournamentId,
    shareToken: token,
    utm,
  });
}

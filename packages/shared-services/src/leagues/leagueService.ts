/**
 * League Service
 *
 * Wraps the L&T Postgres RPCs for leagues and seasons (V6 slice).
 */

import type { Tables, Enums, Json } from '@rallia/shared-types';
import type { UtmParams } from '@rallia/shared-utils';

import {
  getProfilesByIds,
  TournamentPaymentError,
  type PlayerProfile,
  type LinkableMatch,
  type LinkableMatchState,
  type RegistrationPaymentIntent,
} from '../tournaments/tournamentService';
import { generateInvitationLink } from '../invitation/invitationLinkService';
import { supabase } from '../supabase';

export type League = Tables<'leagues'>;
export type LeagueMember = Tables<'league_members'>;
export type Season = Tables<'seasons'>;
export type Session = Tables<'sessions'>;
export type SessionPresence = Tables<'session_presence'>;
export type SessionMatch = Tables<'session_matches'>;
export type SeasonRanking = Tables<'season_rankings'>;
export type SeasonMember = Tables<'season_members'>;
export type SeasonMemberStatus = Enums<'season_member_status'>;
export type PresenceStatus = Enums<'session_presence_status'>;
export type MatchStatus = Enums<'session_match_status'>;
export type PairingTeam = Enums<'pairing_team'>;

export interface SeasonRankingWithProfile extends SeasonRanking {
  profile?: PlayerProfile | null;
}

export interface SessionPresenceWithProfile extends SessionPresence {
  profile?: PlayerProfile | null;
}

export interface SeasonMemberWithProfile extends SeasonMember {
  profile?: PlayerProfile | null;
}

export type LeagueMemberPreview = { id: string; avatarUrl: string | null; name: string };

/** List-surface row: league plus its active-member count and a small avatar
 *  preview of the earliest members (mirrors TournamentListItem). */
export type LeagueListItem = League & {
  member_count: number;
  member_preview: LeagueMemberPreview[];
};

/** How many member avatars to surface on a list card. */
const PREVIEW_LIMIT = 5;

// Pull the member rows (not just a count) so we can both count them and show a
// few faces. The status='active' filter is applied by the caller.
const LIST_SELECT = '*, league_members(user_id, joined_at)';

type ListRow = League & {
  league_members?: { user_id: string; joined_at: string }[];
};

/** Shape raw list rows into list items, attaching an avatar preview. Avatars
 *  live in `profile`, batch-fetched by id in one round trip across the list. */
async function toListItems(rows: ListRow[]): Promise<LeagueListItem[]> {
  const staged = rows.map(row => {
    const { league_members, ...league } = row;
    const members = (league_members ?? [])
      .slice()
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    return {
      league: league as League,
      count: members.length,
      previewIds: members.slice(0, PREVIEW_LIMIT).map(m => m.user_id),
    };
  });

  const allIds = [...new Set(staged.flatMap(s => s.previewIds))];
  const profiles = await getProfilesByIds(allIds);

  return staged.map(s => ({
    ...s.league,
    member_count: s.count,
    member_preview: s.previewIds.map(id => {
      const p = profiles[id];
      return {
        id,
        avatarUrl: p?.profile_picture_url ?? null,
        name: p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : '',
      };
    }),
  }));
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
  logoUrl?: string;
  /** Merged over the sport defaults server-side, then validated. */
  rulesOverride?: Record<string, unknown>;
}

export interface LeagueMemberWithProfile extends LeagueMember {
  profile?: PlayerProfile | null;
}

export async function listPublicLeagues(
  opts: { sportId?: string } = {}
): Promise<LeagueListItem[]> {
  // Paused leagues stay listed on purpose. They take no new members (league_join
  // requires status 'active' and answers LEAGUE_NOT_ACTIVE), but a league that
  // pauses for a season should not vanish from discovery. 'closed' is excluded:
  // there is nothing left to join or follow.
  //
  // Community visibility is deliberately NOT surfaced here. leagues_select would
  // permit it (it restricts community leagues to active members of the league's
  // network), so this is a product decision to park the community concept, not a
  // limitation. Flipping this back is a one-line change if that decision changes.
  let query = supabase
    .from('leagues')
    .select(LIST_SELECT)
    .eq('visibility', 'public')
    .in('status', ['active', 'paused'])
    .eq('league_members.status', 'active')
    .order('created_at', { ascending: false });
  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return toListItems((data ?? []) as ListRow[]);
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

  // Closed leagues are included: a member keeps their history, and hiding them
  // here left an archived league unreachable from BOTH lists. The caller splits
  // active from closed for display.
  let query = supabase
    .from('leagues')
    .select(LIST_SELECT)
    .eq('league_members.status', 'active')
    .order('created_at', { ascending: false });

  query = memberLeagueIds.length
    ? query.or(`organizer_id.eq.${userId},id.in.(${memberLeagueIds.join(',')})`)
    : query.eq('organizer_id', userId);

  if (opts.sportId) query = query.eq('sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return toListItems((data ?? []) as ListRow[]);
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
    p_logo_url: input.logoUrl ?? null,
    p_rules_override: (input.rulesOverride ?? null) as Json,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

export interface LeagueUpdatePatch {
  name?: string;
  description?: string | null;
  logoUrl?: string | null;
  visibility?: Enums<'tournament_visibility'>;
  joinMode?: Enums<'tournament_registration_mode'>;
  facilityId?: string | null;
  venueName?: string | null;
  surfaces?: string[];
  categories?: string[];
  level?: string | null;
  // Snapshotted by season_create, so an edit only reaches seasons created after it.
  defaultRules?: Record<string, unknown>;
  memberCapacity?: number | null;
  waitlistEnabled?: boolean;
  minRating?: number | null;
  maxRating?: number | null;
  minReputation?: number | null;
}

const LEAGUE_UPDATE_PATCH_COLUMNS: Record<keyof LeagueUpdatePatch, string> = {
  name: 'name',
  description: 'description',
  logoUrl: 'logo_url',
  visibility: 'visibility',
  joinMode: 'join_mode',
  facilityId: 'facility_id',
  venueName: 'venue_name',
  surfaces: 'surfaces',
  categories: 'categories',
  level: 'level',
  defaultRules: 'default_rules',
  memberCapacity: 'member_capacity',
  waitlistEnabled: 'waitlist_enabled',
  minRating: 'min_rating',
  maxRating: 'max_rating',
  minReputation: 'min_reputation',
};

type LeaguePatchValue = string | number | boolean | null | string[] | Record<string, unknown>;

/**
 * Organizer partial-update. Only keys present in the patch are sent; the server
 * gates each field on the league's current status and bumps `version`. Keys with
 * an explicit null clear the column, so undefined (not null) means "don't touch".
 */
export async function updateLeague(
  leagueId: string,
  versionWas: number,
  patch: LeagueUpdatePatch
): Promise<League> {
  const snakePatch: Record<string, LeaguePatchValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      snakePatch[LEAGUE_UPDATE_PATCH_COLUMNS[key as keyof LeagueUpdatePatch]] =
        value as LeaguePatchValue;
    }
  }

  const { data, error } = await supabase.rpc('league_update', {
    p_league_id: leagueId,
    p_version_was: versionWas,
    p_patch: snakePatch,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

/**
 * Lifecycle transitions. Each is version-guarded server-side, so a stale copy
 * raises OPTIMISTIC_LOCK_CONFLICT rather than silently re-applying.
 */
export async function pauseLeague(leagueId: string, versionWas: number): Promise<League> {
  const { data, error } = await supabase.rpc('league_pause', {
    p_league_id: leagueId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

export async function resumeLeague(leagueId: string, versionWas: number): Promise<League> {
  const { data, error } = await supabase.rpc('league_resume', {
    p_league_id: leagueId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

/** Terminal. Refuses with LEAGUE_HAS_OPEN_SEASONS until every season is closed. */
export async function closeLeague(
  leagueId: string,
  reason: string | null,
  versionWas: number
): Promise<League> {
  const { data, error } = await supabase.rpc('league_close', {
    p_league_id: leagueId,
    p_reason: reason,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as League;
}

// ---------------------------------------------------------------------------
// Paid seasons
//
// The paid unit is the SEASON: a league is permanent, you pay to play a season.
// Both edge functions are shared with tournaments and return the same shapes,
// so TournamentPaymentError is reused rather than cloned — the code strings are
// what differ ('season_not_open' vs 'tournament_reg_closed').
// ---------------------------------------------------------------------------

export interface SeasonFeeQuote {
  entryCents: number;
  serviceFeeCents: number;
  /** GST/QST on the service fee (Rallia remits). Never refunded. */
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

/** Returns null for a free season. */
export async function getSeasonFeeQuote(seasonId: string): Promise<SeasonFeeQuote | null> {
  const { data, error } = await supabase.rpc('season_fee_quote', { p_season_id: seasonId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.entry_cents <= 0) return null;
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

/**
 * Claim a season slot at payment_pending and open a Stripe PaymentIntent. The
 * caller drives the PaymentSheet with `clientSecret`; the webhook flips the
 * member to 'enrolled'. Throws TournamentPaymentError(code) on guard failures.
 */
export async function createSeasonEnrollmentPayment(
  seasonId: string
): Promise<RegistrationPaymentIntent> {
  const { data, error } = await supabase.functions.invoke('lt-create-registration-payment', {
    body: { seasonId },
  });

  // Guard failures come back as { error: code }; supabase-js surfaces non-2xx as
  // `error` (body on error.context) and may leave data null, so check both.
  let code: string | undefined = (data as { error?: string } | null)?.error;
  if (!code && error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx?.json) {
      try {
        code = (await ctx.json())?.error;
      } catch {
        // body wasn't JSON — fall through
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

/**
 * Stripe-hosted receipt page for the caller's paid season enrollment, or null
 * while the webhook hasn't stored one (or the season was free). Refunded
 * statuses are included: Stripe updates the same receipt to show the refund.
 */
export async function getSeasonReceiptUrl(seasonMemberId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('lt_registration_payment')
    .select('stripe_receipt_url')
    .eq('season_user_id', seasonMemberId)
    .in('status', ['succeeded', 'partially_refunded', 'refunded'])
    .not('stripe_receipt_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.stripe_receipt_url ?? null;
}

/** Withdraw from a paid season and refund per policy. The entry only — the
 *  service fee and its tax are never returned. */
export async function refundSeasonEnrollment(
  seasonMemberId: string,
  versionWas: number
): Promise<{ withdrawn: boolean; refundedCents: number }> {
  const { data, error } = await supabase.functions.invoke('lt-refund-registration', {
    body: { seasonMemberId, versionWas },
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

export interface SeasonUpdatePatch {
  name?: string;
  startDate?: string;
  endDate?: string;
  rules?: Record<string, unknown>;
  // Server gates all fee fields to 'draft' — once a season opens, the price
  // someone agreed to is history.
  entryFeeCents?: number;
  feePayer?: Enums<'fee_payer_enum'>;
  payoutTiming?: Enums<'payout_timing_enum'>;
  refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
  refundPartialBps?: number | null;
  refundCutoffAt?: string | null;
}

const SEASON_UPDATE_PATCH_COLUMNS: Record<keyof SeasonUpdatePatch, string> = {
  name: 'name',
  startDate: 'start_date',
  endDate: 'end_date',
  rules: 'rules',
  entryFeeCents: 'entry_fee_cents',
  feePayer: 'fee_payer',
  payoutTiming: 'payout_timing',
  refundPolicyKind: 'refund_policy_kind',
  refundPartialBps: 'refund_partial_bps',
  refundCutoffAt: 'refund_cutoff_at',
};

export async function updateSeason(
  seasonId: string,
  versionWas: number,
  patch: SeasonUpdatePatch
): Promise<Season> {
  const snakePatch: Record<string, LeaguePatchValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      snakePatch[SEASON_UPDATE_PATCH_COLUMNS[key as keyof SeasonUpdatePatch]] =
        value as LeaguePatchValue;
    }
  }
  const { data, error } = await supabase.rpc('season_update', {
    p_season_id: seasonId,
    p_version_was: versionWas,
    p_patch: snakePatch,
  });
  if (error) throw new Error(error.message);
  return data as Season;
}

/** Cancels the season and its pending sessions. This is what makes paid
 *  enrolments refundable — the settle cron picks cancelled seasons up. */
export async function cancelSeason(
  seasonId: string,
  reason: string | null,
  versionWas: number
): Promise<Season> {
  const { data, error } = await supabase.rpc('season_cancel', {
    p_season_id: seasonId,
    p_reason: reason,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Season;
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

export interface LeagueWaitlistStatus {
  queueRank: number;
  queueSize: number;
}

/**
 * The caller's live place in a capped league's waitlist, or null when not
 * queued. RLS hides other rows, so the rank comes from a definer RPC rather
 * than a count.
 */
export async function getMyLeagueWaitlistStatus(
  leagueId: string
): Promise<LeagueWaitlistStatus | null> {
  const { data, error } = await supabase.rpc('league_waitlist_position', {
    p_league_id: leagueId,
  });
  if (error) throw new Error(error.message);
  const row = (data as { queue_rank: number; queue_size: number }[] | null)?.[0];
  return row ? { queueRank: row.queue_rank, queueSize: row.queue_size } : null;
}

export type LeagueWaitlistEntry = Tables<'league_member_waitlist'>;

/**
 * The un-promoted queue in promotion order. RLS scopes this to the whole
 * queue for the organizer and to the caller's own row otherwise.
 */
export async function listLeagueWaitlist(leagueId: string): Promise<LeagueWaitlistEntry[]> {
  const { data, error } = await supabase
    .from('league_member_waitlist')
    .select('*')
    .eq('league_id', leagueId)
    .is('promoted_at', null)
    .order('position', { ascending: true })
    .order('joined_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeagueWaitlistEntry[];
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
  /** Omit or 0 for a free season. */
  entryFeeCents?: number;
  feePayer?: Enums<'fee_payer_enum'>;
  payoutTiming?: Enums<'payout_timing_enum'>;
  refundPolicyKind?: Enums<'refund_policy_kind_enum'>;
  refundPartialBps?: number | null;
  refundCutoffAt?: string | null;
}): Promise<Season> {
  const { data, error } = await supabase.rpc('season_create', {
    p_league_id: input.leagueId,
    p_name: input.name,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_rules_override: input.rulesOverride ?? null,
    p_entry_fee_cents: input.entryFeeCents ?? 0,
    p_fee_payer: input.feePayer ?? 'player_pays',
    p_payout_timing: input.payoutTiming ?? 'hold_until_event_end',
    p_refund_policy_kind: input.refundPolicyKind ?? 'none',
    p_refund_partial_bps: input.refundPartialBps ?? null,
    p_refund_cutoff_at: input.refundCutoffAt ?? null,
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
// Season enrollment (roster) — the per-season membership paid leagues attach to
// ---------------------------------------------------------------------------

export async function enrollInSeason(seasonId: string): Promise<SeasonMember> {
  const { data, error } = await supabase.rpc('season_enroll', { p_season_id: seasonId });
  if (error) throw new Error(error.message);
  return data as SeasonMember;
}

export async function withdrawFromSeason(seasonId: string): Promise<SeasonMember> {
  const { data, error } = await supabase.rpc('season_withdraw', { p_season_id: seasonId });
  if (error) throw new Error(error.message);
  return data as SeasonMember;
}

export async function removeSeasonMember(
  seasonMemberId: string,
  versionWas: number
): Promise<SeasonMember> {
  const { data, error } = await supabase.rpc('season_remove_member', {
    p_season_member_id: seasonMemberId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as SeasonMember;
}

export async function listSeasonMembers(seasonId: string): Promise<SeasonMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('season_members')
    .select('*')
    .eq('season_id', seasonId)
    .eq('status', 'enrolled')
    .order('enrolled_at', { ascending: true });
  if (error) throw new Error(error.message);
  const members = (data ?? []) as SeasonMember[];
  if (members.length === 0) return [];

  const profiles = await getProfilesByIds(members.map(m => m.user_id));
  return members.map(m => ({
    ...m,
    profile: profiles[m.user_id] ?? null,
  }));
}

export async function getMySeasonMembership(
  seasonId: string,
  userId: string
): Promise<SeasonMember | null> {
  const { data, error } = await supabase
    .from('season_members')
    .select('*')
    .eq('season_id', seasonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SeasonMember | null;
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

/** A released session matchup with no linked game yet — a home call-to-action. */
export type UnscheduledSessionMatch = SessionMatch & {
  session: Pick<Session, 'id' | 'name' | 'scheduled_at' | 'season_id'> & {
    season: Pick<Season, 'id' | 'league_id'> & {
      league: Pick<League, 'id' | 'name' | 'sport_id'>;
    };
  };
};

/**
 * List the caller's released session matchups that are waiting for a game to
 * be linked (match_id IS NULL) in live sessions. Calls to action, not agenda
 * items — once linked, the matchup flows through the regular match rails as
 * a `match` row.
 */
export async function listMyUnscheduledSessionMatches(
  userId: string,
  opts: { sportId?: string; limit?: number } = {}
): Promise<UnscheduledSessionMatch[]> {
  // Imperative refetches bypass the hook's enabled:!!userId gate — never interpolate undefined.
  if (!userId) return [];
  let query = supabase
    .from('session_matches')
    .select(
      '*, session:sessions!inner(id, name, scheduled_at, season_id, season:seasons!inner(id, league_id, league:leagues!inner(id, name, sport_id)))'
    )
    .eq('status', 'pending')
    .is('match_id', null)
    .eq('is_drill', false)
    .or(`team_a_user_ids.cs.{${userId}},team_b_user_ids.cs.{${userId}}`)
    .in('session.status', ['published', 'in_progress'])
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 10);
  if (opts.sportId) query = query.eq('session.season.league.sport_id', opts.sportId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as UnscheduledSessionMatch[];
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

/**
 * Creates a whole run of sessions at once, spaced `repeatEveryDays` apart. The
 * occurrences are ordinary drafts: each is published, edited or cancelled on
 * its own afterwards. The server refuses a run that would outlive its season.
 */
export async function createLeagueSessionSeries(input: {
  seasonId: string;
  name: string;
  firstAt: string;
  repeatEveryDays: number;
  occurrences: number;
  timezone?: string;
  durationMinutes?: number;
  facilityId?: string;
  venueName?: string;
  capacity?: number;
  rounds?: number;
  pairingMode?: Enums<'pairing_mode'>;
}): Promise<Session[]> {
  const { data, error } = await supabase.rpc('session_create_series', {
    p_season_id: input.seasonId,
    p_name: input.name,
    p_first_at: input.firstAt,
    p_repeat_every_days: input.repeatEveryDays,
    p_occurrences: input.occurrences,
    p_timezone: input.timezone ?? null,
    p_duration_minutes: input.durationMinutes ?? 90,
    p_facility_id: input.facilityId ?? null,
    p_venue_name: input.venueName ?? null,
    p_capacity: input.capacity ?? null,
    p_rounds: input.rounds ?? 1,
    p_pairing_mode: input.pairingMode ?? 'by_rank',
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Session[];
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

/**
 * Organizer withdraws a member from a published session (confirmed or
 * waitlisted -> declined). Frees a seat, which lets the waitlist trigger
 * promote the next player. Cannot seat anyone.
 */
export async function withdrawSessionMember(
  sessionId: string,
  userId: string,
  versionWas: number
): Promise<SessionPresence> {
  const { data, error } = await supabase.rpc('session_withdraw_member', {
    p_session_id: sessionId,
    p_user_id: userId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as SessionPresence;
}

/** Nudges every member who has not answered yet. Returns how many were reached. */
export async function remindPendingSessionMembers(sessionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('session_remind_pending', {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
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

/**
 * Releases a draft sheet to the league members. A generated (or regenerated)
 * sheet is organizer-only until this lands, which is what gives the organizer
 * room to adjust pairings before anyone sees them. Idempotent server-side, so
 * a double tap is harmless.
 */
export async function publishSessionSheet(sessionId: string, versionWas: number): Promise<Session> {
  const { data, error } = await supabase.rpc('session_publish_sheet', {
    p_session_id: sessionId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

/**
 * Organizer substitution on one named pairing of a published sheet: `userOut`
 * leaves `matchId` and `userIn` takes the slot. If `userIn` was already paired
 * in that same round, the two trade; if they were on a bye that round, they
 * simply come in. Refused once either pairing carries a result.
 */
export async function swapSessionPlayer(
  sessionId: string,
  matchId: string,
  userOut: string,
  userIn: string,
  versionWas: number
): Promise<Session> {
  const { data, error } = await supabase.rpc('session_swap_player', {
    p_session_id: sessionId,
    p_match_id: matchId,
    p_user_out: userOut,
    p_user_in: userIn,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as Session;
}

export type LeagueInviteLink = Tables<'league_invite_links'>;

export interface LeagueInvitePreview {
  league: League;
  activeCount: number;
}

/**
 * The caller's active invite link, minted on first call. Organizers get the
 * league's shared organizer link (skeleton key); anyone else gets their own
 * player link, which only exists on a public, non-invite-only, active league
 * (SHARING_NOT_AVAILABLE otherwise).
 */
export async function getOrCreateLeagueInvite(leagueId: string): Promise<LeagueInviteLink> {
  const { data, error } = await supabase.rpc('league_invite_get_or_create', {
    p_league_id: leagueId,
  });
  if (error) throw new Error(error.message);
  return data as LeagueInviteLink;
}

/**
 * Revokes the active organizer link and mints a fresh one. Player links are
 * deliberately left alone — they redeem through the normal join rules.
 */
export async function resetLeagueInvite(leagueId: string): Promise<LeagueInviteLink> {
  const { data, error } = await supabase.rpc('league_invite_reset', {
    p_league_id: leagueId,
  });
  if (error) throw new Error(error.message);
  return data as LeagueInviteLink;
}

/**
 * Token preview: resolves a valid invite token to its league — bypassing RLS
 * so invitees can see private leagues before joining — plus the active member
 * count. Throws INVITE_INVALID for unknown / revoked / expired tokens.
 */
export async function getLeagueByInviteToken(token: string): Promise<LeagueInvitePreview> {
  const { data, error } = await supabase.rpc('league_get_by_invite_token', { p_token: token });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { league: League; active_count: number };
  return { league: payload.league, activeCount: payload.active_count };
}

/**
 * Joins the caller via an invite token. An organizer link bypasses join_mode
 * and the rating/reputation gates (never capacity); a player link goes through
 * the normal league_join rules — an approval league lands the caller pending.
 * Idempotent for already-active members.
 */
export async function joinLeagueViaInvite(token: string): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_join_via_invite', { p_token: token });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

/**
 * Shareable league invite URL on the unified /invite format — the sender's
 * referral code rides along for signup attribution. `sessionId` points the
 * recipient at a specific session once they're in.
 */
export function getLeagueShareLink(
  token: string,
  leagueId: string,
  referralCode: string,
  options?: { sessionId?: string; utm?: UtmParams }
): string {
  return generateInvitationLink({
    type: 'league',
    referralCode,
    targetId: leagueId,
    shareToken: token,
    sessionId: options?.sessionId,
    utm: options?.utm,
  });
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

// ---------------------------------------------------------------------------
// Member invites (intra-app)
// ---------------------------------------------------------------------------

export async function inviteLeagueMembers(leagueId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('league_invite_members', {
    p_league_id: leagueId,
    p_user_ids: userIds,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function acceptLeagueInvite(leagueId: string): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_accept_invite', {
    p_league_id: leagueId,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function revokeLeagueInvite(
  memberId: string,
  versionWas: number
): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_revoke_invite', {
    p_member_id: memberId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

// ---------------------------------------------------------------------------
// Member lifecycle (leave / remove / suspend / reinstate)
// ---------------------------------------------------------------------------

export async function leaveLeague(leagueId: string): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_leave', { p_league_id: leagueId });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function removeLeagueMember(
  memberId: string,
  versionWas: number
): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_remove_member', {
    p_member_id: memberId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function suspendLeagueMember(
  memberId: string,
  versionWas: number,
  opts: { reason?: string; until?: string } = {}
): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_suspend_member', {
    p_member_id: memberId,
    p_version_was: versionWas,
    p_reason: opts.reason ?? null,
    p_until: opts.until ?? null,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

export async function reinstateLeagueMember(
  memberId: string,
  versionWas: number
): Promise<LeagueMember> {
  const { data, error } = await supabase.rpc('league_reinstate_member', {
    p_member_id: memberId,
    p_version_was: versionWas,
  });
  if (error) throw new Error(error.message);
  return data as LeagueMember;
}

// ---------------------------------------------------------------------------
// Session match bridge — link a verified casual match to a session pairing
// (mirror of listLinkableMatchesForSlot / attachMatchToTournamentSlot)
// ---------------------------------------------------------------------------

/**
 * List the caller's games that could be linked to a session pairing: every
 * member of the pairing is a joined participant (2 for singles, 4 for doubles),
 * same sport + format, and not already linked to another session pairing or a
 * tournament bracket slot.
 *
 * Games still missing a score, or with a score the opponent has not confirmed,
 * are returned too (see `state`) so the picker can show them as not-yet-linkable
 * with the step that unblocks them. Only 'ready' rows may be attached.
 */
export async function listLinkableMatchesForSessionSlot(params: {
  sessionMatchId: string;
  team1UserIds: string[];
  team2UserIds: string[];
  sportId: string;
  entryFormat: Enums<'entry_format'>;
}): Promise<LinkableMatch[]> {
  // Scoreless games are candidates too, so the result join can't be inner —
  // which means upcoming games would otherwise crowd out played ones. Only
  // games whose date has passed can have been played.
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('match')
    .select(
      `id, match_date, start_time, end_time, format,
       match_result ( id, is_verified, verified_at, winning_team, team1_score, team2_score,
         match_set ( set_number, team1_score, team2_score ) ),
       match_participant!inner ( player_id, status, team_number )`
    )
    .eq('sport_id', params.sportId)
    .lte('match_date', todayIso)
    .order('match_date', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

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
    if ((row.format ?? 'singles') !== (isDoubles ? 'doubles' : 'singles')) continue;
    const state: LinkableMatchState = !mr
      ? 'awaiting_score'
      : mr.is_verified
        ? 'ready'
        : 'awaiting_confirmation';

    const joined = row.match_participant.filter(p => p.status === 'joined');
    const joinedUsers = joined.map(p => p.player_id);
    if (expected.size !== expectedSize || joinedUsers.length !== expectedSize) continue;
    if (!joinedUsers.every(u => expected.has(u))) continue;
    if (!Array.from(expected).every(u => joinedUsers.includes(u))) continue;

    let team1_user_ids = joined.filter(p => p.team_number === 1).map(p => p.player_id);
    let team2_user_ids = joined.filter(p => p.team_number === 2).map(p => p.player_id);
    if (!isDoubles && (team1_user_ids.length === 0 || team2_user_ids.length === 0)) {
      const t1 = team1_user_ids[0] ?? joinedUsers.find(u => u !== team2_user_ids[0]) ?? null;
      const t2 = team2_user_ids[0] ?? joinedUsers.find(u => u !== t1) ?? null;
      team1_user_ids = t1 ? [t1] : [];
      team2_user_ids = t2 ? [t2] : [];
    }

    const sets = (mr?.match_set ?? [])
      .slice()
      .sort((a, b) => a.set_number - b.set_number)
      .map(s => ({ team1: s.team1_score, team2: s.team2_score }));

    eligible.push({
      state,
      id: row.id,
      match_date: row.match_date,
      start_time: row.start_time,
      end_time: row.end_time,
      match_result_id: mr?.id ?? null,
      winning_team: (mr?.winning_team as 1 | 2 | null) ?? null,
      team1_score: mr?.team1_score ?? null,
      team2_score: mr?.team2_score ?? null,
      verified_at: mr?.verified_at ?? null,
      team1_user_ids,
      team2_user_ids,
      sets,
    });
  }

  if (eligible.length === 0) return eligible;
  const ids = eligible.map(m => m.id);
  const [sLinked, tLinked] = await Promise.all([
    supabase
      .from('session_matches')
      .select('match_id')
      .in('match_id', ids)
      .neq('id', params.sessionMatchId),
    supabase.from('tournament_matches').select('match_id').in('match_id', ids),
  ]);
  if (sLinked.error) throw new Error(sLinked.error.message);
  if (tLinked.error) throw new Error(tLinked.error.message);
  const taken = new Set<string>();
  for (const r of sLinked.data ?? []) if (r.match_id) taken.add(r.match_id);
  for (const r of tLinked.data ?? []) if (r.match_id) taken.add(r.match_id);

  // Linkable games first; the rest keep the date ordering from the query.
  return eligible
    .filter(m => !taken.has(m.id))
    .sort((a, b) => Number(b.state === 'ready') - Number(a.state === 'ready'));
}

/**
 * Attach a verified, played match to a pending session pairing. The server
 * validates participation, sport, verified result, and exact-participant match.
 */
export async function attachMatchToSessionSlot(
  sessionMatchId: string,
  matchId: string
): Promise<SessionMatch> {
  const { data, error } = await supabase.rpc('session_attach_match', {
    p_session_match_id: sessionMatchId,
    p_match_id: matchId,
  });
  if (error) throw new Error(error.message);
  return data as SessionMatch;
}

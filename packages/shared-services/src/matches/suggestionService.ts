/**
 * Match Suggestion Service
 *
 * Produces a 7-day grid of personalized match suggestions:
 *   - For each of the next 7 days, returns up to 5 (opponent, facility, slot)
 *     triplets — at most one per opponent per day.
 *   - Slot times come from the 6 fixed product hours: 8, 10, 14, 16, 18, 20.
 *     A slot is only emitted when both its day-of-week AND its period are in
 *     the suggéreur's shared availability with the caller.
 *   - Scoring per triplet = playerCompatibility (from RPC) +
 *     actionabilityBoost (per-opponent slot count) + urgencyBoost (sooner
 *     slots) + jitter.
 *
 * NOTE: Realtime court availability is not used here — slots are generated
 * from the shared day×period overlap. `hasAvailabilitySource` is always false.
 */

import { supabase } from '../supabase';
import { createMatch, invitePlayersToMatch } from './matchService';
import type { MatchTypeEnum, MatchDurationEnum, MatchFormatEnum } from '@rallia/shared-types';

// =============================================================================
// TYPES
// =============================================================================

/** Raw row returned by the get_match_suggestions_scored RPC */
interface ScoredMatchup {
  opponent_id: string;
  opponent_first_name: string;
  opponent_last_name: string;
  opponent_avatar: string | null;
  opponent_reputation_score: number | null;
  opponent_reputation_tier: string;
  opponent_rating_value: number | null;
  opponent_rating_label: string | null;
  opponent_badge_status: string | null;
  facility_id: string;
  facility_name: string;
  facility_address: string;
  facility_city: string;
  facility_data_provider_id: string | null;
  facility_provider_type: string | null;
  facility_external_id: string | null;
  facility_booking_url_tpl: string | null;
  facility_timezone: string | null;
  overlapping_days_periods: OverlapSlot[];
  match_type: string;
  match_duration: string;
  player_compatibility: number;
  facility_affinity: number;
  matchup_score: number;
}

export interface OverlapSlot {
  day: string; // 'monday' .. 'sunday'
  period: string; // 'morning' | 'afternoon' | 'evening'
}

export interface SuggestionFacility {
  facilityId: string;
  facilityName: string;
  facilityAddress: string;
  facilityCity: string;
  facilityAffinity: number;
  hasAvailabilitySource: boolean;
}

export interface SuggestionSlot {
  datetime: Date;
  endDatetime: Date;
  bookingUrl: string | null;
}

/** A single (opponent, facility, slot) triplet — one card. */
export interface SlotSuggestion {
  opponentId: string;
  opponentFirstName: string;
  opponentLastName: string;
  opponentAvatar: string | null;
  opponentReputationScore: number | null;
  opponentReputationTier: string;
  opponentRatingScoreValue: number | null;
  opponentRatingLabel: string | null;
  opponentBadgeStatus: string | null;
  matchType: string;
  matchDuration: string;

  facility: SuggestionFacility;
  slot: SuggestionSlot;

  /** Final ordering score (player_compatibility + boosts + jitter). */
  score: number;
  /** Per-opponent compatibility from the RPC, before per-slot boosts. */
  playerCompatibility: number;
}

export interface GetMatchSuggestionsParams {
  /** Authenticated caller's player id. Omit for anon mode. */
  playerId?: string;
  sportId: string;
  sportName?: string;
  /** Anon mode: caller latitude. Required when playerId is not provided. */
  latitude?: number;
  /** Anon mode: caller longitude. Required when playerId is not provided. */
  longitude?: number;
  /** Anon mode: search radius in km (defaults to 25). */
  maxDistanceKm?: number;
  /** Cancellation signal — wired through TanStack's queryFn. */
  signal?: AbortSignal;
}

export interface BusySlot {
  matchDate: string;
  startTime: string;
  endTime: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Lookahead window for slot generation. */
const DAYS_AHEAD = 7;

/** Fixed candidate hours per period (product spec). */
const PERIOD_FIXED_HOURS: Record<string, number[]> = {
  morning: [8, 10],
  afternoon: [14, 16],
  evening: [18, 20],
};

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

// =============================================================================
// DATE HELPERS
// =============================================================================

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextNDays(n: number): { date: Date; key: string }[] {
  const out: { date: Date; key: string }[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push({ date: d, key: dateKey(d) });
  }
  return out;
}

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

export function hasTimeConflict(
  proposedDate: string,
  proposedStartHour: number,
  proposedEndHour: number,
  busySlots: BusySlot[]
): boolean {
  const proposedStart = `${String(proposedStartHour).padStart(2, '0')}:00`;
  const proposedEnd = `${String(proposedEndHour).padStart(2, '0')}:00`;
  return busySlots.some(slot => {
    if (slot.matchDate !== proposedDate) return false;
    return proposedStart < slot.endTime && proposedEnd > slot.startTime;
  });
}

async function fetchBusySlots(
  playerIds: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, BusySlot[]>> {
  const busyByPlayer = new Map<string, BusySlot[]>();
  if (playerIds.length === 0) return busyByPlayer;

  const { data, error } = await supabase
    .from('match_participant')
    .select(
      `
      player_id,
      match:match_id (
        match_date,
        start_time,
        end_time,
        cancelled_at
      )
    `
    )
    .in('player_id', playerIds)
    .in('status', ['joined', 'requested', 'pending', 'waitlisted']);

  if (error || !data) {
    console.warn('[SuggestionService] Failed to fetch busy slots:', error);
    return busyByPlayer;
  }

  for (const row of data) {
    const match = row.match as unknown as {
      match_date: string;
      start_time: string;
      end_time: string;
      cancelled_at: string | null;
    };
    if (!match || match.cancelled_at) continue;
    if (match.match_date < startDate || match.match_date > endDate) continue;

    const playerId = row.player_id as string;
    if (!busyByPlayer.has(playerId)) busyByPlayer.set(playerId, []);
    busyByPlayer.get(playerId)!.push({
      matchDate: match.match_date,
      startTime: match.start_time,
      endTime: match.end_time,
    });
  }

  return busyByPlayer;
}

/**
 * Returns the set of opponent IDs the caller has an active pending invite to —
 * i.e. the caller created an upcoming, non-cancelled match and the opponent is
 * a `pending` participant. Used to suppress repeat suggestions for someone the
 * caller has already pinged.
 */
async function fetchOpponentsWithPendingInviteFromCaller(
  callerId: string,
  todayKey: string
): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await supabase
    .from('match_participant')
    .select(
      `
      player_id,
      match:match_id!inner (
        created_by,
        match_date,
        cancelled_at
      )
    `
    )
    .eq('status', 'pending')
    .neq('player_id', callerId);

  if (error || !data) {
    if (error) console.warn('[SuggestionService] Failed to fetch pending invites:', error);
    return out;
  }

  for (const row of data) {
    const m = row.match as unknown as {
      created_by: string;
      match_date: string;
      cancelled_at: string | null;
    } | null;
    if (!m || m.cancelled_at) continue;
    if (m.created_by !== callerId) continue;
    if (m.match_date < todayKey) continue;
    out.add(row.player_id as string);
  }
  return out;
}

// =============================================================================
// SLOT GENERATION (FIXED HOURS)
// =============================================================================

/**
 * For a single (opponent, facility) row, emit one candidate slot per matching
 * (date, fixed-hour) cell across the 7-day window. Returns slots already
 * filtered against the caller's and the opponent's busy windows.
 *
 * Exported for unit testing.
 */
export function generateFixedHourSlots(
  overlaps: OverlapSlot[],
  window: { date: Date; key: string }[],
  callerBusy: BusySlot[],
  opponentBusy: BusySlot[],
  now: Date
): SuggestionSlot[] {
  if (overlaps.length === 0) return [];

  // Build a Set of "day:period" pairs for O(1) lookup
  const overlapSet = new Set(overlaps.map(o => `${o.day}:${o.period}`));

  const out: SuggestionSlot[] = [];
  const nowMs = now.getTime();

  for (const { date, key } of window) {
    const dayName = DAY_NAMES[date.getDay()];
    for (const period of Object.keys(PERIOD_FIXED_HOURS)) {
      if (!overlapSet.has(`${dayName}:${period}`)) continue;
      const hours = PERIOD_FIXED_HOURS[period];
      for (const h of hours) {
        const slotStart = new Date(date);
        slotStart.setHours(h, 0, 0, 0);
        if (slotStart.getTime() <= nowMs) continue;
        if (hasTimeConflict(key, h, h + 1, callerBusy)) continue;
        if (hasTimeConflict(key, h, h + 1, opponentBusy)) continue;

        out.push({
          datetime: slotStart,
          endDatetime: new Date(slotStart.getTime() + 60 * 60 * 1000),
          bookingUrl: null,
        });
      }
    }
  }
  return out;
}

// =============================================================================
// SCORE BOOSTS
// =============================================================================

function urgencyBoostForDate(slotDate: Date, now: Date): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const slotStart = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate());
  const daysAway = Math.round((slotStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAway <= 1) return 0.05;
  if (daysAway === 2) return 0.03;
  if (daysAway === 3) return 0.01;
  return 0;
}

function actionabilityBoostFor(totalSlotsForOpponent: number): number {
  return Math.min(0.1, Math.max(0, (totalSlotsForOpponent - 1) * 0.012));
}

// =============================================================================
// PIPELINE — Steps 1-4 (RPC → busy slots → triplet expansion → scoring)
// =============================================================================

interface ScoredTriplet {
  row: ScoredMatchup;
  slot: SuggestionSlot;
  dateKey: string;
  score: number;
}

interface ComputeTripletsResult {
  triplets: ScoredTriplet[];
  windowKeys: string[];
  aborted: boolean;
}

/**
 * Shared pipeline for both `getMatchSuggestions` (per-day grid) and
 * `getTopSuggestions` (flat top-N). Returns scored, conflict-filtered triplets
 * — the consumer decides how to bucket/order/cap them.
 */
async function computeScoredTriplets(
  params: GetMatchSuggestionsParams
): Promise<ComputeTripletsResult> {
  const { playerId, sportId, latitude, longitude, maxDistanceKm = 25, signal } = params;
  const isAnon = !playerId;

  const window = getNextNDays(DAYS_AHEAD);
  const windowKeys = window.map(w => w.key);

  if (isAnon && (latitude == null || longitude == null)) {
    console.warn('[SuggestionService] Anon mode requires latitude/longitude');
    return { triplets: [], windowKeys, aborted: false };
  }

  // Headroom — we want enough opponents/facilities to survive conflict and
  // opponent-dedup filtering downstream. 140 is empirically safe for the
  // 30-item Public Matches padding cap.
  const rpcLimit = 140;

  // ── Step 1: Call SQL RPC ────────────────────────────────────────────
  const rpcBuilder = isAnon
    ? supabase.rpc('get_match_suggestions_anon', {
        p_sport_id: sportId,
        p_lat: latitude!,
        p_lng: longitude!,
        p_max_distance_km: maxDistanceKm,
        p_limit: rpcLimit,
      })
    : supabase.rpc('get_match_suggestions_scored', {
        p_player_id: playerId!,
        p_sport_id: sportId,
        p_limit: rpcLimit,
        p_lat: latitude ?? null,
        p_lng: longitude ?? null,
      });
  if (signal) rpcBuilder.abortSignal(signal);
  const { data: scoredRows, error } = await rpcBuilder;
  if (signal?.aborted) return { triplets: [], windowKeys, aborted: true };

  if (error) {
    console.error('[SuggestionService] RPC error:', error);
    return { triplets: [], windowKeys, aborted: false };
  }
  if (!scoredRows || scoredRows.length === 0) {
    return { triplets: [], windowKeys, aborted: false };
  }

  let scored = scoredRows as ScoredMatchup[];

  // ── Step 1b: Drop opponents the caller has already pinged ──────────
  // Anon mode has no caller, so nothing to exclude.
  if (!isAnon) {
    const alreadyInvited = await fetchOpponentsWithPendingInviteFromCaller(
      playerId!,
      window[0].key
    );
    if (signal?.aborted) return { triplets: [], windowKeys, aborted: true };
    if (alreadyInvited.size > 0) {
      scored = scored.filter(r => !alreadyInvited.has(r.opponent_id));
    }
    if (scored.length === 0) {
      return { triplets: [], windowKeys, aborted: false };
    }
  }

  // ── Step 2: Busy slots for caller + opponents (conflict detection) ──
  const uniqueOpponentIds = [...new Set(scored.map(r => r.opponent_id))];
  const allPlayerIds = isAnon ? uniqueOpponentIds : [playerId!, ...uniqueOpponentIds];
  const startDate = window[0].key;
  const endDate = window[window.length - 1].key;

  const busyByPlayer = await fetchBusySlots(allPlayerIds, startDate, endDate);
  if (signal?.aborted) return { triplets: [], windowKeys, aborted: true };
  const callerBusy = isAnon ? [] : (busyByPlayer.get(playerId!) ?? []);

  // ── Step 3: Expand RPC rows into candidate triplets ─────────────────
  const now = new Date();

  interface RawTriplet {
    row: ScoredMatchup;
    slot: SuggestionSlot;
    dateKey: string;
  }

  const rawTriplets: RawTriplet[] = [];
  /** opponent_id → total slot count across all facilities, used for actionability */
  const slotCountByOpponent = new Map<string, number>();

  for (const row of scored) {
    const opponentBusy = busyByPlayer.get(row.opponent_id) ?? [];
    const slots = generateFixedHourSlots(
      row.overlapping_days_periods || [],
      window,
      callerBusy,
      opponentBusy,
      now
    );
    if (slots.length === 0) continue;

    slotCountByOpponent.set(
      row.opponent_id,
      (slotCountByOpponent.get(row.opponent_id) ?? 0) + slots.length
    );

    for (const slot of slots) {
      rawTriplets.push({ row, slot, dateKey: dateKey(slot.datetime) });
    }
  }

  // ── Step 4: Score each triplet ──────────────────────────────────────
  const triplets: ScoredTriplet[] = rawTriplets.map(t => {
    const action = actionabilityBoostFor(slotCountByOpponent.get(t.row.opponent_id) ?? 0);
    const urgency = urgencyBoostForDate(t.slot.datetime, now);
    const jitter = (Math.random() - 0.5) * 0.06;
    const score = Number(t.row.player_compatibility) + action + urgency + jitter;
    return { ...t, score };
  });

  return { triplets, windowKeys, aborted: false };
}

// =============================================================================
// MAIN — Flat top-N (used by every consumer: Suggestion Sheet, Onboarding,
// Public Matches padding, daily-digest composer, JustForYou composer)
// =============================================================================

export interface GetTopSuggestionsParams extends GetMatchSuggestionsParams {
  /** Maximum number of suggestions to return after global opponent dedup. */
  maxItems: number;
}

/**
 * Returns up to `maxItems` suggestions, deduped by opponent globally (one slot
 * per opponent — the highest-scored), sorted by score desc, over the next
 * 7 days.
 */
export async function getTopSuggestions(
  params: GetTopSuggestionsParams
): Promise<SlotSuggestion[]> {
  const { triplets, aborted } = await computeScoredTriplets(params);
  if (aborted) return [];
  return pickTopGlobal(triplets, params.maxItems);
}

/**
 * Pure helper — picks at most one slot per opponent (the highest-scored),
 * sorts those slots by score desc across all opponents, and caps at
 * `maxItems`. Exported for unit testing.
 */
export function pickTopGlobal(
  triplets: { row: ScoredMatchup; slot: SuggestionSlot; dateKey: string; score: number }[],
  maxItems: number
): SlotSuggestion[] {
  if (maxItems <= 0) return [];
  const bestByOpponent = new Map<string, (typeof triplets)[number]>();
  for (const t of triplets) {
    const existing = bestByOpponent.get(t.row.opponent_id);
    if (!existing || t.score > existing.score) {
      bestByOpponent.set(t.row.opponent_id, t);
    }
  }
  return [...bestByOpponent.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)
    .map(toSlotSuggestion);
}

function toSlotSuggestion(t: {
  row: ScoredMatchup;
  slot: SuggestionSlot;
  score: number;
}): SlotSuggestion {
  const r = t.row;
  return {
    opponentId: r.opponent_id,
    opponentFirstName: r.opponent_first_name,
    opponentLastName: r.opponent_last_name,
    opponentAvatar: r.opponent_avatar,
    opponentReputationScore: r.opponent_reputation_score,
    opponentReputationTier: r.opponent_reputation_tier,
    opponentRatingScoreValue: r.opponent_rating_value,
    opponentRatingLabel: r.opponent_rating_label,
    opponentBadgeStatus: r.opponent_badge_status,
    matchType: r.match_type,
    matchDuration: r.match_duration,
    facility: {
      facilityId: r.facility_id,
      facilityName: r.facility_name,
      facilityAddress: r.facility_address,
      facilityCity: r.facility_city,
      facilityAffinity: Number(r.facility_affinity),
      hasAvailabilitySource: false,
    },
    slot: t.slot,
    score: t.score,
    playerCompatibility: Number(r.player_compatibility),
  };
}

// =============================================================================
// CREATE MATCH FROM SUGGESTION
// =============================================================================

export interface CreateFromSuggestionInput {
  createdBy: string;
  opponentId: string;
  sportId: string;
  matchType: string;
  matchDuration: string;
  facilityId: string;
  startTime: Date;
  /** End time from the slot — when provided, duration is derived from its length. */
  endTime?: Date | null;
  timezone: string;
}

function computeEndTime(startHour: number, duration: string): string {
  const durationMinutes = parseInt(duration, 10) || 60;
  const endMinutes = startHour * 60 + durationMinutes;
  const endHour = Math.floor(endMinutes / 60) % 24;
  const endMin = endMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
}

export async function createMatchFromSuggestion(
  input: CreateFromSuggestionInput
): Promise<{ matchId: string; invited: boolean }> {
  const startHour = input.startTime.getHours();
  const startMin = input.startTime.getMinutes();
  const matchDate = `${input.startTime.getFullYear()}-${String(input.startTime.getMonth() + 1).padStart(2, '0')}-${String(input.startTime.getDate()).padStart(2, '0')}`;
  const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

  let endTimeStr: string;
  let duration = input.matchDuration;

  if (input.endTime) {
    const endH = input.endTime.getHours();
    const endM = input.endTime.getMinutes();
    endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    const slotMinutes = Math.round((input.endTime.getTime() - input.startTime.getTime()) / 60000);
    if (slotMinutes <= 30) duration = '30';
    else if (slotMinutes <= 60) duration = '60';
    else if (slotMinutes <= 90) duration = '90';
    else duration = '120';
  } else {
    endTimeStr = computeEndTime(startHour, input.matchDuration);
  }

  const match = await createMatch({
    sportId: input.sportId,
    createdBy: input.createdBy,
    matchDate,
    startTime: startTimeStr,
    endTime: endTimeStr,
    timezone: input.timezone,
    format: 'singles' as MatchFormatEnum,
    playerExpectation: input.matchType as MatchTypeEnum,
    duration: duration as MatchDurationEnum,
    locationType: 'facility' as const,
    facilityId: input.facilityId,
    courtStatus: 'to_book',
    visibility: 'private' as const,
    visibleInGroups: false,
    visibleInCommunities: false,
    joinMode: 'direct' as const,
  });

  const result = await invitePlayersToMatch(match.id, [input.opponentId], input.createdBy);

  return {
    matchId: match.id,
    invited: result.invited.length > 0,
  };
}

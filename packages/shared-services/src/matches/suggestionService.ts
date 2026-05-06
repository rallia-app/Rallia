/**
 * Match Suggestion Service
 *
 * Orchestrates the match suggestion engine:
 * 1. Calls the SQL RPC for scored (opponent, facility) pairs
 * 2. Fetches busy times for caller + all opponents (conflict detection)
 * 3. Generates hour slots from shared availability (with conflict filtering)
 * 4. Groups by opponent with all compatible facilities + conflict-free slots
 * 5. Ranks opponents by player compatibility and returns quality-filtered results
 *
 * NOTE: Realtime court availability fetching is temporarily disabled for
 * performance. All facilities flow through the no-source slot generator and
 * `hasAvailabilitySource` is always false.
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
  day: string; // e.g. 'monday'
  period: string; // e.g. 'morning'
}

export interface AvailableTimeSlot {
  datetime: Date;
  endDatetime: Date;
  courtCount: number;
  bookingUrl: string | null;
}

export interface SuggestionFacility {
  facilityId: string;
  facilityName: string;
  facilityAddress: string;
  facilityCity: string;
  facilityAffinity: number;
  availableSlots: AvailableTimeSlot[];
  hasAvailabilitySource: boolean;
}

/** Final suggestion returned to the client — one per opponent */
export interface MatchSuggestion {
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
  playerCompatibility: number;
  facilities: SuggestionFacility[];
  sharedAvailability: OverlapSlot[];
}

export interface GetMatchSuggestionsParams {
  /** Authenticated caller's player id. Omit for anon mode. */
  playerId?: string;
  sportId: string;
  sportName?: string;
  limit?: number;
  /** Anon mode: caller latitude. Required when playerId is not provided. */
  latitude?: number;
  /** Anon mode: caller longitude. Required when playerId is not provided. */
  longitude?: number;
  /** Anon mode: search radius in km (defaults to 25). */
  maxDistanceKm?: number;
  /** Cancellation signal — wired through TanStack's queryFn. The scoring RPC
   *  honors `.abortSignal(signal)`; long-running downstream availability /
   *  busy-slot fetches are short-circuited via `signal.aborted` checks. */
  signal?: AbortSignal;
}

/** A player's existing match time window for conflict detection */
interface BusySlot {
  matchDate: string;
  startTime: string;
  endTime: string;
}

// =============================================================================
// TIME PERIOD MAPPING
// =============================================================================

const PERIOD_HOURS: Record<string, number[]> = {
  morning: [8, 9, 10, 11, 12],
  afternoon: [13, 14, 15, 16, 17],
  evening: [18, 19, 20, 21],
};

// =============================================================================
// DATE HELPERS
// =============================================================================

function getNextNDays(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return dates;
}

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

/**
 * Check if a proposed time slot overlaps with any of the player's existing matches.
 * Uses simple time-string comparison on the same date.
 */
function hasTimeConflict(
  proposedDate: string, // YYYY-MM-DD
  proposedStartHour: number,
  proposedEndHour: number,
  busySlots: BusySlot[]
): boolean {
  const proposedStart = `${String(proposedStartHour).padStart(2, '0')}:00`;
  const proposedEnd = `${String(proposedEndHour).padStart(2, '0')}:00`;

  return busySlots.some(slot => {
    if (slot.matchDate !== proposedDate) return false;
    // Standard overlap: start1 < end2 AND start2 < end1
    return proposedStart < slot.endTime && proposedEnd > slot.startTime;
  });
}

/**
 * Fetch busy times for a list of player IDs within a date range.
 * Returns a map of playerId → BusySlot[].
 */
async function fetchBusySlots(
  playerIds: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, BusySlot[]>> {
  const busyByPlayer = new Map<string, BusySlot[]>();

  if (playerIds.length === 0) return busyByPlayer;

  // Query all active match participations for these players within the date window
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

    // Skip cancelled matches
    if (!match || match.cancelled_at) continue;

    // Skip matches outside our date window
    if (match.match_date < startDate || match.match_date > endDate) continue;

    const playerId = row.player_id as string;
    if (!busyByPlayer.has(playerId)) {
      busyByPlayer.set(playerId, []);
    }
    busyByPlayer.get(playerId)!.push({
      matchDate: match.match_date,
      startTime: match.start_time,
      endTime: match.end_time,
    });
  }

  return busyByPlayer;
}

// =============================================================================
// NO-SOURCE SLOT GENERATION
// =============================================================================

/**
 * Generate on-the-hour slots for a facility without real-time availability data.
 * Slots are generated for each shared availability period within the date window.
 */
function generateNoSourceSlots(
  overlaps: OverlapSlot[],
  now: Date,
  dates: string[]
): AvailableTimeSlot[] {
  const slots: AvailableTimeSlot[] = [];
  const todayIndex = now.getDay();
  const currentHour = now.getHours();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (const overlap of overlaps) {
    const targetDayIndex = dayNames.indexOf(overlap.day);
    let daysAhead = targetDayIndex - todayIndex;
    if (daysAhead < 0) daysAhead += 7;

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysAhead);
    const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

    // Only generate slots within our fetch window
    if (!dates.includes(dateStr)) continue;

    const hours = PERIOD_HOURS[overlap.period] ?? [];
    const isToday = daysAhead === 0;

    for (const h of hours) {
      if (isToday && h <= currentHour) continue;

      const d = new Date(targetDate);
      d.setHours(h, 0, 0, 0);
      slots.push({
        datetime: d,
        endDatetime: new Date(d.getTime() + 60 * 60 * 1000),
        courtCount: 0,
        bookingUrl: null,
      });
    }
  }

  return slots.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

export async function getMatchSuggestions(
  params: GetMatchSuggestionsParams
): Promise<MatchSuggestion[]> {
  const {
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm = 25,
    limit = 10,
    signal,
  } = params;
  const isAnon = !playerId;

  if (isAnon && (latitude == null || longitude == null)) {
    console.warn('[SuggestionService] Anon mode requires latitude/longitude');
    return [];
  }

  const dates = getNextNDays(3);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  // RPC returns one row per (opponent, facility) and many opponents drop out
  // during conflict-filtering — ask for 4× headroom so the final cap can be hit.
  const rpcLimit = Math.max(50, limit * 4);

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
  if (signal?.aborted) return [];

  if (error) {
    console.error('[SuggestionService] RPC error:', error);
    return [];
  }

  if (!scoredRows || scoredRows.length === 0) {
    return [];
  }

  const scored = scoredRows as ScoredMatchup[];

  // ── Step 2: Fetch busy times for caller + all opponents ─────────────
  const uniqueOpponentIds = [...new Set(scored.map(r => r.opponent_id))];
  const allPlayerIds = isAnon ? uniqueOpponentIds : [playerId!, ...uniqueOpponentIds];

  const busyByPlayer = await fetchBusySlots(allPlayerIds, startDate, endDate);
  if (signal?.aborted) return [];

  const callerBusy = isAnon ? [] : (busyByPlayer.get(playerId!) ?? []);

  // ── Step 3: Group by opponent, build facilities + conflict-free slots ─
  const now = new Date();
  const opponentMap = new Map<
    string,
    {
      row: ScoredMatchup;
      facilities: Map<
        string,
        {
          row: ScoredMatchup;
          slots: AvailableTimeSlot[];
        }
      >;
    }
  >();

  for (const row of scored) {
    if (!opponentMap.has(row.opponent_id)) {
      opponentMap.set(row.opponent_id, { row, facilities: new Map() });
    }
    const opponent = opponentMap.get(row.opponent_id)!;
    const opponentBusy = busyByPlayer.get(row.opponent_id) ?? [];

    if (!opponent.facilities.has(row.facility_id)) {
      const overlaps = row.overlapping_days_periods || [];
      const generated = generateNoSourceSlots(overlaps, now, dates);

      const facilitySlots: AvailableTimeSlot[] = [];
      for (const slot of generated) {
        const d = slot.datetime;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const hour = d.getHours();
        if (hasTimeConflict(dateStr, hour, hour + 1, callerBusy)) continue;
        if (hasTimeConflict(dateStr, hour, hour + 1, opponentBusy)) continue;
        facilitySlots.push(slot);
      }

      opponent.facilities.set(row.facility_id, {
        row,
        slots: facilitySlots,
      });
    }
  }

  // ── Step 4: Build final suggestions ────────────────────────────────
  const suggestions: MatchSuggestion[] = [];

  for (const [, opponent] of opponentMap) {
    const { row } = opponent;

    const facilities: SuggestionFacility[] = [];
    for (const [, fac] of opponent.facilities) {
      // Only include if there are conflict-free slots available
      if (fac.slots.length > 0) {
        facilities.push({
          facilityId: fac.row.facility_id,
          facilityName: fac.row.facility_name,
          facilityAddress: fac.row.facility_address,
          facilityCity: fac.row.facility_city,
          facilityAffinity: fac.row.facility_affinity,
          availableSlots: fac.slots.sort((a, b) => a.datetime.getTime() - b.datetime.getTime()),
          hasAvailabilitySource: false,
        });
      }
    }

    if (facilities.length === 0) continue;

    facilities.sort((a, b) => b.facilityAffinity - a.facilityAffinity);

    suggestions.push({
      opponentId: row.opponent_id,
      opponentFirstName: row.opponent_first_name,
      opponentLastName: row.opponent_last_name,
      opponentAvatar: row.opponent_avatar,
      opponentReputationScore: row.opponent_reputation_score,
      opponentReputationTier: row.opponent_reputation_tier,
      opponentRatingScoreValue: row.opponent_rating_value,
      opponentRatingLabel: row.opponent_rating_label,
      opponentBadgeStatus: row.opponent_badge_status,
      matchType: row.match_type,
      matchDuration: row.match_duration,
      playerCompatibility: row.player_compatibility,
      facilities,
      sharedAvailability: row.overlapping_days_periods || [],
    });
  }

  // ── Step 5: Compute final score with actionability + urgency + jitter ─
  const scoredSuggestions = suggestions.map(s => {
    // Actionability: more available slots across all facilities = higher boost
    const totalSlots = s.facilities.reduce((sum, f) => sum + f.availableSlots.length, 0);
    const actionabilityBoost = Math.min(0.1, Math.max(0, (totalSlots - 1) * 0.012));

    // Urgency: soonest available slot gets a time-based bonus
    const allSlots = s.facilities.flatMap(f => f.availableSlots);
    const soonestSlot =
      allSlots.length > 0
        ? allSlots.reduce((earliest, slot) =>
            slot.datetime.getTime() < earliest.datetime.getTime() ? slot : earliest
          )
        : null;

    let urgencyBoost = 0;
    if (soonestSlot) {
      const nowDate = new Date();
      const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
      const slotStart = new Date(
        soonestSlot.datetime.getFullYear(),
        soonestSlot.datetime.getMonth(),
        soonestSlot.datetime.getDate()
      );
      const daysAway = Math.round(
        (slotStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysAway <= 0)
        urgencyBoost = 0.05; // today
      else if (daysAway === 1)
        urgencyBoost = 0.05; // tomorrow
      else if (daysAway === 2) urgencyBoost = 0.03;
      else if (daysAway === 3) urgencyBoost = 0.01;
    }

    // Random jitter ±3% for feed freshness across sessions
    const jitter = (Math.random() - 0.5) * 0.06;

    const finalScore = s.playerCompatibility + actionabilityBoost + urgencyBoost + jitter;

    return { ...s, playerCompatibility: finalScore };
  });

  // ── Step 6: Sort and apply quality threshold ──────────────────────
  scoredSuggestions.sort((a, b) => b.playerCompatibility - a.playerCompatibility);

  const MIN_GUARANTEED = Math.min(10, limit);
  const QUALITY_THRESHOLD = 0.35;

  let result: MatchSuggestion[];
  if (scoredSuggestions.length <= MIN_GUARANTEED) {
    result = scoredSuggestions;
  } else {
    const aboveThreshold = scoredSuggestions.filter(
      s => s.playerCompatibility >= QUALITY_THRESHOLD
    );
    result =
      aboveThreshold.length >= MIN_GUARANTEED
        ? aboveThreshold
        : scoredSuggestions.slice(0, MIN_GUARANTEED);
  }

  return result.slice(0, limit);
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
  /** End time from the court availability slot — if provided, duration is derived from the slot length */
  endTime?: Date | null;
  timezone: string;
}

/**
 * Compute end time string (HH:MM) from start time and duration.
 */
function computeEndTime(startHour: number, duration: string): string {
  const durationMinutes = parseInt(duration, 10) || 60;
  const endMinutes = startHour * 60 + durationMinutes;
  const endHour = Math.floor(endMinutes / 60) % 24;
  const endMin = endMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
}

/**
 * Create a match from a suggestion and invite the opponent.
 * The caller becomes the host (via created_by), and the opponent
 * gets a 'pending' invitation with an automatic push notification.
 */
export async function createMatchFromSuggestion(
  input: CreateFromSuggestionInput
): Promise<{ matchId: string; invited: boolean }> {
  const startHour = input.startTime.getHours();
  const startMin = input.startTime.getMinutes();
  const matchDate = `${input.startTime.getFullYear()}-${String(input.startTime.getMonth() + 1).padStart(2, '0')}-${String(input.startTime.getDate()).padStart(2, '0')}`;
  const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

  // If a slot end time is provided (from real-time availability), use it directly
  // and derive duration from the slot length. Otherwise fall back to caller's preferred duration.
  let endTimeStr: string;
  let duration = input.matchDuration;

  if (input.endTime) {
    const endH = input.endTime.getHours();
    const endM = input.endTime.getMinutes();
    endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    const slotMinutes = Math.round((input.endTime.getTime() - input.startTime.getTime()) / 60000);
    // Map slot duration to the closest match_duration_enum value
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

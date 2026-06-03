/**
 * Open-court availability for match cards and the match detail sheet.
 *
 * Shared helper that reads `facility_availability_snapshot` — the same source
 * the suggestion service uses for its "N courts available" chip — to surface
 * the bookable courts at a match's facility for its exact start time. Reads the
 * full snapshot rows (not just a count) so callers get both:
 *   - `available_courts`: distinct court count → MatchCard's chip
 *   - `available_courts_slots`: the raw rows → MatchDetailSheet's available-
 *     courts tiles, formatted client-side via `formatInlineSnapshotSlots`
 * Used by the match-list fetchers (discovery feeds, my-matches, network
 * matches) and the single-match fetcher so neither the card chip nor the detail
 * sheet needs a separate availability round trip.
 */

import { createDateInTimezone } from '@rallia/shared-utils';
import type { MatchWithDetails, FacilityAvailabilitySlotRow } from '@rallia/shared-types';

import { supabase } from '../supabase';
import { Logger } from '../logger';

/**
 * Snapshot lookahead for open-court availability on matches. Matches whose start
 * lies beyond this window can't have snapshot data, so we never query for them.
 * Mirrors the snapshot coverage window the refresh worker writes.
 */
const MATCH_COURT_SNAPSHOT_HORIZON_DAYS = 7;

/** Snapshot columns we read — the full set `FacilityAvailabilitySlotRow` needs. */
const SNAPSHOT_COLUMNS =
  'external_court_id, slot_start, slot_end, external_slot_id, court_name, court_number, price_cents, currency, source, sport_id, booking_url';

/**
 * Fetch the bookable snapshot rows at each match's exact start time, scoped to
 * the match's sport, reading `facility_availability_snapshot`.
 *
 * Only future matches with a facility, a sport, and no court reserved yet are
 * eligible; everything else is skipped so a match that's already booked (or
 * past, or location-TBD) never triggers a lookup. Returns a map of match id →
 * snapshot rows, populated only for matches that actually have ≥1 court at the
 * slot. Snapshot-only by design (org-managed/local-template courts aren't
 * included), matching the suggestion behavior.
 */
export async function fetchAvailableCourtSlotsForMatches(
  matches: MatchWithDetails[]
): Promise<Map<string, FacilityAvailabilitySlotRow[]>> {
  const result = new Map<string, FacilityAvailabilitySlotRow[]>();
  const now = Date.now();
  const horizonMs = now + MATCH_COURT_SNAPSHOT_HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // Build per-match snapshot lookup keys: facility|sport|slotStartISO.
  const keyByMatch = new Map<string, string>();
  const facilityIds = new Set<string>();
  const sportIds = new Set<string>();
  // Exact slot timestamps to fetch — at most one per match (deduped). We filter
  // the snapshot on this set rather than a [min,max] range so we only transfer
  // rows at slots a match actually starts at, instead of every court at every
  // facility across the whole window.
  const slotIsos = new Set<string>();

  for (const m of matches) {
    if (!m.facility_id || !m.sport_id) continue;
    if (m.court_status === 'reserved') continue;
    if (!m.match_date || !m.start_time) continue;

    const timezone = m.facility?.timezone ?? m.timezone ?? 'UTC';
    let slotIso: string;
    try {
      slotIso = createDateInTimezone(m.match_date, m.start_time, timezone).toISOString();
    } catch {
      continue;
    }
    const slotMs = new Date(slotIso).getTime();
    if (Number.isNaN(slotMs) || slotMs <= now || slotMs > horizonMs) continue;

    keyByMatch.set(m.id, `${m.facility_id}|${m.sport_id}|${slotIso}`);
    facilityIds.add(m.facility_id);
    sportIds.add(m.sport_id);
    slotIsos.add(slotIso);
  }

  if (keyByMatch.size === 0) return result;

  const { data, error } = await supabase
    .from('facility_availability_snapshot')
    .select(`facility_id, ${SNAPSHOT_COLUMNS}`)
    .in('facility_id', Array.from(facilityIds))
    .in('sport_id', Array.from(sportIds))
    .in('slot_start', Array.from(slotIsos))
    .eq('is_available', true);

  if (error) {
    Logger.warn('[availableCourts] court slot snapshot fetch error', {
      error: error.message,
    });
    return result;
  }

  // Group snapshot rows by facility|sport|slot. The row's facility_id is the
  // physical facility; external_court_id distinguishes courts within it.
  const rowsByKey = new Map<string, FacilityAvailabilitySlotRow[]>();
  for (const row of data ?? []) {
    if (!row.sport_id) continue;
    const iso = new Date(row.slot_start as string).toISOString();
    const key = `${row.facility_id}|${row.sport_id}|${iso}`;
    let rows = rowsByKey.get(key);
    if (!rows) {
      rows = [];
      rowsByKey.set(key, rows);
    }
    // Project onto the FacilityAvailabilitySlotRow shape (drop facility_id).
    rows.push({
      external_court_id: row.external_court_id as string,
      slot_start: row.slot_start as string,
      slot_end: row.slot_end as string,
      external_slot_id: (row.external_slot_id as string | null) ?? null,
      court_name: (row.court_name as string | null) ?? null,
      court_number: (row.court_number as number | null) ?? null,
      price_cents: (row.price_cents as number | null) ?? null,
      currency: (row.currency as string | null) ?? null,
      source: row.source as string,
      sport_id: (row.sport_id as string | null) ?? null,
      booking_url: (row.booking_url as string | null) ?? null,
    });
  }

  for (const [matchId, key] of keyByMatch) {
    const rows = rowsByKey.get(key);
    if (rows && rows.length > 0) result.set(matchId, rows);
  }
  return result;
}

/** Distinct bookable court count for a slot's snapshot rows. */
function distinctCourtCount(rows: FacilityAvailabilitySlotRow[]): number {
  const courts = new Set<string>();
  for (const row of rows) courts.add(row.external_court_id);
  return courts.size;
}

/**
 * Apply a precomputed `matchId → snapshot rows` map onto matches in place,
 * setting both `available_courts_slots` (the rows) and `available_courts` (the
 * distinct court count). Pair with `fetchAvailableCourtSlotsForMatches` when a
 * caller wants to run the snapshot query in parallel with its other enrichment.
 */
export function applyCourtSlots(
  matches: MatchWithDetails[],
  slotsByMatch: Map<string, FacilityAvailabilitySlotRow[]>
): void {
  if (slotsByMatch.size === 0) return;
  for (const match of matches) {
    const rows = slotsByMatch.get(match.id);
    if (rows && rows.length > 0) {
      match.available_courts_slots = rows;
      match.available_courts = distinctCourtCount(rows);
    }
  }
}

/**
 * Fetch + apply in one step: set `available_courts` and `available_courts_slots`
 * on each eligible match (future, unreserved, with snapshot data at its slot) in
 * place. No-op when nothing is eligible. Convenience for callers that don't need
 * to parallelize the snapshot read with other work.
 */
export async function attachAvailableCourtSlots(matches: MatchWithDetails[]): Promise<void> {
  applyCourtSlots(matches, await fetchAvailableCourtSlotsForMatches(matches));
}

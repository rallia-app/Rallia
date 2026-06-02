/**
 * Open-court counts for match cards.
 *
 * Shared helper that counts distinct bookable courts at a match's facility for
 * its exact start time, reading `facility_availability_snapshot` — the same
 * source the suggestion service uses for its "N courts available" chip. Used by
 * the match-list fetchers (discovery feeds, my-matches, network matches) so
 * MatchCard can render the chip for matches with no court reserved yet.
 */

import { createDateInTimezone } from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';

import { supabase } from '../supabase';
import { Logger } from '../logger';

/**
 * Snapshot lookahead for open-court counts on match cards. Matches whose start
 * lies beyond this window can't have snapshot data, so we never query for them.
 * Mirrors the snapshot coverage window the refresh worker writes.
 */
const MATCH_COURT_SNAPSHOT_HORIZON_DAYS = 7;

/**
 * Count distinct bookable courts at each match's facility for the exact match
 * start time, reading `facility_availability_snapshot`.
 *
 * Only future matches with a facility, a sport, and no court reserved yet are
 * eligible; everything else is skipped so a match that's already booked (or
 * past, or location-TBD) never triggers a lookup. Returns a map of match id →
 * court count, populated only for matches that actually have ≥1 court at the
 * slot. Snapshot-only by design (org-managed/local-template courts aren't
 * counted), matching the suggestion behavior.
 */
export async function fetchAvailableCourtCountsForMatches(
  matches: MatchWithDetails[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
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
    .select('facility_id, sport_id, slot_start, external_court_id')
    .in('facility_id', Array.from(facilityIds))
    .in('sport_id', Array.from(sportIds))
    .in('slot_start', Array.from(slotIsos))
    .eq('is_available', true);

  if (error) {
    Logger.warn('[availableCourts] court-count snapshot fetch error', {
      error: error.message,
    });
    return result;
  }

  // Count distinct courts per facility|sport|slot. Snapshot rows are unique on
  // (facility_id, external_court_id, slot_start), but a Set guards against any
  // duplication across the sport dimension.
  const courtsByKey = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    if (!row.sport_id) continue;
    const iso = new Date(row.slot_start as string).toISOString();
    const key = `${row.facility_id}|${row.sport_id}|${iso}`;
    let set = courtsByKey.get(key);
    if (!set) {
      set = new Set<string>();
      courtsByKey.set(key, set);
    }
    set.add(row.external_court_id as string);
  }

  for (const [matchId, key] of keyByMatch) {
    const count = courtsByKey.get(key)?.size ?? 0;
    if (count > 0) result.set(matchId, count);
  }
  return result;
}

/**
 * Apply a precomputed `matchId → court count` map onto matches in place. Pair
 * with `fetchAvailableCourtCountsForMatches` when a caller wants to run the
 * snapshot query in parallel with its other enrichment queries.
 */
export function applyCourtCounts(
  matches: MatchWithDetails[],
  courtCounts: Map<string, number>
): void {
  if (courtCounts.size === 0) return;
  for (const match of matches) {
    const count = courtCounts.get(match.id);
    if (count) match.available_courts = count;
  }
}

/**
 * Fetch + apply in one step: set `available_courts` on each eligible match
 * (future, unreserved, with snapshot data at its slot) in place. No-op when
 * nothing is eligible. Convenience for callers that don't need to parallelize
 * the snapshot read with other work.
 */
export async function attachAvailableCourtCounts(matches: MatchWithDetails[]): Promise<void> {
  applyCourtCounts(matches, await fetchAvailableCourtCountsForMatches(matches));
}

/**
 * useUnifiedMatchFeed Hook
 *
 * Merges real matches and matchup suggestions into a single chronologically
 * sorted feed. Used by Home and Public Matches to render a unified list of
 * cards (≥30) instead of two sequential blocks.
 */

import { useEffect, useMemo, useState } from 'react';
import { createDateInTimezone } from '@rallia/shared-utils';
import type { AvailableTimeSlot, MatchSuggestion } from '@rallia/shared-services';
import type { NearbyMatch } from './useNearbyMatches';
import type { PublicMatch } from './usePublicMatches';
import type { PublicMatchFilters } from './usePublicMatchFilters';
import { deduplicateSuggestionsByTimeSlot } from './deduplicateSuggestions';

export type UnifiedFeedMatch = NearbyMatch | PublicMatch;

export type UnifiedFeedItem =
  | { kind: 'match'; key: string; sortTime: number; data: UnifiedFeedMatch }
  | {
      kind: 'suggestion';
      key: string;
      sortTime: number;
      data: MatchSuggestion;
      /** The slot whose datetime drives both sortTime and the card's display.
       *  Computed deterministically (seeded by opponentId) so the random pick
       *  is stable across renders and matches what the card shows. */
      pickedSlot: AvailableTimeSlot;
      /** Index into `suggestion.facilities` of the facility whose slot was
       *  chosen. The card uses this to select the matching facility name in
       *  the location row. */
      pickedFacilityIndex: number;
    };

/** Subset of PublicMatchFilters applicable to suggestions client-side. */
export type SuggestionApplicableFilters = Pick<
  PublicMatchFilters,
  | 'searchQuery'
  | 'matchType'
  | 'duration'
  | 'format'
  | 'dateRange'
  | 'timeOfDay'
  | 'specificDate'
  | 'specificTime'
>;

export interface UseUnifiedMatchFeedOptions {
  matches: UnifiedFeedMatch[];
  suggestions: MatchSuggestion[];
  /** When provided, applicable filters are applied to suggestions client-side.
   *  Omit for screens that don't use filters (e.g. Home). */
  filters?: SuggestionApplicableFilters;
}

function getSlotMs(slot: { datetime: Date | string }): number {
  const t =
    slot.datetime instanceof Date ? slot.datetime.getTime() : new Date(slot.datetime).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

/** Stable string→int hash (djb2). Used to seed the per-opponent random pick. */
function hashStringToInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h < 0 ? -h : h;
}

/** Local YYYY-MM-DD key for a Date — groups slots by user-facing day. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface PickedSuggestionSlot {
  slot: AvailableTimeSlot;
  facilityIndex: number;
}

/**
 * Pick the slot a locked SuggestionCard will display.
 *
 * Strategy (mirrors what the card needs to show):
 *   1. Walk `suggestion.facilities` in declared order (already sorted by
 *      `facilityAffinity` desc). Take the **first** facility that has at
 *      least one strictly-future slot. This means a suggestion whose top
 *      facility has only past slots still surfaces, falling back to the
 *      next-best facility.
 *   2. Within that facility, group future slots by local calendar day;
 *      take the soonest day's slots.
 *   3. Random-pick one of those slots, seeded by `opponentId` so the choice
 *      is stable across renders. Same input → same output, different
 *      opponents → different hours.
 *
 * Returns `null` if no facility has any future slot.
 */
export function pickSlotForSuggestion(
  suggestion: MatchSuggestion,
  nowMs: number
): PickedSuggestionSlot | null {
  for (let facilityIndex = 0; facilityIndex < suggestion.facilities.length; facilityIndex++) {
    const facility = suggestion.facilities[facilityIndex];

    const futureSlots: { slot: AvailableTimeSlot; t: number; dayKey: string }[] = [];
    for (const slot of facility.availableSlots) {
      const t = getSlotMs(slot);
      if (!Number.isFinite(t) || t <= nowMs) continue;
      const dayKey = localDateKey(
        slot.datetime instanceof Date ? slot.datetime : new Date(slot.datetime)
      );
      futureSlots.push({ slot, t, dayKey });
    }
    if (futureSlots.length === 0) continue;

    const soonestDayKey = futureSlots.reduce(
      (min, s) => (s.t < min.t ? s : min),
      futureSlots[0]
    ).dayKey;

    const sameDay = futureSlots.filter(s => s.dayKey === soonestDayKey);
    const seed = hashStringToInt(suggestion.opponentId);
    return { slot: sameDay[seed % sameDay.length].slot, facilityIndex };
  }
  return null;
}

// =============================================================================
// SUGGESTION FILTER PREDICATE
// =============================================================================

/**
 * Check whether a suggestion passes the currently active filters.
 * Pure function — exported for unit testing.
 */
export function doesSuggestionPassFilters(
  suggestion: MatchSuggestion,
  pickedSlot: AvailableTimeSlot,
  pickedFacilityIndex: number,
  filters: SuggestionApplicableFilters,
  nowMs: number
): boolean {
  // ── searchQuery ──
  if (filters.searchQuery.length > 0) {
    const q = filters.searchQuery.toLowerCase();
    const opponentName =
      `${suggestion.opponentFirstName} ${suggestion.opponentLastName}`.toLowerCase();
    const facility = suggestion.facilities[pickedFacilityIndex];
    const facilityName = facility?.facilityName?.toLowerCase() ?? '';
    const facilityCity = facility?.facilityCity?.toLowerCase() ?? '';
    if (!opponentName.includes(q) && !facilityName.includes(q) && !facilityCity.includes(q)) {
      return false;
    }
  }

  // ── matchType ── ('casual' also accepts 'both', mirrors RPC logic)
  if (filters.matchType !== 'all') {
    const st = suggestion.matchType;
    if (st !== filters.matchType && st !== 'both') return false;
  }

  // ── duration ──
  if (filters.duration !== 'all') {
    if (filters.duration === '120+') {
      if (parseInt(suggestion.matchDuration, 10) < 120) return false;
    } else if (suggestion.matchDuration !== filters.duration) {
      return false;
    }
  }

  // ── format ── (suggestions are singles-only)
  if (filters.format !== 'all' && filters.format !== 'singles') {
    return false;
  }

  // Resolve slot date for date/time checks
  const slotDate =
    pickedSlot.datetime instanceof Date ? pickedSlot.datetime : new Date(pickedSlot.datetime);
  const slotHour = slotDate.getHours();

  // ── specificDate (overrides dateRange) ──
  if (filters.specificDate !== null) {
    if (localDateKey(slotDate) !== filters.specificDate) return false;
  } else if (filters.dateRange !== 'all') {
    // ── dateRange ──
    const now = new Date(nowMs);
    const slotKey = localDateKey(slotDate);
    switch (filters.dateRange) {
      case 'today':
        if (slotKey !== localDateKey(now)) return false;
        break;
      case 'tomorrow': {
        const tomorrow = new Date(nowMs + 86_400_000);
        if (slotKey !== localDateKey(tomorrow)) return false;
        break;
      }
      case 'week': {
        const weekEnd = new Date(nowMs + 7 * 86_400_000);
        if (slotDate < now || slotDate > weekEnd) return false;
        break;
      }
      case 'weekend': {
        const day = slotDate.getDay();
        if (day !== 0 && day !== 6) return false;
        break;
      }
    }
  }

  // ── specificTime (overrides timeOfDay) ──
  if (filters.specificTime !== null) {
    const filterHour = parseInt(filters.specificTime.split(':')[0], 10);
    if (slotHour !== filterHour) return false;
  } else if (filters.timeOfDay !== 'all') {
    // ── timeOfDay ── (morning [6,12), afternoon [12,18), evening [18,24))
    switch (filters.timeOfDay) {
      case 'morning':
        if (slotHour < 6 || slotHour >= 12) return false;
        break;
      case 'afternoon':
        if (slotHour < 12 || slotHour >= 18) return false;
        break;
      case 'evening':
        if (slotHour < 18) return false;
        break;
    }
  }

  return true;
}

function getMatchSortTime(match: UnifiedFeedMatch): number {
  // `match.start_time` is "HH:MM:SS"; the actual day is on `match.match_date`.
  // Combine them in the match's timezone so the chronological sort is correct.
  if (!match.match_date || !match.start_time) return Infinity;
  const date = createDateInTimezone(match.match_date, match.start_time, match.timezone || 'UTC');
  const t = date.getTime();
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * Tick every 60 s so the feed re-derives without needing a fetch — expired
 * suggestions drop out, the chronological sort updates as time passes.
 */
function useNowTicker(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useUnifiedMatchFeed(options: UseUnifiedMatchFeedOptions): UnifiedFeedItem[] {
  const { matches, suggestions, filters } = options;
  const nowMs = useNowTicker();

  return useMemo(() => {
    const items: UnifiedFeedItem[] = [];

    for (const match of matches) {
      items.push({
        kind: 'match',
        key: `match:${match.id}`,
        sortTime: getMatchSortTime(match),
        data: match,
      });
    }

    const dedupedSuggestions = deduplicateSuggestionsByTimeSlot(suggestions, nowMs);

    for (const { suggestion, pickedSlot, pickedFacilityIndex } of dedupedSuggestions) {
      const t = getSlotMs(pickedSlot);
      if (!Number.isFinite(t)) continue;

      // Apply filters to suggestions when provided (PublicMatches screen).
      // When omitted (Home screen), all suggestions pass through.
      if (
        filters &&
        !doesSuggestionPassFilters(suggestion, pickedSlot, pickedFacilityIndex, filters, nowMs)
      ) {
        continue;
      }

      items.push({
        kind: 'suggestion',
        key: `suggestion:${suggestion.opponentId}`,
        sortTime: t,
        data: suggestion,
        pickedSlot,
        pickedFacilityIndex,
      });
    }

    items.sort((a, b) => a.sortTime - b.sortTime);
    return items;
  }, [matches, suggestions, nowMs, filters]);
}

export default useUnifiedMatchFeed;

/**
 * Client-side filter predicate for suggestions in the Public Matches feed.
 *
 * Mirrors the filters the user can apply on the screen (search query,
 * match type, duration, format, date range, time of day, specific date,
 * specific time). Matches don't go through this — server-side
 * `search_public_matches` already filters them. Suggestions are produced
 * separately and need the same filters applied client-side.
 */

import type { SlotSuggestion } from '@rallia/shared-services';
import type { PublicMatchFilters } from './usePublicMatchFilters';

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

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function doesSuggestionPassFilters(
  s: SlotSuggestion,
  filters: SuggestionApplicableFilters,
  nowMs: number
): boolean {
  if (filters.searchQuery.length > 0) {
    const q = filters.searchQuery.toLowerCase();
    const opponentName = `${s.opponentFirstName} ${s.opponentLastName}`.toLowerCase();
    const facilityName = s.facility.facilityName?.toLowerCase() ?? '';
    const facilityCity = s.facility.facilityCity?.toLowerCase() ?? '';
    if (!opponentName.includes(q) && !facilityName.includes(q) && !facilityCity.includes(q)) {
      return false;
    }
  }

  if (filters.matchType !== 'all') {
    const st = s.matchType;
    if (st !== filters.matchType && st !== 'both') return false;
  }

  if (filters.duration !== 'all') {
    if (filters.duration === '120+') {
      if (parseInt(s.matchDuration, 10) < 120) return false;
    } else if (s.matchDuration !== filters.duration) {
      return false;
    }
  }

  if (filters.format !== 'all' && filters.format !== 'singles') return false;

  const slotDate = s.slot.datetime instanceof Date ? s.slot.datetime : new Date(s.slot.datetime);
  const slotHour = slotDate.getHours();

  if (filters.specificDate !== null) {
    if (localDateKey(slotDate) !== filters.specificDate) return false;
  } else if (filters.dateRange !== 'all') {
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

  if (filters.specificTime !== null) {
    const filterHour = parseInt(filters.specificTime.split(':')[0], 10);
    if (slotHour !== filterHour) return false;
  } else if (filters.timeOfDay !== 'all') {
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

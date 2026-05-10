/**
 * useUnifiedMatchFeed Hook
 *
 * Combines real matches (Nearby + Public) with the 7-day suggestion grid
 * into a per-day structure that Home and PublicMatches can render as
 * date-headed sections.
 *
 *   day {
 *     date: "YYYY-MM-DD",
 *     items: [
 *       { kind: 'match', sortTime, data },
 *       { kind: 'suggestion', sortTime, data: SlotSuggestion },
 *     ]
 *   }
 *
 * Suggestions are already capped at 5 per day by the service. Matches always
 * render. Filters apply per-item.
 */

import { useEffect, useMemo, useState } from 'react';
import { createDateInTimezone } from '@rallia/shared-utils';
import type { DaySuggestions, SlotSuggestion } from '@rallia/shared-services';
import type { NearbyMatch } from './useNearbyMatches';
import type { PublicMatch } from './usePublicMatches';
import { doesSuggestionPassFilters, type SuggestionApplicableFilters } from './suggestionFilters';

export type UnifiedFeedMatch = NearbyMatch | PublicMatch;

export type UnifiedFeedItem =
  | { kind: 'match'; key: string; sortTime: number; data: UnifiedFeedMatch }
  | { kind: 'suggestion'; key: string; sortTime: number; data: SlotSuggestion };

export interface UnifiedFeedDay {
  date: string;
  items: UnifiedFeedItem[];
}

export interface UseUnifiedMatchFeedOptions {
  matches: UnifiedFeedMatch[];
  /** 7-day grid from `useMatchSuggestions().days`. */
  days: DaySuggestions[];
  /** When provided, applicable filters are applied to suggestions client-side. */
  filters?: SuggestionApplicableFilters;
}

function getMatchSortTime(match: UnifiedFeedMatch): number {
  if (!match.match_date || !match.start_time) return Infinity;
  const date = createDateInTimezone(match.match_date, match.start_time, match.timezone || 'UTC');
  const t = date.getTime();
  return Number.isFinite(t) ? t : Infinity;
}

function getSlotMs(s: SlotSuggestion): number {
  const dt = s.slot.datetime;
  const t = dt instanceof Date ? dt.getTime() : new Date(dt).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

// =============================================================================
// HOOK
// =============================================================================

function useNowTicker(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useUnifiedMatchFeed(options: UseUnifiedMatchFeedOptions): UnifiedFeedDay[] {
  const { matches, days, filters } = options;
  const nowMs = useNowTicker();

  return useMemo(() => {
    // Initialise all 7 days from the suggestions grid (preserves order).
    const dayMap = new Map<string, UnifiedFeedItem[]>();
    for (const d of days) dayMap.set(d.date, []);

    // Drop matches into the right day bucket. Matches outside the 7-day
    // window get their own bucket and end up at the bottom.
    for (const match of matches) {
      if (!match.match_date) continue;
      const key = match.match_date;
      const t = getMatchSortTime(match);
      if (!dayMap.has(key)) dayMap.set(key, []);
      dayMap.get(key)!.push({
        kind: 'match',
        key: `match:${match.id}`,
        sortTime: t,
        data: match,
      });
    }

    // Suggestions — already capped at 5/day by service, opponent-deduped.
    for (const day of days) {
      for (const s of day.suggestions) {
        const t = getSlotMs(s);
        if (!Number.isFinite(t)) continue;
        if (filters && !doesSuggestionPassFilters(s, filters, nowMs)) continue;
        dayMap.get(day.date)!.push({
          kind: 'suggestion',
          // Compose a stable key per (opponent, day, slot start)
          key: `suggestion:${s.opponentId}:${day.date}:${(s.slot.datetime as Date).getHours()}`,
          sortTime: t,
          data: s,
        });
      }
    }

    // Build ordered output: dates from the suggestions grid first (in order),
    // then any out-of-window match dates appended chronologically.
    const out: UnifiedFeedDay[] = [];
    const seen = new Set<string>();
    for (const d of days) {
      const items = dayMap.get(d.date) ?? [];
      items.sort((a, b) => a.sortTime - b.sortTime);
      out.push({ date: d.date, items });
      seen.add(d.date);
    }
    const extraDates = [...dayMap.keys()].filter(k => !seen.has(k)).sort();
    for (const date of extraDates) {
      const items = dayMap.get(date)!;
      items.sort((a, b) => a.sortTime - b.sortTime);
      out.push({ date, items });
    }
    return out;
  }, [matches, days, nowMs, filters]);
}

export default useUnifiedMatchFeed;

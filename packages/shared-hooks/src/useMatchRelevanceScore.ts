/**
 * Match Relevance Scoring Hooks
 *
 * Thin React-side wrappers around the framework-free `scoreNearbyMatch`
 * function in `@rallia/shared-services`. The pure scoring logic lives there
 * so it can also be imported by the daily-digest edge function (Deno).
 */

import { useMemo } from 'react';
import {
  scoreNearbyMatch,
  maxCostInBatch,
  type Scorable,
  type MatchScoringPreferences,
} from '@rallia/shared-services';

export type { Scorable, MatchScoringPreferences } from '@rallia/shared-services';
export { scoreNearbyMatch } from '@rallia/shared-services';

/**
 * Hook that sorts nearby matches chronologically (soonest first), using the
 * relevance score as a tiebreaker when matches share the same date and time.
 *
 * Used by Public Matches — preserves the server's chronological ordering for
 * pagination while still surfacing the most relevant matches first within
 * the same time slot.
 */
export function useSortedNearbyMatches<T extends Scorable>(
  matches: T[],
  preferences: MatchScoringPreferences
): T[] {
  return useMemo(() => {
    if (matches.length === 0) return matches;

    const maxCost = maxCostInBatch(matches);
    const scored = matches.map(match => ({
      match,
      score: scoreNearbyMatch(match, preferences, maxCost),
    }));

    scored.sort((a, b) => {
      // Primary: chronological order (soonest first)
      const dateA = a.match.match_date ?? '';
      const dateB = b.match.match_date ?? '';
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;

      const timeA = a.match.start_time ?? '';
      const timeB = b.match.start_time ?? '';
      if (timeA !== timeB) return timeA < timeB ? -1 : 1;

      // Tiebreaker: higher relevance score first
      return b.score - a.score;
    });

    return scored.map(s => s.match);
  }, [matches, preferences]);
}

/**
 * Hook that sorts nearby matches purely by relevance score (highest first).
 * No chronological ordering. Used by the Home "Just for you" carousel where
 * the goal is "best 5 things you could play this week," not "soonest first."
 */
export function useScoreOrderedMatches<T extends Scorable>(
  matches: T[],
  preferences: MatchScoringPreferences
): T[] {
  return useMemo(() => {
    if (matches.length === 0) return matches;

    const maxCost = maxCostInBatch(matches);
    const scored = matches.map(match => ({
      match,
      score: scoreNearbyMatch(match, preferences, maxCost),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.match);
  }, [matches, preferences]);
}

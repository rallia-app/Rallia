/**
 * "Just for you" composer
 *
 * Shared brain behind the Home "Just for you" carousel and the daily digest.
 * Pure async function — no React, no Deno specifics — so both hosts can call
 * it. Returns up to `matchLimit` items composed of:
 *   1. Top-scored real matches from the caller's nearby pool, then
 *   2. Suggestions to pad up to the limit when matches < limit.
 *
 * Match score (0–100) and suggestion score (~0–1) live on different scales,
 * so the two pools are NOT merged by score. Matches always come first; the
 * caller renders them however they want and appends the suggestion list at
 * the tail (with whatever divider the surface needs).
 */

import { getNearbyMatches } from './matchService';
import { getTopSuggestions } from './suggestionService';
import { scoreNearbyMatch, maxCostInBatch } from './matchScoring';
import type { Scorable, MatchScoringPreferences } from './matchScoring';
import type { SlotSuggestion } from './suggestionService';

export interface ComposeJustForYouInput {
  /**
   * Authenticated caller's player id. When omitted, the composer runs in anon
   * mode: matches are still scored (using whatever scoring preferences the
   * caller can provide), and suggestions go through the anon path of
   * `getTopSuggestions` (location-keyed availability density).
   */
  playerId?: string;
  sportId: string;
  sportName?: string;
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
  /** Caller's gender, for the nearby-match RPC's eligibility check. */
  userGender?: string | null;
  /** Scoring preferences — drives the match ranking. */
  scoringPreferences: MatchScoringPreferences;
  /**
   * Player IDs to exclude from the match pool entirely. Typically `[playerId]`
   * to drop matches the caller already created or joined.
   */
  excludeUserIds?: string[];
  /** Total number of items to return. Defaults to 5. */
  matchLimit?: number;
  /** Cancellation signal — wired through TanStack queryFn or AbortController. */
  signal?: AbortSignal;
}

export interface ComposeJustForYouResult {
  /** Top-scored real matches, score-desc, capped at `matchLimit`. */
  matches: Scorable[];
  /** Suggestions to pad the gap when matches < matchLimit. */
  suggestions: SlotSuggestion[];
}

const DEFAULT_LIMIT = 5;
/** Pool size pulled from the match RPC before scoring + dedup. Generous
 *  headroom so the limit is never the bottleneck after exclusions. */
const MATCH_POOL_SIZE = 30;

export async function composeJustForYou(
  input: ComposeJustForYouInput
): Promise<ComposeJustForYouResult> {
  const {
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm,
    userGender,
    scoringPreferences,
    excludeUserIds,
    matchLimit = DEFAULT_LIMIT,
    signal,
  } = input;

  // ── 1. Match pool ────────────────────────────────────────────────────
  const { matches: rawMatches } = await getNearbyMatches({
    latitude,
    longitude,
    maxDistanceKm,
    sportId,
    userGender,
    limit: MATCH_POOL_SIZE,
    offset: 0,
  });

  if (signal?.aborted) {
    return { matches: [], suggestions: [] };
  }

  // ── 2. Filter exclusions (caller as creator + active participant) ──
  const exclusionSet = new Set(excludeUserIds ?? []);
  const filteredMatches = rawMatches.filter(m => {
    if (exclusionSet.has(m.created_by)) return false;
    if (exclusionSet.size > 0 && m.participants) {
      const isActive = m.participants.some(
        p =>
          exclusionSet.has(p.player_id) &&
          p.status != null &&
          ['joined', 'requested', 'waitlisted'].includes(p.status)
      );
      if (isActive) return false;
    }
    return true;
  });

  // ── 3. Score and take top N ─────────────────────────────────────────
  const maxCost = maxCostInBatch(filteredMatches);
  const scoredMatches = filteredMatches
    .map(match => ({
      match,
      score: scoreNearbyMatch(match, scoringPreferences, maxCost),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, matchLimit)
    .map(s => s.match);

  // ── 4. Pad with suggestions if we're under the cap ──────────────────
  const padCount = Math.max(0, matchLimit - scoredMatches.length);
  if (padCount === 0) {
    return { matches: scoredMatches, suggestions: [] };
  }

  const suggestions = await getTopSuggestions({
    playerId,
    sportId,
    sportName,
    latitude,
    longitude,
    maxDistanceKm,
    maxItems: padCount,
    signal,
  });

  if (signal?.aborted) {
    return { matches: scoredMatches, suggestions: [] };
  }

  return { matches: scoredMatches, suggestions };
}

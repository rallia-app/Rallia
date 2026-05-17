/**
 * "Just for you" composer
 *
 * Shared brain behind the Home "Just for you" carousel and the daily digest.
 * Pure async function — no React, no Deno specifics — so both hosts can call
 * it. Fetches both pools (real matches + AI suggestions) in parallel, scores
 * them on a **unified 0..1 scale**, applies a cross-pool opponent dedup, and
 * returns the top `matchLimit` items in score-desc order.
 *
 * Why unified ranking (vs. the previous "matches first, suggestions pad"
 * approach): with both sides scored on the same scale, a strong suggestion
 * (e.g. invite a player you've played with before) can win over a weak
 * nearby match — instead of always being relegated to the tail.
 *
 * Scoring scales:
 *   - Match score      → see `scoreNearbyMatch` (0..1, auth path uses RPC
 *                         compat + affinity + actionability/tier/gender/cost)
 *   - Suggestion score → already 0..1 (server `player_compatibility` +
 *                         actionability + urgency + jitter, computed in
 *                         `suggestionService.ts`)
 *
 * Post-score additive boosts on the match side (urgency, jitter) keep the
 * two pools coherent — suggestions already have these baked in.
 */

import { getNearbyMatches } from './matchService';
import { getTopSuggestions } from './suggestionService';
import {
  scoreNearbyMatch,
  maxCostInBatch,
  matchUrgencyBoost,
  isMatchStillJoinable,
} from './matchScoring';
import type { Scorable, MatchScoringPreferences } from './matchScoring';
import type { SlotSuggestion } from './suggestionService';

export interface ComposeJustForYouInput {
  /**
   * Authenticated caller's player id. When omitted, the composer runs in anon
   * mode: matches go through the unscored `search_matches_nearby` path (and
   * `scoreNearbyMatch` falls back to its 9-factor TS-only formula);
   * suggestions go through the anon path of `getTopSuggestions`.
   */
  playerId?: string;
  sportId: string;
  sportName?: string;
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
  /** Caller's gender, for the nearby-match RPC's eligibility check. */
  userGender?: string | null;
  /** Scoring preferences — drives the anon-fallback match ranking. */
  scoringPreferences: MatchScoringPreferences;
  /**
   * Player IDs to exclude from the match pool entirely. Typically `[playerId]`
   * to drop matches the caller already created or joined. The scored RPC
   * already excludes the caller server-side; this is kept for the anon
   * fallback path (where the legacy RPC doesn't filter).
   */
  excludeUserIds?: string[];
  /** Total number of items to return. Defaults to 5. */
  matchLimit?: number;
  /** Cancellation signal — wired through TanStack queryFn or AbortController. */
  signal?: AbortSignal;
}

export type JustForYouItem =
  | { kind: 'match'; score: number; data: Scorable }
  | { kind: 'suggestion'; score: number; data: SlotSuggestion };

export interface ComposeJustForYouResult {
  /** Ordered (score-desc), capped at `matchLimit`. The canonical ranking. */
  items: JustForYouItem[];
  /**
   * Matches that made it into `items`. Kept for analytics / dismiss state
   * that key off the legacy shape.
   */
  matches: Scorable[];
  /**
   * Suggestions that made it into `items`. Kept for analytics / dismiss
   * state that key off the legacy shape.
   */
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

  // ── 1. Fetch both pools in parallel ─────────────────────────────────
  const [matchPool, rawSuggestions] = await Promise.all([
    getNearbyMatches({
      callerId: playerId,
      latitude,
      longitude,
      maxDistanceKm,
      sportId,
      userGender,
      limit: MATCH_POOL_SIZE,
      offset: 0,
    }),
    // Fetch up to matchLimit suggestions (already opponent-deduped + score-desc
    // by `getTopSuggestions`). Asking for `matchLimit` gives us enough
    // headroom: even if all matches lose to suggestions, we have exactly the
    // count we need.
    getTopSuggestions({
      playerId,
      sportId,
      sportName,
      latitude,
      longitude,
      maxDistanceKm,
      maxItems: matchLimit,
      signal,
    }),
  ]);

  if (signal?.aborted) {
    return { items: [], matches: [], suggestions: [] };
  }

  const rawMatches = matchPool.matches;

  // ── 2. Filter exclusions (anon fallback: scored RPC already excludes
  //    caller-as-creator/participant; legacy RPC does not) ─────────────
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

  // ── 3. Drop unjoinable (past or within lead-time cutoff) ────────────
  const now = new Date();
  const joinableMatches = filteredMatches.filter(m => isMatchStillJoinable(m, now));

  // ── 4. Score matches and apply urgency + jitter boosts ──────────────
  // `REAL_ACTION_BONUS` closes the structural ceiling gap between match and
  // suggestion scores: a perfect match maxes at ~1.08 from its factor sum,
  // while a perfect suggestion can reach ~1.18 (its score is `player_compat`
  // directly + boosts, with no facility/state dilution). The bonus also
  // recognizes that one-tap-to-join is materially less friction than
  // invite-and-wait, biasing the carousel toward real action when scores
  // are close. Applied at the composer (carousel) layer — not inside
  // `scoreNearbyMatch` — so Public Matches and other scored consumers
  // aren't affected.
  const REAL_ACTION_BONUS = 0.05;
  const maxCost = maxCostInBatch(joinableMatches);
  const scoredMatches: Array<{ match: Scorable; score: number }> = joinableMatches.map(match => {
    const base = scoreNearbyMatch(match, scoringPreferences, maxCost);
    const urgency = matchUrgencyBoost(match, now);
    const jitter = (Math.random() - 0.5) * 0.06;
    return { match, score: base + REAL_ACTION_BONUS + urgency + jitter };
  });

  // ── 5. Cross-pool opponent dedup ────────────────────────────────────
  // A suggestion to invite player X is redundant if X already has a match
  // we'd surface. Drop the suggestion (real action beats a hypothetical).
  const matchCreatorIds = new Set(scoredMatches.map(s => s.match.created_by));
  const dedupedSuggestions = rawSuggestions.filter(s => !matchCreatorIds.has(s.opponentId));

  // ── 6. Merge + sort + cap ───────────────────────────────────────────
  const merged: JustForYouItem[] = [
    ...scoredMatches.map(s => ({ kind: 'match' as const, score: s.score, data: s.match })),
    ...dedupedSuggestions.map(s => ({
      kind: 'suggestion' as const,
      score: s.score,
      data: s,
    })),
  ];
  merged.sort((a, b) => b.score - a.score);
  const items = merged.slice(0, matchLimit);

  // ── 7. Derive legacy shape from items for analytics consumers ───────
  const matches: Scorable[] = [];
  const suggestions: SlotSuggestion[] = [];
  for (const item of items) {
    if (item.kind === 'match') matches.push(item.data);
    else suggestions.push(item.data);
  }

  return { items, matches, suggestions };
}

/**
 * Match Relevance Scoring
 *
 * Computes a 0–1 relevance score for nearby/upcoming matches. Two paths:
 *
 *  • **Auth path** — match carries server-computed `player_compatibility`
 *    (caller↔creator, 0..1) and `facility_affinity` (0..1) from
 *    `get_upcoming_matches_scored`. We combine those with match-specific
 *    actionability signals (spots-left, tier, gender, cost) that the RPC
 *    can't see (real-time participant state, batch-relative cost).
 *
 *  • **Anon path** — no server scores. Falls back to a TS-only 9-factor
 *    formula (the legacy scoring) scaled to 0..1. Used by callers that
 *    don't yet pass `callerId` through to `getNearbyMatches` (e.g. the
 *    Public Matches list, anon home).
 *
 * Framework-free: no React, no Deno-specific APIs. Imported by:
 *   - React Native via `useMatchRelevanceScore` / `useJustForYou`
 *   - Deno edge functions via the daily-digest composer
 *
 * Auth-path weights (sum = 1.0):
 *   0.55  server player_compatibility    (caller↔creator: match_type, skill,
 *                                         duration, availability fit, reputation,
 *                                         responsiveness, activity, history)
 *   0.20  server facility_affinity       (shared favorite + distance decay)
 *   0.10  spots-left actionability       (real-time participant count)
 *   0.05  tier                           (court_booked × certified-joined)
 *   0.05  gender alignment               (soft signal beyond hard filter)
 *   0.05  cost normalization             (batch-relative)
 *
 * Post-score additive boosts apply to both paths:
 *   urgencyBoost  same-day +0.05, day+1 +0.03, day+2 +0.01, else 0
 *   jitter        ±0.03 random
 */

import type { MatchWithDetails } from '@rallia/shared-types';

/**
 * Any match type that carries distance info. Server scoring fields are
 * populated when the match came from `get_upcoming_matches_scored`
 * (authenticated path); null/undefined for the anon path.
 */
export type Scorable = MatchWithDetails & {
  distance_meters: number | null;
  player_compatibility?: number | null;
  facility_affinity?: number | null;
  score_history?: number | null;
};

// =============================================================================
// TYPES
// =============================================================================

export interface MatchScoringPreferences {
  /** Player's gender ('male' | 'female' | 'other') */
  playerGender?: string | null;
  /** Player's rating score value (numeric, e.g. NTRP 3.5) */
  playerRatingValue?: number | null;
  /** Player's preferred match duration ('30' | '60' | '90' | '120') */
  preferredMatchDuration?: string | null;
  /** Player's preferred match type ('casual' | 'competitive' | 'both') */
  preferredMatchType?: string | null;
  /** Player's favorite facility IDs (up to 3) */
  favoriteFacilityIds?: string[];
  /** Player's max travel distance in km */
  maxTravelDistanceKm?: number;
}

// =============================================================================
// SHARED FACTOR HELPERS (used by both paths)
// =============================================================================

const DURATION_STEPS = ['30', '60', '90', '120'];

function getCapacity(format: string | null | undefined): number {
  return format === 'doubles' ? 4 : 2;
}

function getJoinedCount(match: Scorable): number {
  return match.participants?.filter(p => p.status === 'joined').length ?? 0;
}

/** Spots-left actionability. 0..1. Full match = 0. */
function scoreSpotsLeft(match: Scorable): number {
  const capacity = getCapacity(match.format);
  const joined = getJoinedCount(match);
  const spotsLeft = capacity - joined;

  if (spotsLeft <= 0) return 0;
  if (spotsLeft === 1) return 1.0;
  if (spotsLeft === 2) return 0.7;
  if (spotsLeft === 3) return 0.4;
  return 0.2;
}

/** Tier: court booked × certified-joined-player. 0..1. */
function scoreTier(match: Scorable): number {
  const courtBooked = match.court_status === 'reserved';
  const hasCoveted =
    match.participants?.some(
      p => p.status === 'joined' && p.player?.sportCertificationStatus === 'certified'
    ) ?? false;

  if (hasCoveted && courtBooked) return 1.0;
  if (hasCoveted || courtBooked) return 0.6;
  return 0.2;
}

/** Gender alignment. 0..1. */
function scoreGender(match: Scorable, playerGender: string | null | undefined): number {
  if (!match.preferred_opponent_gender) return 0.7;
  if (!playerGender) return 0.5;
  return match.preferred_opponent_gender === playerGender ? 1.0 : 0.3;
}

/** Cost normalization. 0..1. Free matches = 1.0. */
function scoreCost(match: Scorable, maxCostInBatchValue: number): number {
  if (match.is_court_free || match.estimated_cost == null || match.estimated_cost === 0) return 1.0;
  if (maxCostInBatchValue <= 0) return 0.5;
  return Math.max(0.1, 1.0 - match.estimated_cost / maxCostInBatchValue);
}

// =============================================================================
// ANON-PATH-ONLY FACTOR HELPERS (server score subsumes these on auth path)
// =============================================================================

function scoreRatingFit(match: Scorable, playerRatingValue: number | null | undefined): number {
  const minRatingValue = match.min_rating_score?.value;
  if (minRatingValue == null || playerRatingValue == null) return 0.5;
  if (minRatingValue >= playerRatingValue) return 1.0;
  const diff = playerRatingValue - minRatingValue;
  return Math.max(0.2, 1.0 - diff * 0.3);
}

function scoreDistance(match: Scorable, maxTravelDistanceKm: number | undefined): number {
  if (match.distance_meters == null) return 0.5;
  if (!maxTravelDistanceKm || maxTravelDistanceKm <= 0) return 0.5;
  const ratio = match.distance_meters / (maxTravelDistanceKm * 1000);
  return Math.max(0, 1.0 - ratio);
}

function scoreDuration(match: Scorable, preferredDuration: string | null | undefined): number {
  if (!preferredDuration || !match.duration) return 0.5;
  if (preferredDuration === 'custom' || match.duration === 'custom') return 0.5;
  if (match.duration === preferredDuration) return 1.0;

  const matchIdx = DURATION_STEPS.indexOf(match.duration);
  const prefIdx = DURATION_STEPS.indexOf(preferredDuration);
  if (matchIdx === -1 || prefIdx === -1) return 0.5;

  const stepsOff = Math.abs(matchIdx - prefIdx);
  if (stepsOff === 1) return 0.6;
  if (stepsOff === 2) return 0.3;
  return 0.1;
}

function scorePreferredFacility(
  match: Scorable,
  favoriteFacilityIds: string[] | undefined
): number {
  if (!favoriteFacilityIds || favoriteFacilityIds.length === 0 || !match.facility_id) return 0;
  return favoriteFacilityIds.includes(match.facility_id) ? 1.0 : 0;
}

function scoreFormat(match: Scorable, preferredMatchType: string | null | undefined): number {
  if (!preferredMatchType || !match.player_expectation) return 0.5;
  if (match.player_expectation === preferredMatchType) return 1.0;
  if (match.player_expectation === 'both' || preferredMatchType === 'both') return 0.7;
  return 0.2;
}

// =============================================================================
// MAIN SCORING — 0..1
// =============================================================================

/**
 * Compute a 0–1 relevance score for a single match.
 *
 * Auth path (server scoring present): unified weighting of server compat +
 * affinity + TS-side actionability factors.
 *
 * Anon path (no server scoring): legacy 9-factor sum scaled to 0–1.
 *
 * Post-score boosts (urgency, jitter) are applied by the *caller* (the
 * composer) so the boost shape stays visible at the ranking layer.
 *
 * @param maxCostInBatchValue - Highest `estimated_cost` in the batch, used to
 *   normalize the cost component.
 */
export function scoreNearbyMatch(
  match: Scorable,
  preferences: MatchScoringPreferences,
  maxCostInBatchValue: number
): number {
  const isAuthPath = match.player_compatibility != null && match.facility_affinity != null;

  if (isAuthPath) {
    const score =
      0.55 * (match.player_compatibility as number) +
      0.2 * (match.facility_affinity as number) +
      0.1 * scoreSpotsLeft(match) +
      0.05 * scoreTier(match) +
      0.05 * scoreGender(match, preferences.playerGender) +
      0.05 * scoreCost(match, maxCostInBatchValue);
    return Math.round(score * 10000) / 10000;
  }

  // Anon path: legacy 9-factor formula (was 0..100), scaled to 0..1.
  const score100 =
    25 * scoreSpotsLeft(match) +
    20 * scoreTier(match) +
    15 * scoreRatingFit(match, preferences.playerRatingValue) +
    12 * scoreDistance(match, preferences.maxTravelDistanceKm) +
    8 * scoreDuration(match, preferences.preferredMatchDuration) +
    7 * scorePreferredFacility(match, preferences.favoriteFacilityIds) +
    5 * scoreFormat(match, preferences.preferredMatchType) +
    4 * scoreCost(match, maxCostInBatchValue) +
    4 * scoreGender(match, preferences.playerGender);
  return Math.round(score100) / 100;
}

/**
 * Highest `estimated_cost` in a batch — used to normalize the cost factor
 * (cost is only meaningful relative to the rest of the pool).
 */
export function maxCostInBatch(matches: Scorable[]): number {
  return matches.reduce((max, m) => {
    const cost = m.estimated_cost ?? 0;
    return cost > max ? cost : max;
  }, 0);
}

// =============================================================================
// POST-SCORE BOOSTS + JOINABILITY GUARD
// =============================================================================

/**
 * Resolve the match's start instant in UTC. Combines `match_date + start_time`
 * in the match's timezone (when set), or treats them as local time.
 * Returns null when either field is missing.
 */
function matchStartDate(match: Scorable): Date | null {
  if (!match.match_date || !match.start_time) return null;
  // Build an ISO string from the date + time parts. If a timezone is set on
  // the match, append it; otherwise treat as local.
  const timePart = match.start_time.length === 5 ? `${match.start_time}:00` : match.start_time;
  // The date stored is a calendar date (no TZ). If the match has a tz we'd
  // need a date library to do proper IANA-zone conversion; for the urgency
  // curve a UTC parse is close enough — the curve is in whole-day buckets
  // and the boundary error is at most one zone's offset (<24h).
  const iso = `${match.match_date}T${timePart}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Urgency boost applied additively on top of the relevance score. Mirrors
 * the suggestion-side `urgencyBoostForDate` shape so the two pools stay
 * coherent when merged in the composer.
 *
 *   today      → +0.05
 *   tomorrow   → +0.03
 *   day after  → +0.01
 *   beyond     →  0
 */
export function matchUrgencyBoost(match: Scorable, now: Date = new Date()): number {
  const start = matchStartDate(match);
  if (!start) return 0;

  // Whole-day delta using UTC dates (so DST shifts don't move the boundary).
  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = Math.floor(start.getTime() / dayMs);
  const nowDay = Math.floor(now.getTime() / dayMs);
  const delta = startDay - nowDay;

  if (delta <= 0) return 0.05;
  if (delta === 1) return 0.03;
  if (delta === 2) return 0.01;
  return 0;
}

/**
 * Cheap TS-side safety net for the past-cutoff filter. The RPC already
 * filters past matches (timezone-aware) but a match could slip into the
 * within-N-minutes window between fetch and render. Returns false when the
 * match is already starting (or about to).
 *
 * @param leadMinutes - Minimum lead time before start to still consider
 *   joinable. Default 30 — by then the booking link is moot.
 */
export function isMatchStillJoinable(
  match: Scorable,
  now: Date = new Date(),
  leadMinutes = 30
): boolean {
  const start = matchStartDate(match);
  if (!start) return true; // No start info → don't drop; the RPC would have already filtered if needed.
  return start.getTime() - now.getTime() > leadMinutes * 60 * 1000;
}

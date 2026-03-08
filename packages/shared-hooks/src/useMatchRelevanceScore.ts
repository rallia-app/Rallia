/**
 * Match Relevance Scoring
 *
 * Computes a 0–100 relevance score for nearby matches based on player preferences.
 * Used to sort the "Soon & Nearby" section on the home screen.
 *
 * Factors (weights sum to 100):
 *  1. Spots left (25)        – fewer spots = more urgent, full = worst
 *  2. Match tier (20)        – mostWanted > covetedPlayers/courtBooked > regular
 *  3. Rating fit (15)        – min rating >= player rating = good challenge
 *  4. Distance (12)          – closer is better
 *  5. Duration match (8)     – matches preferred duration
 *  6. Preferred facility (7) – match at player's preferred facility
 *  7. Format/type (5)        – casual/competitive preference match
 *  8. Cost (4)               – cheaper is better
 *  9. Gender (4)             – gender preference alignment
 */

import { useMemo } from 'react';
import type { MatchWithDetails } from '@rallia/shared-types';

/** Any match type that carries distance info (NearbyMatch, PublicMatch, etc.) */
export type Scorable = MatchWithDetails & { distance_meters: number | null };

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
// SCORING FUNCTIONS
// =============================================================================

const DURATION_STEPS = ['30', '60', '90', '120'];

function getCapacity(format: string | null | undefined): number {
  return format === 'doubles' ? 4 : 2;
}

function getJoinedCount(match: Scorable): number {
  return match.participants?.filter(p => p.status === 'joined').length ?? 0;
}

/** Factor 1: Spots left (weight 25) */
function scoreSpotsLeft(match: Scorable): number {
  const capacity = getCapacity(match.format);
  const joined = getJoinedCount(match);
  const spotsLeft = capacity - joined;

  if (spotsLeft <= 0) return 0; // full = worst
  if (spotsLeft === 1) return 1.0;
  if (spotsLeft === 2) return 0.7;
  if (spotsLeft === 3) return 0.4;
  return 0.2;
}

/** Factor 2: Match tier (weight 20) */
function scoreTier(match: Scorable): number {
  const courtBooked = match.court_status === 'reserved';
  const hasCoveted =
    match.participants?.some(
      p => p.status === 'joined' && p.player?.sportCertificationStatus === 'certified'
    ) ?? false;

  if (hasCoveted && courtBooked) return 1.0; // mostWanted
  if (hasCoveted || courtBooked) return 0.6; // covetedPlayers or courtBooked
  return 0.2; // regular
}

/** Factor 3: Rating fit (weight 15) */
function scoreRatingFit(match: Scorable, playerRatingValue: number | null | undefined): number {
  const minRatingValue = match.min_rating_score?.value;

  // No rating requirement on match or player has no rating → neutral
  if (minRatingValue == null || playerRatingValue == null) return 0.5;

  if (minRatingValue >= playerRatingValue) return 1.0; // good challenge

  // Below player rating — penalize proportionally
  const diff = playerRatingValue - minRatingValue;
  // Each 0.5 rating step below = -0.15
  return Math.max(0.2, 1.0 - diff * 0.3);
}

/** Factor 4: Distance (weight 12) */
function scoreDistance(match: Scorable, maxTravelDistanceKm: number | undefined): number {
  if (match.distance_meters == null) return 0.5;
  if (!maxTravelDistanceKm || maxTravelDistanceKm <= 0) return 0.5;

  const maxMeters = maxTravelDistanceKm * 1000;
  const ratio = match.distance_meters / maxMeters;
  return Math.max(0, 1.0 - ratio);
}

/** Factor 5: Duration match (weight 8) */
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

/** Factor 6: Preferred facility (weight 7) */
function scorePreferredFacility(
  match: Scorable,
  favoriteFacilityIds: string[] | undefined
): number {
  if (!favoriteFacilityIds || favoriteFacilityIds.length === 0 || !match.facility_id) return 0;
  return favoriteFacilityIds.includes(match.facility_id) ? 1.0 : 0;
}

/** Factor 7: Format/type match (weight 5) */
function scoreFormat(match: Scorable, preferredMatchType: string | null | undefined): number {
  if (!preferredMatchType || !match.player_expectation) return 0.5;

  if (match.player_expectation === preferredMatchType) return 1.0;
  if (match.player_expectation === 'both' || preferredMatchType === 'both') return 0.7;
  return 0.2;
}

/** Factor 8: Cost (weight 4) */
function scoreCost(match: Scorable, maxCostInBatch: number): number {
  if (match.is_court_free || match.estimated_cost == null || match.estimated_cost === 0) return 1.0;
  if (maxCostInBatch <= 0) return 0.5;

  return Math.max(0.1, 1.0 - match.estimated_cost / maxCostInBatch);
}

/** Factor 9: Gender (weight 4) */
function scoreGender(match: Scorable, playerGender: string | null | undefined): number {
  // null preferred_opponent_gender means "any gender welcome"
  if (!match.preferred_opponent_gender) return 0.7;
  if (!playerGender) return 0.5;

  return match.preferred_opponent_gender === playerGender ? 1.0 : 0.3;
}

// =============================================================================
// MAIN SCORING FUNCTION
// =============================================================================

/**
 * Compute a 0–100 relevance score for a single match.
 * @param maxCostInBatch - The highest estimated_cost among all matches in the batch (for normalization)
 */
export function scoreNearbyMatch(
  match: Scorable,
  preferences: MatchScoringPreferences,
  maxCostInBatch: number
): number {
  const score =
    25 * scoreSpotsLeft(match) +
    20 * scoreTier(match) +
    15 * scoreRatingFit(match, preferences.playerRatingValue) +
    12 * scoreDistance(match, preferences.maxTravelDistanceKm) +
    8 * scoreDuration(match, preferences.preferredMatchDuration) +
    7 * scorePreferredFacility(match, preferences.favoriteFacilityIds) +
    5 * scoreFormat(match, preferences.preferredMatchType) +
    4 * scoreCost(match, maxCostInBatch) +
    4 * scoreGender(match, preferences.playerGender);

  return Math.round(score * 100) / 100;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook that sorts nearby matches chronologically (soonest first),
 * using the relevance score as a tiebreaker when matches share the same date and time.
 * This preserves the server's chronological ordering for pagination while still
 * surfacing the most relevant matches first within the same time slot.
 */
export function useSortedNearbyMatches<T extends Scorable>(
  matches: T[],
  preferences: MatchScoringPreferences
): T[] {
  return useMemo(() => {
    if (matches.length === 0) return matches;

    // Compute max cost in the batch for normalization
    const maxCost = matches.reduce((max, m) => {
      const cost = m.estimated_cost ?? 0;
      return cost > max ? cost : max;
    }, 0);

    // Score and sort: primary by date+time (ascending), secondary by relevance (descending)
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

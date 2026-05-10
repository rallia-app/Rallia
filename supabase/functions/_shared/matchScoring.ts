/**
 * Match Relevance Scoring (Deno port)
 *
 * IMPORTANT: keep in sync with `packages/shared-services/src/matches/matchScoring.ts`.
 * The mobile app and the digest edge function MUST score matches identically;
 * otherwise the same player can see different rankings on Home vs in the email.
 *
 * Why a copy: Deno can't import from the TypeScript monorepo path aliases used
 * by React Native, so we keep a parallel Deno-friendly version. Inlines the
 * minimal `Scorable` shape the scorer actually reads (no @rallia/shared-types
 * dependency).
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

export interface Scorable {
  id: string;
  facility_id: string | null;
  format: string | null;
  duration: string | null;
  match_date: string | null;
  start_time: string | null;
  estimated_cost: number | null;
  is_court_free: boolean | null;
  court_status: string | null;
  player_expectation: string | null;
  preferred_opponent_gender: string | null;
  distance_meters: number | null;
  min_rating_score?: { value: number | null } | null;
  participants?: Array<{
    status: string | null;
    player_id?: string | null;
    player?: { sportCertificationStatus?: string | null } | null;
  }> | null;
  // Optional rendering fields the scorer doesn't read but downstream
  // consumers (e.g. digest email template) may need. The composer hydrates
  // them; absence is harmless.
  end_time?: string | null;
  join_mode?: string | null;
  sport?: { name: string } | null;
  facility?: { name: string; city: string } | null;
}

export interface MatchScoringPreferences {
  playerGender?: string | null;
  playerRatingValue?: number | null;
  preferredMatchDuration?: string | null;
  preferredMatchType?: string | null;
  favoriteFacilityIds?: string[];
  maxTravelDistanceKm?: number;
}

const DURATION_STEPS = ['30', '60', '90', '120'];

function getCapacity(format: string | null | undefined): number {
  return format === 'doubles' ? 4 : 2;
}

function getJoinedCount(match: Scorable): number {
  return match.participants?.filter(p => p.status === 'joined').length ?? 0;
}

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
  const maxMeters = maxTravelDistanceKm * 1000;
  const ratio = match.distance_meters / maxMeters;
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

function scoreCost(match: Scorable, maxCostInBatchValue: number): number {
  if (match.is_court_free || match.estimated_cost == null || match.estimated_cost === 0) return 1.0;
  if (maxCostInBatchValue <= 0) return 0.5;
  return Math.max(0.1, 1.0 - match.estimated_cost / maxCostInBatchValue);
}

function scoreGender(match: Scorable, playerGender: string | null | undefined): number {
  if (!match.preferred_opponent_gender) return 0.7;
  if (!playerGender) return 0.5;
  return match.preferred_opponent_gender === playerGender ? 1.0 : 0.3;
}

export function scoreNearbyMatch(
  match: Scorable,
  preferences: MatchScoringPreferences,
  maxCostInBatchValue: number
): number {
  const score =
    25 * scoreSpotsLeft(match) +
    20 * scoreTier(match) +
    15 * scoreRatingFit(match, preferences.playerRatingValue) +
    12 * scoreDistance(match, preferences.maxTravelDistanceKm) +
    8 * scoreDuration(match, preferences.preferredMatchDuration) +
    7 * scorePreferredFacility(match, preferences.favoriteFacilityIds) +
    5 * scoreFormat(match, preferences.preferredMatchType) +
    4 * scoreCost(match, maxCostInBatchValue) +
    4 * scoreGender(match, preferences.playerGender);
  return Math.round(score * 100) / 100;
}

export function maxCostInBatch(matches: Scorable[]): number {
  return matches.reduce((max, m) => {
    const cost = m.estimated_cost ?? 0;
    return cost > max ? cost : max;
  }, 0);
}

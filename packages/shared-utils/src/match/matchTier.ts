/**
 * Match Tier Utilities
 *
 * Shared logic for determining match tier based on court status
 * and participant reputation/certification.
 */

/**
 * Match tier determines visual styling based on desirability:
 * - mostWanted: Court booked + enough coveted participants → accent/gold
 * - readyToPlay: Court booked only → secondary/coral
 * - topPlayer: Enough coveted participants → primary variant
 * - regular: Default → primary/teal
 * - expired: Match started but not full (disabled appearance) → neutral/gray
 *
 * A match has "coveted players" when:
 * - Singles: at least 1 joined player is coveted
 * - Doubles: at least 2 joined players are coveted
 */
export type MatchTier = 'mostWanted' | 'readyToPlay' | 'topPlayer' | 'regular' | 'expired';

/**
 * Threshold for "high reputation" (percentage 0-100)
 */
export const HIGH_REPUTATION_THRESHOLD = 90;

/**
 * Minimum reputation events before the score is considered valid for coveted status.
 * Mirrors MIN_EVENTS_FOR_PUBLIC in reputationConfig.
 */
export const MIN_EVENTS_FOR_COVETED = 5;

/**
 * Check if a single player qualifies as "coveted" (high rep + certified rating + enough events).
 */
export function isCoveted(repScore?: number, certStatus?: string, totalEvents?: number): boolean {
  return (
    (totalEvents ?? 0) >= MIN_EVENTS_FOR_COVETED &&
    (repScore ?? 0) >= HIGH_REPUTATION_THRESHOLD &&
    certStatus === 'certified'
  );
}

/**
 * Determine match tier based on court status and participant composition.
 * A match has "coveted players" when at least 1 joined player is coveted
 * for singles, or at least 2 for doubles.
 */
export function getMatchTier(
  courtStatus: string | null,
  opponents: Array<{ repScore?: number; certStatus?: string; totalEvents?: number }>,
  format?: string | null
): MatchTier {
  const isCourtBooked = courtStatus === 'reserved';
  const covetedCount = opponents.filter(o =>
    isCoveted(o.repScore, o.certStatus, o.totalEvents)
  ).length;
  const covetedThreshold = format === 'doubles' ? 2 : 1;
  const hasCoveted = covetedCount >= covetedThreshold;

  if (isCourtBooked && hasCoveted) return 'mostWanted';
  if (isCourtBooked) return 'readyToPlay';
  if (hasCoveted) return 'topPlayer';
  return 'regular';
}

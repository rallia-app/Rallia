/**
 * Cancellation Penalty Calculator
 *
 * Graduated, context-sensitive penalties for late match cancellations/leaves.
 * Pure functions — easy to unit test, no DB dependencies.
 */

// =============================================================================
// PENALTY BRACKETS
// =============================================================================

/**
 * Base penalty by hours-before-match bracket.
 * Closer to match = harsher penalty. Creator pays ~1.5× participant.
 * All values capped below match_no_show (-50) to preserve the distinction
 * that cancelling is still better than ghosting.
 *
 * After history multiplier, penalties are floored at NO_SHOW_PENALTY + 1 (-49)
 * so that even repeat offenders don't exceed the no-show penalty.
 */
const PENALTY_BRACKETS: { maxHours: number; creator: number; participant: number }[] = [
  // After match has started (hoursUntilMatch <= 0)
  { maxHours: 0, creator: -45, participant: -33 },
  // 0–2 hours before
  { maxHours: 2, creator: -45, participant: -28 },
  // 2–6 hours before
  { maxHours: 6, creator: -35, participant: -22 },
  // 6–12 hours before
  { maxHours: 12, creator: -20, participant: -13 },
  // 12–24 hours before
  { maxHours: 24, creator: -10, participant: -7 },
];

// =============================================================================
// HISTORY MULTIPLIERS
// =============================================================================

/**
 * Multiplier based on number of late cancel/leave events in the last 30 days.
 * First offense gets leniency (0.5×), repeat offenders escalate up to 2×.
 */
const HISTORY_MULTIPLIERS: { maxOffenses: number; multiplier: number }[] = [
  { maxOffenses: 0, multiplier: 0.5 },
  { maxOffenses: 1, multiplier: 1.0 },
  { maxOffenses: 2, multiplier: 1.5 },
];
const MAX_HISTORY_MULTIPLIER = 2.0;

/** Cancellation penalties must never exceed the no-show penalty (-50). */
const NO_SHOW_PENALTY = -50;

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Calculate the cancellation/leave penalty for a player.
 *
 * @param hoursUntilMatch - Hours until match start (negative = already started)
 * @param role - 'creator' for host cancellation, 'participant' for leaving
 * @param options.recentOffenses - Number of late cancel/leave events in last 30 days
 * @returns Negative number (penalty) or 0 if outside penalty range (24h+)
 */
export function calculateCancellationPenalty(
  hoursUntilMatch: number,
  role: 'creator' | 'participant',
  options: { recentOffenses: number }
): number {
  // 24h+ before match → no penalty
  if (hoursUntilMatch >= 24) {
    return 0;
  }

  // Find the applicable bracket
  const basePenalty = lookupBasePenalty(hoursUntilMatch, role);
  if (basePenalty === 0) return 0;

  // Apply history modifier
  const historyMod = getHistoryMultiplier(options.recentOffenses);

  return Math.max(Math.round(basePenalty * historyMod), NO_SHOW_PENALTY + 1);
}

// =============================================================================
// INTERNALS
// =============================================================================

function lookupBasePenalty(hoursUntilMatch: number, role: 'creator' | 'participant'): number {
  // Walk brackets from tightest (after start) to widest (12-24h)
  for (const bracket of PENALTY_BRACKETS) {
    if (hoursUntilMatch <= bracket.maxHours) {
      return role === 'creator' ? bracket.creator : bracket.participant;
    }
  }
  // Beyond all brackets (24h+)
  return 0;
}

function getHistoryMultiplier(recentOffenses: number): number {
  for (const entry of HISTORY_MULTIPLIERS) {
    if (recentOffenses <= entry.maxOffenses) {
      return entry.multiplier;
    }
  }
  return MAX_HISTORY_MULTIPLIER;
}

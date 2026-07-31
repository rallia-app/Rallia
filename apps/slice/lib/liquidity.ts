import { getRatingOptions, type SportOption } from './constants';
import { isFlexibleTimeSlot, parseTimeSlot } from './time-selection';

/**
 * Simulated liquidity signal, shown between the time step and the contact ask.
 *
 * The numbers are FABRICATED — the smoke test has no player pool to count.
 * They exist to remove "I don't believe a no-name brand can find me anyone"
 * as a confounder, so a refusal at the pricing screen measures willingness to
 * pay rather than disbelief. The reveal screen discloses the simulation.
 *
 * Everything is a pure function of the visitor's own inputs, never random:
 * two visitors with the same preferences see the same numbers, and the same
 * visitor sees them again on a second pass. Credibility also demands the
 * numbers shrink where a knowledgeable player expects scarcity — extreme
 * ratings, tight radii — because a 6.5 NTRP shown "23 players nearby" knows
 * immediately it's fake.
 */

export interface LiquidityEstimate {
  /** "X compatible players" shown to the visitor. */
  playerCount: number;
  /** "~Y% chance your game happens" shown to the visitor. */
  likelihoodPct: number;
}

/** FNV-1a, folded to [0, 1). Stable jitter source keyed on the inputs. */
function hashFraction(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 2 ** 32;
}

/** 1 at the middle of the rating scale, 0 at either extreme. */
function ratingCentrality(sport: SportOption, rating: string): number {
  const options = getRatingOptions(sport);
  const index = options.indexOf(rating);
  if (index === -1) return 0.5;
  const mid = (options.length - 1) / 2;
  return 1 - Math.abs(index - mid) / mid;
}

const BASE_COUNT_BY_RADIUS: Record<number, number> = { 10: 9, 25: 16, 50: 26 };

function timeSlotFactor(timeSlot: string): number {
  if (isFlexibleTimeSlot(timeSlot)) return 1.25;
  const hour = parseTimeSlot(timeSlot)?.hour ?? 12;
  if (hour >= 18) return 1.15; // evenings are believably the busiest
  if (hour < 12) return 0.9;
  return 1;
}

export function estimateLiquidity(input: {
  sport: SportOption;
  rating: string;
  maxDistanceKm: number;
  timeSlot: string;
}): LiquidityEstimate {
  const { sport, rating, maxDistanceKm, timeSlot } = input;
  const centrality = ratingCentrality(sport, rating);
  const jitter = hashFraction(`${sport}|${rating}|${maxDistanceKm}|${timeSlot}`);

  const base = BASE_COUNT_BY_RADIUS[maxDistanceKm] ?? 16;
  const sportFactor = sport === 'pickleball' ? 0.8 : 1;
  const centralityFactor = 0.3 + 0.7 * centrality;
  const raw =
    base * sportFactor * centralityFactor * timeSlotFactor(timeSlot) * (0.88 + 0.24 * jitter);
  const playerCount = Math.min(40, Math.max(2, Math.round(raw)));

  const flexibleBonus = isFlexibleTimeSlot(timeSlot) ? 6 : 0;
  const radiusBonus = maxDistanceKm >= 50 ? 3 : maxDistanceKm >= 25 ? 1 : 0;
  const rawPct = 71 + 12 * centrality + flexibleBonus + radiusBonus + Math.round(jitter * 6) - 3;
  const likelihoodPct = Math.min(92, Math.max(68, Math.round(rawPct)));

  return { playerCount, likelihoodPct };
}

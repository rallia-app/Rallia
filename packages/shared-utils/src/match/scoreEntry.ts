/**
 * Score-entry rules shared by every structured score sheet.
 *
 * One place decides how many sets a format allows, how many clinch it, which
 * side won, and how the result serializes to the "6-4 6-2" string every caller
 * stores. Tournaments and league sessions both drive their entry UI from here;
 * keeping the rules out of the components is what stops the two drifting apart
 * again.
 */

import type { Enums } from '@rallia/shared-types';

/** Fallback cap when a context carries no declared format (casual matches). */
export const MAX_SETS = 5;

export interface SetScore {
  player1Score: number | null;
  player2Score: number | null;
}

export interface SetRules {
  /** Most sets the UI will offer. */
  maxSets: number;
  /** Set wins that decide the match, after which "add set" disappears. */
  setsToWin: number;
}

/**
 * Sets a scorer may enter per declared format.
 *
 * The two sports name different things. Tennis formats state how many sets win
 * the match. Pickleball formats state the POINTS that win a single game, which
 * says nothing about how many games are played, so the game count is a separate
 * axis the enum cannot currently express.
 *
 * Pickleball therefore allows up to 3 games with 2 to clinch: best-of-3 to 11 is
 * the standard format and used to be unreachable, while a single-game event
 * still works because a lone decided game is submittable. Previously these were
 * pinned to exactly one game, so a second game could not be entered at all.
 */
const FORMAT_SET_RULES: Partial<Record<Enums<'match_format'>, SetRules>> = {
  one_set: { maxSets: 1, setsToWin: 1 },
  two_of_three: { maxSets: 3, setsToWin: 2 },
  three_of_five: { maxSets: 5, setsToWin: 3 },
  pickleball_to_11: { maxSets: 3, setsToWin: 2 },
  pickleball_to_15: { maxSets: 3, setsToWin: 2 },
  pickleball_to_21: { maxSets: 3, setsToWin: 2 },
};

/** Set rules for a format; an absent/unknown format gets the loose fallback. */
export function setRulesFor(format: Enums<'match_format'> | undefined | null): SetRules {
  return (format && FORMAT_SET_RULES[format]) || { maxSets: MAX_SETS, setsToWin: MAX_SETS + 1 };
}

/** Sets with both sides filled in. Partially typed rows never count. */
export function validSetsOf(sets: SetScore[]): SetScore[] {
  return sets.filter(s => s.player1Score !== null && s.player2Score !== null);
}

/** Sets won by each side. */
export function countSetWins(sets: SetScore[]): { player1: number; player2: number } {
  let player1 = 0;
  let player2 = 0;
  for (const s of sets) {
    if (s.player1Score === null || s.player2Score === null) continue;
    if (s.player1Score > s.player2Score) player1 += 1;
    else if (s.player2Score > s.player1Score) player2 += 1;
  }
  return { player1, player2 };
}

/** Winning side (1 or 2), or null when nobody leads on sets. */
export function deriveWinningSideFromSets(sets: SetScore[]): 1 | 2 | null {
  const { player1, player2 } = countSetWins(sets);
  if (player1 > player2) return 1;
  if (player2 > player1) return 2;
  return null;
}

/** Whether a side has already taken enough sets to end the match. */
export function hasClinched(sets: SetScore[], setsToWin: number): boolean {
  const { player1, player2 } = countSetWins(sets);
  return player1 >= setsToWin || player2 >= setsToWin;
}

/** True while another set may still be added. */
export function canAddSet(sets: SetScore[], rules: SetRules): boolean {
  return sets.length < rules.maxSets && !hasClinched(validSetsOf(sets), rules.setsToWin);
}

/** Serialize to "6-4 6-2", player 1 always on the left. */
export function serializeSets(sets: SetScore[]): string {
  return validSetsOf(sets)
    .map(s => `${s.player1Score}-${s.player2Score}`)
    .join(' ');
}

/**
 * The score a side must reach to take one set/game, per format. A format that
 * declares no target is not validated at all, which is what keeps casual
 * matches (no declared format) on their old permissive behaviour.
 */
const FORMAT_TARGET: Partial<Record<Enums<'match_format'>, number>> = {
  one_set: 6,
  two_of_three: 6,
  three_of_five: 6,
  pickleball_to_11: 11,
  pickleball_to_15: 15,
  pickleball_to_21: 21,
};

/** The winning score for one set/game under this format, or null if unconstrained. */
export function setTargetFor(format: Enums<'match_format'> | undefined | null): number | null {
  return (format && FORMAT_TARGET[format]) ?? null;
}

/**
 * Rejects a score that cannot belong to this format, which in practice means a
 * score from the other sport: 6-4 in a to-11 pickleball draw, 11-7 in a tennis
 * one. The rule is simply that whoever took the set reached the format's target.
 *
 * Returns the offending set's 1-based index, or null when the sets are
 * plausible. Sets that are still half-entered are ignored, so the check never
 * fires while someone is mid-type.
 *
 * Deliberately not a range check on both sides: 7-5 and 13-11 are legitimate,
 * and an upper bound would reject them. Nothing here models a retirement,
 * because no surface can record one today; a retirement UI would need to bypass
 * this rather than loosen it.
 */
export function firstSetFailingFormat(
  sets: SetScore[],
  format: Enums<'match_format'> | undefined | null
): number | null {
  const target = setTargetFor(format);
  if (target === null) return null;
  const complete = validSetsOf(sets);
  for (let i = 0; i < complete.length; i += 1) {
    const s = complete[i];
    if (Math.max(s.player1Score as number, s.player2Score as number) < target) return i + 1;
  }
  return null;
}

/**
 * Whether a single entered value looks out of range for the sport. Advisory
 * only: the scorer is the authority, this just catches fat fingers.
 */
export function isScoreOutOfRange(score: number | null, isPickleball: boolean): boolean {
  if (score === null) return false;
  return isPickleball ? score > 25 : score > 7;
}

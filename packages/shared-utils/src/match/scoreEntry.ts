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
 * Whether a single entered value looks out of range for the sport. Advisory
 * only: the scorer is the authority, this just catches fat fingers.
 */
export function isScoreOutOfRange(score: number | null, isPickleball: boolean): boolean {
  if (score === null) return false;
  return isPickleball ? score > 25 : score > 7;
}

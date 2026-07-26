/**
 * How a rating score is explained to a player.
 *
 * Extracted from mobile's onboarding RatingStep so web's rating step describes NTRP
 * and DUPR levels with exactly the same words. The copy itself lives in
 * shared-translations under `onboarding.ratingStep`; this module only decides which
 * key a given score maps to, which is the part that was silently duplicable.
 */

export type RatingSystemCode = 'ntrp' | 'dupr';

/** Coarse tier, used for the icon and emphasis on a level card. */
export type RatingSkillTier = 'beginner' | 'intermediate' | 'advanced' | 'professional';

/**
 * Score → skill-level leaf key under `onboarding.ratingStep.skillLevels`.
 *
 * The two systems agree everywhere except their floor: NTRP starts at 1.5, DUPR at
 * 1.0. Both call that first rung "Beginner 1".
 */
const SHARED_SKILL_LEVELS: Record<number, string> = {
  2.0: 'beginner2',
  2.5: 'beginner3',
  3.0: 'intermediate1',
  3.5: 'intermediate2',
  4.0: 'intermediate3',
  4.5: 'advanced1',
  5.0: 'advanced2',
  5.5: 'advanced3',
  6.0: 'professional',
};

const SYSTEM_FLOOR: Record<RatingSystemCode, number> = { ntrp: 1.5, dupr: 1.0 };

/**
 * Leaf key under `onboarding.ratingStep.skillLevels`, or null for a score the
 * system does not define a name for (rather than rendering a raw key).
 */
export function ratingSkillLevelKey(system: RatingSystemCode, scoreValue: number): string | null {
  if (scoreValue === SYSTEM_FLOOR[system]) return 'beginner1';
  return SHARED_SKILL_LEVELS[scoreValue] ?? null;
}

/**
 * Leaf key under `onboarding.ratingStep` for the level's description, e.g.
 * `ntrpDescriptions.3_5`. Scores are keyed to one decimal with `.` → `_`.
 */
export function ratingDescriptionKey(system: RatingSystemCode, scoreValue: number): string {
  return `${system}Descriptions.${scoreValue.toFixed(1).replace('.', '_')}`;
}

/** Tier a score falls in. Thresholds match mobile's getSkillCategory. */
export function ratingSkillTier(scoreValue: number): RatingSkillTier {
  if (scoreValue <= 2.5) return 'beginner';
  if (scoreValue <= 4.0) return 'intermediate';
  if (scoreValue <= 5.5) return 'advanced';
  return 'professional';
}

/** Official documentation for each system, linked from the rating step. */
export const RATING_SYSTEM_URLS: Record<RatingSystemCode, string> = {
  ntrp: 'https://www.usta.com/content/dam/usta/pdfs/10013_experience_player_ntrp_characteristics1%20(2).pdf',
  dupr: 'https://www.dupr.com/post/understanding-all-pickleball-ratings',
};

/** Which rating system a sport is scored on. */
export function ratingSystemForSport(sportSlug: string): RatingSystemCode {
  return sportSlug === 'pickleball' ? 'dupr' : 'ntrp';
}

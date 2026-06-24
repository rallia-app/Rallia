/**
 * Founding Member
 *
 * A Founding Member joined before the public launch cutoff. Derived directly
 * from existing profile data — no badge records exist yet.
 */

/** Players who joined before this instant (UTC) are eligible for the Founding Member badge. */
export const FOUNDING_MEMBER_CUTOFF = '2026-06-01T00:00:00Z';

/**
 * Whether a player qualifies as a Founding Member. Gated on completed onboarding
 * when that flag is known; an unknown (undefined) flag does not disqualify, so
 * callers that don't load it still behave correctly.
 */
export function isFoundingMember(
  createdAt?: string | null,
  onboardingCompleted?: boolean | null
): boolean {
  if (!createdAt) return false;
  if (onboardingCompleted === false) return false;
  const joined = new Date(createdAt).getTime();
  if (Number.isNaN(joined)) return false;
  return joined < new Date(FOUNDING_MEMBER_CUTOFF).getTime();
}

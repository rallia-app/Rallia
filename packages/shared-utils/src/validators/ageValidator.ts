/**
 * Age Validation Utilities
 *
 * Shared logic for enforcing the minimum-age requirement across the mobile
 * onboarding and the web join flow. Keeping the threshold and the date math in
 * one place ensures both platforms gate users identically.
 */

/** Minimum age (in years) required to use Rallia. */
export const MINIMUM_AGE_YEARS = 18;

/**
 * The latest date of birth that still satisfies the minimum age requirement,
 * i.e. exactly `MINIMUM_AGE_YEARS` ago from today. Anyone born after this date
 * is too young.
 *
 * @param now - Reference date (defaults to the current date). Useful for tests.
 */
export function getMinimumDateOfBirth(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() - MINIMUM_AGE_YEARS);
  return date;
}

/**
 * Whether the given date of birth meets the minimum age requirement.
 *
 * Accepts a `Date` or an ISO date string (e.g. "2000-01-15"). Returns `false`
 * for missing or unparseable input so callers can treat it as "not eligible".
 *
 * @param dateOfBirth - The user's date of birth
 * @param now - Reference date (defaults to the current date). Useful for tests.
 *
 * @example
 * meetsMinimumAge('2000-01-15') // true (if today is well past 2018)
 * meetsMinimumAge('2015-01-15') // false
 */
export function meetsMinimumAge(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!dateOfBirth) return false;

  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return false;

  return dob <= getMinimumDateOfBirth(now);
}

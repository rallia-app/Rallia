/**
 * Onboarding minimum (specs/01-authentication/onboarding-minimum.md).
 *
 * Every onboarding path, mobile or web, must leave the player with a postal
 * code, a rating on every sport, and at least MIN_FAVORITE_FACILITIES
 * favourite facilities per sport. The server enforces it through
 * complete_onboarding(); the clients read the same constants to gate their
 * steps before they ever call it.
 */

/** Mirror of public.min_favorite_facilities() in SQL. Change both together. */
export const MIN_FAVORITE_FACILITIES = 2;

/** Stable codes returned by get_onboarding_gaps() / complete_onboarding(). */
export type OnboardingGapCode =
  | 'postal_code'
  | 'sport'
  | `rating:${string}`
  | `favorites:${string}`;

export interface OnboardingGaps {
  postalCode: boolean;
  sport: boolean;
  /** Sport ids whose player_sport row has no active rating. */
  unratedSportIds: string[];
  /** Sport ids with fewer than MIN_FAVORITE_FACILITIES favourites. */
  underFavoritedSportIds: string[];
}

export function parseOnboardingGaps(codes: readonly string[] | null | undefined): OnboardingGaps {
  const gaps: OnboardingGaps = {
    postalCode: false,
    sport: false,
    unratedSportIds: [],
    underFavoritedSportIds: [],
  };
  for (const code of codes ?? []) {
    if (code === 'postal_code') gaps.postalCode = true;
    else if (code === 'sport') gaps.sport = true;
    else if (code.startsWith('rating:')) gaps.unratedSportIds.push(code.slice('rating:'.length));
    else if (code.startsWith('favorites:'))
      gaps.underFavoritedSportIds.push(code.slice('favorites:'.length));
  }
  return gaps;
}

export function hasOnboardingGaps(gaps: OnboardingGaps): boolean {
  return (
    gaps.postalCode ||
    gaps.sport ||
    gaps.unratedSportIds.length > 0 ||
    gaps.underFavoritedSportIds.length > 0
  );
}

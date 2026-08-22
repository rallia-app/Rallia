/**
 * Maps get_onboarding_gaps() codes onto profile-completeness checklist items.
 * Pure so the ordering and deep links are unit-testable. Order follows the
 * repair spec: sport first (nothing attaches without one), then rating,
 * favourites, then location.
 */

import { MIN_FAVORITE_FACILITIES, type OnboardingGaps } from '@rallia/shared-utils';

import type { CompletenessItem } from './useProfileCompleteness';

export interface GapSportInfo {
  id: string;
  name: string;
  display_name: string;
}

/** Weight of every gap row; heavy on purpose so the banner and ring react. */
export const ONBOARDING_GAP_WEIGHT = 15;

export function isOnboardingGapItem(item: Pick<CompletenessItem, 'key'>): boolean {
  return item.key.startsWith('onboarding_');
}

/**
 * Sport-scoped gaps whose sport is not in `sportsById` are skipped: without a
 * sport name the deep link cannot be built, and the map catches up on the
 * next render.
 */
export function buildOnboardingGapItems(
  gaps: OnboardingGaps,
  sportsById: Record<string, GapSportInfo>
): CompletenessItem[] {
  const items: CompletenessItem[] = [];

  if (gaps.sport) {
    items.push({
      key: 'onboarding_sport',
      labelKey: 'profileCompletion.gaps.sport',
      weight: ONBOARDING_GAP_WEIGHT,
      completed: false,
      applicable: true,
      actionType: 'sport_setup',
    });
  }

  for (const sportId of gaps.unratedSportIds) {
    const sport = sportsById[sportId];
    if (!sport) continue;
    items.push({
      key: `onboarding_rating:${sportId}`,
      labelKey: 'profileCompletion.gaps.rating',
      labelParams: { sport: sport.display_name },
      weight: ONBOARDING_GAP_WEIGHT,
      completed: false,
      applicable: true,
      actionType: 'navigate',
      actionNavigate: 'SportProfile',
      actionPayload: { sportId, sportName: sport.name, openSheet: 'rating' },
    });
  }

  for (const sportId of gaps.underFavoritedSportIds) {
    const sport = sportsById[sportId];
    if (!sport) continue;
    items.push({
      key: `onboarding_favorites:${sportId}`,
      labelKey: 'profileCompletion.gaps.favorites',
      labelParams: { sport: sport.display_name, count: MIN_FAVORITE_FACILITIES },
      weight: ONBOARDING_GAP_WEIGHT,
      completed: false,
      applicable: true,
      actionType: 'navigate',
      actionNavigate: 'SportProfile',
      actionPayload: { sportId, sportName: sport.name, openSheet: 'favorite-facilities' },
    });
  }

  if (gaps.postalCode) {
    items.push({
      key: 'onboarding_postal_code',
      labelKey: 'profileCompletion.gaps.postalCode',
      weight: ONBOARDING_GAP_WEIGHT,
      completed: false,
      applicable: true,
      actionType: 'sheet',
      actionSheet: 'player-location',
    });
  }

  return items;
}

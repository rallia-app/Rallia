import { MIN_FAVORITE_FACILITIES, parseOnboardingGaps } from '@rallia/shared-utils';
import { buildOnboardingGapItems, isOnboardingGapItem } from './onboardingGapItems';

const TENNIS = '11111111-1111-4111-8111-111111111111';
const PICKLEBALL = '22222222-2222-4222-8222-222222222222';
const SPORTS = {
  [TENNIS]: { id: TENNIS, name: 'tennis', display_name: 'Tennis' },
  [PICKLEBALL]: { id: PICKLEBALL, name: 'pickleball', display_name: 'Pickleball' },
};

describe('buildOnboardingGapItems', () => {
  it('returns nothing when there are no gaps', () => {
    expect(buildOnboardingGapItems(parseOnboardingGaps([]), SPORTS)).toEqual([]);
  });

  it('orders sport, rating, favorites, then postal code', () => {
    const items = buildOnboardingGapItems(
      parseOnboardingGaps(['postal_code', `favorites:${TENNIS}`, `rating:${TENNIS}`, 'sport']),
      SPORTS
    );
    expect(items.map(i => i.key)).toEqual([
      'onboarding_sport',
      `onboarding_rating:${TENNIS}`,
      `onboarding_favorites:${TENNIS}`,
      'onboarding_postal_code',
    ]);
    expect(items.every(i => i.applicable && !i.completed)).toBe(true);
    expect(items.every(isOnboardingGapItem)).toBe(true);
  });

  it('deep-links each gap to its fix', () => {
    const items = buildOnboardingGapItems(
      parseOnboardingGaps(['sport', `rating:${PICKLEBALL}`, `favorites:${TENNIS}`, 'postal_code']),
      SPORTS
    );
    const byKey = Object.fromEntries(items.map(i => [i.key, i]));

    expect(byKey.onboarding_sport.actionType).toBe('sport_setup');

    const rating = byKey[`onboarding_rating:${PICKLEBALL}`];
    expect(rating.actionType).toBe('navigate');
    expect(rating.actionNavigate).toBe('SportProfile');
    expect(rating.actionPayload).toEqual({
      sportId: PICKLEBALL,
      sportName: 'pickleball',
      openSheet: 'rating',
    });
    expect(rating.labelParams).toEqual({ sport: 'Pickleball' });

    const favorites = byKey[`onboarding_favorites:${TENNIS}`];
    expect(favorites.actionPayload).toEqual({
      sportId: TENNIS,
      sportName: 'tennis',
      openSheet: 'favorite-facilities',
    });
    expect(favorites.labelParams).toEqual({ sport: 'Tennis', count: MIN_FAVORITE_FACILITIES });

    expect(byKey.onboarding_postal_code.actionType).toBe('sheet');
    expect(byKey.onboarding_postal_code.actionSheet).toBe('player-location');
  });

  it('skips sport-scoped gaps until the sport is resolvable', () => {
    const items = buildOnboardingGapItems(
      parseOnboardingGaps([`rating:${TENNIS}`, `favorites:${PICKLEBALL}`]),
      { [TENNIS]: SPORTS[TENNIS] }
    );
    expect(items.map(i => i.key)).toEqual([`onboarding_rating:${TENNIS}`]);
  });
});

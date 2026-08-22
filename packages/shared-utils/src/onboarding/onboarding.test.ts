import { hasOnboardingGaps, MIN_FAVORITE_FACILITIES, parseOnboardingGaps } from './index';

describe('onboarding minimum', () => {
  it('mirrors the SQL constant min_favorite_facilities()', () => {
    expect(MIN_FAVORITE_FACILITIES).toBe(2);
  });

  it('parses an empty or missing list as no gaps', () => {
    expect(hasOnboardingGaps(parseOnboardingGaps([]))).toBe(false);
    expect(hasOnboardingGaps(parseOnboardingGaps(null))).toBe(false);
    expect(hasOnboardingGaps(parseOnboardingGaps(undefined))).toBe(false);
  });

  it('splits the server codes into typed gaps', () => {
    const gaps = parseOnboardingGaps([
      'postal_code',
      'rating:11111111-1111-1111-1111-111111111111',
      'favorites:11111111-1111-1111-1111-111111111111',
      'favorites:22222222-2222-2222-2222-222222222222',
    ]);
    expect(gaps.postalCode).toBe(true);
    expect(gaps.sport).toBe(false);
    expect(gaps.unratedSportIds).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(gaps.underFavoritedSportIds).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(hasOnboardingGaps(gaps)).toBe(true);
  });

  it('reports the no-sport short circuit on its own', () => {
    const gaps = parseOnboardingGaps(['sport']);
    expect(gaps.sport).toBe(true);
    expect(hasOnboardingGaps(gaps)).toBe(true);
  });
});

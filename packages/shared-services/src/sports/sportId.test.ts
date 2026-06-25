import {
  UUID_REGEX,
  FALLBACK_SPORT_ID_SUFFIX,
  isRealSportId,
  makeFallbackSportId,
  isFallbackSportId,
  fallbackSportSlug,
} from './sportId';

describe('sportId helpers', () => {
  const TENNIS_UUID = '39f9b592-0000-4000-8000-000000000001';

  it('recognizes valid uuids', () => {
    expect(isRealSportId(TENNIS_UUID)).toBe(true);
    expect(UUID_REGEX.test(TENNIS_UUID)).toBe(true);
  });

  it('rejects synthetic fallback ids and other non-uuids', () => {
    expect(isRealSportId('tennis-fallback')).toBe(false);
    expect(isRealSportId('tennis')).toBe(false);
    expect(isRealSportId('')).toBe(false);
    expect(isRealSportId(null)).toBe(false);
    expect(isRealSportId(undefined)).toBe(false);
  });

  it('mints and detects fallback ids with a stable suffix', () => {
    expect(FALLBACK_SPORT_ID_SUFFIX).toBe('-fallback');
    expect(makeFallbackSportId('tennis')).toBe('tennis-fallback');
    expect(makeFallbackSportId('pickleball')).toBe('pickleball-fallback');
    expect(isFallbackSportId('tennis-fallback')).toBe(true);
    expect(isFallbackSportId(TENNIS_UUID)).toBe(false);
  });

  it('recovers the sport slug from a fallback id', () => {
    expect(fallbackSportSlug('tennis-fallback')).toBe('tennis');
    expect(fallbackSportSlug('pickleball-fallback')).toBe('pickleball');
    expect(fallbackSportSlug(TENNIS_UUID)).toBeNull();
    expect(fallbackSportSlug('not-a-fallback-id')).toBeNull();
  });
});

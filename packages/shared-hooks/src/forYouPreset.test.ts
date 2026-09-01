import { buildForYouPreset, isForYouPresetActive, matchesForYouLocation } from './forYouPreset';
import { DEFAULT_PUBLIC_MATCH_FILTERS } from './usePublicMatchFilters';

describe('buildForYouPreset', () => {
  it('builds the full preset from a complete profile', () => {
    const preset = buildForYouPreset({
      playerRatingScoreId: 'rs-1',
      maxTravelDistanceKm: 10,
    });
    expect(preset).toEqual({
      rating: ['rs-1'],
      distance: 'all',
      spotsAvailable: 'any',
      isMeaningful: true,
    });
  });

  it('never narrows the server-side distance — location is a client-side OR', () => {
    expect(buildForYouPreset({ maxTravelDistanceKm: 3 }).distance).toBe('all');
    expect(buildForYouPreset({}).distance).toBe('all');
  });

  it('marks the preset non-meaningful without a rating or travel range', () => {
    expect(buildForYouPreset({}).isMeaningful).toBe(false);
    expect(buildForYouPreset({ maxTravelDistanceKm: 0 }).isMeaningful).toBe(false);
    expect(buildForYouPreset({ playerRatingScoreId: 'rs-1' }).isMeaningful).toBe(true);
    expect(buildForYouPreset({ maxTravelDistanceKm: 5 }).isMeaningful).toBe(true);
  });
});

describe('isForYouPresetActive', () => {
  const preset = buildForYouPreset({
    playerRatingScoreId: 'rs-1',
    maxTravelDistanceKm: 5,
  });

  it('is active when the filters equal the preset exactly', () => {
    const filters = {
      ...DEFAULT_PUBLIC_MATCH_FILTERS,
      rating: ['rs-1'],
      spotsAvailable: 'any' as const,
    };
    expect(isForYouPresetActive(filters, preset)).toBe(true);
  });

  it('turns off when any preset dimension is hand-tweaked', () => {
    const base = {
      ...DEFAULT_PUBLIC_MATCH_FILTERS,
      rating: ['rs-1'],
      spotsAvailable: 'any' as const,
    };
    expect(isForYouPresetActive({ ...base, distance: 10 }, preset)).toBe(false);
    expect(isForYouPresetActive({ ...base, rating: [] }, preset)).toBe(false);
    expect(isForYouPresetActive({ ...base, rating: ['rs-1', 'rs-2'] }, preset)).toBe(false);
    expect(isForYouPresetActive({ ...base, spotsAvailable: 'all' }, preset)).toBe(false);
  });

  it('never activates a non-meaningful preset from overlapping manual filters', () => {
    const weakPreset = buildForYouPreset({});
    const filters = { ...DEFAULT_PUBLIC_MATCH_FILTERS, spotsAvailable: 'any' as const };
    expect(isForYouPresetActive(filters, weakPreset)).toBe(false);
  });
});

describe('matchesForYouLocation', () => {
  const inputs = { maxTravelDistanceKm: 10, favoriteFacilityIds: ['fac-1', 'fac-2'] };

  it('keeps matches within the travel range', () => {
    expect(matchesForYouLocation({ distance_meters: 9000, facility_id: 'fac-9' }, inputs)).toBe(
      true
    );
  });

  it('keeps matches at a favorite facility even beyond the travel range', () => {
    expect(matchesForYouLocation({ distance_meters: 25000, facility_id: 'fac-2' }, inputs)).toBe(
      true
    );
  });

  it('drops matches beyond the travel range at a non-favorite facility', () => {
    expect(matchesForYouLocation({ distance_meters: 25000, facility_id: 'fac-9' }, inputs)).toBe(
      false
    );
  });

  it('drops out-of-range matches with no facility (custom locations)', () => {
    expect(matchesForYouLocation({ distance_meters: 25000, facility_id: null }, inputs)).toBe(
      false
    );
  });

  it('is lenient on missing data', () => {
    expect(matchesForYouLocation({ distance_meters: null, facility_id: 'fac-9' }, inputs)).toBe(
      true
    );
    expect(
      matchesForYouLocation(
        { distance_meters: 25000, facility_id: 'fac-9' },
        { maxTravelDistanceKm: null }
      )
    ).toBe(true);
  });
});

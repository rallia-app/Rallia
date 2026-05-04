/**
 * Tests for deduplicateSuggestionsByTimeSlot
 *
 * Tests cover:
 * - No collisions: all suggestions survive
 * - Same day+hour collision: highest playerCompatibility wins
 * - Suggestions with no pickable slot are filtered out
 * - Multiple collisions across different hours
 * - Result order preserves score-based ranking
 */

import { deduplicateSuggestionsByTimeSlot } from './deduplicateSuggestions';
import { pickSlotForSuggestion } from './useUnifiedMatchFeed';
import type { MatchSuggestion, AvailableTimeSlot } from '@rallia/shared-services';

// Mock pickSlotForSuggestion so we control which slot each suggestion "picks"
jest.mock('./useUnifiedMatchFeed', () => ({
  pickSlotForSuggestion: jest.fn(),
}));

const mockPickSlot = pickSlotForSuggestion as jest.MockedFunction<typeof pickSlotForSuggestion>;

function makeSuggestion(opponentId: string, playerCompatibility: number): MatchSuggestion {
  return {
    opponentId,
    opponentFirstName: 'Player',
    opponentLastName: opponentId,
    opponentAvatar: null,
    opponentReputationScore: null,
    opponentReputationTier: 'unknown',
    opponentRatingScoreValue: null,
    opponentRatingLabel: null,
    opponentBadgeStatus: null,
    matchType: 'casual',
    matchDuration: '60',
    playerCompatibility,
    facilities: [],
    sharedAvailability: [],
  };
}

function makeSlot(dateStr: string, hour: number): AvailableTimeSlot {
  const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
  return {
    datetime: d,
    endDatetime: new Date(d.getTime() + 60 * 60 * 1000),
    courtCount: 1,
    bookingUrl: null,
  };
}

describe('deduplicateSuggestionsByTimeSlot', () => {
  const NOW = new Date('2025-05-03T10:00:00').getTime();

  beforeEach(() => {
    mockPickSlot.mockReset();
  });

  it('returns all suggestions when no day+hour collisions', () => {
    const s1 = makeSuggestion('alice', 0.9);
    const s2 = makeSuggestion('bob', 0.8);
    const s3 = makeSuggestion('charlie', 0.7);

    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 10), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 14), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-05', 10), facilityIndex: 1 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2, s3], NOW);

    expect(result).toHaveLength(3);
    expect(result[0].suggestion.opponentId).toBe('alice');
    expect(result[1].suggestion.opponentId).toBe('bob');
    expect(result[2].suggestion.opponentId).toBe('charlie');
  });

  it('keeps only the higher-scored suggestion when two collide on same day+hour', () => {
    const s1 = makeSuggestion('alice', 0.9);
    const s2 = makeSuggestion('bob', 0.7);

    // Both pick the same day+hour: May 4 at 15:00
    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 15), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 15), facilityIndex: 1 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2], NOW);

    expect(result).toHaveLength(1);
    expect(result[0].suggestion.opponentId).toBe('alice');
    expect(result[0].suggestion.playerCompatibility).toBe(0.9);
  });

  it('replaces a lower-scored suggestion if a higher one appears later for the same slot', () => {
    // Unusual case: suggestions not pre-sorted by score
    const s1 = makeSuggestion('alice', 0.5);
    const s2 = makeSuggestion('bob', 0.9);

    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 15), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 15), facilityIndex: 0 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2], NOW);

    expect(result).toHaveLength(1);
    expect(result[0].suggestion.opponentId).toBe('bob');
  });

  it('filters out suggestions where pickSlotForSuggestion returns null', () => {
    const s1 = makeSuggestion('alice', 0.9);
    const s2 = makeSuggestion('bob', 0.8);
    const s3 = makeSuggestion('charlie', 0.7);

    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 10), facilityIndex: 0 })
      .mockReturnValueOnce(null) // bob has no future slot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 14), facilityIndex: 0 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2, s3], NOW);

    expect(result).toHaveLength(2);
    expect(result[0].suggestion.opponentId).toBe('alice');
    expect(result[1].suggestion.opponentId).toBe('charlie');
  });

  it('handles multiple collisions across different hours correctly', () => {
    const s1 = makeSuggestion('alice', 0.95);
    const s2 = makeSuggestion('bob', 0.9);
    const s3 = makeSuggestion('charlie', 0.85);
    const s4 = makeSuggestion('dave', 0.8);

    // alice and charlie both at 10:00, bob and dave both at 14:00
    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 10), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 14), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 10), facilityIndex: 1 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 14), facilityIndex: 1 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2, s3, s4], NOW);

    expect(result).toHaveLength(2);
    // alice wins the 10:00 slot (0.95 > 0.85)
    expect(result[0].suggestion.opponentId).toBe('alice');
    // bob wins the 14:00 slot (0.90 > 0.80)
    expect(result[1].suggestion.opponentId).toBe('bob');
  });

  it('returns empty array for empty input', () => {
    const result = deduplicateSuggestionsByTimeSlot([], NOW);
    expect(result).toHaveLength(0);
  });

  it('preserves the pickedSlot and pickedFacilityIndex from the winning suggestion', () => {
    const s1 = makeSuggestion('alice', 0.9);

    const slot = makeSlot('2025-05-04', 11);
    mockPickSlot.mockReturnValueOnce({ slot, facilityIndex: 2 });

    const result = deduplicateSuggestionsByTimeSlot([s1], NOW);

    expect(result[0].pickedSlot).toBe(slot);
    expect(result[0].pickedFacilityIndex).toBe(2);
  });

  it('treats different days at the same hour as separate slots', () => {
    const s1 = makeSuggestion('alice', 0.9);
    const s2 = makeSuggestion('bob', 0.8);

    // Same hour (15), but different days
    mockPickSlot
      .mockReturnValueOnce({ slot: makeSlot('2025-05-04', 15), facilityIndex: 0 })
      .mockReturnValueOnce({ slot: makeSlot('2025-05-05', 15), facilityIndex: 0 });

    const result = deduplicateSuggestionsByTimeSlot([s1, s2], NOW);

    expect(result).toHaveLength(2);
  });
});

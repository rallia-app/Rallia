/**
 * Tests for buildActiveSportRatings — the per-sport rating selection used by
 * PlayerContext. The player's explicitly-active rating must win; sports with no
 * active choice fall back to the heuristic (first parsed row for that sport).
 */

import { buildActiveSportRatings, type ParsedSportRating } from './PlayerContext';

// Minimal PrimaryRating fixtures; only identity matters for these assertions.
const tennisA: ParsedSportRating = {
  sportId: 's-tennis',
  playerRatingScoreId: 'prs-A',
  primary: { value: 4.0, label: '4.0 (A)' },
};
const tennisB: ParsedSportRating = {
  sportId: 's-tennis',
  playerRatingScoreId: 'prs-B',
  primary: { value: 3.5, label: '3.5 (B)' },
};
const pickleC: ParsedSportRating = {
  sportId: 's-pickleball',
  playerRatingScoreId: 'prs-C',
  primary: { value: 4.5, label: 'DUPR 4.5' },
};

// Parsed list is ordered certified-then-most-recent, so tennisA precedes tennisB.
const parsed = [tennisA, tennisB, pickleC];

describe('buildActiveSportRatings', () => {
  it('picks the explicitly-active rating over the heuristic-first one', () => {
    const result = buildActiveSportRatings(parsed, { 's-tennis': 'prs-B' });
    expect(result['s-tennis']).toBe(tennisB.primary); // active wins, not the first
    expect(result['s-pickleball']).toBe(pickleC.primary); // fallback for the other sport
  });

  it('falls back to the heuristic-first rating when no active choice is set', () => {
    const result = buildActiveSportRatings(parsed, {});
    expect(result['s-tennis']).toBe(tennisA.primary);
    expect(result['s-pickleball']).toBe(pickleC.primary);
  });

  it('falls back when the active pointer is null', () => {
    const result = buildActiveSportRatings(parsed, { 's-tennis': null });
    expect(result['s-tennis']).toBe(tennisA.primary);
  });

  it('falls back when the active pointer references a rating not in the list', () => {
    const result = buildActiveSportRatings(parsed, { 's-tennis': 'prs-stale' });
    expect(result['s-tennis']).toBe(tennisA.primary);
  });

  it('returns exactly one rating per sport', () => {
    const result = buildActiveSportRatings(parsed, { 's-tennis': 'prs-B' });
    expect(Object.keys(result).sort()).toEqual(['s-pickleball', 's-tennis']);
  });

  it('handles an empty parsed list', () => {
    expect(buildActiveSportRatings([], { 's-tennis': 'prs-B' })).toEqual({});
  });
});

import { describe, it, expect } from '@jest/globals';

import { tournamentRankingHeadline, CHAMPION_BASE_POINTS } from './rankingPoints';

describe('tournamentRankingHeadline', () => {
  it('shows the firm value from the stamped multiplier once the bracket is set', () => {
    // 8-draw open → multiplier 1.0 → champion 500, not projected.
    expect(
      tournamentRankingHeadline({ ranking_multiplier: 1.0, ranking_points_ceiling: 500 })
    ).toEqual({ points: 500, projected: false });
    // Advanced 16-draw → 1.95 → round(500 × 1.95) = 975.
    expect(
      tournamentRankingHeadline({ ranking_multiplier: 1.95, ranking_points_ceiling: 999 })
    ).toEqual({ points: 975, projected: false });
  });

  it('prefers the stamped multiplier over the ceiling when both are present', () => {
    // Firm 0.5 (a 4-draw that filled) must win over a ceiling of 500 (its
    // capacity was 8) — the field is fixed, so the real value is truthful.
    expect(
      tournamentRankingHeadline({ ranking_multiplier: 0.5, ranking_points_ceiling: 500 })
    ).toEqual({ points: 250, projected: false });
  });

  it('falls back to the ceiling as a projection before the bracket exists', () => {
    expect(
      tournamentRankingHeadline({ ranking_multiplier: null, ranking_points_ceiling: 650 })
    ).toEqual({ points: 650, projected: true });
  });

  it('returns null when there is nothing worth showing', () => {
    expect(
      tournamentRankingHeadline({ ranking_multiplier: null, ranking_points_ceiling: null })
    ).toBeNull();
    expect(
      tournamentRankingHeadline({ ranking_multiplier: null, ranking_points_ceiling: 0 })
    ).toBeNull();
    // A stamped multiplier that rounds to zero points also surfaces nothing.
    expect(
      tournamentRankingHeadline({ ranking_multiplier: 0, ranking_points_ceiling: null })
    ).toBeNull();
  });

  it('rounds the firm value to a whole number', () => {
    // 500 × 1.155 = 577.5 → 578 (banker's rounding is not used).
    expect(
      tournamentRankingHeadline({ ranking_multiplier: 1.155, ranking_points_ceiling: null })?.points
    ).toBe(578);
  });

  it('pins the champion base to the server constant', () => {
    expect(CHAMPION_BASE_POINTS).toBe(500);
  });
});

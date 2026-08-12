import { describe, it, expect } from '@jest/globals';

import {
  tournamentRankingHeadline,
  tournamentPointsLadder,
  poolKnockoutDrawSize,
  CHAMPION_BASE_POINTS,
  PARTICIPATION_POINTS,
} from './rankingPoints';

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

describe('tournamentPointsLadder', () => {
  it('reproduces the award ladder for the live Série 1 draws', () => {
    // Verified against staging: the ×2.6 case is the worked example in
    // migration 20260717150000 (468/234/52 before dime rounding → 470/230/50).
    expect(
      tournamentPointsLadder({
        ranking_multiplier: null,
        ranking_points_ceiling: 1300,
        max_participants: 16,
      })?.rows
    ).toEqual([
      { placement: 'champion', points: 1300 },
      { placement: 'finalist', points: 780 },
      { placement: 'semifinal', points: 470 },
      { placement: 'quarterfinal', points: 230 },
      { placement: 'round_of_16', points: 130 },
      { placement: 'participated', points: 10 },
    ]);
    // Avancé (×3.2) and Débutant (×2.0), same draws on staging.
    expect(
      tournamentPointsLadder({
        ranking_multiplier: null,
        ranking_points_ceiling: 1600,
        max_participants: 16,
      })?.rows.map(r => r.points)
    ).toEqual([1600, 960, 580, 290, 160, 10]);
    expect(
      tournamentPointsLadder({
        ranking_multiplier: null,
        ranking_points_ceiling: 1000,
        max_participants: 16,
      })?.rows.map(r => r.points)
    ).toEqual([1000, 600, 360, 180, 100, 10]);
  });

  it('is the unscaled base ladder at multiplier 1.0', () => {
    expect(
      tournamentPointsLadder({
        ranking_multiplier: 1.0,
        ranking_points_ceiling: 500,
        max_participants: 8,
      })?.rows.map(r => r.points)
    ).toEqual([500, 300, 180, 90, 10]);
  });

  it('truncates the ladder to the bracket capacity', () => {
    // The award reads depth off the capacity, so a rung only exists if the
    // draw is deep enough to have that round. Advertising R16 on an 8-draw
    // would promise points no entrant can reach.
    const placements = (max_participants: number) =>
      tournamentPointsLadder({
        ranking_multiplier: 1.0,
        ranking_points_ceiling: null,
        max_participants,
      })?.rows.map(r => r.placement);

    expect(placements(4)).toEqual(['champion', 'finalist', 'semifinal', 'participated']);
    expect(placements(8)).not.toContain('round_of_16');
    expect(placements(16)).toContain('round_of_16');
    expect(placements(16)).not.toContain('round_of_32');
    expect(placements(32)).toContain('round_of_32');
    expect(placements(32)).not.toContain('round_of_64');
    expect(placements(64)).toContain('round_of_64');
    // 128 is the deepest legal draw: an R128 exit has zero real wins and lands
    // on the participation floor, so there is no rung below R64.
    expect(placements(128)).toEqual([
      'champion',
      'finalist',
      'semifinal',
      'quarterfinal',
      'round_of_16',
      'round_of_32',
      'round_of_64',
      'participated',
    ]);
  });

  it('recovers the multiplier exactly from the advertised ceiling', () => {
    const ladder = tournamentPointsLadder({
      ranking_multiplier: null,
      ranking_points_ceiling: 1300,
      max_participants: 16,
    });
    expect(ladder?.multiplier).toBe(2.6);
    expect(ladder?.projected).toBe(true);
  });

  it('prefers the stamped multiplier and reports a firm ladder', () => {
    const ladder = tournamentPointsLadder({
      ranking_multiplier: 2.0,
      ranking_points_ceiling: 1600,
      max_participants: 16,
    });
    expect(ladder?.projected).toBe(false);
    expect(ladder?.multiplier).toBe(2.0);
    expect(ladder?.rows[0]).toEqual({ placement: 'champion', points: 1000 });
  });

  it('omits the depth rungs on a double-elimination bracket', () => {
    // The award only resolves champion / finalist / participated there, so the
    // screen must not advertise any round-reached points.
    expect(
      tournamentPointsLadder({
        ranking_multiplier: 1.0,
        ranking_points_ceiling: 500,
        max_participants: 32,
        bracket_type: 'double_elimination',
      })?.rows.map(r => r.placement)
    ).toEqual(['champion', 'finalist', 'participated']);
  });

  it('returns null when the tournament awards nothing', () => {
    expect(
      tournamentPointsLadder({
        ranking_multiplier: null,
        ranking_points_ceiling: null,
        max_participants: 8,
      })
    ).toBeNull();
    expect(
      tournamentPointsLadder({
        ranking_multiplier: null,
        ranking_points_ceiling: 0,
        max_participants: 8,
      })
    ).toBeNull();
  });

  it('never scales participation, in either direction', () => {
    // The award pays a flat 10 for showing up whatever the category, so the
    // rung must not move with the multiplier. At ×10 the old scaled value
    // advertised 200 against an award of 10.
    const participation = (ranking_multiplier: number) =>
      tournamentPointsLadder({
        ranking_multiplier,
        ranking_points_ceiling: null,
        max_participants: 8,
      })?.rows.find(r => r.placement === 'participated')?.points;

    expect(participation(0.2)).toBe(PARTICIPATION_POINTS);
    expect(participation(1.0)).toBe(PARTICIPATION_POINTS);
    expect(participation(10)).toBe(PARTICIPATION_POINTS);
    expect(PARTICIPATION_POINTS).toBe(10);

    // The floor case still bottoms out above participation: a quarterfinal at
    // ×0.2 pays 20, so no win ever pays less than showing up.
    expect(
      tournamentPointsLadder({
        ranking_multiplier: 0.2,
        ranking_points_ceiling: null,
        max_participants: 8,
      })?.rows.map(r => r.points)
    ).toEqual([100, 60, 40, 20, 10]);
  });

  it('sizes a pool ladder off the qualifiers, not the field', () => {
    // 16 players, 4 pools of 4, 2 through: an 8-team tree whose first round is
    // the quarterfinal. A round of 16 is unreachable and must not be promised.
    const pool = (max_participants: number, qualifiers_per_pool = 2) =>
      tournamentPointsLadder({
        ranking_multiplier: 1.0,
        ranking_points_ceiling: null,
        max_participants,
        bracket_type: 'pool_knockout',
        pool_size: 4,
        qualifiers_per_pool,
      })?.rows.map(r => r.placement);

    expect(pool(16)).toEqual(['champion', 'finalist', 'semifinal', 'quarterfinal', 'participated']);
    // Same capacity as a single-elim 16-draw, which DOES reach the round of 16.
    expect(
      tournamentPointsLadder({
        ranking_multiplier: 1.0,
        ranking_points_ceiling: null,
        max_participants: 16,
      })?.rows.map(r => r.placement)
    ).toContain('round_of_16');

    // 24 and 32 both make a 16-team tree; 8 and 12 stop at the quarterfinal.
    expect(pool(24)).toContain('round_of_16');
    expect(pool(32)).toContain('round_of_16');
    expect(pool(32)).not.toContain('round_of_32');
    expect(pool(12)).not.toContain('round_of_16');
    expect(pool(8)).toEqual(['champion', 'finalist', 'semifinal', 'participated']);

    // One per pool halves the tree.
    expect(pool(16, 1)).toEqual(['champion', 'finalist', 'semifinal', 'participated']);
  });

  it('pins the pool draw sizes against _lt_compute_pool_assignment', () => {
    // ceil(n / pool_size), pulled back to floor(n / 3) when pools would be
    // smaller than three. Drift here silently mis-advertises a whole format.
    expect(poolKnockoutDrawSize(8, 4, 2)).toBe(4);
    expect(poolKnockoutDrawSize(12, 4, 2)).toBe(8);
    expect(poolKnockoutDrawSize(16, 4, 2)).toBe(8);
    expect(poolKnockoutDrawSize(20, 4, 2)).toBe(16);
    expect(poolKnockoutDrawSize(24, 4, 2)).toBe(16);
    expect(poolKnockoutDrawSize(32, 4, 2)).toBe(16);
    // pool_size 3 on an 8 field would give pools of 3/3/2, so it falls back to
    // two pools of four.
    expect(poolKnockoutDrawSize(8, 3, 2)).toBe(4);
    expect(poolKnockoutDrawSize(16, 5, 2)).toBe(8);
  });
});

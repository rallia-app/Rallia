import { describe, it, expect } from '@jest/globals';

import {
  byRankPairings,
  rankingCompare,
  rotateForRound,
  type RankedPlayer,
} from './byRankPairings';

// Build players whose rank order is a > b > c > ... by points.
function players(...specs: Array<[string, number]>): RankedPlayer[] {
  return specs.map(([userId, points], i) => ({ userId, points, tiebreakSeed: i }));
}

describe('rankingCompare', () => {
  it('orders by points desc, then tiebreakSeed asc, then userId', () => {
    const a = { userId: 'a', points: 10, tiebreakSeed: 5 };
    const b = { userId: 'b', points: 20, tiebreakSeed: 9 };
    const c = { userId: 'c', points: 10, tiebreakSeed: 1 };
    const sorted = [a, b, c].sort(rankingCompare).map(p => p.userId);
    expect(sorted).toEqual(['b', 'c', 'a']); // b (20) first; c beats a on lower seed
  });

  it('breaks exact ties deterministically by userId', () => {
    const x = { userId: 'z', points: 10, tiebreakSeed: 1 };
    const y = { userId: 'a', points: 10, tiebreakSeed: 1 };
    expect([x, y].sort(rankingCompare).map(p => p.userId)).toEqual(['a', 'z']);
  });
});

describe('byRankPairings — singles, single round', () => {
  it('pairs highest vs second-highest, etc. for an even roster', () => {
    const { matches, byes } = byRankPairings(players(['a', 40], ['b', 30], ['c', 20], ['d', 10]));
    expect(byes).toEqual([]);
    expect(matches).toEqual([
      { roundNumber: 1, teamAUserIds: ['a'], teamBUserIds: ['b'] },
      { roundNumber: 1, teamAUserIds: ['c'], teamBUserIds: ['d'] },
    ]);
  });

  it('byes the highest-ranked player on an odd roster; pairs the rest', () => {
    const { matches, byes } = byRankPairings(players(['a', 30], ['b', 20], ['c', 10]));
    expect(byes).toEqual([{ roundNumber: 1, userId: 'a' }]);
    expect(matches).toEqual([{ roundNumber: 1, teamAUserIds: ['b'], teamBUserIds: ['c'] }]);
  });

  it('sorts unsorted input before pairing', () => {
    const { matches } = byRankPairings(players(['c', 10], ['a', 40], ['d', 5], ['b', 30]));
    expect(matches).toEqual([
      { roundNumber: 1, teamAUserIds: ['a'], teamBUserIds: ['b'] },
      { roundNumber: 1, teamAUserIds: ['c'], teamBUserIds: ['d'] },
    ]);
  });

  it('every match is a 1v1 (never an empty team)', () => {
    for (const n of [2, 3, 4, 5, 8, 9]) {
      const specs = Array.from({ length: n }, (_, i) => [`p${i}`, n - i] as [string, number]);
      const { matches } = byRankPairings(players(...specs));
      for (const m of matches) {
        expect(m.teamAUserIds).toHaveLength(1);
        expect(m.teamBUserIds).toHaveLength(1);
      }
      // Exactly one bye iff odd.
      expect(byRankPairings(players(...specs)).byes).toHaveLength(n % 2);
    }
  });

  it('byes a lone player and pairs nothing; an empty roster yields nothing', () => {
    // Unreachable in practice (the RPC enforces confirmed >= 2) but consistent
    // with the odd-cardinality rule.
    expect(byRankPairings(players(['a', 10]))).toEqual({
      matches: [],
      byes: [{ roundNumber: 1, userId: 'a' }],
    });
    expect(byRankPairings([])).toEqual({ matches: [], byes: [] });
  });
});

describe('byRankPairings — multi-round rotation', () => {
  it('round-robins so each player meets every other across K-1 rounds', () => {
    const roster = players(['a', 40], ['b', 30], ['c', 20], ['d', 10]);
    const { matches } = byRankPairings(roster, { rounds: 3 });

    const opponents: Record<string, Set<string>> = {
      a: new Set(),
      b: new Set(),
      c: new Set(),
      d: new Set(),
    };
    for (const m of matches) {
      const [x] = m.teamAUserIds;
      const [y] = m.teamBUserIds;
      opponents[x].add(y);
      opponents[y].add(x);
    }
    // K=4 → after 3 rounds everyone has met the other three exactly once.
    expect(opponents.a).toEqual(new Set(['b', 'c', 'd']));
    expect(opponents.b).toEqual(new Set(['a', 'c', 'd']));
    expect(matches).toHaveLength(6); // 2 matches/round × 3 rounds
  });

  it('is deterministic for identical input', () => {
    const roster = players(['a', 40], ['b', 30], ['c', 20], ['d', 10], ['e', 5]);
    expect(byRankPairings(roster, { rounds: 2 })).toEqual(byRankPairings(roster, { rounds: 2 }));
  });
});

describe('rotateForRound', () => {
  it('keeps the head fixed and rotates the tail', () => {
    expect(rotateForRound([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
    expect(rotateForRound([1, 2, 3, 4], 2)).toEqual([1, 3, 4, 2]);
    expect(rotateForRound([1, 2, 3, 4], 3)).toEqual([1, 4, 2, 3]);
  });

  it('is a no-op for 0/1/2 element arrays', () => {
    expect(rotateForRound([1, 2], 2)).toEqual([1, 2]);
    expect(rotateForRound([1], 3)).toEqual([1]);
  });
});

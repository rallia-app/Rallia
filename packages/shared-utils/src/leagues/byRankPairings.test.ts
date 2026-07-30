import { describe, it, expect } from '@jest/globals';

import {
  byRankDoublesPairings,
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

  it('byes the lowest-standing player on an odd roster by default; pairs the rest', () => {
    const { matches, byes } = byRankPairings(players(['a', 30], ['b', 20], ['c', 10]));
    expect(byes).toEqual([{ roundNumber: 1, userId: 'c' }]);
    expect(matches).toEqual([{ roundNumber: 1, teamAUserIds: ['a'], teamBUserIds: ['b'] }]);
  });

  it('honours an explicit byeQueue (fewest byes this season first)', () => {
    const { matches, byes } = byRankPairings(players(['a', 30], ['b', 20], ['c', 10]), {
      byeQueue: ['b', 'c', 'a'],
    });
    expect(byes).toEqual([{ roundNumber: 1, userId: 'b' }]);
    expect(matches).toEqual([{ roundNumber: 1, teamAUserIds: ['a'], teamBUserIds: ['c'] }]);
  });

  it('ignores byeQueue entries who are not on the confirmed roster', () => {
    const { byes } = byRankPairings(players(['a', 30], ['b', 20], ['c', 10]), {
      byeQueue: ['ghost', 'b'],
    });
    expect(byes).toEqual([{ roundNumber: 1, userId: 'b' }]);
  });

  it('still records a bye when byeQueue is empty or entirely off-roster', () => {
    // The regression: an empty effective queue used to fall into the even-roster
    // path, silently dropping the third player from both matches and byes.
    for (const byeQueue of [[], ['ghost1', 'ghost2']]) {
      const { matches, byes } = byRankPairings(players(['a', 30], ['b', 20], ['c', 10]), {
        byeQueue,
      });
      expect(byes).toEqual([{ roundNumber: 1, userId: 'c' }]);
      expect(matches).toEqual([{ roundNumber: 1, teamAUserIds: ['a'], teamBUserIds: ['b'] }]);
    }
  });

  it('completes a partial byeQueue to the full roster so the bye still rotates', () => {
    // A one-entry queue used to cycle onto the same player every round —
    // the same starvation the queue exists to prevent.
    const { byes } = byRankPairings(
      players(['a', 50], ['b', 40], ['c', 30], ['d', 20], ['e', 10]),
      { rounds: 3, byeQueue: ['b'] }
    );
    expect(byes.map(b => b.userId)).toEqual(['b', 'e', 'd']);
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

  it('rotates the bye across rounds so nobody sits out the whole night', () => {
    // The regression: with the top seed pinned, one player used to bye in every
    // round of an odd-roster session and play nothing at all.
    const { matches, byes } = byRankPairings(
      players(['a', 50], ['b', 40], ['c', 30], ['d', 20], ['e', 10]),
      { rounds: 3 }
    );

    expect(byes).toHaveLength(3);
    expect(new Set(byes.map(b => b.userId)).size).toBe(3);

    const appearances = new Map<string, number>();
    for (const m of matches) {
      for (const id of [...m.teamAUserIds, ...m.teamBUserIds]) {
        appearances.set(id, (appearances.get(id) ?? 0) + 1);
      }
    }
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(appearances.get(id) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('doubles: teams by rank adjacency, matches by team strength', () => {
    const { matches, byes } = byRankDoublesPairings(
      players(
        ['a', 80],
        ['b', 70],
        ['c', 60],
        ['d', 50],
        ['e', 40],
        ['f', 30],
        ['g', 20],
        ['h', 10]
      )
    );
    expect(byes).toEqual([]);
    expect(matches).toEqual([
      { roundNumber: 1, teamAUserIds: ['a', 'b'], teamBUserIds: ['c', 'd'] },
      { roundNumber: 1, teamAUserIds: ['e', 'f'], teamBUserIds: ['g', 'h'] },
    ]);
  });

  it('doubles: a mutual pair stays together; one roster-invalid pair is ignored', () => {
    const { matches } = byRankDoublesPairings(
      players(
        ['a', 80],
        ['b', 70],
        ['c', 60],
        ['d', 50],
        ['e', 40],
        ['f', 30],
        ['g', 20],
        ['h', 10]
      ),
      {
        mutualPairs: [
          ['b', 'g'],
          ['ghost', 'a'],
        ],
      }
    );
    const together = matches.some(
      m =>
        (m.teamAUserIds.includes('b') && m.teamAUserIds.includes('g')) ||
        (m.teamBUserIds.includes('b') && m.teamBUserIds.includes('g'))
    );
    expect(together).toBe(true);
  });

  it('doubles: a 6-player 2-round night rotates disjoint benches so everyone plays', () => {
    const { matches, byes } = byRankDoublesPairings(
      players(['a', 60], ['b', 50], ['c', 40], ['d', 30], ['e', 20], ['f', 10]),
      { rounds: 2 }
    );
    expect(matches).toHaveLength(2); // one 2v2 per round
    expect(byes).toHaveLength(4); // two benched per round
    expect(new Set(byes.map(x => x.userId)).size).toBe(4); // benches don't repeat
    const played = new Set(matches.flatMap(m => [...m.teamAUserIds, ...m.teamBUserIds]));
    expect(played.size).toBe(6); // nobody sits the whole night
  });

  it('doubles: when everyone is pre-paired, a residue bench must split a pair', () => {
    // 6 players in 3 mutual pairs, residue 2: two players sit, their orphaned
    // partners team together, and the two intact pairs are undisturbed... but
    // with only paired players available, benching necessarily splits pairs.
    const { matches, byes } = byRankDoublesPairings(
      players(['a', 60], ['b', 50], ['c', 40], ['d', 30], ['e', 20], ['f', 10]),
      {
        mutualPairs: [
          ['a', 'b'],
          ['c', 'd'],
          ['e', 'f'],
        ],
      }
    );
    expect(byes).toHaveLength(2);
    expect(matches).toHaveLength(1);
    const onCourt = [...matches[0].teamAUserIds, ...matches[0].teamBUserIds];
    expect(onCourt).toHaveLength(4);
    // Benched + playing partitions the roster exactly.
    const all = new Set([...onCourt, ...byes.map(b => b.userId)]);
    expect(all.size).toBe(6);
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

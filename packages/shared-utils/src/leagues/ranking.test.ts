import { describe, it, expect } from '@jest/globals';

import {
  parseScore,
  outcomePoints,
  matchPoints,
  assignRanks,
  type RankingRules,
  type RankingRow,
} from './ranking';

const RULES: RankingRules = {
  pointWin: 10,
  pointLoss: 1,
  pointDraw: 5,
  pointNoShow: -5,
  pointBye: 1,
  pointRetirementWinner: 10,
  pointRetirementLoser: 1,
  pointWalkoverWinner: 10,
  pointWalkoverLoser: 0,
};

describe('outcomePoints', () => {
  it('awards win/loss/retirement/walkover/draw points', () => {
    expect(outcomePoints(RULES, 'completed', true)).toBe(10);
    expect(outcomePoints(RULES, 'completed', false)).toBe(1);
    expect(outcomePoints(RULES, 'retired', true)).toBe(10);
    expect(outcomePoints(RULES, 'retired', false)).toBe(1);
    expect(outcomePoints(RULES, 'walkover', true)).toBe(10);
    expect(outcomePoints(RULES, 'walkover', false)).toBe(0);
    expect(outcomePoints(RULES, 'draw', true)).toBe(5);
    expect(outcomePoints(RULES, 'draw', false)).toBe(5);
  });
});

describe('matchPoints', () => {
  it('is the result alone when the league does not count games', () => {
    expect(matchPoints(RULES, 'completed', true, 12)).toBe(10);
  });

  it('adds the games won on top of the result', () => {
    const rules: RankingRules = { ...RULES, pointPerGameWon: 1 };
    // 6-4 6-2: winner takes 12 games, loser 6.
    expect(matchPoints(rules, 'completed', true, 12)).toBe(22);
    expect(matchPoints(rules, 'completed', false, 6)).toBe(7);
  });

  it('separates a blowout from a grind, which is the point of the setting', () => {
    const rules: RankingRules = { ...RULES, pointPerGameWon: 1 };
    const blowout = matchPoints(rules, 'completed', true, parseScore('6-0 6-0').aGames);
    const grind = matchPoints(rules, 'completed', true, parseScore('7-6 6-7 7-6').aGames);
    expect(grind).toBeGreaterThan(blowout);
  });

  it('gives a walkover winner nothing extra, since no game was played', () => {
    const rules: RankingRules = { ...RULES, pointPerGameWon: 1 };
    expect(matchPoints(rules, 'walkover', true, parseScore(null).aGames)).toBe(10);
  });
});

describe('parseScore', () => {
  it('parses a straight-sets tennis score', () => {
    expect(parseScore('6-4 6-2')).toEqual({ aSets: 2, bSets: 0, aGames: 12, bGames: 6 });
  });

  it('parses a three-set tennis score with a tiebreak', () => {
    expect(parseScore('6-4, 4-6, 7-6(5)')).toEqual({
      aSets: 2,
      bSets: 1,
      aGames: 17,
      bGames: 16,
    });
  });

  it('parses a super-tiebreak final set in brackets', () => {
    expect(parseScore('6-4, 3-6, [10-7]')).toEqual({
      aSets: 2,
      bSets: 1,
      aGames: 19,
      bGames: 17,
    });
  });

  it('handles a retirement by counting only completed games', () => {
    expect(parseScore('6-4, 2-1 RET')).toEqual({ aSets: 1, bSets: 0, aGames: 8, bGames: 5 });
  });

  it('parses pickleball "to <target>" games', () => {
    expect(parseScore('11-8 to 11, 11-9 to 11')).toEqual({
      aSets: 2,
      bSets: 0,
      aGames: 22,
      bGames: 17,
    });
  });

  it('returns zeroes for empty / unparseable input', () => {
    expect(parseScore('')).toEqual({ aSets: 0, bSets: 0, aGames: 0, bGames: 0 });
    expect(parseScore(null)).toEqual({ aSets: 0, bSets: 0, aGames: 0, bGames: 0 });
    expect(parseScore('W/O')).toEqual({ aSets: 0, bSets: 0, aGames: 0, bGames: 0 });
    expect(parseScore('garbage')).toEqual({ aSets: 0, bSets: 0, aGames: 0, bGames: 0 });
  });

  it('stays linear on unbalanced parentheses', () => {
    const started = Date.now();
    expect(parseScore(`6-4 6-2 ${'('.repeat(50000)}`)).toEqual({
      aSets: 2,
      bSets: 0,
      aGames: 12,
      bGames: 6,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

function row(over: Partial<RankingRow>): RankingRow {
  return {
    points: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
    sessionsAttended: 0,
    sessionsEligible: 0,
    tiebreakSeed: 0,
    ...over,
  };
}

describe('rankingCompare / assignRanks', () => {
  it('ranks by points first', () => {
    const a = row({ points: 30, tiebreakSeed: 1 });
    const b = row({ points: 50, tiebreakSeed: 2 });
    expect(assignRanks([a, b]).map(r => r.row.points)).toEqual([50, 30]);
  });

  it('breaks point ties by set difference, then game difference', () => {
    const a = row({
      points: 20,
      setsWon: 4,
      setsLost: 2,
      gamesWon: 30,
      gamesLost: 25,
      tiebreakSeed: 1,
    });
    const b = row({
      points: 20,
      setsWon: 4,
      setsLost: 2,
      gamesWon: 40,
      gamesLost: 20,
      tiebreakSeed: 2,
    });
    const c = row({
      points: 20,
      setsWon: 5,
      setsLost: 1,
      gamesWon: 10,
      gamesLost: 9,
      tiebreakSeed: 3,
    });
    // c wins on set diff (+4); then b over a on game diff (+20 vs +5)
    expect(assignRanks([a, b, c]).map(r => r.row.tiebreakSeed)).toEqual([3, 2, 1]);
  });

  it('falls back to participation %, then deterministic seed', () => {
    const a = row({ points: 10, sessionsAttended: 5, sessionsEligible: 10, tiebreakSeed: 9 });
    const b = row({ points: 10, sessionsAttended: 8, sessionsEligible: 10, tiebreakSeed: 8 });
    expect(assignRanks([a, b]).map(r => r.row.tiebreakSeed)).toEqual([8, 9]); // b: 80% > a: 50%

    const c = row({ points: 10, sessionsAttended: 5, sessionsEligible: 10, tiebreakSeed: 2 });
    const d = row({ points: 10, sessionsAttended: 5, sessionsEligible: 10, tiebreakSeed: 7 });
    expect(assignRanks([d, c]).map(r => r.row.tiebreakSeed)).toEqual([2, 7]); // lower seed wins
  });

  it('produces dense 1-indexed ranks', () => {
    const ranked = assignRanks([row({ points: 5 }), row({ points: 9 }), row({ points: 1 })]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].row.points).toBe(9);
  });
});

import {
  firstSetFailingFormat,
  setTargetFor,
  setRulesFor,
  deriveWinningSideFromSets,
  canAddSet,
  hasClinched,
  serializeSets,
  validSetsOf,
  isScoreOutOfRange,
  type SetScore,
} from './scoreEntry';

const set = (a: number | null, b: number | null): SetScore => ({
  player1Score: a,
  player2Score: b,
});

describe('setRulesFor', () => {
  it('reads tennis formats as sets-to-win', () => {
    expect(setRulesFor('one_set')).toEqual({ maxSets: 1, setsToWin: 1 });
    expect(setRulesFor('two_of_three')).toEqual({ maxSets: 3, setsToWin: 2 });
    expect(setRulesFor('three_of_five')).toEqual({ maxSets: 5, setsToWin: 3 });
  });

  it('lets pickleball run best-of-3, which the old single-game cap forbade', () => {
    for (const f of ['pickleball_to_11', 'pickleball_to_15', 'pickleball_to_21'] as const) {
      expect(setRulesFor(f)).toEqual({ maxSets: 3, setsToWin: 2 });
    }
  });

  it('falls back to a loose cap when no format is declared', () => {
    expect(setRulesFor(undefined)).toEqual({ maxSets: 5, setsToWin: 6 });
    expect(setRulesFor(null)).toEqual({ maxSets: 5, setsToWin: 6 });
  });
});

describe('pickleball game entry', () => {
  const rules = setRulesFor('pickleball_to_11');

  it('offers a second game after the first, the case that used to be blocked', () => {
    expect(canAddSet([set(11, 7)], rules)).toBe(true);
  });

  it('offers a third game when the games are split', () => {
    expect(canAddSet([set(11, 7), set(8, 11)], rules)).toBe(true);
  });

  it('stops offering games once someone takes two', () => {
    expect(canAddSet([set(11, 7), set(11, 9)], rules)).toBe(false);
  });

  it('never exceeds the cap', () => {
    expect(canAddSet([set(11, 7), set(8, 11), set(11, 9)], rules)).toBe(false);
  });

  it('still accepts a single decided game, so one-game events keep working', () => {
    expect(deriveWinningSideFromSets(validSetsOf([set(11, 7)]))).toBe(1);
  });
});

describe('deriveWinningSideFromSets', () => {
  it('picks whoever took more sets', () => {
    expect(deriveWinningSideFromSets([set(6, 4), set(6, 3)])).toBe(1);
    expect(deriveWinningSideFromSets([set(4, 6), set(3, 6)])).toBe(2);
    expect(deriveWinningSideFromSets([set(6, 4), set(3, 6), set(7, 5)])).toBe(1);
  });

  it('returns null when nobody leads', () => {
    expect(deriveWinningSideFromSets([])).toBeNull();
    expect(deriveWinningSideFromSets([set(6, 4), set(4, 6)])).toBeNull();
  });

  it('ignores incomplete rows', () => {
    expect(deriveWinningSideFromSets([set(6, 4), set(6, null)])).toBe(1);
    expect(deriveWinningSideFromSets([set(null, null)])).toBeNull();
  });

  it('treats a tied set as won by neither', () => {
    expect(deriveWinningSideFromSets([set(6, 6)])).toBeNull();
  });
});

describe('hasClinched', () => {
  it('is true only once a side reaches the winning count', () => {
    expect(hasClinched([set(6, 4)], 2)).toBe(false);
    expect(hasClinched([set(6, 4), set(6, 3)], 2)).toBe(true);
    expect(hasClinched([set(6, 4), set(3, 6)], 2)).toBe(false);
  });
});

describe('serializeSets', () => {
  it('writes player 1 on the left and drops incomplete rows', () => {
    expect(serializeSets([set(6, 4), set(6, 3)])).toBe('6-4 6-3');
    expect(serializeSets([set(11, 7), set(9, 11), set(11, 6)])).toBe('11-7 9-11 11-6');
    expect(serializeSets([set(6, 4), set(null, null)])).toBe('6-4');
    expect(serializeSets([])).toBe('');
  });
});

describe('isScoreOutOfRange', () => {
  it('uses a per-sport ceiling and never flags an empty box', () => {
    expect(isScoreOutOfRange(8, false)).toBe(true);
    expect(isScoreOutOfRange(7, false)).toBe(false);
    expect(isScoreOutOfRange(26, true)).toBe(true);
    expect(isScoreOutOfRange(21, true)).toBe(false);
    expect(isScoreOutOfRange(null, false)).toBe(false);
  });
});

describe('firstSetFailingFormat', () => {
  it('rejects a tennis score in a pickleball draw, which is the reported case', () => {
    expect(firstSetFailingFormat([set(6, 4), set(6, 3)], 'pickleball_to_11')).toBe(1);
  });

  it('rejects a pickleball score in a tennis draw only when nobody reached 6', () => {
    expect(firstSetFailingFormat([set(4, 2)], 'two_of_three')).toBe(1);
    // 11-7 clears the tennis target, so it is odd but not impossible; the soft
    // out-of-range warning covers it rather than a hard block.
    expect(firstSetFailingFormat([set(11, 7)], 'two_of_three')).toBeNull();
  });

  it('accepts the legitimate edge scores an upper bound would have broken', () => {
    expect(firstSetFailingFormat([set(7, 5)], 'two_of_three')).toBeNull();
    expect(firstSetFailingFormat([set(7, 6)], 'two_of_three')).toBeNull();
    expect(firstSetFailingFormat([set(13, 11)], 'pickleball_to_11')).toBeNull();
    expect(firstSetFailingFormat([set(15, 13)], 'pickleball_to_15')).toBeNull();
  });

  it('points at the offending set, not just the first one', () => {
    expect(firstSetFailingFormat([set(11, 7), set(6, 4)], 'pickleball_to_11')).toBe(2);
  });

  it('ignores half-entered sets so it cannot fire mid-type', () => {
    expect(firstSetFailingFormat([set(1, null)], 'pickleball_to_11')).toBeNull();
    expect(firstSetFailingFormat([], 'pickleball_to_11')).toBeNull();
  });

  it('does not constrain a context with no declared format', () => {
    expect(firstSetFailingFormat([set(2, 1)], undefined)).toBeNull();
    expect(firstSetFailingFormat([set(2, 1)], null)).toBeNull();
  });

  it('exposes the target each format expects', () => {
    expect(setTargetFor('pickleball_to_21')).toBe(21);
    expect(setTargetFor('three_of_five')).toBe(6);
    expect(setTargetFor(undefined)).toBeNull();
  });
});

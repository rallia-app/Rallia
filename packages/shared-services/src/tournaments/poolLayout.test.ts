import { computePoolLayout } from './poolLayout';

/**
 * Every field size crossed with every pool size the format allows. The shapes
 * are not hand-written: they were read out of _lt_compute_pool_assignment on a
 * live database, so this table is the contract between the preview and the SQL.
 * If the distribution ever changes, these fail and the organizer-facing preview
 * gets corrected with it.
 *
 * Shape is [count, size] pairs, largest pools first.
 */
const FROM_SQL: Array<[field: number, pool: number, groups: Array<[number, number]>]> = [
  [8, 3, [[2, 4]]],
  [8, 4, [[2, 4]]],
  [8, 5, [[2, 4]]],
  [12, 3, [[4, 3]]],
  [12, 4, [[3, 4]]],
  [12, 5, [[3, 4]]],
  [
    16,
    3,
    [
      [1, 4],
      [4, 3],
    ],
  ],
  [16, 4, [[4, 4]]],
  [16, 5, [[4, 4]]],
  [
    20,
    3,
    [
      [2, 4],
      [4, 3],
    ],
  ],
  [20, 4, [[5, 4]]],
  [20, 5, [[4, 5]]],
  [24, 3, [[8, 3]]],
  [24, 4, [[6, 4]]],
  [
    24,
    5,
    [
      [4, 5],
      [1, 4],
    ],
  ],
  [
    32,
    3,
    [
      [2, 4],
      [8, 3],
    ],
  ],
  [32, 4, [[8, 4]]],
  [
    32,
    5,
    [
      [4, 5],
      [3, 4],
    ],
  ],
];

describe('computePoolLayout', () => {
  for (const [field, pool, groups] of FROM_SQL) {
    it(`matches the SQL distribution for ${field} players at pools of ${pool}`, () => {
      const layout = computePoolLayout(field, pool, 2);
      expect(layout).not.toBeNull();
      expect(layout!.groups.map(g => [g.count, g.size])).toEqual(groups);
      expect(layout!.pools).toBe(groups.reduce((n, [count]) => n + count, 0));
      // Every entry is accounted for.
      expect(groups.reduce((n, [count, size]) => n + count * size, 0)).toBe(field);
    });
  }

  it('reports the guarantee off the SMALLEST pool, not the requested size', () => {
    // 16 at pools of 3 splits [4,3,3,3,3]: the floor is 2 games, not 3.
    expect(computePoolLayout(16, 3, 2)!.guaranteedGames).toBe(2);
    // 20 at pools of 5 really is pools of 5, so 4 games. The old static hint
    // claimed 3 here, which is what made it worth computing.
    expect(computePoolLayout(20, 5, 2)!.guaranteedGames).toBe(4);
    expect(computePoolLayout(16, 4, 2)!.guaranteedGames).toBe(3);
  });

  it('sizes the knockout draw to the qualifier count', () => {
    // 4 pools, 2 through each → 8, an exact draw.
    expect(computePoolLayout(16, 4, 2)).toMatchObject({ qualifiers: 8, drawSize: 8 });
    // 3 pools, 2 through each → 6, so an 8-draw with two byes.
    expect(computePoolLayout(12, 4, 2)).toMatchObject({ qualifiers: 6, drawSize: 8 });
    // One per pool halves the field that advances.
    expect(computePoolLayout(16, 4, 1)).toMatchObject({ qualifiers: 4, drawSize: 4 });
    expect(computePoolLayout(32, 4, 2)).toMatchObject({ qualifiers: 16, drawSize: 16 });
  });

  it('refuses inputs the SQL would refuse', () => {
    expect(computePoolLayout(5, 4, 2)).toBeNull(); // under the 6-entry floor
    expect(computePoolLayout(16, 2, 2)).toBeNull(); // pools of 2 are not legal
    expect(computePoolLayout(16, 6, 2)).toBeNull(); // nor pools of 6
    expect(computePoolLayout(16.5, 4, 2)).toBeNull();
    expect(computePoolLayout(16, 4, 0)).toBeNull();
  });
});

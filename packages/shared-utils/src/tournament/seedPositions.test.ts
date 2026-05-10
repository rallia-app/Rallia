import { describe, it, expect } from '@jest/globals';

import { seedPositions, byeSeeds } from './seedPositions';

describe('seedPositions', () => {
  it('returns the canonical order for small brackets', () => {
    expect(seedPositions(2)).toEqual([1, 2]);
    expect(seedPositions(4)).toEqual([1, 4, 2, 3]);
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedPositions(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('returns a permutation of 1..size', () => {
    for (const size of [2, 4, 8, 16, 32, 64, 128]) {
      const positions = seedPositions(size);
      expect(positions).toHaveLength(size);
      const sorted = [...positions].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    }
  });

  it('places top seeds in opposite halves', () => {
    // seed 1 should always be in the top half, seed 2 in the bottom half
    for (const size of [4, 8, 16, 32]) {
      const positions = seedPositions(size);
      const seed1At = positions.indexOf(1);
      const seed2At = positions.indexOf(2);
      expect(seed1At).toBeLessThan(size / 2);
      expect(seed2At).toBeGreaterThanOrEqual(size / 2);
    }
  });

  it('throws on non-power-of-two sizes', () => {
    expect(() => seedPositions(3)).toThrow();
    expect(() => seedPositions(6)).toThrow();
    expect(() => seedPositions(10)).toThrow();
  });

  it('throws on size < 2 or non-integer', () => {
    expect(() => seedPositions(0)).toThrow();
    expect(() => seedPositions(1)).toThrow();
    expect(() => seedPositions(2.5)).toThrow();
  });
});

describe('byeSeeds', () => {
  it('returns the highest seeds when participants < size', () => {
    expect(byeSeeds(8, 6)).toEqual([7, 8]);
    expect(byeSeeds(8, 8)).toEqual([]);
    expect(byeSeeds(16, 12)).toEqual([13, 14, 15, 16]);
    expect(byeSeeds(4, 2)).toEqual([3, 4]);
  });

  it('throws when participants > size', () => {
    expect(() => byeSeeds(8, 9)).toThrow();
  });
});

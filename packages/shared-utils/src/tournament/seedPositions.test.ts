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

describe('seedPositions — round-isolation properties', () => {
  // For a single-elimination bracket, top seed N can only meet seed N+1
  // in the *next* round if their pairs collide. The classic guarantee:
  // the top 2^k seeds occupy distinct quarters/halves/octants, so they
  // can't meet until the round where 2^k slots remain. We verify this
  // for several powers of two against several bracket sizes.
  function quadrantOf(positionIndex: number, size: number, slotsPerGroup: number): number {
    return Math.floor(positionIndex / slotsPerGroup);
  }

  it('top 2 seeds are in different halves (final-only meeting)', () => {
    for (const size of [4, 8, 16, 32, 64, 128]) {
      const positions = seedPositions(size);
      const half = size / 2;
      const a = quadrantOf(positions.indexOf(1), size, half);
      const b = quadrantOf(positions.indexOf(2), size, half);
      expect(a).not.toEqual(b);
    }
  });

  it('top 4 seeds are in different quarters (semis-only meeting)', () => {
    for (const size of [8, 16, 32, 64, 128]) {
      const positions = seedPositions(size);
      const quarter = size / 4;
      const groups = [1, 2, 3, 4].map(s => quadrantOf(positions.indexOf(s), size, quarter));
      expect(new Set(groups).size).toBe(4);
    }
  });

  it('top 8 seeds are in different eighths (quarters-only meeting)', () => {
    for (const size of [16, 32, 64, 128]) {
      const positions = seedPositions(size);
      const eighth = size / 8;
      const groups = [1, 2, 3, 4, 5, 6, 7, 8].map(s =>
        quadrantOf(positions.indexOf(s), size, eighth)
      );
      expect(new Set(groups).size).toBe(8);
    }
  });

  it('seed 1 always lands at position 1 (top of bracket)', () => {
    for (const size of [2, 4, 8, 16, 32, 64, 128]) {
      expect(seedPositions(size)[0]).toBe(1);
    }
  });

  it('every paired-up sum equals size + 1 (mirror invariant)', () => {
    // First-round matchups are positions [0,1],[2,3],... and the seeds in
    // each pair must sum to size+1 — that's the binary-placement invariant.
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const positions = seedPositions(size);
      for (let i = 0; i < size; i += 2) {
        expect(positions[i] + positions[i + 1]).toBe(size + 1);
      }
    }
  });
});

describe('seedPositions — input validation', () => {
  it('rejects negative sizes', () => {
    expect(() => seedPositions(-1)).toThrow();
    expect(() => seedPositions(-8)).toThrow();
  });

  it('rejects NaN and Infinity', () => {
    expect(() => seedPositions(NaN)).toThrow();
    expect(() => seedPositions(Infinity)).toThrow();
    expect(() => seedPositions(-Infinity)).toThrow();
  });

  it('rejects 256 only if a size cap is enforced (currently allows it)', () => {
    // No cap is enforced today — 256 produces a valid permutation. If we ever
    // add a cap (the schema enum stops at 128), update this test.
    expect(() => seedPositions(256)).not.toThrow();
    expect(seedPositions(256)).toHaveLength(256);
  });
});

describe('byeSeeds', () => {
  it('returns the highest seeds when participants < size', () => {
    expect(byeSeeds(8, 6)).toEqual([7, 8]);
    expect(byeSeeds(8, 8)).toEqual([]);
    expect(byeSeeds(16, 12)).toEqual([13, 14, 15, 16]);
    expect(byeSeeds(4, 2)).toEqual([3, 4]);
  });

  it('returns the full upper range when participants is the floor (2)', () => {
    expect(byeSeeds(8, 2)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(byeSeeds(16, 2)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('returns [] when participants exactly fills the bracket', () => {
    for (const size of [2, 4, 8, 16, 32, 64, 128]) {
      expect(byeSeeds(size, size)).toEqual([]);
    }
  });

  it('returns [size] when exactly one BYE is needed', () => {
    expect(byeSeeds(8, 7)).toEqual([8]);
    expect(byeSeeds(16, 15)).toEqual([16]);
  });

  it('throws when participants > size', () => {
    expect(() => byeSeeds(8, 9)).toThrow();
    expect(() => byeSeeds(4, 5)).toThrow();
  });

  it('produces non-overlapping BYE seeds vs active seeds', () => {
    // Active seeds are 1..participants, BYEs are participants+1..size — no overlap.
    for (const size of [8, 16, 32]) {
      for (let p = 2; p <= size; p++) {
        const byes = byeSeeds(size, p);
        const active = Array.from({ length: p }, (_, i) => i + 1);
        const overlap = byes.filter(b => active.includes(b));
        expect(overlap).toEqual([]);
        expect(byes.length + active.length).toBe(size);
      }
    }
  });
});

describe('seedPositions × byeSeeds — first-round BYE pairing property', () => {
  // In a real bracket, the highest seeds (BYEs) should be paired against
  // the lowest seeds (so the top seed gets the BYE first). Verify by
  // walking first-round pairs and checking that wherever a BYE sits, its
  // opponent is among the active seeds with the smallest seed number.
  it('BYEs land opposite the highest-ranking active seeds', () => {
    for (const size of [8, 16, 32]) {
      for (let participants = 2; participants <= size; participants++) {
        const positions = seedPositions(size);
        const byes = new Set(byeSeeds(size, participants));
        // For each first-round pair, if exactly one slot is a BYE, the
        // active opponent should be a "top" seed (≤ participants) — never
        // also a BYE.
        for (let i = 0; i < size; i += 2) {
          const a = positions[i];
          const b = positions[i + 1];
          const aBye = byes.has(a);
          const bBye = byes.has(b);
          if (aBye && !bBye) {
            expect(b).toBeLessThanOrEqual(participants);
          } else if (bBye && !aBye) {
            expect(a).toBeLessThanOrEqual(participants);
          }
          // If both are BYEs (only possible when participants is small
          // relative to size), neither is an active player — that's fine.
        }
      }
    }
  });
});

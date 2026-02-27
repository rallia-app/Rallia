import { calculateCancellationPenalty } from './reputationPenalties';

describe('calculateCancellationPenalty', () => {
  // =========================================================================
  // A. No penalty (24h+)
  // =========================================================================
  describe('no penalty when 24h+ before match', () => {
    it.each([
      { hours: 24, role: 'creator' as const },
      { hours: 24, role: 'participant' as const },
      { hours: 48, role: 'creator' as const },
      { hours: 48, role: 'participant' as const },
    ])('returns 0 for $role at $hours hours', ({ hours, role }) => {
      expect(calculateCancellationPenalty(hours, role, { recentOffenses: 1 })).toBe(0);
    });
  });

  // =========================================================================
  // B. Bracket boundaries — creator (1 prior offense = 1.0× multiplier)
  // =========================================================================
  describe('bracket boundaries — creator role', () => {
    it.each([
      { hours: 23, expected: -10 },
      { hours: 12, expected: -20 },
      { hours: 11, expected: -20 },
      { hours: 6, expected: -35 },
      { hours: 5, expected: -35 },
      { hours: 2, expected: -45 },
      { hours: 1, expected: -45 },
      { hours: 0, expected: -45 },
      { hours: -1, expected: -45 },
    ])('returns $expected for creator at $hours hours', ({ hours, expected }) => {
      expect(calculateCancellationPenalty(hours, 'creator', { recentOffenses: 1 })).toBe(expected);
    });
  });

  // =========================================================================
  // C. Bracket boundaries — participant (1 prior offense = 1.0× multiplier)
  // =========================================================================
  describe('bracket boundaries — participant role', () => {
    it.each([
      { hours: 23, expected: -7 },
      { hours: 12, expected: -13 },
      { hours: 6, expected: -22 },
      { hours: 2, expected: -28 },
      { hours: 0, expected: -33 },
      { hours: -5, expected: -33 },
    ])('returns $expected for participant at $hours hours', ({ hours, expected }) => {
      expect(calculateCancellationPenalty(hours, 'participant', { recentOffenses: 1 })).toBe(
        expected
      );
    });
  });

  // =========================================================================
  // D. History multipliers (fixed at 2–6h bracket, creator = -35 base)
  // =========================================================================
  describe('history multipliers', () => {
    it.each([
      { offenses: 0, multiplier: '0.5×', expected: -17 },
      { offenses: 1, multiplier: '1.0×', expected: -35 },
      { offenses: 2, multiplier: '1.5×', expected: -49 },
      { offenses: 3, multiplier: '2.0×', expected: -49 },
      { offenses: 10, multiplier: '2.0× (cap)', expected: -49 },
    ])('applies $multiplier for $offenses offenses → $expected', ({ offenses, expected }) => {
      expect(calculateCancellationPenalty(5, 'creator', { recentOffenses: offenses })).toBe(
        expected
      );
    });
  });

  // =========================================================================
  // E. Spec examples
  // =========================================================================
  describe('spec examples', () => {
    it('first-time creator cancels 3h before → -17', () => {
      expect(calculateCancellationPenalty(3, 'creator', { recentOffenses: 0 })).toBe(-17);
    });

    it('3rd-offense participant leaves 1h before → -42', () => {
      expect(calculateCancellationPenalty(1, 'participant', { recentOffenses: 2 })).toBe(-42);
    });
  });

  // =========================================================================
  // F. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('exactly 24.0h → 0 (no penalty)', () => {
      expect(calculateCancellationPenalty(24.0, 'creator', { recentOffenses: 1 })).toBe(0);
    });

    it('very negative hours (-100) → after-start bracket', () => {
      expect(calculateCancellationPenalty(-100, 'creator', { recentOffenses: 1 })).toBe(-45);
      expect(calculateCancellationPenalty(-100, 'participant', { recentOffenses: 1 })).toBe(-33);
    });

    it('negative recentOffenses treated as first offense (0.5× leniency)', () => {
      // -1 offenses should match maxOffenses=0 entry → 0.5× multiplier
      const result = calculateCancellationPenalty(5, 'creator', { recentOffenses: -1 });
      expect(result).toBe(Math.round(-35 * 0.5)); // -17
    });

    it('fractional hours land in the correct bracket', () => {
      // 0.5h → 0–2h bracket
      expect(calculateCancellationPenalty(0.5, 'creator', { recentOffenses: 1 })).toBe(-45);
      // 3.5h → 2–6h bracket
      expect(calculateCancellationPenalty(3.5, 'creator', { recentOffenses: 1 })).toBe(-35);
      // 9h → 6–12h bracket
      expect(calculateCancellationPenalty(9, 'creator', { recentOffenses: 1 })).toBe(-20);
      // 18h → 12–24h bracket
      expect(calculateCancellationPenalty(18, 'creator', { recentOffenses: 1 })).toBe(-10);
    });

    it('boundary hours use the tighter bracket (<=)', () => {
      // hours=2 matches 0–2h bracket (maxHours=2, 2<=2), NOT 2–6h
      expect(calculateCancellationPenalty(2, 'creator', { recentOffenses: 1 })).toBe(-45);
      // hours=6 matches 2–6h bracket (maxHours=6, 6<=6), NOT 6–12h
      expect(calculateCancellationPenalty(6, 'creator', { recentOffenses: 1 })).toBe(-35);
      // hours=12 matches 6–12h bracket, NOT 12–24h
      expect(calculateCancellationPenalty(12, 'creator', { recentOffenses: 1 })).toBe(-20);
    });

    it('all penalties are negative or zero', () => {
      const roles: Array<'creator' | 'participant'> = ['creator', 'participant'];
      const hourValues = [-100, -1, 0, 0.5, 1, 2, 3.5, 5, 6, 9, 11, 12, 18, 23, 24, 48];
      const offenseValues = [0, 1, 2, 3, 10];

      for (const role of roles) {
        for (const hours of hourValues) {
          for (const offenses of offenseValues) {
            const result = calculateCancellationPenalty(hours, role, {
              recentOffenses: offenses,
            });
            expect(result).toBeLessThanOrEqual(0);
          }
        }
      }
    });
  });

  // =========================================================================
  // G. No-show cap enforcement (-49 maximum penalty)
  // =========================================================================
  describe('no-show cap enforcement', () => {
    it('never exceeds -49 even for worst-case creator scenario', () => {
      // Worst case: after start, 10 offenses, creator
      // base = -45, multiplier = 2.0 → raw = -90, capped to -49
      const result = calculateCancellationPenalty(-1, 'creator', { recentOffenses: 10 });
      expect(result).toBe(-49);
      expect(result).toBeGreaterThan(-50); // Must be less severe than no-show
    });

    it('never exceeds -49 even for worst-case participant scenario', () => {
      // Worst case: after start, 10 offenses, participant
      // base = -33, multiplier = 2.0 → raw = -66, capped to -49
      const result = calculateCancellationPenalty(-1, 'participant', { recentOffenses: 10 });
      expect(result).toBe(-49);
      expect(result).toBeGreaterThan(-50);
    });

    it('all penalty values are strictly greater than -50 (no-show)', () => {
      const roles: Array<'creator' | 'participant'> = ['creator', 'participant'];
      const hourValues = [-100, -1, 0, 1, 2, 5, 6, 11, 12, 23];
      const offenseValues = [0, 1, 2, 3, 5, 10, 100];

      for (const role of roles) {
        for (const hours of hourValues) {
          for (const offenses of offenseValues) {
            const result = calculateCancellationPenalty(hours, role, {
              recentOffenses: offenses,
            });
            expect(result).toBeGreaterThanOrEqual(-49);
          }
        }
      }
    });
  });

  // =========================================================================
  // H. Creator penalties always >= participant penalties (same bracket/offenses)
  // =========================================================================
  describe('creator vs participant penalty ordering', () => {
    it.each([
      { hours: 23, offenses: 1 },
      { hours: 12, offenses: 1 },
      { hours: 6, offenses: 1 },
      { hours: 2, offenses: 1 },
      { hours: 0, offenses: 1 },
      { hours: -5, offenses: 1 },
      { hours: 5, offenses: 0 },
      { hours: 5, offenses: 2 },
      { hours: 5, offenses: 3 },
    ])(
      'creator penalty is at least as harsh as participant at hours=$hours, offenses=$offenses',
      ({ hours, offenses }) => {
        const creatorPenalty = calculateCancellationPenalty(hours, 'creator', {
          recentOffenses: offenses,
        });
        const participantPenalty = calculateCancellationPenalty(hours, 'participant', {
          recentOffenses: offenses,
        });
        // Creator should be equal or more negative (harsher)
        expect(creatorPenalty).toBeLessThanOrEqual(participantPenalty);
      }
    );
  });

  // =========================================================================
  // I. Penalty monotonicity
  // =========================================================================
  describe('penalty monotonicity', () => {
    it('penalties get harsher (more negative) as hours decrease', () => {
      const hourSequence = [23, 11, 5, 1, 0, -1];

      for (const role of ['creator', 'participant'] as const) {
        let prevPenalty = 0;
        for (const hours of hourSequence) {
          const penalty = calculateCancellationPenalty(hours, role, { recentOffenses: 1 });
          expect(penalty).toBeLessThanOrEqual(prevPenalty);
          prevPenalty = penalty;
        }
      }
    });

    it('penalties get harsher (more negative) as offenses increase', () => {
      const offenseSequence = [0, 1, 2, 3];

      for (const role of ['creator', 'participant'] as const) {
        let prevPenalty = 0;
        for (const offenses of offenseSequence) {
          const penalty = calculateCancellationPenalty(5, role, { recentOffenses: offenses });
          expect(penalty).toBeLessThanOrEqual(prevPenalty);
          prevPenalty = penalty;
        }
      }
    });
  });

  // =========================================================================
  // J. History multiplier with participant brackets
  // =========================================================================
  describe('history multipliers — participant role', () => {
    it.each([
      // 2–6h bracket, participant base = -22
      { offenses: 0, expected: -11 }, // round(-22 * 0.5)
      { offenses: 1, expected: -22 }, // round(-22 * 1.0)
      { offenses: 2, expected: -33 }, // round(-22 * 1.5)
      { offenses: 3, expected: -44 }, // round(-22 * 2.0)
    ])('participant at 5h, $offenses offenses → $expected', ({ offenses, expected }) => {
      expect(calculateCancellationPenalty(5, 'participant', { recentOffenses: offenses })).toBe(
        expected
      );
    });

    it.each([
      // 0–2h bracket, participant base = -28
      { offenses: 0, expected: -14 }, // round(-28 * 0.5)
      { offenses: 1, expected: -28 }, // round(-28 * 1.0)
      { offenses: 2, expected: -42 }, // round(-28 * 1.5)
      { offenses: 3, expected: -49 }, // max(round(-28 * 2.0) = -56, -49) → -49
    ])('participant at 1h, $offenses offenses → $expected', ({ offenses, expected }) => {
      expect(calculateCancellationPenalty(1, 'participant', { recentOffenses: offenses })).toBe(
        expected
      );
    });

    it.each([
      // after-start bracket, participant base = -33
      { offenses: 0, expected: -16 }, // round(-33 * 0.5)
      { offenses: 1, expected: -33 }, // round(-33 * 1.0)
      { offenses: 2, expected: -49 }, // max(round(-33 * 1.5) = -50, -49) → -49
      { offenses: 3, expected: -49 }, // max(round(-33 * 2.0) = -66, -49) → -49
    ])('participant after start, $offenses offenses → $expected', ({ offenses, expected }) => {
      expect(calculateCancellationPenalty(-1, 'participant', { recentOffenses: offenses })).toBe(
        expected
      );
    });
  });
});

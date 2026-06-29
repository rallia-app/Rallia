import { describe, it, expect } from '@jest/globals';

import {
  computeServiceFeeCents,
  quoteRegistration,
  DEFAULT_SERVICE_FEE_PARAMS,
} from './serviceFee';

describe('computeServiceFeeCents (defaults 6% + $1.50, $20 cap)', () => {
  // The approved worked-example table — must stay in lockstep with the SQL.
  it.each([
    ['free $0', 0, 0],
    ['$0.50 rounds 3¢', 50, 153],
    ['$20', 2000, 270],
    ['$50', 5000, 450],
    ['$100', 10000, 750],
    ['$200', 20000, 1350],
    ['$307.50 just under cap', 30750, 1995],
    ['$308.33 cap exact', 30833, 2000],
    ['$400 capped', 40000, 2000],
    ['$1000 capped', 100000, 2000],
  ])('%s → %i¢ entry yields %i¢ fee', (_label, entry, expected) => {
    expect(computeServiceFeeCents(entry)).toBe(expected);
  });

  it('treats negative / garbage entry as free', () => {
    expect(computeServiceFeeCents(-100)).toBe(0);
    expect(computeServiceFeeCents(NaN)).toBe(0);
  });

  it('honors overridden params (3% + $0, $10 cap)', () => {
    const params = { pctBps: 300, flatCents: 0, capCents: 1000 };
    expect(computeServiceFeeCents(5000, params)).toBe(150); // 3% of $50
    expect(computeServiceFeeCents(50000, params)).toBe(1000); // capped at $10
  });

  it('cap first binds at $308.25 (half-up rounding pushes the fee to $20)', () => {
    // $308.24 → round(1849.44)=1849 +150 = $19.99; $308.25 → round(1849.5)=1850 +150 = $20.00.
    // This is the half-up rounding edge — SQL ROUND and JS Math.round must agree here.
    expect(computeServiceFeeCents(30824)).toBe(1999);
    expect(computeServiceFeeCents(30825)).toBe(DEFAULT_SERVICE_FEE_PARAMS.capCents);
  });
});

describe('quoteRegistration', () => {
  it('player_pays: fee on top, organizer gets full entry ($50 → $54.50 / $50)', () => {
    expect(quoteRegistration(5000, 'player_pays')).toEqual({
      entryCents: 5000,
      serviceFeeCents: 450,
      totalCents: 5450,
      organizerReceivesCents: 5000,
      feePayer: 'player_pays',
    });
  });

  it('organizer_absorbs: player pays entry, fee netted out ($50 → $50 / $45.50)', () => {
    expect(quoteRegistration(5000, 'organizer_absorbs')).toEqual({
      entryCents: 5000,
      serviceFeeCents: 450,
      totalCents: 5000,
      organizerReceivesCents: 4550,
      feePayer: 'organizer_absorbs',
    });
  });

  it('free event: no fee, no charge, in either mode', () => {
    for (const payer of ['player_pays', 'organizer_absorbs'] as const) {
      expect(quoteRegistration(0, payer)).toMatchObject({
        serviceFeeCents: 0,
        totalCents: 0,
        organizerReceivesCents: 0,
      });
    }
  });
});

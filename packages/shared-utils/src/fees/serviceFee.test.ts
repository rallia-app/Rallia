import { describe, it, expect } from '@jest/globals';

import {
  computeServiceFeeCents,
  computeFeeTaxCents,
  quoteRegistration,
  DEFAULT_SERVICE_FEE_PARAMS,
} from './serviceFee';

describe('computeServiceFeeCents (defaults 5% + $1.00, $20 cap)', () => {
  // The approved worked-example table — must stay in lockstep with the SQL.
  it.each([
    ['free $0', 0, 0],
    ['$0.50 rounds 3¢', 50, 103],
    ['$20', 2000, 200],
    ['$50', 5000, 350],
    ['$100', 10000, 600],
    ['$200', 20000, 1100],
    ['$379.89 just under cap', 37989, 1999],
    ['$379.90 cap exact', 37990, 2000],
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

  it('cap first binds at $379.90 (half-up rounding pushes the fee to $20)', () => {
    // $379.89 → round(1899.45)=1899 +100 = $19.99; $379.90 → round(1899.5)=1900 +100 = $20.00.
    // This is the half-up rounding edge — SQL ROUND and JS Math.round must agree here.
    expect(computeServiceFeeCents(37989)).toBe(1999);
    expect(computeServiceFeeCents(37990)).toBe(DEFAULT_SERVICE_FEE_PARAMS.capCents);
  });
});

describe('computeFeeTaxCents (GST+QST 14.975%)', () => {
  it.each([
    ['no fee', 0, 0],
    ['$1.53 fee', 153, 23],
    ['$4.50 fee', 450, 67],
    ['$7.50 fee', 750, 112],
    ['$20 cap fee', 2000, 300],
  ])('%s → %i¢ fee yields %i¢ tax', (_label, fee, expected) => {
    expect(computeFeeTaxCents(fee)).toBe(expected);
  });

  it('half-up rounding matches SQL ROUND (fee where tax lands on .5)', () => {
    // 1002 × 0.14975 = 150.0495 → 150; 1005 × 0.14975 = 150.499875 → 150; 1006 → 150.6485 → 151.
    expect(computeFeeTaxCents(1002)).toBe(150);
    expect(computeFeeTaxCents(1006)).toBe(151);
  });

  it('treats negative / garbage fee as zero', () => {
    expect(computeFeeTaxCents(-100)).toBe(0);
    expect(computeFeeTaxCents(NaN)).toBe(0);
  });
});

describe('quoteRegistration', () => {
  it('player_pays: fee + tax on top, organizer gets full entry ($50 → $54.02 / $50)', () => {
    expect(quoteRegistration(5000, 'player_pays')).toEqual({
      entryCents: 5000,
      serviceFeeCents: 350,
      feeTaxCents: 52,
      totalCents: 5402,
      organizerReceivesCents: 5000,
      feePayer: 'player_pays',
    });
  });

  it('organizer_absorbs: player pays entry, fee + tax netted out ($50 → $50 / $45.98)', () => {
    expect(quoteRegistration(5000, 'organizer_absorbs')).toEqual({
      entryCents: 5000,
      serviceFeeCents: 350,
      feeTaxCents: 52,
      totalCents: 5000,
      organizerReceivesCents: 4598,
      feePayer: 'organizer_absorbs',
    });
  });

  it('free event: no fee, no tax, no charge, in either mode', () => {
    for (const payer of ['player_pays', 'organizer_absorbs'] as const) {
      expect(quoteRegistration(0, payer)).toMatchObject({
        serviceFeeCents: 0,
        feeTaxCents: 0,
        totalCents: 0,
        organizerReceivesCents: 0,
      });
    }
  });
});

import { describe, it, expect } from '@jest/globals';

import {
  computeServiceFeeCents,
  computeFeeTaxCents,
  computeEntryTaxCents,
  entryChargedCents,
  quoteRegistration,
  DEFAULT_SERVICE_FEE_PARAMS,
} from './serviceFee';

describe('computeServiceFeeCents (defaults straight 5%, $20 cap)', () => {
  // The approved worked-example table — must stay in lockstep with the SQL.
  it.each([
    ['free $0', 0, 0],
    ['$0.50 rounds 3¢', 50, 3],
    ['$20', 2000, 100],
    ['$50', 5000, 250],
    ['$100', 10000, 500],
    ['$200', 20000, 1000],
    ['$399.89 just under cap', 39989, 1999],
    ['$399.90 cap exact', 39990, 2000],
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

  it('cap first binds at $399.90 (half-up rounding pushes the fee to $20)', () => {
    // $399.89 → round(1999.45) = $19.99; $399.90 → round(1999.5) = $20.00.
    // This is the half-up rounding edge — SQL ROUND and JS Math.round must agree here.
    expect(computeServiceFeeCents(39989)).toBe(1999);
    expect(computeServiceFeeCents(39990)).toBe(DEFAULT_SERVICE_FEE_PARAMS.capCents);
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
  it('player_pays: fee + tax on top, organizer gets full entry ($50 → $52.87 / $50)', () => {
    expect(quoteRegistration(5000, 'player_pays')).toEqual({
      entryCents: 5000,
      entryTaxCents: 0,
      serviceFeeCents: 250,
      feeTaxCents: 37,
      totalCents: 5287,
      organizerReceivesCents: 5000,
      feePayer: 'player_pays',
    });
  });

  it('organizer_absorbs: player pays entry, fee + tax netted out ($50 → $50 / $47.13)', () => {
    expect(quoteRegistration(5000, 'organizer_absorbs')).toEqual({
      entryCents: 5000,
      entryTaxCents: 0,
      serviceFeeCents: 250,
      feeTaxCents: 37,
      totalCents: 5000,
      organizerReceivesCents: 4713,
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

describe('computeEntryTaxCents (entry-side GST+QST)', () => {
  it('none never taxes, whatever the entry', () => {
    expect(computeEntryTaxCents(5000, 'none')).toBe(0);
    expect(computeEntryTaxCents(5000)).toBe(0); // the default
  });

  it('a free entry is never taxed', () => {
    expect(computeEntryTaxCents(0, 'included')).toBe(0);
    expect(computeEntryTaxCents(0, 'added')).toBe(0);
  });

  // Same worked examples as supabase/tests/lt_entry_tax_mode_test.sql.
  it.each([
    ['$15 added', 1500, 'added' as const, 225],
    ['$15 included', 1500, 'included' as const, 195],
    ['$50 added', 5000, 'added' as const, 749],
    ['$50 included', 5000, 'included' as const, 651],
  ])('%s → %i¢', (_label, entry, mode, expected) => {
    expect(computeEntryTaxCents(entry, mode)).toBe(expected);
  });

  // The property that keeps a tax-included price honest: multiplying the gross
  // by 14.975% would over-collect, so 'included' divides instead.
  it.each([1500, 5000, 2500, 12345])('included round-trips %i¢ exactly', entry => {
    const tax = computeEntryTaxCents(entry, 'included');
    expect(Math.round((entry - tax) * 1.14975)).toBe(entry);
  });
});

describe('entryChargedCents', () => {
  it('only added sits on top of the entry', () => {
    expect(entryChargedCents(5000, 0, 'none')).toBe(5000);
    expect(entryChargedCents(5000, 651, 'included')).toBe(5000);
    expect(entryChargedCents(5000, 749, 'added')).toBe(5749);
  });
});

describe('quoteRegistration with an entry tax', () => {
  it('included does not move a single total: only the split is new', () => {
    const none = quoteRegistration(5000, 'player_pays', DEFAULT_SERVICE_FEE_PARAMS, 'none');
    const included = quoteRegistration(5000, 'player_pays', DEFAULT_SERVICE_FEE_PARAMS, 'included');

    expect(included.totalCents).toBe(none.totalCents);
    expect(included.organizerReceivesCents).toBe(none.organizerReceivesCents);
    expect(included.entryCents).toBe(5000);
    expect(included.entryTaxCents).toBe(651);
  });

  it('added raises the charge and what settles to the organizer', () => {
    expect(quoteRegistration(5000, 'player_pays', DEFAULT_SERVICE_FEE_PARAMS, 'added')).toEqual({
      entryCents: 5000,
      entryTaxCents: 749,
      serviceFeeCents: 250,
      feeTaxCents: 37,
      totalCents: 6036,
      organizerReceivesCents: 5749,
      feePayer: 'player_pays',
    });
  });

  it('organizer_absorbs absorbs the fee, never the entry tax', () => {
    expect(
      quoteRegistration(5000, 'organizer_absorbs', DEFAULT_SERVICE_FEE_PARAMS, 'added')
    ).toMatchObject({
      entryTaxCents: 749,
      totalCents: 5749,
      organizerReceivesCents: 5749 - 250 - 37,
    });
  });
});

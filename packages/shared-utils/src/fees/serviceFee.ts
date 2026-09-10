/**
 * Service-fee math — TypeScript mirror of the authoritative SQL.
 *
 * The DB functions `compute_service_fee_cents` / `tournament_fee_quote` are the
 * source of truth and the server ALWAYS recomputes at charge time. This mirror
 * exists only so the client can show the player a price breakdown and the
 * organizer a live "players pay $X / you receive $Y" preview without a round
 * trip. Keep it in lockstep with supabase/migrations/*_lt_fee_core.sql.
 *
 * Rule: free events (entry ≤ 0) pay nothing; otherwise
 *   min(cap, round(entry * pctBps / 10000) + flat).
 * Defaults are a straight 5% (no flat add-on), capped at $20, but are resolved
 * per event → per organizer → global default, so callers pass the effective
 * params.
 */

export type FeePayer = 'player_pays' | 'organizer_absorbs';

/**
 * How GST/QST applies to the ENTRY (not the service fee).
 * - none:     third-party organizer, merchant of record, owns the entry tax.
 *             The default, and today's behaviour everywhere.
 * - included: the listed entry is the all-in price; tax is carved out of it,
 *             so the player is charged exactly what 'none' charges.
 * - added:    tax charged on top of the listed entry.
 */
export type EntryTaxMode = 'none' | 'included' | 'added';

export interface ServiceFeeParams {
  /** Percentage of entry, in basis points (500 = 5%). */
  pctBps: number;
  /** Flat add-on, in cents (100 = $1.00). */
  flatCents: number;
  /** Hard cap on the fee, in cents (2000 = $20). */
  capCents: number;
}

/** Platform-wide default when no organizer/event override is set. */
export const DEFAULT_SERVICE_FEE_PARAMS: ServiceFeeParams = {
  pctBps: 500,
  flatCents: 0,
  capCents: 2000,
};

/**
 * Service fee (cents) for an entry price under the given params.
 * Mirrors `compute_service_fee_cents`. Math.round matches Postgres ROUND for
 * non-negative cents (half away from zero).
 */
export const computeServiceFeeCents = (
  entryCents: number,
  params: ServiceFeeParams = DEFAULT_SERVICE_FEE_PARAMS
): number => {
  const entry = Math.max(0, Math.trunc(entryCents || 0));
  if (entry <= 0) return 0;
  const pctPart = Math.round((entry * params.pctBps) / 10000);
  return Math.min(params.capCents, pctPart + params.flatCents);
};

/** GST 5% + QST 9.975%, in hundredths of a bp (matches the SQL constant). */
export const FEE_TAX_RATE_NUM = 14975;
export const FEE_TAX_RATE_DEN = 100000;

/**
 * GST/QST (cents) on the service fee. Mirrors `compute_fee_tax_cents`:
 * QC-only 14.975% constant in v0, half-up.
 */
export const computeFeeTaxCents = (feeCents: number): number =>
  Math.round((Math.max(0, feeCents || 0) * FEE_TAX_RATE_NUM) / FEE_TAX_RATE_DEN);

/** Denominator for backing tax OUT of a tax-included price (100000 + 14975). */
export const ENTRY_TAX_INCLUSIVE_DEN = 114975;

/**
 * GST/QST (cents) on an entry fee. Mirrors `compute_entry_tax_cents`.
 * 'included' divides rather than multiplies, so that base + tax reconstructs
 * the listed price exactly; multiplying by 14.975% would over-collect.
 */
export const computeEntryTaxCents = (entryCents: number, mode: EntryTaxMode = 'none'): number => {
  const entry = Math.max(0, Math.trunc(entryCents || 0));
  if (entry <= 0 || mode === 'none') return 0;
  const den = mode === 'included' ? ENTRY_TAX_INCLUSIVE_DEN : FEE_TAX_RATE_DEN;
  return Math.round((entry * FEE_TAX_RATE_NUM) / den);
};

/**
 * Entry-side cents the player is charged, and therefore the refundable base.
 * Mirrors `lt_entry_charged_cents`: 'included' already holds the tax inside
 * the entry, only 'added' sits on top of it.
 */
export const entryChargedCents = (
  entryCents: number,
  entryTaxCents: number,
  mode: EntryTaxMode = 'none'
): number =>
  Math.max(0, Math.trunc(entryCents || 0)) +
  (mode === 'added' ? Math.max(0, Math.trunc(entryTaxCents || 0)) : 0);

export interface RegistrationQuote {
  /** The listed entry price, unchanged by the tax mode. */
  entryCents: number;
  /** GST/QST on the entry (0 unless the event sets a mode). */
  entryTaxCents: number;
  serviceFeeCents: number;
  /** GST/QST on the service fee (Rallia remits). */
  feeTaxCents: number;
  /** What the player is charged. */
  totalCents: number;
  /** What the organizer ultimately receives. */
  organizerReceivesCents: number;
  feePayer: FeePayer;
}

/**
 * All-in breakdown for a registration. Mirrors `tournament_fee_quote`:
 * - player_pays      → player charged entry + fee + fee tax, organizer gets entry.
 * - organizer_absorbs → player charged entry, organizer gets entry − fee − fee tax.
 *
 * Entry tax rides on top of that only in 'added' mode; 'included' is a pure
 * bookkeeping split that leaves every total identical to 'none'.
 */
export const quoteRegistration = (
  entryCents: number,
  feePayer: FeePayer = 'player_pays',
  params: ServiceFeeParams = DEFAULT_SERVICE_FEE_PARAMS,
  entryTaxMode: EntryTaxMode = 'none'
): RegistrationQuote => {
  const entry = Math.max(0, Math.trunc(entryCents || 0));
  const serviceFeeCents = computeServiceFeeCents(entry, params);
  const feeTaxCents = computeFeeTaxCents(serviceFeeCents);
  const entryTaxCents = computeEntryTaxCents(entry, entryTaxMode);
  const entryCharge = entryChargedCents(entry, entryTaxCents, entryTaxMode);

  if (feePayer === 'player_pays') {
    return {
      entryCents: entry,
      entryTaxCents,
      serviceFeeCents,
      feeTaxCents,
      totalCents: entryCharge + serviceFeeCents + feeTaxCents,
      organizerReceivesCents: entryCharge,
      feePayer,
    };
  }

  return {
    entryCents: entry,
    entryTaxCents,
    serviceFeeCents,
    feeTaxCents,
    totalCents: entryCharge,
    organizerReceivesCents: Math.max(entryCharge - serviceFeeCents - feeTaxCents, 0),
    feePayer,
  };
};

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
 * Defaults are 6% + $1.50, capped at $20, but are resolved per event →
 * per organizer → global default, so callers pass the effective params.
 */

export type FeePayer = 'player_pays' | 'organizer_absorbs';

export interface ServiceFeeParams {
  /** Percentage of entry, in basis points (600 = 6%). */
  pctBps: number;
  /** Flat add-on, in cents (150 = $1.50). */
  flatCents: number;
  /** Hard cap on the fee, in cents (2000 = $20). */
  capCents: number;
}

/** Platform-wide default when no organizer/event override is set. */
export const DEFAULT_SERVICE_FEE_PARAMS: ServiceFeeParams = {
  pctBps: 600,
  flatCents: 150,
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

export interface RegistrationQuote {
  entryCents: number;
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
 */
export const quoteRegistration = (
  entryCents: number,
  feePayer: FeePayer = 'player_pays',
  params: ServiceFeeParams = DEFAULT_SERVICE_FEE_PARAMS
): RegistrationQuote => {
  const entry = Math.max(0, Math.trunc(entryCents || 0));
  const serviceFeeCents = computeServiceFeeCents(entry, params);
  const feeTaxCents = computeFeeTaxCents(serviceFeeCents);

  if (feePayer === 'player_pays') {
    return {
      entryCents: entry,
      serviceFeeCents,
      feeTaxCents,
      totalCents: entry + serviceFeeCents + feeTaxCents,
      organizerReceivesCents: entry,
      feePayer,
    };
  }

  return {
    entryCents: entry,
    serviceFeeCents,
    feeTaxCents,
    totalCents: entry,
    organizerReceivesCents: Math.max(entry - serviceFeeCents - feeTaxCents, 0),
    feePayer,
  };
};

/**
 * Executes an entry refund for the v0 destination-charge model as two explicit
 * Stripe calls: a transfer reversal for the organizer's share, then the player
 * refund with `reverse_transfer: false`. See lt-refund-logic.ts for why a
 * single reverse_transfer:true refund short-changes the platform (proportional
 * reversal) and for how the amounts are derived.
 *
 * Order matters: the reversal runs first. If the refund then fails, a retry
 * re-reads Stripe state, sees the reversal is done, skips it, and re-attempts
 * only the refund — every partial failure converges. The opposite order would
 * strand a "refunded but never clawed back" state that nothing retries.
 *
 * Idempotency: both calls carry keys derived from the ledger payment id. The
 * refund key is suffixed `-v2` because the pre-fix code used `${prefix}-${id}`
 * with different params (reverse_transfer:true), and reusing a live key (<24h)
 * with new params is an idempotency_error. Keys expire after 24h; beyond that
 * the live-state guards above are what actually prevent double refunds.
 */

import type Stripe from 'stripe';

import { planEntryRefund } from './lt-refund-logic.ts';

export interface EntryRefundParams {
  /** lt_registration_payment.id — namespaces idempotency keys and metadata. */
  paymentId: string;
  paymentIntentId: string;
  /** Charge id from the ledger; resolved from the PaymentIntent when null. */
  chargeId: string | null;
  /** Entry cents owed back to the player (refund policy already applied). */
  refundableEntryCents: number;
  /** Metadata label: 'withdraw' | 'event_cancelled' | … */
  reason: string;
  /** Per-flow idempotency namespace, e.g. 'lt-refund' / 'lt-cancel-refund'. */
  idempotencyPrefix: string;
}

export interface EntryRefundResult {
  /** Refunded to the player by this call (0 if an earlier attempt already had). */
  refundedCents: number;
  /** Clawed back from the organizer by this call. */
  reversedCents: number;
}

export async function executeEntryRefund(
  stripe: Stripe,
  params: EntryRefundParams
): Promise<EntryRefundResult> {
  const charge = params.chargeId
    ? await stripe.charges.retrieve(params.chargeId)
    : await resolveChargeFromIntent(stripe, params.paymentIntentId);
  if (!charge) {
    throw new Error(`[lt-entry-refund] no charge found for PI ${params.paymentIntentId}`);
  }

  const transferId = typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;

  let transferAmountCents = 0;
  let transferReversedCents = 0;
  if (transferId) {
    const transfer = await stripe.transfers.retrieve(transferId);
    transferAmountCents = transfer.amount;
    transferReversedCents = transfer.amount_reversed;
  } else {
    // Every v0 charge is a destination charge, so this should be unreachable.
    // Refund the player anyway (their money comes first) and shout: the whole
    // refund is being funded from Rallia's balance with nothing clawed back.
    console.error(
      '[lt-entry-refund] CRITICAL: charge %s has no destination transfer; ' +
        'refunding %d cents entirely from the platform balance. payment_id=%s',
      charge.id,
      params.refundableEntryCents,
      params.paymentId
    );
  }

  const plan = planEntryRefund({
    refundableEntryCents: params.refundableEntryCents,
    transferAmountCents,
    transferReversedCents,
    chargeRefundedCents: charge.amount_refunded,
  });

  const metadata = {
    rallia_flow: 'lt_registration',
    paymentId: params.paymentId,
    reason: params.reason,
  };

  if (transferId && plan.reversalCents > 0) {
    await stripe.transfers.createReversal(
      transferId,
      { amount: plan.reversalCents, metadata },
      { idempotencyKey: `${params.idempotencyPrefix}-rev-${params.paymentId}` }
    );
  }

  if (plan.refundCents > 0) {
    await stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        amount: plan.refundCents,
        reverse_transfer: false,
        refund_application_fee: false,
        metadata,
      },
      { idempotencyKey: `${params.idempotencyPrefix}-v2-${params.paymentId}` }
    );
  }

  return { refundedCents: plan.refundCents, reversedCents: plan.reversalCents };
}

async function resolveChargeFromIntent(
  stripe: Stripe,
  paymentIntentId: string
): Promise<Stripe.Charge | null> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  return typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
}

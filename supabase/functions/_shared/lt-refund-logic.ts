/**
 * Entry-refund split for the v0 destination-charge model.
 *
 * A refund created with `reverse_transfer: true` reverses the destination
 * transfer PROPORTIONALLY to refund_amount / charge_amount
 * (https://docs.stripe.com/api/refunds/create), not by the refund amount. In
 * player_pays mode (charge = entry + fee + tax, transfer = entry) a full-entry
 * refund would reverse only entry × entry/(entry+fee+tax): the organizer keeps
 * the fee+tax share of the refund and Rallia's platform balance silently funds
 * the shortfall (~$3.72 on a $50 entry at current fees). So the refund and the
 * transfer reversal are issued as two explicit Stripe calls, and this function
 * decides the amount of each.
 *
 * Amounts are derived from live Stripe state (transfer.amount_reversed,
 * charge.amount_refunded) rather than assumed to be zero, so any interrupted
 * attempt converges on retry instead of double-moving money:
 *   - legacy proportional reversal already applied → reverse only the remainder
 *   - reversal done but refund failed → skip the reversal, retry the refund
 *   - both done but the ledger write failed → both no-op, retry the write
 *
 * organizer_absorbs mode: the transfer is entry − fee − tax and cannot cover a
 * full-entry reversal. Policy: reverse the whole remaining transfer and let the
 * platform fund the fee+tax gap — Rallia kept exactly that amount as its
 * application fee, so the net is ~zero (this was already the de facto behavior).
 */

export interface EntryRefundState {
  /** Entry cents owed back to the player (refund policy already applied). */
  refundableEntryCents: number;
  /** Amount of the destination transfer created at charge time. */
  transferAmountCents: number;
  /** Portion of that transfer already reversed by earlier attempts. */
  transferReversedCents: number;
  /** Amount already refunded on the charge by earlier attempts. */
  chargeRefundedCents: number;
}

export interface EntryRefundPlan {
  /** Reverse this much of the transfer now (0 = skip the call). */
  reversalCents: number;
  /** Refund this much to the player now (0 = skip the call). */
  refundCents: number;
}

export function planEntryRefund(state: EntryRefundState): EntryRefundPlan {
  const owed = Math.max(state.refundableEntryCents, 0);
  const remainingTransfer = Math.max(state.transferAmountCents - state.transferReversedCents, 0);
  const owedFromOrganizer = Math.max(owed - state.transferReversedCents, 0);
  return {
    reversalCents: Math.min(owedFromOrganizer, remainingTransfer),
    refundCents: Math.max(owed - Math.max(state.chargeRefundedCents, 0), 0),
  };
}

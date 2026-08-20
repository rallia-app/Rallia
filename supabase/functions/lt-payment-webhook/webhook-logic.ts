// Pure decision logic for lt-payment-webhook, extracted so it can be unit-tested
// without a database or a served function (see ../tests/lt-payment-webhook-test.ts).
// index.ts imports these, so the tested logic IS the shipped logic.
//
// Every subtle bug this webhook has had lived in these decisions: promoting a
// ledger row we'd already given up on, or returning early before the slot was
// finalized/released. Keeping them as data-in/data-out functions makes each
// case explicit and provable.

export type LedgerStatus =
  | 'pending'
  | 'succeeded'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'cancelled';

// What to do with a payment_intent.succeeded event, given the ledger row's
// current status.
//   orphan   — the row is terminal (failed/cancelled): the reaper released the
//              slot or a newer attempt superseded this one, so the player paid
//              for a slot that's gone. Record the charge for traceability, but
//              never promote it (that would make it a payout candidate against a
//              withdrawn registration).
//   ignore   — already refunded: do nothing, and never re-seat the payer.
//   promote  — pending: mark the ledger succeeded, then finalize the slot.
//   finalize — already succeeded (a re-delivery whose first attempt may have
//              died before finalizing): re-attempt the finalize only.
export type SucceededDecision = 'orphan' | 'ignore' | 'promote' | 'finalize';

export function classifySucceeded(status: LedgerStatus): SucceededDecision {
  switch (status) {
    case 'failed':
    case 'cancelled':
      return 'orphan';
    case 'refunded':
    case 'partially_refunded':
      return 'ignore';
    case 'pending':
      return 'promote';
    case 'succeeded':
      return 'finalize';
  }
}

// Whether the finalize (flip the reserved slot to registered/enrolled) should
// run for a given succeeded decision.
export function shouldFinalize(decision: SucceededDecision): boolean {
  return decision === 'promote' || decision === 'finalize';
}

// What to do with a terminal event (payment_failed / canceled).
//   writeLedger — set the ledger to the terminal status. Skipped when it's
//                 already there (a re-delivery) so it stays a compare-and-set.
//   releaseSlot — free the reserved slot. Must run even on a re-delivery: a
//                 delivery that died between the ledger write and the release
//                 left the slot reserved forever, and the reaper can't recover a
//                 terminal row (it only scans 'pending').
//
// `hasLiveSibling` is the guard that stops a terminal event for an ABANDONED
// attempt from evicting the player's CURRENT one. The slot is shared: a retry
// reuses the same tournament_registrations / season_members row, so releasing it
// on behalf of a superseded ledger row throws away a reservation that a newer,
// live payment is relying on.
//
// This is what stranded the Serie 2 payers. Retrying checkout makes
// lt-create-registration-payment cancel the previous PaymentIntent at Stripe;
// the resulting payment_intent.canceled resolved to the OLD ledger row and
// released the shared slot about a second after the new attempt reserved it.
// The new payment then succeeded, and its finalize silently matched no rows
// because the registration was already 'withdrawn'. Card charged, no seat.
export interface TerminalDecision {
  writeLedger: boolean;
  releaseSlot: boolean;
}

export function classifyTerminal(
  status: LedgerStatus,
  target: 'failed' | 'cancelled',
  hasLiveSibling: boolean
): TerminalDecision {
  // A payment that already succeeded (or was refunded) is never downgraded by a
  // late failure on a retried intent.
  if (status === 'succeeded' || status === 'refunded' || status === 'partially_refunded') {
    return { writeLedger: false, releaseSlot: false };
  }
  // Record the terminal status either way, but the slot belongs to the live
  // attempt, not to this dead one.
  return { writeLedger: status !== target, releaseSlot: !hasLiveSibling };
}

// Pure decision logic for lt-reap-stale-registration-payments, extracted so it
// can be unit-tested without Stripe or a database (see
// ../tests/lt-reap-stale-registration-payments-test.ts). index.ts imports these,
// so the tested logic IS the shipped logic.
//
// The bug this exists to prevent: the old SQL reaper released a reserved slot
// purely because the ledger row was still 'pending' past its TTL. But 'pending'
// is ALSO the state of "player paid, webhook hasn't landed yet" — the reaper
// could not tell an abandoned checkout from a live payment, and it never told
// Stripe, so the intent stayed confirmable after the slot was gone. Players got
// charged for a seat that had already been released.
//
// The fix is to ask Stripe what the intent is actually doing, and to make the
// release conditional on first killing the intent at Stripe.

export type PiStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'canceled';

// What the reaper should do with an expired 'pending' ledger row.
//   cancel_and_release — nothing is in flight. Cancel the intent at Stripe
//                        FIRST (so it can never be confirmed later), then
//                        cancel the ledger row and free the slot.
//   wait               — money is in flight (processing, or an uncaptured
//                        authorization). Leave the reservation standing and
//                        push the TTL out; the webhook will finalize it, and
//                        we re-check on the next pass if it doesn't.
//   finalize           — the player already paid and we missed it. Promote the
//                        ledger to succeeded and seat them. This is what turns
//                        the reaper into a self-heal for a dropped webhook
//                        instead of the thing that strands the payer.
export type ReapAction = 'cancel_and_release' | 'wait' | 'finalize';

export function classifyIntent(status: PiStatus): ReapAction {
  switch (status) {
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'cancel_and_release';
    // Already dead at Stripe; the slot is the only thing left to free.
    case 'canceled':
      return 'cancel_and_release';
    case 'processing':
      return 'wait';
    // We never create manual-capture intents, but an authorization outstanding
    // is money the player has committed. Never release a slot out from under it.
    case 'requires_capture':
      return 'wait';
    case 'succeeded':
      return 'finalize';
  }
}

// A ledger row that never got as far as a PaymentIntent can be released with no
// Stripe round-trip: there is nothing that could have charged the player.
export function classifyRow(paymentIntentId: string | null): ReapAction | 'no_intent' {
  return paymentIntentId ? 'no_intent' : 'cancel_and_release';
}

// How far to push expires_at when an intent is still in flight. Long enough that
// a 'processing' ACH/pre-authorized-debit style method isn't re-polled every
// 5 minutes, short enough that a genuinely stuck row comes back for review.
export const WAIT_EXTENSION_MINUTES = 60;

// Stripe refuses to cancel an intent that has moved on (most importantly one
// that succeeded in the gap between our retrieve and our cancel). That refusal
// is the race being caught, not an error: re-read the intent and act on the new
// status rather than releasing the slot.
export function isNotCancellableError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const type = (e as { type?: string })?.type;
  return code === 'payment_intent_unexpected_state' || type === 'StripeInvalidRequestError';
}

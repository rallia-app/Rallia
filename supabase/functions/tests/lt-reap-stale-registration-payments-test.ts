import { assertEquals } from 'jsr:@std/assert';

import {
  classifyIntent,
  classifyRow,
  isNotCancellableError,
  type PiStatus,
} from '../lt-reap-stale-registration-payments/reap-logic.ts';

const ALL_STATUSES: PiStatus[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
  'processing',
  'succeeded',
  'canceled',
];

// =============================================================================
// classifyIntent — never release a slot while money can still move
// =============================================================================

Deno.test('an untouched intent is safe to cancel and release', () => {
  assertEquals(classifyIntent('requires_payment_method'), 'cancel_and_release');
  assertEquals(classifyIntent('requires_confirmation'), 'cancel_and_release');
});

Deno.test('requires_action is released (player never finished 3DS)', () => {
  // Safe only because index.ts cancels the intent at Stripe first: once voided
  // the player cannot complete the challenge and be charged for a freed slot.
  assertEquals(classifyIntent('requires_action'), 'cancel_and_release');
});

Deno.test('processing is NEVER released', () => {
  // The old SQL reaper released this state blind: the player's money was in
  // flight, the slot went away, and the succeeded webhook could only log an
  // orphan. Waiting is the entire point of this function.
  assertEquals(classifyIntent('processing'), 'wait');
});

Deno.test('requires_capture waits (an authorization is committed money)', () => {
  assertEquals(classifyIntent('requires_capture'), 'wait');
});

Deno.test('succeeded self-heals instead of stranding the payer', () => {
  // Reaching the reaper in this state means the webhook never landed. Seating
  // them here is what stops a dropped delivery from becoming a support ticket.
  assertEquals(classifyIntent('succeeded'), 'finalize');
});

Deno.test('canceled just frees the slot', () => {
  assertEquals(classifyIntent('canceled'), 'cancel_and_release');
});

Deno.test('no intent status ever silently falls through', () => {
  for (const s of ALL_STATUSES) {
    const action = classifyIntent(s);
    assertEquals(
      ['cancel_and_release', 'wait', 'finalize'].includes(action),
      true,
      `unhandled status: ${s}`
    );
  }
});

Deno.test('no PiStatus that holds money is ever released', () => {
  // Property form of the invariant: if money can still move, the slot stays.
  const holdsMoney: PiStatus[] = ['processing', 'requires_capture', 'succeeded'];
  for (const s of holdsMoney) {
    assertEquals(classifyIntent(s) === 'cancel_and_release', false, `released ${s}`);
  }
});

// =============================================================================
// classifyRow — rows that never reached Stripe
// =============================================================================

Deno.test('a row with no intent is released without a Stripe call', () => {
  assertEquals(classifyRow(null), 'cancel_and_release');
});

Deno.test('a row with an intent must ask Stripe', () => {
  assertEquals(classifyRow('pi_123'), 'no_intent');
});

// =============================================================================
// isNotCancellableError — the retrieve/cancel race
// =============================================================================

Deno.test('payment_intent_unexpected_state is recognised as the race', () => {
  assertEquals(isNotCancellableError({ code: 'payment_intent_unexpected_state' }), true);
});

Deno.test('a StripeInvalidRequestError is treated as the race', () => {
  assertEquals(isNotCancellableError({ type: 'StripeInvalidRequestError' }), true);
});

Deno.test('an unrelated failure is not swallowed as the race', () => {
  // Must rethrow: a network blip is not permission to release the slot.
  assertEquals(isNotCancellableError({ type: 'StripeConnectionError' }), false);
  assertEquals(isNotCancellableError(new Error('boom')), false);
});

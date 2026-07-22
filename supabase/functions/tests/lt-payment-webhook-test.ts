import { assertEquals } from 'jsr:@std/assert';

import {
  classifySucceeded,
  classifyTerminal,
  shouldFinalize,
  type LedgerStatus,
} from '../lt-payment-webhook/webhook-logic.ts';

const ALL_STATUSES: LedgerStatus[] = [
  'pending',
  'succeeded',
  'refunded',
  'partially_refunded',
  'failed',
  'cancelled',
];

// =============================================================================
// classifySucceeded — what a payment_intent.succeeded event does per status
// =============================================================================

Deno.test('succeeded on pending → promote (mark ledger + finalize slot)', () => {
  assertEquals(classifySucceeded('pending'), 'promote');
  assertEquals(shouldFinalize('promote'), true);
});

Deno.test('succeeded on succeeded → finalize only (redelivery re-attempts the flip)', () => {
  // The bug this guards: an early return here left the player payment_pending
  // forever when the first delivery died after marking the ledger succeeded.
  assertEquals(classifySucceeded('succeeded'), 'finalize');
  assertEquals(shouldFinalize('finalize'), true);
});

Deno.test('succeeded on failed/cancelled → orphan, never promoted', () => {
  // The reaper released the slot or a newer attempt superseded this one. Promoting
  // would pay the organizer for a withdrawn registration.
  for (const s of ['failed', 'cancelled'] as LedgerStatus[]) {
    assertEquals(classifySucceeded(s), 'orphan');
    assertEquals(shouldFinalize(classifySucceeded(s)), false);
  }
});

Deno.test('succeeded on refunded/partially_refunded → ignore, payer not re-seated', () => {
  for (const s of ['refunded', 'partially_refunded'] as LedgerStatus[]) {
    assertEquals(classifySucceeded(s), 'ignore');
    assertEquals(shouldFinalize(classifySucceeded(s)), false);
  }
});

Deno.test('only pending is ever promoted; only terminal/refunded skip finalize', () => {
  const promoted = ALL_STATUSES.filter(s => classifySucceeded(s) === 'promote');
  assertEquals(promoted, ['pending']);
  const finalizes = ALL_STATUSES.filter(s => shouldFinalize(classifySucceeded(s)));
  assertEquals(finalizes.sort(), ['pending', 'succeeded']);
});

// =============================================================================
// classifyTerminal — what a payment_failed / canceled event does per status
// =============================================================================

Deno.test('terminal on pending → write ledger + release slot', () => {
  assertEquals(classifyTerminal('pending', 'failed'), { writeLedger: true, releaseSlot: true });
  assertEquals(classifyTerminal('pending', 'cancelled'), { writeLedger: true, releaseSlot: true });
});

Deno.test('terminal on the same status → skip ledger, still release the slot', () => {
  // Re-delivery of the same failure: the ledger is already there, but the slot
  // release must still run (the bug was returning early and leaking the slot).
  assertEquals(classifyTerminal('failed', 'failed'), { writeLedger: false, releaseSlot: true });
  assertEquals(classifyTerminal('cancelled', 'cancelled'), {
    writeLedger: false,
    releaseSlot: true,
  });
});

Deno.test('terminal on the other terminal status → rewrite + release', () => {
  assertEquals(classifyTerminal('cancelled', 'failed'), { writeLedger: true, releaseSlot: true });
  assertEquals(classifyTerminal('failed', 'cancelled'), { writeLedger: true, releaseSlot: true });
});

Deno.test('terminal on succeeded/refunded → no-op (never downgrade a paid row)', () => {
  for (const s of ['succeeded', 'refunded', 'partially_refunded'] as LedgerStatus[]) {
    assertEquals(classifyTerminal(s, 'failed'), { writeLedger: false, releaseSlot: false });
    assertEquals(classifyTerminal(s, 'cancelled'), { writeLedger: false, releaseSlot: false });
  }
});

Deno.test('terminal always releases the slot unless the row is already paid', () => {
  const paid: LedgerStatus[] = ['succeeded', 'refunded', 'partially_refunded'];
  for (const s of ALL_STATUSES) {
    const expectRelease = !paid.includes(s);
    assertEquals(classifyTerminal(s, 'failed').releaseSlot, expectRelease, `status=${s}`);
  }
});

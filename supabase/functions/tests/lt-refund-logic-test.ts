import { assertEquals } from 'jsr:@std/assert';

import { planEntryRefund } from '../_shared/lt-refund-logic.ts';

// Running example at current fees (straight 5%, cap $20; 14.975% GST/QST on
// the fee): $50.00 entry → $2.50 fee, $0.37 tax.
const ENTRY = 5000;
const FEE = 250;
const TAX = 37;

// =============================================================================
// player_pays — charge = entry + fee + tax, transfer = entry
// =============================================================================

Deno.test('player_pays full refund: reverse exactly the entry, refund exactly the entry', () => {
  // The bug this replaces: reverse_transfer:true reversed only
  // entry × entry/(entry+fee+tax) ≈ $47.29, leaving the organizer ~$2.71 and
  // Rallia funding the gap. The explicit split reverses the full $50.00.
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: ENTRY,
      transferReversedCents: 0,
      chargeRefundedCents: 0,
    }),
    { reversalCents: ENTRY, refundCents: ENTRY }
  );
});

Deno.test('player_pays partial policy (50%): both legs at the refundable amount', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY / 2,
      transferAmountCents: ENTRY,
      transferReversedCents: 0,
      chargeRefundedCents: 0,
    }),
    { reversalCents: ENTRY / 2, refundCents: ENTRY / 2 }
  );
});

// =============================================================================
// organizer_absorbs — charge = entry, transfer = entry − fee − tax
// =============================================================================

Deno.test(
  'organizer_absorbs full refund: reverse the whole transfer, platform funds the gap',
  () => {
    // The transfer can't cover a full-entry reversal. Policy: claw back all of it
    // and let the platform fund fee+tax — which Rallia kept as its application
    // fee, so the net is ~zero.
    assertEquals(
      planEntryRefund({
        refundableEntryCents: ENTRY,
        transferAmountCents: ENTRY - FEE - TAX,
        transferReversedCents: 0,
        chargeRefundedCents: 0,
      }),
      { reversalCents: ENTRY - FEE - TAX, refundCents: ENTRY }
    );
  }
);

// =============================================================================
// Convergence — amounts derive from live Stripe state, so retries and
// interrupted legacy attempts never double-move money
// =============================================================================

Deno.test(
  'legacy proportional reversal repair: claw back only what the organizer still holds',
  () => {
    // Old-code refund went through (player got $50.00, organizer gave back
    // ~$47.29) but the ledger write failed, so the row is retried by new code.
    const legacyReversed = 4729;
    assertEquals(
      planEntryRefund({
        refundableEntryCents: ENTRY,
        transferAmountCents: ENTRY,
        transferReversedCents: legacyReversed,
        chargeRefundedCents: ENTRY,
      }),
      { reversalCents: ENTRY - legacyReversed, refundCents: 0 }
    );
  }
);

Deno.test('retry after the reversal succeeded but the refund failed: refund only', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: ENTRY,
      transferReversedCents: ENTRY,
      chargeRefundedCents: 0,
    }),
    { reversalCents: 0, refundCents: ENTRY }
  );
});

Deno.test('retry after both legs succeeded (only the ledger write failed): full no-op', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: ENTRY,
      transferReversedCents: ENTRY,
      chargeRefundedCents: ENTRY,
    }),
    { reversalCents: 0, refundCents: 0 }
  );
});

Deno.test('partially refunded charge: refund only the remainder owed', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: ENTRY,
      transferReversedCents: 0,
      chargeRefundedCents: 2000,
    }),
    { reversalCents: ENTRY, refundCents: ENTRY - 2000 }
  );
});

// =============================================================================
// Bounds
// =============================================================================

Deno.test('nothing refundable → nothing moves', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: 0,
      transferAmountCents: ENTRY,
      transferReversedCents: 0,
      chargeRefundedCents: 0,
    }),
    { reversalCents: 0, refundCents: 0 }
  );
});

Deno.test('missing transfer (amount 0): refund still goes out, reversal skipped', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: 0,
      transferReversedCents: 0,
      chargeRefundedCents: 0,
    }),
    { reversalCents: 0, refundCents: ENTRY }
  );
});

Deno.test('over-reversed / over-refunded state clamps to zero, never negative', () => {
  assertEquals(
    planEntryRefund({
      refundableEntryCents: ENTRY,
      transferAmountCents: ENTRY,
      transferReversedCents: ENTRY + 1000,
      chargeRefundedCents: ENTRY + 1000,
    }),
    { reversalCents: 0, refundCents: 0 }
  );
});

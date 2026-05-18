# Stripe Connect: Just-in-Time Onboarding

> **Status:** Counter-proposal to `interac-payment-integration-plan.md`. Recommends keeping the existing Stripe Connect rails and fixing the _timing_ of host onboarding rather than replacing the rail.
> **Owner:** Mathis · **Created:** 2026-05-04

---

## 1. Premise

The pain point with the current Stripe Connect Express implementation is **not the product** — it's **when** onboarding is presented to hosts.

| Current flow (broken)                                                                                       | Proposed flow (JIT)                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host creates match → blocked on "Set up payments" → 10-min form before any value is visible → high drop-off | Host creates match → match happens → players pay (instantly via Apple Pay) → funds held in Rallia balance → host gets push: "$60 ready, finish setup to receive" → 10-min form with $60 visible → high completion |

Same number of fields. Different motivation context. This is the pattern Etsy, Substack, Gumroad, and Patreon use for sellers; it works because humans complete forms when there is concrete money on the other side, not when the form is speculative.

The Interac rewrite (in the sibling doc) solves "host onboarding friction" by removing host onboarding entirely — at the cost of player UX (60–90s WebView vs 3s Apple Pay), chargeback protection, fraud screening, and platform-fee mechanism. **JIT onboarding solves the same problem without any of those losses.**

---

## 2. New user flow

### 2.1 Host

1. Creates match. **No payment setup required.** Section in the match creation flow that previously said "Set up Stripe to enable reimbursements" → removed.
2. Match happens.
3. Taps "Request reimbursements" on the match detail screen. **Works whether or not the host has a Stripe account yet.**
4. Players pay. Funds accumulate in Rallia's Stripe platform balance, tagged to this host.
5. Push notification + in-app banner: _"You have $60.00 ready — verify your bank to receive (5 min)."_
6. Host taps banner → existing `player-stripe-onboard` Edge Function runs → Stripe-hosted onboarding (5–10 min, name/SIN/address mostly pre-filled) → `account.updated` webhook flips `onboarding_completed = true`.
7. Reconciliation cron sweeps all `pending_transfer` rows for this host and creates `stripe.transfers` to release funds. Standard Stripe payout schedule (T+2) applies after that.
8. Future matches: onboarding already done, payouts arrive automatically.

### 2.2 Player

Identical to today, only better:

1. Sees "$15.00 due — Pay with Apple Pay" on the match detail screen.
2. Taps. Biometric. Done in ~3 seconds.
3. Sees ✓ within seconds (Stripe webhook `payment_intent.succeeded` fires immediately).

Apple Pay / Google Pay are already enabled in the existing flow via `automatic_payment_methods: { enabled: true }` in `match-reimbursement-create/index.ts:138`. No mobile work required to make this fast.

### 2.3 The casual-host escape hatch

Some hosts will host one or two casual games per year and never want to set up payouts. For them:

- Host opens "Request reimbursements" → sees a secondary CTA: _"Skip Stripe — track who paid manually."_
- Choosing this path: Rallia tracks debts (player owes host, displayed clearly) but does not process payments. Players settle out-of-band (cash, Interac email, Venmo cousin, whatever). Either party can tap "Mark as paid" once settled.
- This path costs Rallia $0 and requires no compliance burden.

---

## 3. The Stripe technical model: separate charges and transfers

This is the critical architecture change. The current code uses **destination charges**:

```ts
// existing match-reimbursement-create/index.ts:134
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountCents,
  currency: 'cad',
  automatic_payment_methods: { enabled: true },
  application_fee_amount: 0,
  transfer_data: { destination: hostStripe.stripe_account_id }, // ← this requires onboarded host
  metadata: { matchId, playerId },
});
```

`transfer_data.destination` requires the destination account to have the `transfers` capability **active**, which means full onboarding must already be complete. That's why the function returns `host_not_connected` for unonboarded hosts — it has to.

**Switch to "separate charges and transfers":**

```ts
// new match-reimbursement-create/index.ts (sketch)
const paymentIntent = await stripe.paymentIntents.create(
  {
    amount: amountCents,
    currency: 'cad',
    automatic_payment_methods: { enabled: true },
    // NO transfer_data — Rallia is merchant of record on the charge
    metadata: {
      matchId,
      playerId,
      intendedRecipientPlayerId: match.created_by, // for later transfer
    },
  },
  { idempotencyKey: `reimburse-${matchId}-${playerId}` }
);
```

Funds land in Rallia's Stripe platform balance. The actual transfer to the host happens later, in two possible places:

- **If host already onboarded** at time of payment: webhook handler creates the `stripe.transfers.create({ amount, destination, source_transaction: charge_id })` immediately.
- **If host not onboarded yet:** insert a row into `pending_host_transfer` (see §4). A reconciliation cron releases it once `onboarding_completed` flips true.

### 3.1 Implications of this switch

| Concern               | Today (destination charge)          | Proposed (separate transfers)                              | Action                                                                                  |
| --------------------- | ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Merchant of record    | Host's connected account            | **Rallia**                                                 | Update receipts: "Rallia (on behalf of {host name})".                                   |
| Receipt shows         | Host name                           | Rallia                                                     | Acceptable — Rallia is the brand the player recognizes.                                 |
| Dispute landing       | Host's account                      | **Rallia's account**                                       | Rallia handles disputes. (Same as the current donation/booking flow already on Stripe.) |
| Refunds               | Refund the charge directly          | Refund the charge **and** reverse the transfer if released | Add reverse-transfer logic to refund path.                                              |
| 1099/T4A              | Stripe issues to host               | **Rallia issues** to hosts crossing thresholds             | Annual ops process; hosts collecting <$600/yr exempt.                                   |
| Tax on the host       | Stripe-reported income              | Rallia-reported (or untracked under threshold)             | Document in ToS — hosts responsible for declaring income.                               |
| Connect fee structure | `application_fee_amount` carved out | Rallia keeps gross, transfers net                          | Same monetization mechanic, just expressed differently.                                 |

This is the same model the existing booking flow (`booking-create`) uses for `organization_stripe_account`. **We're aligning the player-reimbursement flow with a pattern already in production.**

---

## 4. Schema changes

Minimal — three columns and one new table.

### Migration: `20260504000000_stripe_jit_onboarding.sql`

```sql
-- ============================================================
-- 1. Track funds awaiting host onboarding
-- ============================================================
CREATE TABLE pending_host_transfer (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_participant_id     UUID NOT NULL REFERENCES match_participant(id) ON DELETE RESTRICT,
  host_player_id           UUID NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
  stripe_charge_id         TEXT NOT NULL,            -- ch_... source for the transfer
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  currency                 TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  status                   TEXT NOT NULL DEFAULT 'awaiting_onboarding'
    CHECK (status IN ('awaiting_onboarding', 'released', 'refunded', 'expired')),
  released_at              TIMESTAMPTZ,
  released_transfer_id     TEXT,                     -- tr_... once stripe.transfers.create succeeds
  expires_at               TIMESTAMPTZ NOT NULL,     -- 90 days; auto-refund if host never onboards
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_participant_id)                      -- one transfer per paid participant row
);

CREATE INDEX idx_pht_awaiting ON pending_host_transfer(host_player_id)
  WHERE status = 'awaiting_onboarding';
CREATE INDEX idx_pht_expires ON pending_host_transfer(expires_at)
  WHERE status = 'awaiting_onboarding';

ALTER TABLE pending_host_transfer ENABLE ROW LEVEL SECURITY;
-- Service role only.

-- ============================================================
-- 2. Host can opt out of Stripe entirely (manual tracking only)
-- ============================================================
ALTER TABLE player
  ADD COLUMN payouts_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (payouts_mode IN ('auto', 'manual_only', 'undecided'));

COMMENT ON COLUMN player.payouts_mode IS
  'auto: prompt for Stripe onboarding when first earning. '
  'manual_only: never prompt for Stripe; track debts but rely on out-of-band settlement. '
  'undecided: default; treat as auto until the host indicates otherwise.';
```

That's it. We are NOT renaming `match_participant.payment_intent_id` (the Interac plan did that). We are NOT introducing a `payment_status_enum`. The existing `has_paid` column remains the source of truth.

---

## 5. Backend changes

### 5.1 `match-reimbursement-create` — drop the onboarding gate

- Remove the `'host_not_connected'` early return (lines 124–131 in the existing file).
- Remove `transfer_data` from the PaymentIntent params.
- Stop reading `player_stripe_account` here — irrelevant at charge time.
- Keep idempotency key, keep `automatic_payment_methods`, keep metadata.

### 5.2 `stripe-match-webhook` — release transfers when possible

On `payment_intent.succeeded`:

```ts
// pseudocode
const { matchId, playerId, intendedRecipientPlayerId } = pi.metadata;
const charge = await stripe.charges.retrieve(pi.latest_charge);

// Mark participant paid
await admin
  .from('match_participant')
  .update({ has_paid: true })
  .eq('match_id', matchId)
  .eq('player_id', playerId);

// Look up host onboarding status
const { data: hostAcct } = await admin
  .from('player_stripe_account')
  .select('stripe_account_id, onboarding_completed')
  .eq('player_id', intendedRecipientPlayerId)
  .maybeSingle();

const participantId = (
  await admin
    .from('match_participant')
    .select('id')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .single()
).data.id;

if (hostAcct?.onboarding_completed) {
  // Host is ready — release immediately
  const transfer = await stripe.transfers.create(
    {
      amount: pi.amount,
      currency: pi.currency,
      destination: hostAcct.stripe_account_id,
      source_transaction: charge.id,
      metadata: { matchId, fromPlayerId: playerId },
    },
    { idempotencyKey: `transfer-${charge.id}` }
  );

  await admin.from('pending_host_transfer').insert({
    match_participant_id: participantId,
    host_player_id: intendedRecipientPlayerId,
    stripe_charge_id: charge.id,
    amount_cents: pi.amount,
    status: 'released',
    released_at: new Date().toISOString(),
    released_transfer_id: transfer.id,
    expires_at: addDays(new Date(), 90).toISOString(),
  });
} else {
  // Host not onboarded yet — park funds, prompt host
  await admin.from('pending_host_transfer').insert({
    match_participant_id: participantId,
    host_player_id: intendedRecipientPlayerId,
    stripe_charge_id: charge.id,
    amount_cents: pi.amount,
    status: 'awaiting_onboarding',
    expires_at: addDays(new Date(), 90).toISOString(),
  });

  // Push the host: "$X ready, finish setup"
  await admin.rpc('insert_notification', {
    p_user_id: intendedRecipientPlayerId,
    p_type: 'payouts_setup_required',
    p_target_id: matchId,
    p_payload: { amountCents: pi.amount, matchId },
    p_priority: 'high',
    p_title: null,
    p_body: null,
    p_scheduled_at: null,
    p_expires_at: null,
    p_organization_id: null,
  });
}
```

### 5.3 New webhook handler: `account.updated` → release pending transfers

When Stripe fires `account.updated` and `charges_enabled` flips to true (already handled today for the org webhook in `apps/web/app/api/stripe/webhooks/route.ts`):

1. Find the `player_stripe_account` row for the account.
2. Update `onboarding_completed = true`.
3. Sweep all `pending_host_transfer` rows where `host_player_id = player_id AND status = 'awaiting_onboarding'`:

   ```ts
   for (const row of pending) {
     const transfer = await stripe.transfers.create(
       {
         amount: row.amount_cents,
         currency: row.currency.toLowerCase(),
         destination: hostAcct.stripe_account_id,
         source_transaction: row.stripe_charge_id,
         metadata: { participantId: row.match_participant_id },
       },
       { idempotencyKey: `release-${row.id}` }
     );

     await admin
       .from('pending_host_transfer')
       .update({
         status: 'released',
         released_at: new Date().toISOString(),
         released_transfer_id: transfer.id,
       })
       .eq('id', row.id);
   }
   ```

4. Send a notification to the host: "All $X ready and on its way to your bank."

### 5.4 New cron: `pending-transfer-reconciler` (daily)

Belt & suspenders for the webhook above. Walks `pending_host_transfer` looking for:

- Rows in `awaiting_onboarding` whose host's `onboarding_completed` is now true (webhook missed) → release as in §5.3.
- Rows past `expires_at` (90 days) where the host never onboarded → refund the original charge to the player (`stripe.refunds.create({ charge: row.stripe_charge_id })`), set status to `refunded`, send sympathetic push to both host and player ("Reimbursement could not be completed; we've refunded the player. You can resend after setting up payouts.").

Cron declared in `vercel.ts`:

```ts
crons: [
  { path: '/api/crons/pending-transfer-reconciler', schedule: '0 2 * * *' }, // 2am daily
];
```

### 5.5 `match-payment-mark-manual` (new, small)

Same idea as in the Interac plan — a host-only endpoint to flip `has_paid = true` for cash/Venmo/etc. settlements. For hosts in `payouts_mode = 'manual_only'`, this is the _only_ path. For hosts in `auto` mode, it's an escape hatch when a player paid out-of-band.

```ts
// POST /functions/v1/match-payment-mark-manual
// Auth: caller is the match host
// Body: { participantId }
// Effect: has_paid = true; if a pending_host_transfer row exists, refund and mark 'refunded'
```

---

## 6. Mobile UI changes

The reimbursement section in `MatchDetailSheet.tsx` (lines 4589–4700) stays in place. Three small behavioural changes:

### 6.1 Remove the "host must be onboarded" blocker

Today the card likely shows different states depending on `psa.onboarding_completed`. Change to:

| Host state                                         | What the host sees                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Onboarding incomplete, no funds yet                | Same as today: "Reimbursement" section with "Request reimbursements" button. **No setup gate.**                |
| Onboarding incomplete, funds awaiting              | New banner: "💰 $60.00 ready — verify your bank to receive (5 min)" → tapping invokes `player-stripe-onboard`. |
| Onboarding incomplete, host opted to `manual_only` | "Reimbursement (manual)" — shows owed/paid status, no payment processing.                                      |
| Onboarding complete                                | Same as today: shows status of each player's payment. Funds auto-released.                                     |

### 6.2 Add a "skip Stripe" option

On the match detail screen, when a host first taps "Request reimbursements" and they have no `player_stripe_account` row yet, show a sheet:

> **How do you want to handle reimbursements?**
>
> ▸ **Stripe (recommended)** — Players pay with Apple Pay in 3 seconds. Funds go to your bank. ~5 min one-time setup.
>
> ▸ **Track only** — Mark who paid you out-of-band (cash, Interac, etc.). No setup, no fees, but you have to chase players yourself.

Selection writes `player.payouts_mode = 'auto' | 'manual_only'`.

### 6.3 Player side — no changes

Apple Pay / Google Pay tile already shows up automatically via `automatic_payment_methods`. Tested: this works even when destination is Rallia (separate charge model) instead of a connected account.

---

## 7. Notifications

Two new types added to `notification_type_enum`:

```sql
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payouts_setup_required';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payouts_released';
```

(In a separate migration — `ALTER TYPE ADD VALUE` cannot be in the same transaction that uses the value.)

Translation keys (en-US + fr-CA):

```jsonc
"notifications.messages.payouts_setup_required": {
  "title": "{amount} ready to receive",
  "body": "Verify your bank account to get paid (5 min)."
},
"notifications.messages.payouts_released": {
  "title": "{amount} on the way",
  "body": "Your reimbursement is heading to your bank, arrives in 1–2 business days."
}
```

Existing `payment_received` / `payment_all_received` notifications (already fired today) stay as-is for the player-paid moment.

---

## 8. Edge cases

| Scenario                                                                           | Handling                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Player pays, host never onboards within 90 days                                    | Cron auto-refunds player, sends both parties an explanatory notification. Host can re-request next match.                                                                                                                                                          |
| Player pays, host opts into `manual_only` after the fact                           | Refund the charge (player), mark participant `has_paid` only if host explicitly confirms.                                                                                                                                                                          |
| Host onboards, but Stripe later restricts the account (charges/transfers disabled) | Webhook handler treats this the same as un-onboarded: pending rows revert to `awaiting_onboarding`. Already-released transfers stay where they are.                                                                                                                |
| Player disputes the charge                                                         | Standard Stripe dispute flow lands on Rallia's dashboard. If the dispute is opened _before_ transfer release: cancel the pending transfer. If _after_: reverse the transfer with `stripe.transfers.createReversal` and absorb the loss while the dispute resolves. |
| Refund of an already-released transfer                                             | `stripe.refunds.create({ charge, reverse_transfer: true })` does both legs atomically.                                                                                                                                                                             |
| Host is the same person as the payer (sole-host self-pay)                          | Already filtered out: `match_participant.is_host = true` is excluded from the payer set.                                                                                                                                                                           |
| Host onboards on iOS but app restarts mid-flow                                     | Existing universal link `https://rallia.app/stripe-connect-return` already handles this.                                                                                                                                                                           |

---

## 9. Risk surface (what changes)

| Item                | Today                                                                          | Under JIT                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KYC quality         | Strong (full Stripe Express KYC on host)                                       | **Strong, deferred** — still required before _any_ money reaches the host's bank. Only the _timing_ changes.                                                                                                                              |
| Custody window      | Funds touch Rallia balance momentarily (destination charge) then route to host | Funds may sit in Rallia balance for **hours to 90 days** while host onboards                                                                                                                                                              |
| MSB/FINTRAC posture | Likely safe (destination charges; Rallia isn't a money transmitter)            | **Needs explicit review** — Rallia holding funds for an unbounded peer is closer to a money-transmitter pattern. Stripe's docs explicitly support this model and many platforms use it (Etsy, Substack), but get a written legal opinion. |
| Chargebacks         | Land on host's account                                                         | **Land on Rallia's account** — same as booking/donation flow today.                                                                                                                                                                       |
| Player UX           | Already good                                                                   | Unchanged — Apple Pay / Google Pay                                                                                                                                                                                                        |
| Host UX             | 10-min form blocks first match                                                 | **10-min form happens after first match, with $ visible**                                                                                                                                                                                 |

The MSB question is the one new risk that didn't exist under destination charges. It needs to be answered before launch — but you needed the same answer for the Interac plan, so it's not net-new work, just a different question to ask the lawyer.

---

## 10. What this doesn't change

To be explicit, **none** of the following need to be touched:

- `organization_stripe_account` table and the org-side Stripe Connect (booking + donation flow stays exactly as it is)
- `apps/web/app/api/stripe/connect/*` — org Connect onboarding routes
- `apps/web/app/api/stripe/webhooks/route.ts` — already handles `account.updated`, `payment_intent.succeeded`, `charge.refunded`. We're adding handlers, not removing.
- `apps/web/lib/stripe/*` — all helpers stay
- `@stripe/stripe-react-native` in mobile — stays
- `match_participant.has_paid` and `match_participant.payment_intent_id` — stay (no column rename)
- Existing `player_stripe_account` table and `player-stripe-onboard` Edge Function — stay, just invoked at a different moment

---

## 11. Implementation order

| Phase                                       | Tasks                                                                                                                       | Days            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **1. Schema + types**                       | Migration (`pending_host_transfer`, `player.payouts_mode`), regenerate types, `ALTER TYPE ADD VALUE` for notification enums | 0.5             |
| **2. `match-reimbursement-create` rewrite** | Drop onboarding gate, switch to separate-charge model, keep idempotency                                                     | 0.5             |
| **3. Webhook handler**                      | `payment_intent.succeeded` → release-or-park; `account.updated` → release-pending sweep                                     | 1               |
| **4. Reconciliation cron**                  | `pending-transfer-reconciler` (daily)                                                                                       | 0.5             |
| **5. `match-payment-mark-manual`**          | New Edge Function + audit fields                                                                                            | 0.5             |
| **6. Mobile UI**                            | Remove onboarding gate, add "$ ready" banner, add "skip Stripe" sheet                                                       | 1.5             |
| **7. Translations**                         | en-US + fr-CA for new notification types and CTAs                                                                           | 0.5             |
| **8. Observability**                        | PostHog events for `payouts_setup_required` shown / completed; Sentry alerts for stuck pending transfers                    | 0.5             |
| **9. Legal review**                         | FINTRAC opinion on funds custody under separate-charges model; ToS update                                                   | 1 (in parallel) |
| **10. Pilot**                               | 10 hosts; measure onboarding completion rate by trigger context (before-earnings vs after-earnings)                         | 7 (calendar)    |

**Total engineering: ~5–6 days.** Vs ~23 days for the Interac rewrite.

---

## 12. Pilot plan

Before committing to either approach, run a 2-week comparison:

1. Ship phases 1–8 above behind a `JIT_ONBOARDING_ENABLED` flag for ~10 selected hosts.
2. Track:
   - **Host onboarding completion rate, before-earnings cohort vs after-earnings cohort** (this is the key metric)
   - Time from "first player pays" to "host onboarded"
   - Player payment completion rate (expected: high, ~95%, since Apple Pay)
   - 90-day expiry incidents (expected: <5%)
3. Decision after 2 weeks:
   - If after-earnings completion > 80%: **commit to JIT, archive the Interac plan.**
   - If after-earnings completion < 60%: **the problem isn't timing, it's the form. Re-evaluate Interac.**
   - In between: tune the prompt copy, push notification timing, "skip Stripe" affordance, then retest.

---

## 13. Open questions

| #   | Question                                                                                                                                            | Owner   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Confirm with FINTRAC counsel: Rallia holding funds in Stripe balance for up to 90 days under the separate-charges model — is this MSB territory?    | Legal   |
| 2   | Should hosts in `manual_only` mode see player payment statuses at all, or is that out-of-scope for the v1 ledger view?                              | Product |
| 3   | 90-day expiry → auto-refund player. Confirm acceptable from a UX standpoint or shorten to 30 days.                                                  | Product |
| 4   | T4A reporting: at what host annual receipt threshold does Rallia issue tax forms? CRA threshold for casual reimbursement is fuzzy.                  | Legal   |
| 5   | Refund-with-reverse-transfer fee handling: Stripe still bills the original processing fee on a refunded charge. Does Rallia absorb or pass to host? | Product |
| 6   | "Skip Stripe" choice — reversible? Can a host who chose `manual_only` later opt back into `auto`? (Yes, trivially. But document the moment.)        | Product |

---

## 14. Recommendation

**Run the pilot.** The cost of finding out is 5–6 engineering days plus 2 weeks of calendar time. The upside is keeping a payment rail that gives you Apple Pay UX, chargeback protection, fraud screening, and a native platform-fee mechanism — all of which evaporate in the Interac rewrite.

If the pilot fails (after-earnings completion still <60%), you'll have learned something important: the friction is in the _form_, not the _timing_, and Interac's "no host setup at all" becomes the right answer. But you'll have ruled out the better option first instead of guessing.

If the pilot succeeds, the work to ship to all hosts is incremental: remove the feature flag, monitor for two more weeks, archive `interac-payment-integration-plan.md`.

---

## Appendix A — Why not stay on destination charges?

Destination charges (current state) require the host to be onboarded _before_ a single PaymentIntent can be created with `transfer_data`. There's no Stripe-supported way to use destination charges with deferred onboarding — the API rejects the call. Switching to separate charges and transfers is the only mechanism that lets Rallia accept payments while waiting on host KYC.

The cost of the switch is the column changes in §3.1 (merchant of record, dispute landing, T4A). Most of those align Rallia's player-reimbursement flow with the booking/donation flow that already runs separate-charge style — it's a consistency win, not a regression.

## Appendix B — Why not Apple Pay / Google Pay direct-to-host?

A naïve "skip Stripe Connect, use plain Stripe charges, then Rallia mails the host an Interac e-Transfer" pattern would give the best player UX and the worst compliance posture (Rallia clearly acting as a money transmitter). It's tempting but almost certainly MSB territory. The separate-charges-with-Connect-transfer model gets the same player UX while keeping Stripe in the regulatory role they already occupy.

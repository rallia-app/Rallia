# Tournament payments v0 — organizer-as-merchant, hold-in-their-balance

**Status:** proposal / pre-build. Needs Stripe confirmation on one capability point (§5) before implementation.

## Why

Two co-founder requirements that today's implementation violates:

1. **"Rallia ne doit jamais être le détenteur de fonds."** Today the **default** `payout_timing='hold_until_event_end'` creates the PaymentIntent on Rallia's platform account with no `transfer_data`, so **100% of the entry settles into Rallia's own Stripe balance** and is `transfers.create`'d to the organizer only at event completion. That is Rallia holding funds.
2. **Hold entry money until after the tournament** (fraud/no-show protection) — which we want, but done compliantly.

These reconcile if the money is held in the **organizer's connected-account Stripe balance** (Stripe holds it, not Rallia) and Rallia only controls **when Stripe pays that balance out to the organizer's bank**.

## v0 principle — one rule for everyone

- Entry always settles into the **organizer's connected balance**; Rallia keeps only its service fee.
- Organizer connected accounts are on **manual payouts**.
- **One payout for every organizer:** Rallia triggers a payout ~24–48h **after** the tournament is marked `completed` (after the refund/dispute window). No tiers, no credibility ramp, no pre-event money. (Deferred — see §7.)

The universal "hold in their balance until after the event" IS the fraud protection, so v0 needs no per-organizer state machine.

## Target Stripe model

Destination charge, on behalf of the organizer:

```ts
stripe.paymentIntents.create({
  amount: total_charged_cents, // entry (+ fee if player_pays)
  currency,
  automatic_payment_methods: { enabled: true },
  on_behalf_of: organizer_stripe_account_id, // NEW — organizer = merchant of record
  transfer_data: { destination: organizer_stripe_account_id },
  application_fee_amount: service_fee_cents, // Rallia's fee → platform
  description: 'Rallia — tournament registration',
  metadata,
});
```

- Entry lands in the **organizer's** balance; `application_fee` in **Rallia's**.
- `on_behalf_of` makes the **organizer the merchant of record** (statement descriptor, refund/chargeback liability) — which also matches the liability position we want ("Rallia only facilitates").
- **This is the same for every event.** The `payout_timing` enum stops driving the charge shape.

## Changes required (by file)

**1. Onboarding — `supabase/functions/player-stripe-onboard/index.ts`** (or a new organizer variant)

- Request **`card_payments` + `transfers`** capabilities (today: `transfers` only). `on_behalf_of`/destination settlement needs the connected account to carry `card_payments`. **← the one thing to confirm with Stripe (§5).**
- Support `business_type: 'company'` for clubs, not only `individual`.
- Correct `business_profile` (MCC + product description for "tournament entry fees", not the current "court cost reimbursements from co-players").
- Set the account **payout schedule to manual** (`settings.payouts.schedule.interval = 'manual'`).
- Keep it **Express + hosted account link** (Stripe owns KYC; lowest friction).

**2. Charge — `supabase/functions/lt-create-registration-payment/index.ts`**

- Always build the destination charge above with `on_behalf_of`; delete the "hold in platform balance" branch.
- Precondition: organizer onboarded **and** `card_payments` active (not just `transfers`). Reuse/extend the `organizer_not_ready` guard.

**3. Settlement — `supabase/functions/lt-settle-event-payments/index.ts` + cron**

- Replace `transfers.create` (from platform balance) with **`stripe.payouts.create({ amount }, { stripeAccount: organizer_id })`** — a payout of the organizer's balance for that event, triggered when `tournament.status='completed'` and the refund window has passed.
- Cancellation path: refund each player from the organizer's balance (below), no transfer reversal needed since money never left their balance to a bank.

**4. Refunds — `supabase/functions/lt-refund-registration/index.ts`**

- Refund the PaymentIntent with `reverse_transfer: true, refund_application_fee: false` → pulls the entry back from the organizer's balance, **Rallia keeps its fee**. Simpler than today's manual `transfers.createReversal`.
- Refund base stays **entry only** per `refund_policy_kind` + `refund_cutoff_at` (unchanged logic in `tournament_request_refund`).

**5. Capability / KYC — CONFIRMED via Stripe docs (2026-07-09)**
Stripe docs are explicit: _"The `on_behalf_of` parameter is supported only for connected accounts with a payments capability such as `card_payments`,"_ and (support note) _"for destination charges using on_behalf_of, both card_payments and transfers capabilities must be requested."_ So our onboarding requesting `card_payments` + `transfers` is required and correct. Docs also confirm: destination + `on_behalf_of` makes the **connected account the merchant of record** (its statement descriptor + settlement currency — never Rallia as MoR/holder); **Express → the platform controls settlement speed** (manual payouts + platform-triggered release valid); refund `reverse_transfer:true` pulls funds from the organizer and `refund_application_fee` defaults false so the platform keeps its fee. The identical destination-charge-to-card-capable-account flow is already **in production** for org court bookings (`apps/web/lib/stripe/connect.ts` requests `card_payments`), so feasibility is proven in Rallia's own Stripe account. **Remaining:** counsel sign-off on the money-transmission/tax position (organizer as MoR owns entry-fee tax; Rallia charges tax on its own fee), and CA individual-vs-company onboarding field review — both legal/product, not engineering unknowns.

## Data-model delta

- `payout_timing` enum → **vestigial in v0** (one behavior). Keep the column; stop branching on it. Optionally default everything to a single value.
- Ledger `lt_registration_payment.released_transfer_id` → repurpose/add **`stripe_payout_id`** (release is now a payout, not a transfer). Small migration.
- No change to fee math, `entry_fee_cents`, or refund fields.

## Edge cases to handle

- **Stripe fee on refunds:** with `on_behalf_of`, the organizer's account bears the Stripe processing fee, so their balance = `entry − stripe_fee`. A full-entry refund via `reverse_transfer` can push the balance slightly negative by the Stripe fee. Decide who eats it (likely acceptable: rare, small; Stripe recovers from the account's next volume). Call out in build.
- **Payouts are account-level, amount-specified:** pay out exactly the summed `organizer_amount_cents` newly eligible for that account; mark those ledger rows released. Handles an organizer running concurrent tournaments.
- **Organizer not fully onboarded at charge time:** hard-block (can't open paid registration without `card_payments` active) — the existing publish gate `tournament_open_registration` already blocks on onboarding; extend it to check the capability, not just `onboarding_completed`.

## Out of scope for v0 (defer)

- **Credibility tiers / faster payout for trusted organizers** — purely a payout-_speed_ dial layered on later, only if data shows established organizers need it. No pre-event payouts (they reintroduce clawback risk).
- ~~Taxes (TPS/TVQ)~~ — **built 2026-07-10** for Rallia's own fee: GST+QST 14.975% on the service fee (`compute_fee_tax_cents`, `lt_registration_payment.fee_tax_cents`), collected with the fee via `application_fee_amount`, never refunded. Position (pending accountant sign-off): the fee customer is the ORGANIZER in both fee_payer modes — player_pays adds fee+tax on top, organizer_absorbs nets fee+tax from the take. Rate is a QC-only constant in v0 (all organizers are Québec-based); becomes f(organizer province) later. Entry-fee tax stays the organizer's (they are MoR) — Rallia never taxes the entry.

## Rollout / verification

- Build against **local** Stripe test keys; exercise: onboard (card_payments active) → paid registration (funds in connected balance, fee on platform) → complete event → post-event payout fires → refund before payout (entry back, fee retained) → organizer cancel (all players refunded).
- Deploy edge functions to **staging** only after the above passes; re-run the flow with a staging test organizer.
- **Do not** change prod behavior until Stripe confirms §5 and the staging run is clean.

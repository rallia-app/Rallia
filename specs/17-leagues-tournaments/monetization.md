# Monetization

> Integration boundary with [18-monetization](../18-monetization/) for entry fees, dues, refunds, and sponsorship.

This file does **not** specify monetization mechanics — those live in `specs/18-monetization/`. It specifies the _integration surface_ leagues and tournaments expose so that monetization can plug in without re-opening the L&T spec.

## Scope of v1

L&T v1 ships **without** any payment, fee, or refund flow. The reasons:

- The MVP focus is the competitive product (per [README.md](./README.md#phasing) phasing).
- Stripe wiring already exists in `apps/web/lib/stripe/` for donations and player subscriptions; it is not yet exposed for L&T.
- Quebec consumer-protection rules around tournament refunds need legal review before going live.

But the schema reserves columns so that the monetization payload can be added later **without a migration churn that triggers RLS reset** or breaks live data.

## Reserved columns

### `tournaments`

```sql
ALTER TABLE tournaments
  ADD COLUMN entry_fee_amount_cents integer CHECK (entry_fee_amount_cents IS NULL OR entry_fee_amount_cents >= 0),
  ADD COLUMN entry_fee_currency text CHECK (entry_fee_currency IS NULL OR entry_fee_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN refund_policy text;                  -- markdown text shown at registration time
```

### `tournament_registrations`

```sql
ALTER TABLE tournament_registrations
  ADD COLUMN payment_intent_id text,              -- Stripe PaymentIntent
  ADD COLUMN payment_status text,                 -- 'pending' / 'succeeded' / 'refunded' / null
  ADD COLUMN paid_amount_cents integer,
  ADD COLUMN refunded_amount_cents integer,
  ADD COLUMN refunded_at timestamptz;
```

### `leagues`

```sql
ALTER TABLE leagues
  ADD COLUMN dues_amount_cents integer CHECK (dues_amount_cents IS NULL OR dues_amount_cents >= 0),
  ADD COLUMN dues_currency text CHECK (dues_currency IS NULL OR dues_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN dues_period text CHECK (dues_period IN ('once', 'per_season', 'per_year') OR dues_period IS NULL);
```

### `league_members`

```sql
ALTER TABLE league_members
  ADD COLUMN dues_paid_through date,              -- subscription-style; null = never paid
  ADD COLUMN last_payment_intent_id text;
```

These columns are NULL across the board in v1; no UI surfaces them. They exist purely so the v2 monetization migration is additive (add columns ✓ already done; add policies/RPCs/UI is the new work).

## Integration boundary

When monetization ships, it provides:

| Hook (called from L&T)                                            | Implementation in monetization                       |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `mn_create_tournament_intent(tournament_id, user_id, partner_id)` | Returns Stripe PaymentIntent client_secret           |
| `mn_confirm_tournament_payment(intent_id)`                        | Marks `payment_status = 'succeeded'` on registration |
| `mn_refund_tournament(registration_id, reason)`                   | Issues refund, sets `refunded_*` columns             |
| `mn_create_dues_intent(league_id, user_id)`                       | League-dues subscription                             |

L&T's RPCs that need money awareness:

- `tournament_register` checks `tournaments.entry_fee_amount_cents`. If non-null, returns a `payment_required: true` flag with the Stripe client secret; client opens checkout. Registration only flips to `registered` after payment confirmation.
- `tournament_cancel` calls `mn_refund_tournament` for each registered participant per the tournament's `refund_policy`.
- `tournament_withdraw` may issue a partial refund per the policy text (parsed by monetization service, not by L&T).

## Refund policy (UI text)

Free-text markdown shown at registration. Monetization's service parses simple structured forms (e.g., "100% before X, 50% before Y, 0% after"), but L&T does not interpret it.

## Entry fees in notifications

When `entry_fee_amount_cents IS NOT NULL`:

- `tournament_registered` notification body includes the amount paid.
- `tournament_cancelled` includes refund amount and ETA.

i18n strings live under `notifications.tournament.feeAmount` etc.

## Sponsorship (v2+)

Tournaments and leagues may have sponsors:

| Reserved column            | Purpose                               |
| -------------------------- | ------------------------------------- |
| `sponsor_logo_urls text[]` | Up to 5 logo URLs in Supabase Storage |
| `sponsor_links jsonb`      | Map of sponsor name → URL             |

Display is a small horizontal logo strip on the detail page. Out of scope for v1; reserved here.

## Tax and reporting

Out of scope for v1. Stripe handles tax via Stripe Tax; payouts go to the organizer's connected Stripe account (per Stripe Connect integration in `apps/web/lib/stripe/`).

Organizer dashboards in [web-organizer-ux.md](./web-organizer-ux.md) will show payment summaries when monetization ships.

## What L&T must guarantee

For monetization to plug in cleanly, L&T must:

1. **Never delete a registration row** that has a non-null `payment_intent_id`. Use `withdrawn` status instead.
2. **Always include the `version` lock** when changing payment-relevant fields, so monetization can detect concurrent edits.
3. **Always emit an audit row** when a registration's payment-relevant fields change.
4. **Never expose `payment_intent_id` over RLS** to non-organizers — the column is part of `treg_no_direct_write` policy and select policies redact it for non-organizer reads.

These constraints are encoded in `tournament_registrations`'s schema and RLS policies so they're enforced regardless of monetization's implementation.

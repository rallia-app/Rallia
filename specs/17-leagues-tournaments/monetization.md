# Monetization

> **Status: deferred. v1 of L&T ships with no monetization surface — no entry fees, no league dues, no refunds, no Stripe wiring, no reserved schema columns.**

## Why deferred

- The Rallia spec series does not yet contain `specs/18-monetization/`. Until that exists, there is no contract for L&T to integrate against.
- The friends-and-family launch [project_friends_family_launch.md](../../.claude/projects/-Users-mathis-dev-startups-rallia-rallia/memory/project_friends_family_launch.md) targets free play; paid tournaments are not part of the early validation goal.
- Quebec consumer-protection rules around tournament refunds need legal review before any paid flow ships — out of scope for v1.

## What this means for v1

| Surface                    | v1 behavior                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tournament create form     | No entry-fee field. No refund-policy field. No Stripe Connect prompt.                                                   |
| `tournaments` table        | No `entry_fee_*`, `refund_policy`, or sponsor columns.                                                                  |
| League create form         | No dues field, no `dues_*` columns on `leagues`.                                                                        |
| `tournament_registrations` | No `payment_intent_id`, `payment_status`, `paid_amount_cents`, `refunded_*` columns.                                    |
| `tournament_register` RPC  | Never returns a `payment_required` flag. Registration is free and instant (subject to mode: open/approval/invite_only). |
| `tournament_cancel` RPC    | No refund hook called. Cancellation just transitions matches and emits notifications.                                   |
| `tournament_withdraw` RPC  | No partial refund. Withdrawal is free.                                                                                  |
| Notifications              | No fee-amount or refund-amount strings. The corresponding i18n keys are not created.                                    |
| Organizer dashboards       | No payment summary section.                                                                                             |

## When monetization lands (post-v1)

When `specs/18-monetization/` is written, L&T will need:

1. A new migration adding the entry-fee / dues / payment columns. Because v1 omits these entirely, this migration is purely additive (no `RENAME COLUMN`, no data backfill).
2. New RPC parameters / branches in `tournament_register`, `tournament_cancel`, `tournament_withdraw`, `league_join`, plus new `mn_*` integration hooks defined by 18-monetization.
3. UI updates in [mobile-ux.md](./mobile-ux.md) and [web-organizer-ux.md](./web-organizer-ux.md) to surface pricing on create and at registration.
4. New analytics events in [analytics.md](./analytics.md) (`lt.tournament.payment_succeeded`, etc.).
5. Notification i18n keys for fee/refund strings.

The two invariants that **must** be honored once monetization ships (so that they're worth designing into the v1 schema even though no columns exist yet):

- Never hard-delete a `tournament_registrations` row that has been paid. Use `withdrawn` status. (v1 already follows this since withdrawal is the canonical exit.)
- Always include the `version` lock when changing payment-relevant fields. (v1 already locks every UPDATE.)

These two are both inherent to the v1 design, so post-v1 monetization adds payment fields without requiring v1 behavior to change.

## Sponsorship

Out of scope for v1. Will be re-evaluated when monetization ships.

## What was here before

This file previously specified reserved columns (`entry_fee_amount_cents`, `payment_intent_id`, `dues_amount_cents`, etc.) and four named integration hooks (`mn_create_tournament_intent`, `mn_confirm_tournament_payment`, `mn_refund_tournament`, `mn_create_dues_intent`). Those references have been removed; reintroduce them via `specs/18-monetization/` when that spec is written, and bring them back here as a forward-compatibility section at the same time.

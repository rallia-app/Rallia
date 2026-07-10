-- Migration: Drop the retired court-fee (match) reimbursement feature.
--
-- The reimbursement feature is abandoned. Its edge functions
-- (match-reimbursement-create, match-payment-mark-manual, stripe-match-webhook),
-- the web reconciler cron, and all mobile UI have been removed. This migration
-- drops the reimbursement-only schema.
--
-- KEPT ON PURPOSE:
--   * player_stripe_account — repurposed as the tournament ORGANIZER payout
--     account (settlement merchant for paid registrations). Only its
--     reimbursement-specific RLS policy is dropped below.
--   * notification_type_enum values (payouts_setup_required, payouts_released,
--     payouts_expired_refunded, reimbursement_received, reimbursement_all_received)
--     — Postgres can't safely drop enum values, and their emitters are gone, so
--     they remain as dormant, unreachable values.
--   * match_participant.has_paid / payment_intent_id — DEFERRED. Deployed app
--     builds still SELECT these columns, so dropping them now would 400 those
--     queries. Drop in a follow-up migration once a build that stops selecting
--     them (this change to matchService) has rolled out (expand/contract).
-- ============================================================================

-- 1. Reimbursement-only RLS policy on the (kept) player_stripe_account table.
--    Let joined match participants read the host's onboarding status so the
--    client could pick "Pay Now" vs "pay directly". No longer needed.
DROP POLICY IF EXISTS "psa_read_as_match_participant" ON player_stripe_account;

-- The table now serves tournament organizer payouts, not court reimbursements.
COMMENT ON TABLE player_stripe_account IS
  'Stripe Connect Express account linked to a player so they can receive '
  'tournament organizer payouts (settlement merchant for paid registrations).';

-- 2. pending_host_transfer — held funds awaiting host onboarding / expiry.
--    Reimbursement-only. Dropping the table also removes its indexes, RLS
--    policies, and the updated_at trigger.
DROP TABLE IF EXISTS pending_host_transfer;
-- The trigger is dropped with the table; the function is independent.
DROP FUNCTION IF EXISTS pending_host_transfer_set_updated_at();

-- 3. player.payouts_mode — host's reimbursement payout preference
--    (auto | manual_only | undecided). Reimbursement-only; no views, functions,
--    or policies reference it. Dropping the column also drops its CHECK.
ALTER TABLE player DROP COLUMN IF EXISTS payouts_mode;

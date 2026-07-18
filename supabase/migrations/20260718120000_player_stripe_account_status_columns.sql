-- Migration: player_stripe_account status columns
-- Lets organizers see + manage their payout account after setup. The
-- stripe-connect-webhook mirrors Stripe's account.updated flags here so the
-- app can render a payout status pill and route to the Express dashboard
-- (fully onboarded) or resume onboarding (requirements still outstanding),
-- without a live Stripe round-trip on every screen open.

ALTER TABLE player_stripe_account
  ADD COLUMN IF NOT EXISTS charges_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payouts_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_submitted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN player_stripe_account.charges_enabled   IS 'Stripe account.charges_enabled — can act as settlement merchant for registration charges. Mirrors onboarding_completed.';
COMMENT ON COLUMN player_stripe_account.payouts_enabled   IS 'Stripe account.payouts_enabled — funds can be paid out to the organizer''s bank.';
COMMENT ON COLUMN player_stripe_account.details_submitted IS 'Stripe account.details_submitted — organizer finished the onboarding form (may still have pending verification).';

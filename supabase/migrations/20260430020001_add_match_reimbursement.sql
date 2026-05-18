-- Migration: Add match reimbursement support
-- Adds per-participant payment tracking and a table for player Stripe Connect accounts.

-- ============================================================
-- match_participant: payment state columns
-- ============================================================

ALTER TABLE match_participant
  ADD COLUMN IF NOT EXISTS has_paid          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

COMMENT ON COLUMN match_participant.has_paid          IS 'True once the participant has paid their share of the court cost (either via Stripe or manually marked).';
COMMENT ON COLUMN match_participant.payment_intent_id IS 'Stripe PaymentIntent ID used to reconcile the payment via webhook.';

-- ============================================================
-- player_stripe_account: Stripe Connect Express accounts
-- ============================================================

CREATE TABLE IF NOT EXISTS player_stripe_account (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            UUID        NOT NULL UNIQUE REFERENCES player(id) ON DELETE CASCADE,
  stripe_account_id    TEXT        NOT NULL,
  onboarding_completed BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  player_stripe_account                         IS 'Stripe Connect Express account linked to a player so they can receive court reimbursements.';
COMMENT ON COLUMN player_stripe_account.stripe_account_id      IS 'Stripe connected account ID (e.g. acct_1abc2def).';
COMMENT ON COLUMN player_stripe_account.onboarding_completed   IS 'True once Stripe reports charges_enabled=true for this account.';

ALTER TABLE player_stripe_account ENABLE ROW LEVEL SECURITY;

-- Players can fully manage their own row.
CREATE POLICY "psa_owner"
  ON player_stripe_account
  FOR ALL
  TO authenticated
  USING     (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

-- Joined match participants may read the host's account status so the
-- client knows whether to show "Pay Now" (Stripe) or "pay directly" (manual).
CREATE POLICY "psa_read_as_match_participant"
  ON player_stripe_account
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM match_participant mp
        JOIN match m ON m.id = mp.match_id
       WHERE mp.player_id = auth.uid()
         AND mp.status    = 'joined'
         AND m.created_by = player_stripe_account.player_id
    )
  );

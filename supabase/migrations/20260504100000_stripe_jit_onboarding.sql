-- Migration: Stripe JIT (just-in-time) Onboarding
--
-- Adds support for accepting reimbursement payments BEFORE the host has
-- completed Stripe Connect onboarding. Funds are held in Rallia's Stripe
-- platform balance and released to the host's connected account once they
-- finish onboarding (or refunded to the player after a 90-day expiry).
--
-- See docs/stripe-jit-onboarding-counter-proposal.md
-- ============================================================================

-- ============================================================
-- 1. pending_host_transfer
--    Tracks each successful PaymentIntent whose funds need to be transferred
--    to the host. Inserted on payment_intent.succeeded; flipped to 'released'
--    once stripe.transfers.create succeeds.
-- ============================================================
CREATE TABLE pending_host_transfer (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_participant_id     UUID NOT NULL REFERENCES match_participant(id) ON DELETE RESTRICT,
  host_player_id           UUID NOT NULL REFERENCES player(id) ON DELETE RESTRICT,
  stripe_charge_id         TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  currency                 TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  status                   TEXT NOT NULL DEFAULT 'awaiting_onboarding'
    CHECK (status IN ('awaiting_onboarding', 'released', 'refunded', 'expired')),
  released_at              TIMESTAMPTZ,
  released_transfer_id     TEXT,
  refunded_at              TIMESTAMPTZ,
  refunded_refund_id       TEXT,
  expires_at               TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: one transfer row per paid participant
  UNIQUE (match_participant_id),
  -- Status<->timestamp consistency
  CONSTRAINT pht_released_consistency
    CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CONSTRAINT pht_refunded_consistency
    CHECK ((status = 'refunded') = (refunded_at IS NOT NULL))
);

COMMENT ON TABLE pending_host_transfer IS
  'Funds collected from a player that have not yet been transferred to the host. '
  'Awaiting either host onboarding completion (then released) or 90-day expiry (then refunded).';

COMMENT ON COLUMN pending_host_transfer.status IS
  'awaiting_onboarding: PaymentIntent succeeded, host not yet onboarded. '
  'released: stripe.transfers.create succeeded. '
  'refunded: charge refunded to player (e.g. host abandoned). '
  'expired: 90-day window elapsed and refund is in flight.';

CREATE INDEX idx_pht_awaiting ON pending_host_transfer(host_player_id)
  WHERE status = 'awaiting_onboarding';
CREATE INDEX idx_pht_expires ON pending_host_transfer(expires_at)
  WHERE status = 'awaiting_onboarding';
CREATE INDEX idx_pht_match_participant ON pending_host_transfer(match_participant_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION pending_host_transfer_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pending_host_transfer_updated_at
  BEFORE UPDATE ON pending_host_transfer
  FOR EACH ROW
  EXECUTE FUNCTION pending_host_transfer_set_updated_at();

-- RLS: service role only. No policies for authenticated users — all access
-- happens through Edge Functions running with the service-role key.
ALTER TABLE pending_host_transfer ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. player.payouts_mode
--    Lets a host opt out of Stripe entirely. 'manual_only' hosts use the
--    "track who paid" flow with no payment processing.
-- ============================================================
ALTER TABLE player
  ADD COLUMN payouts_mode TEXT NOT NULL DEFAULT 'undecided'
    CHECK (payouts_mode IN ('auto', 'manual_only', 'undecided'));

COMMENT ON COLUMN player.payouts_mode IS
  'auto: prompt for Stripe onboarding when first earning. '
  'manual_only: never prompt for Stripe; host marks payments received out-of-band. '
  'undecided: default; treated as auto until the host explicitly chooses.';

-- ============================================================
-- 3. RLS: allow joined match participants to read the host's payouts_mode
--    (so the client can choose the right CTA). Already-existing player RLS
--    governs other columns; we only need the read here.
-- ============================================================
-- (No new policy required — payouts_mode is on the player table and existing
--  player select policies already permit visibility to joined match peers.)

-- Migration: Fix pending_host_transfer status<->timestamp consistency checks
--
-- The original CHECK constraints used equality:
--   CHECK ((status = 'released') = (released_at IS NOT NULL))
--   CHECK ((status = 'refunded') = (refunded_at IS NOT NULL))
--
-- That is too strict. When a row legitimately transitions
--   released -> refunded
-- (Stripe charge.refunded after the transfer was already released),
-- both released_at AND refunded_at should remain set as event timestamps:
-- the transfer DID happen at released_at, and the refund DID happen at refunded_at.
-- The original constraints rejected this transition because they required
-- released_at to become NULL the moment status flipped to 'refunded'.
--
-- Replace with forward-implication checks: status='X' implies X_at IS NOT NULL.
-- Don't constrain the reverse direction — the *_at columns are event timestamps,
-- not mirrors of status.
-- ============================================================================

ALTER TABLE pending_host_transfer
  DROP CONSTRAINT IF EXISTS pht_released_consistency;
ALTER TABLE pending_host_transfer
  DROP CONSTRAINT IF EXISTS pht_refunded_consistency;

ALTER TABLE pending_host_transfer
  ADD CONSTRAINT pht_released_implies_timestamp
    CHECK (status <> 'released' OR released_at IS NOT NULL);

ALTER TABLE pending_host_transfer
  ADD CONSTRAINT pht_refunded_implies_timestamp
    CHECK (status <> 'refunded' OR refunded_at IS NOT NULL);

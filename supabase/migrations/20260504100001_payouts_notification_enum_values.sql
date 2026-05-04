-- Migration: Add notification_type_enum values for Stripe JIT onboarding flow.
--
-- IMPORTANT: ALTER TYPE ADD VALUE cannot be used in the same transaction
-- that consumes the new value. This migration MUST be applied before any
-- code that calls insert_notification with these types runs.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payouts_setup_required';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payouts_released';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payouts_expired_refunded';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'reimbursement_received';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'reimbursement_all_received';

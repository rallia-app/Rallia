-- ============================================================================
-- Migration: Add recurring_court_opened notification type
-- Created: 2026-08-28
-- Description: Notification type for telling the host of a recurring game that
--              the facility's provider has just published bookable slots
--              covering their game window. Recurring occurrences are created
--              ~a week out, well before most providers open their booking
--              horizon, so the host needs a ping the moment courts appear.
--              Enum value lives in its own migration so the follow-up
--              migration can reference it outside this transaction.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'recurring_court_opened';

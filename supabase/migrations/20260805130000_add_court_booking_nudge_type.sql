-- ============================================================================
-- Migration: Add court_booking_nudge notification type
-- Created: 2026-08-05
-- Description: Notification type for nudging a host shortly after they create
--              a courtless facility match while bookable slots are open at
--              that facility around game time (momentum harvesting item 5).
--              Enum value lives in its own migration so the follow-up
--              migration can reference it outside this transaction.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'court_booking_nudge';

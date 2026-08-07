-- ============================================================================
-- Migration: Add match_last_minute_spots notification type
-- Created: 2026-08-05
-- Description: Notification type for the last-minute open-spots push: public
--              games starting in 2-6 hours with open spots get surfaced to
--              nearby, rating-compatible players (momentum harvesting item 6).
--              Enum value in its own migration so the follow-up can use it.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'match_last_minute_spots';

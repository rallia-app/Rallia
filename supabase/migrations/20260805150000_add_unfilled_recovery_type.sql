-- ============================================================================
-- Migration: Add match_unfilled_recovery notification type
-- Created: 2026-08-05
-- Description: Notification type for recovering hosts whose game reached its
--              start time without filling (momentum harvesting item 7). Enum
--              value in its own migration so the follow-up can use it.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'match_unfilled_recovery';

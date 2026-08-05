-- ============================================================================
-- Migration: Add tournament_registration_open notification type
-- Created: 2026-08-05
-- Description: Notification type for fanning out "registrations are open" for
--              certified organizers' public tournaments (momentum item 9).
--              Specified in specs/17-leagues-tournaments/notifications.md but
--              never implemented. Enum in its own migration.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_registration_open';

-- ============================================================================
-- Migration: Add match_spot_opened notification type
-- Created: 2026-03-07
-- Description: Adds notification type for notifying waitlisted players when
--              a spot opens up in a match (player left or was kicked).
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'match_spot_opened';

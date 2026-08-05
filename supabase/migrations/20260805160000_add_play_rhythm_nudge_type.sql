-- ============================================================================
-- Migration: Add play_rhythm_nudge notification type
-- Created: 2026-08-05
-- Description: Notification type for the personal play-rhythm gap push: when
--              a player's declared weekly slot is coming up empty and a
--              compatible open game exists for it (momentum item 8). Enum in
--              its own migration so the follow-up can use it.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'play_rhythm_nudge';

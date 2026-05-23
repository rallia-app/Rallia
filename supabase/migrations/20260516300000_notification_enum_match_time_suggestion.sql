-- =============================================================================
-- Add notification_type_enum values for the match time-suggestion feature
--
-- Kept as a standalone migration so the values are committed before any
-- downstream migration (or runtime code) tries to reference them. Postgres
-- forbids using a freshly added enum value inside the same transaction that
-- added it.
-- =============================================================================

ALTER TYPE notification_type_enum
  ADD VALUE IF NOT EXISTS 'match_time_suggested';
ALTER TYPE notification_type_enum
  ADD VALUE IF NOT EXISTS 'match_time_suggestion_accepted';
ALTER TYPE notification_type_enum
  ADD VALUE IF NOT EXISTS 'match_time_suggestion_declined';

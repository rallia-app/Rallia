-- Session / season cancellation notification types.
-- Enum-only migration: ADD VALUE cannot be used in the same transaction that
-- references the new value (same pattern as 20260613110000). The triggers that
-- use these land in 20260730180100.

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'session_cancelled';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'season_cancelled';

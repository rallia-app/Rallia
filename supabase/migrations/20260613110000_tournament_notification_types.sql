-- Tournament lifecycle notification types.
-- Enum-only migration: ADD VALUE cannot be used in the same transaction
-- that references the new value (same pattern as 20260612160000).

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_registration_received';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_registration_approved';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_registration_removed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_bracket_published';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_match_completed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_updated';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_cancelled';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_completed';

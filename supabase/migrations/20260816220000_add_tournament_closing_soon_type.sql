-- Notification type for the registration closing-soon reminder (fan-out in
-- the follow-up migration; new enum values cannot be referenced in the same
-- transaction that adds them).

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_registration_closing_soon';

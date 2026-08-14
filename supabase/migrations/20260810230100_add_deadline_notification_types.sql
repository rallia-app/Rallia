-- Notification types for the round-deadline cadence engine (F4a + F4b).

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_deadline_changed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_round_deadline_soon';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_deadline_extended';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_match_walkover';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_dispute_escalated';

-- Add program notification types to notification_type_enum
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_registration_confirmed';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_registration_cancelled';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_session_reminder';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_session_cancelled';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_waitlist_promoted';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_payment_due';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'program_payment_received';

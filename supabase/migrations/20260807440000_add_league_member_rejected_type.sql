-- Notification type for a turned-down league join request. Own migration so the
-- enum value is committed before the trigger that uses it (house pattern, see
-- 20260805130000..170000).
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'league_member_rejected';

-- ============================================
-- Leagues — confirm-presence reminder (DDL)
-- ============================================
-- A published session can carry a confirmation deadline; past it,
-- lt_close_due_session_confirmations flips remaining pending presence to
-- declined. Until now nothing nudged members beforehand, so a player could be
-- auto-declined without ever being prompted. This adds the notification type
-- and a dedupe marker; the cron that sends the reminder ships in the companion
-- migration (a freshly added enum value can't be used in the same transaction).
-- ============================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'session_confirm_reminder';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS confirm_reminder_sent_at timestamptz;

-- ============================================
-- Notification type: tournament_action_required
-- ============================================
-- The organizer's to-do. Sent when a tournament is sitting at a gate only they
-- can open: registration has closed and nothing is drawn yet, or every pool
-- game is settled and the knockout has not been launched.
--
-- One type for both gates on purpose. They are the same kind of thing to the
-- recipient (your event is waiting on you), the body says which, and it means
-- the organizer can mute the category as a unit rather than one gate at a time.
--
-- Must live in its own migration: a newly added enum value cannot be *used* in
-- the transaction that adds it, and the nudge function in the next migration
-- references it. Same reason as 20260628185500 and 20260811170000.
-- ============================================

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_action_required';

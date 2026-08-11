-- ============================================
-- Notification type: tournament_pool_eliminated
-- ============================================
-- Sent at the pool-to-knockout cut-over to the participants who did NOT
-- qualify, with their pool placing. Half the field of a 2-qualifiers-per-pool
-- event is in this group and until now heard nothing at all: their tournament
-- simply stopped.
--
-- Must live in its own migration: a newly added enum value cannot be *used* in
-- the same transaction that adds it, and the notify function in the next
-- migration references it. Same reason as 20260628185500.
--
-- The qualifying side reuses the existing tournament_bracket_published type,
-- and so does the pools-published notice, so this is the only new value the
-- pool format needs.
-- ============================================

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_pool_eliminated';

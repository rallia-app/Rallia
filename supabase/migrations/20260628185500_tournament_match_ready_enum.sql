-- ============================================
-- Notification type: tournament_match_ready
-- ============================================
-- Fired when bracket advancement makes a player's NEXT match playable (both
-- opponents now known). Round 1 is already announced by
-- tournament_bracket_published; this fills the per-round gap for rounds 2+.
--
-- Must live in its own migration: a newly added enum value cannot be *used*
-- in the same transaction that adds it (the notify function in the next
-- migration references it).
-- ============================================

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_match_ready';

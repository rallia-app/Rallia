-- ============================================================================
-- A cancelled pairing is not a walkover.
-- ============================================================================
-- The ladder's stalemate rung (unplayed-match-resolution.md § 6, R4) cancels a
-- game when both sides tried and neither is at fault. Until now it told nobody,
-- and the only tournament outcome type on hand said "walkover", which is the
-- opposite claim: a walkover names a loser, a cancellation names none.
--
-- Alone in its own migration on purpose: a new enum value cannot be used in the
-- transaction that adds it, and 20260831220000 uses it immediately.
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'tournament_match_cancelled';

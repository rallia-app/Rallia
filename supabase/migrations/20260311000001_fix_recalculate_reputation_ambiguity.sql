-- ============================================================================
-- Fix ambiguous recalculate_player_reputation overloads
-- ============================================================================
-- Migration 20260301000003 added a 3-parameter overload
-- (UUID, BOOLEAN, INT DEFAULT 10) but never dropped the old 2-parameter
-- version (UUID, BOOLEAN). When called with two arguments PostgreSQL cannot
-- choose between them, resulting in:
--   "function recalculate_player_reputation(uuid, boolean) is not unique"
--
-- Drop the old 2-parameter signature so only the 3-parameter version remains.
-- ============================================================================

DROP FUNCTION IF EXISTS recalculate_player_reputation(UUID, BOOLEAN);

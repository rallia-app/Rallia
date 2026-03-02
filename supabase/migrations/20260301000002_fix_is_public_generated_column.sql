-- ============================================================================
-- Fix is_public: drop GENERATED column, replace with regular BOOLEAN
-- ============================================================================
-- The recalculate_player_reputation() function (from 20260228200002) writes
-- to is_public directly, but the column is GENERATED ALWAYS AS
-- (total_events >= min_events_for_public) STORED — which PostgreSQL forbids.
--
-- Fix: drop the generated column and min_events_for_public config column,
-- then add is_public as a regular BOOLEAN that the function manages.
-- The function already computes `is_public = p_total_events >= 10`.
-- ============================================================================

-- Drop the RLS policy that depends on is_public first
DROP POLICY IF EXISTS "player_reputation_read_public" ON player_reputation;

-- Drop the generated column (and its dependency column)
ALTER TABLE player_reputation DROP COLUMN IF EXISTS is_public;
ALTER TABLE player_reputation DROP COLUMN IF EXISTS min_events_for_public;

-- Re-add as a regular column with a default matching the generated expression
ALTER TABLE player_reputation
ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows
UPDATE player_reputation SET is_public = (total_events >= 10);

-- Recreate the RLS policy
CREATE POLICY "player_reputation_read_public" ON player_reputation
    FOR SELECT
    TO authenticated
    USING (is_public = true);

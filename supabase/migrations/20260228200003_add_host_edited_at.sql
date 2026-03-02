-- Add host_edited_at column to match table
--
-- Tracks when the host explicitly edits match details.
-- Used for the leave-penalty exception: if a host recently edited the match,
-- participants can leave without reputation penalty (they're reacting to changes).
-- Unlike updated_at, this only fires on explicit host edits, not any row modification.

-- 1. Add the column (nullable, defaults to NULL = never edited)
ALTER TABLE match ADD COLUMN IF NOT EXISTS host_edited_at TIMESTAMPTZ;

-- 2. Backfill: set host_edited_at for matches where updated_at differs from created_at
--    (best approximation for existing data)
UPDATE match
SET host_edited_at = updated_at
WHERE updated_at != created_at
  AND host_edited_at IS NULL;

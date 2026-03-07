-- Add privacy_show_availability column to player table
-- This allows players to control whether their availability is visible to others

ALTER TABLE player
ADD COLUMN IF NOT EXISTS privacy_show_availability BOOLEAN DEFAULT TRUE;

-- Add comment for documentation
COMMENT ON COLUMN player.privacy_show_availability IS 'When false, the player availability grid is hidden from other users on their profile';

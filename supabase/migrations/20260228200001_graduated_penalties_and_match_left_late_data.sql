-- Graduated cancellation penalties & match_left_late event type
-- Part 2: Use the new enum value and update config

-- 1. Insert config row for match_left_late
INSERT INTO reputation_config (event_type, default_impact, min_impact, max_impact, decay_enabled, decay_half_life_days, is_active)
VALUES ('match_left_late', -22, -33, -7, true, 180, true)
ON CONFLICT (event_type) DO NOTHING;

-- 2. Update match_cancelled_late config to reflect graduated defaults
UPDATE reputation_config
SET default_impact = -35,
    min_impact = -45,
    max_impact = -10
WHERE event_type = 'match_cancelled_late';

-- 3. Add joined_at column to match_participant for cooling-off check
--    Defaults to created_at for existing rows (best available approximation)
ALTER TABLE match_participant ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;
UPDATE match_participant SET joined_at = created_at WHERE joined_at IS NULL;

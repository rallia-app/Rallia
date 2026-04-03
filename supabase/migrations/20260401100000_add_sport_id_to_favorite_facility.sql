-- Migration: Add sport_id to player_favorite_facility
-- Makes favorite facilities per-sport instead of global per-player.
-- Previously, favoriting a facility from tennis profile would also show on pickleball profile.

-- ============================================
-- STEP 1: Add sport_id column (nullable initially)
-- ============================================

ALTER TABLE player_favorite_facility
  ADD COLUMN IF NOT EXISTS sport_id UUID REFERENCES sport(id) ON DELETE CASCADE;

-- ============================================
-- STEP 2: Data migration - assign sport_id to existing rows
-- ============================================

-- For each existing favorite, assign the sport based on:
-- 1. Which sports the facility supports (facility_sport)
-- 2. Which sports the player plays (player_sport)
-- Use the player's primary sport as tiebreaker when a facility supports multiple sports the player plays.
UPDATE player_favorite_facility pff
SET sport_id = sub.sport_id
FROM (
  SELECT DISTINCT ON (pff2.id)
    pff2.id AS fav_id,
    fs.sport_id
  FROM player_favorite_facility pff2
  JOIN facility_sport fs ON fs.facility_id = pff2.facility_id
  JOIN player_sport ps ON ps.player_id = pff2.player_id AND ps.sport_id = fs.sport_id AND ps.is_active = TRUE
  ORDER BY pff2.id, ps.is_primary DESC, ps.created_at ASC
) sub
WHERE pff.id = sub.fav_id
  AND pff.sport_id IS NULL;

-- For dual-sport facilities where the player plays both sports, duplicate the row for each additional sport.
-- The UPDATE above assigned the primary sport; this INSERT adds rows for secondary sports.
INSERT INTO player_favorite_facility (player_id, facility_id, sport_id, display_order)
SELECT pff.player_id, pff.facility_id, fs.sport_id, pff.display_order
FROM player_favorite_facility pff
JOIN facility_sport fs ON fs.facility_id = pff.facility_id
JOIN player_sport ps ON ps.player_id = pff.player_id AND ps.sport_id = fs.sport_id AND ps.is_active = TRUE
WHERE pff.sport_id IS NOT NULL
  AND fs.sport_id != pff.sport_id
ON CONFLICT DO NOTHING;

-- Re-number display_order per (player_id, sport_id) group to avoid gaps/collisions
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY player_id, sport_id ORDER BY display_order, created_at) AS new_order
  FROM player_favorite_facility
  WHERE sport_id IS NOT NULL
)
UPDATE player_favorite_facility pff
SET display_order = numbered.new_order
FROM numbered
WHERE pff.id = numbered.id
  AND pff.display_order != numbered.new_order;

-- Delete orphaned rows that couldn't be assigned a sport
-- (facility has no facility_sport records, or player doesn't play any sport the facility supports)
DELETE FROM player_favorite_facility WHERE sport_id IS NULL;

-- ============================================
-- STEP 3: Make sport_id NOT NULL and update constraints
-- ============================================

ALTER TABLE player_favorite_facility ALTER COLUMN sport_id SET NOT NULL;

-- Drop old unique constraint (player_id, facility_id) and replace with (player_id, facility_id, sport_id)
ALTER TABLE player_favorite_facility DROP CONSTRAINT IF EXISTS player_favorite_facility_unique;
ALTER TABLE player_favorite_facility
  ADD CONSTRAINT player_favorite_facility_unique UNIQUE(player_id, facility_id, sport_id);

-- ============================================
-- STEP 4: Add index on sport_id
-- ============================================

CREATE INDEX IF NOT EXISTS idx_player_favorite_facility_sport_id
  ON player_favorite_facility(sport_id);

-- ============================================
-- STEP 5: Update get_compatible_players to filter by sport
-- ============================================

DROP FUNCTION IF EXISTS get_compatible_players(UUID, UUID, NUMERIC, INT);

CREATE OR REPLACE FUNCTION get_compatible_players(
  p_player_id UUID,
  p_sport_id UUID,
  p_rating_tolerance NUMERIC DEFAULT 1.0,
  p_max_results INT DEFAULT 10
)
RETURNS TABLE(
  player_id UUID,
  display_name TEXT,
  rating_value NUMERIC,
  rating_difference NUMERIC,
  facility_id UUID,
  facility_name VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_rating NUMERIC;
  v_player_city TEXT;
BEGIN
  -- Get the requesting player's rating for this sport
  SELECT rs.value INTO v_player_rating
  FROM player_rating_score prs
  JOIN rating_score rs ON rs.id = prs.rating_score_id
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  WHERE prs.player_id = p_player_id
    AND rsys.sport_id = p_sport_id
  LIMIT 1;

  -- Get player's city for proximity matching
  SELECT pl.city INTO v_player_city
  FROM player pl
  WHERE pl.id = p_player_id;

  -- Default rating if not set
  IF v_player_rating IS NULL THEN
    v_player_rating := 3.5;
  END IF;

  RETURN QUERY
  SELECT
    sub.player_id,
    sub.display_name,
    sub.rating_value::NUMERIC,
    sub.rating_difference::NUMERIC,
    sub.facility_id,
    sub.facility_name
  FROM (
    SELECT DISTINCT ON (p.id)
      p.id AS player_id,
      pr.display_name,
      COALESCE(rs.value, 3.5)::NUMERIC AS rating_value,
      ABS(COALESCE(rs.value, 3.5) - v_player_rating)::NUMERIC AS rating_difference,
      pff.facility_id,
      f.name AS facility_name
    FROM player p
    JOIN profile pr ON pr.id = p.id
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
    LEFT JOIN player_rating_score prs ON prs.player_id = p.id
    LEFT JOIN rating_score rs ON rs.id = prs.rating_score_id
    LEFT JOIN rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
    LEFT JOIN player_favorite_facility pff ON pff.player_id = p.id AND pff.sport_id = p_sport_id
    LEFT JOIN facility f ON f.id = pff.facility_id
    WHERE p.id != p_player_id
      AND ps.is_active = TRUE
      AND ABS(COALESCE(rs.value, 3.5) - v_player_rating) <= p_rating_tolerance
      AND (v_player_city IS NULL OR p.city IS NULL OR p.city = v_player_city)
    ORDER BY p.id, ABS(COALESCE(rs.value, 3.5) - v_player_rating) ASC
  ) sub
  ORDER BY sub.rating_difference ASC, RANDOM()
  LIMIT p_max_results;
END;
$$;

COMMENT ON COLUMN player_favorite_facility.sport_id IS
  'Sport this favorite applies to. Favorites are per-sport, so the same facility can be favorited independently for different sports.';

COMMENT ON FUNCTION get_compatible_players IS
  'Finds players compatible with a given player for a specific sport based on rating and location. Filters favorite facilities by sport.';

-- Migration: Add auto-match generation support
-- This migration adds:
-- 1. is_auto_generated flag to match table
-- 2. Helper function to find compatible players
-- 3. Helper function to generate matches for a player
-- Created: 2026-02-04

-- ============================================
-- ADD is_auto_generated FLAG TO MATCH TABLE
-- ============================================

ALTER TABLE match ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT FALSE;

-- Index for efficient filtering of auto-generated matches
CREATE INDEX IF NOT EXISTS idx_match_is_auto_generated ON match(is_auto_generated);

-- ============================================
-- HELPER: GET COMPATIBLE PLAYERS
-- ============================================

-- Function to find players compatible with a given player for a sport
-- Criteria: same sport, within rating range, within geographic area
CREATE OR REPLACE FUNCTION get_compatible_players(
  p_player_id UUID,
  p_sport_id UUID,
  p_rating_tolerance NUMERIC DEFAULT 1.0,
  p_max_results INT DEFAULT 20
)
RETURNS TABLE (
  player_id UUID,
  display_name TEXT,
  rating_value NUMERIC,
  rating_difference NUMERIC,
  facility_id UUID,
  facility_name TEXT
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
  ORDER BY prs.created_at DESC
  LIMIT 1;
  
  -- Get the requesting player's city
  SELECT pr.city INTO v_player_city
  FROM profile pr
  WHERE pr.id = p_player_id;
  
  -- If player has no rating, use a default middle value
  IF v_player_rating IS NULL THEN
    v_player_rating := 3.5;
  END IF;
  
  RETURN QUERY
  SELECT DISTINCT
    p.id AS player_id,
    pr.display_name,
    COALESCE(rs.value, 3.5) AS rating_value,
    ABS(COALESCE(rs.value, 3.5) - v_player_rating) AS rating_difference,
    pff.facility_id,
    f.name AS facility_name
  FROM player p
  JOIN profile pr ON pr.id = p.id
  JOIN player_sport_profile psp ON psp.player_id = p.id AND psp.sport_id = p_sport_id
  LEFT JOIN player_rating_score prs ON prs.player_id = p.id
  LEFT JOIN rating_score rs ON rs.id = prs.rating_score_id
  LEFT JOIN rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
  LEFT JOIN player_favorite_facility pff ON pff.player_id = p.id
  LEFT JOIN facility f ON f.id = pff.facility_id
  WHERE p.id != p_player_id
    AND psp.is_active = TRUE
    -- Rating within tolerance
    AND ABS(COALESCE(rs.value, 3.5) - v_player_rating) <= p_rating_tolerance
    -- Prefer same city if available
    AND (v_player_city IS NULL OR pr.city IS NULL OR pr.city = v_player_city)
  ORDER BY 
    rating_difference ASC,
    RANDOM()
  LIMIT p_max_results;
END;
$$;

-- ============================================
-- HELPER: GET TIME SLOT START TIMES
-- ============================================

-- Function to get possible start times for a time period
CREATE OR REPLACE FUNCTION get_time_slot_starts(
  p_period TEXT,
  p_duration_minutes INT
)
RETURNS TIME[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_start_hour INT;
  v_end_hour INT;
  v_times TIME[];
  v_current_time TIME;
BEGIN
  -- Define time ranges for each period
  CASE p_period
    WHEN 'morning' THEN
      v_start_hour := 6;
      v_end_hour := 12;
    WHEN 'afternoon' THEN
      v_start_hour := 12;
      v_end_hour := 18;
    WHEN 'evening' THEN
      v_start_hour := 18;
      v_end_hour := 22;
    ELSE
      v_start_hour := 6;
      v_end_hour := 22;
  END CASE;
  
  -- Generate possible start times (every 30 minutes)
  v_times := ARRAY[]::TIME[];
  v_current_time := (v_start_hour || ':00')::TIME;
  
  WHILE v_current_time + (p_duration_minutes || ' minutes')::INTERVAL <= (v_end_hour || ':00')::TIME LOOP
    v_times := array_append(v_times, v_current_time);
    v_current_time := v_current_time + INTERVAL '30 minutes';
  END LOOP;
  
  RETURN v_times;
END;
$$;

-- ============================================
-- HELPER: PARSE DURATION TO MINUTES
-- ============================================

CREATE OR REPLACE FUNCTION parse_match_duration_to_minutes(p_duration TEXT)
RETURNS INT
LANGUAGE plpgsql
AS $$
BEGIN
  CASE p_duration
    WHEN '30' THEN RETURN 30;
    WHEN '60' THEN RETURN 60;
    WHEN '90' THEN RETURN 90;
    WHEN '120' THEN RETURN 120;
    WHEN '1h' THEN RETURN 60;
    WHEN '1.5h' THEN RETURN 90;
    WHEN '2h' THEN RETURN 120;
    ELSE RETURN 60; -- default 1 hour
  END CASE;
END;
$$;

-- ============================================
-- MAIN: GENERATE WEEKLY MATCHES FOR A PLAYER
-- ============================================

CREATE OR REPLACE FUNCTION generate_weekly_matches_for_player(
  p_player_id UUID,
  p_target_match_count INT DEFAULT 10
)
RETURNS TABLE (
  match_id UUID,
  match_date DATE,
  start_time TIME,
  end_time TIME,
  sport_name TEXT,
  facility_name TEXT,
  host_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sport RECORD;
  v_availability RECORD;
  v_compatible_player RECORD;
  v_duration_minutes INT;
  v_possible_times TIME[];
  v_start_time TIME;
  v_match_date DATE;
  v_match_id UUID;
  v_matches_created INT := 0;
  v_day_offset INT;
BEGIN
  -- Loop through player's sports
  FOR v_sport IN
    SELECT 
      psp.sport_id,
      s.name AS sport_name,
      psp.preferred_match_duration,
      psp.preferred_match_type
    FROM player_sport_profile psp
    JOIN sport s ON s.id = psp.sport_id
    WHERE psp.player_id = p_player_id
      AND psp.is_active = TRUE
  LOOP
    -- Get duration in minutes
    v_duration_minutes := parse_match_duration_to_minutes(v_sport.preferred_match_duration::TEXT);
    
    -- Loop through player's availabilities
    FOR v_availability IN
      SELECT pa.day_of_week, pa.time_period
      FROM player_availability pa
      WHERE pa.player_id = p_player_id
        AND pa.is_active = TRUE
    LOOP
      -- Exit if we've created enough matches
      IF v_matches_created >= p_target_match_count THEN
        EXIT;
      END IF;
      
      -- Calculate the date for this day in the upcoming week
      v_day_offset := CASE v_availability.day_of_week::TEXT
        WHEN 'monday' THEN 1
        WHEN 'tuesday' THEN 2
        WHEN 'wednesday' THEN 3
        WHEN 'thursday' THEN 4
        WHEN 'friday' THEN 5
        WHEN 'saturday' THEN 6
        WHEN 'sunday' THEN 7
      END;
      
      -- Get next occurrence of this day
      v_match_date := CURRENT_DATE + ((v_day_offset - EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 7) % 7);
      IF v_match_date <= CURRENT_DATE THEN
        v_match_date := v_match_date + 7;
      END IF;
      
      -- Get possible start times for this period
      v_possible_times := get_time_slot_starts(v_availability.time_period::TEXT, v_duration_minutes);
      
      -- Pick a random start time
      IF array_length(v_possible_times, 1) > 0 THEN
        v_start_time := v_possible_times[1 + floor(random() * array_length(v_possible_times, 1))::INT];
      ELSE
        v_start_time := '09:00'::TIME;
      END IF;
      
      -- Find a compatible player to be the host
      FOR v_compatible_player IN
        SELECT * FROM get_compatible_players(p_player_id, v_sport.sport_id, 1.0, 5)
        ORDER BY RANDOM()
        LIMIT 1
      LOOP
        -- Create the match with the compatible player as host
        INSERT INTO match (
          sport_id,
          created_by,
          match_date,
          start_time,
          end_time,
          timezone,
          match_type,
          format,
          player_expectation,
          duration,
          location_type,
          facility_id,
          location_name,
          is_court_free,
          visibility,
          join_mode,
          notes,
          is_auto_generated
        ) VALUES (
          v_sport.sport_id,
          v_compatible_player.player_id,
          v_match_date,
          v_start_time,
          v_start_time + (v_duration_minutes || ' minutes')::INTERVAL,
          'America/Montreal',
          'casual'::match_type_enum,  -- Default casual match
          'singles'::match_format_enum,  -- Default singles
          CASE 
            WHEN v_sport.preferred_match_type::TEXT = 'both' THEN 'casual'::match_type_enum
            ELSE v_sport.preferred_match_type::match_type_enum
          END,
          v_duration_minutes::TEXT,
          CASE 
            WHEN v_compatible_player.facility_id IS NOT NULL THEN 'facility'::location_type_enum
            ELSE 'tbd'::location_type_enum
          END,
          v_compatible_player.facility_id,
          v_compatible_player.facility_name,
          TRUE,  -- Assume free court for auto-generated
          'public'::match_visibility_enum,
          'request'::match_join_mode_enum,  -- Users must request to join
          'Auto-generated match based on your preferences',
          TRUE
        )
        RETURNING id INTO v_match_id;
        
        -- Add the host as a participant
        INSERT INTO match_participant (
          match_id,
          player_id,
          status,
          is_host
        ) VALUES (
          v_match_id,
          v_compatible_player.player_id,
          'joined'::match_participant_status_enum,
          TRUE
        );
        
        v_matches_created := v_matches_created + 1;
        
        RETURN QUERY
        SELECT 
          v_match_id,
          v_match_date,
          v_start_time,
          v_start_time + (v_duration_minutes || ' minutes')::INTERVAL,
          v_sport.sport_name,
          v_compatible_player.facility_name,
          v_compatible_player.display_name;
          
      END LOOP;
      
    END LOOP;
  END LOOP;
  
  RETURN;
END;
$$;

-- ============================================
-- MAIN: GENERATE WEEKLY MATCHES FOR ALL PLAYERS
-- ============================================

CREATE OR REPLACE FUNCTION generate_weekly_matches_for_all_players(
  p_target_match_count_per_player INT DEFAULT 10
)
RETURNS TABLE (
  player_id UUID,
  player_name TEXT,
  matches_created INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player RECORD;
  v_match_count INT;
BEGIN
  -- Loop through all active players with completed onboarding
  FOR v_player IN
    SELECT 
      p.id,
      pr.display_name
    FROM player p
    JOIN profile pr ON pr.id = p.id
    WHERE pr.is_active = TRUE
      -- Only generate for players who have sport profiles
      AND EXISTS (
        SELECT 1 FROM player_sport_profile psp 
        WHERE psp.player_id = p.id AND psp.is_active = TRUE
      )
      -- Only generate for players who have availabilities
      AND EXISTS (
        SELECT 1 FROM player_availability pa 
        WHERE pa.player_id = p.id AND pa.is_active = TRUE
      )
  LOOP
    -- Generate matches for this player
    SELECT COUNT(*) INTO v_match_count
    FROM generate_weekly_matches_for_player(v_player.id, p_target_match_count_per_player);
    
    player_id := v_player.id;
    player_name := v_player.display_name;
    matches_created := v_match_count;
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION get_compatible_players IS 'Finds players compatible with a given player for a specific sport based on rating and location';
COMMENT ON FUNCTION get_time_slot_starts IS 'Returns possible start times for a given time period and match duration';
COMMENT ON FUNCTION parse_match_duration_to_minutes IS 'Converts duration enum value to minutes';
COMMENT ON FUNCTION generate_weekly_matches_for_player IS 'Generates weekly matches for a single player based on their preferences';
COMMENT ON FUNCTION generate_weekly_matches_for_all_players IS 'Generates weekly matches for all active players - called by cron job';

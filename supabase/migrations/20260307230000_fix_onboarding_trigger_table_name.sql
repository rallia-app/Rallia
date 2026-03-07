-- Migration: Fix all auto-match functions to use correct table name (player_sport instead of player_sport_profile)
-- The table was renamed from player_sport_profile to player_sport but the functions were not updated
-- Created: 2026-03-07

-- ============================================
-- DROP EXISTING FUNCTIONS (return type changed)
-- ============================================

DROP FUNCTION IF EXISTS get_compatible_players(UUID, UUID, NUMERIC, INT);
DROP FUNCTION IF EXISTS generate_weekly_matches_for_player(UUID, INT);
DROP FUNCTION IF EXISTS generate_weekly_matches_for_all_players(INT);

-- ============================================
-- FIX 1: get_compatible_players function
-- ============================================

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
  
  -- Get player's city for proximity matching (city is on player table)
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
    -- FIXED: Use player_sport instead of player_sport_profile
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
    LEFT JOIN player_rating_score prs ON prs.player_id = p.id
    LEFT JOIN rating_score rs ON rs.id = prs.rating_score_id
    LEFT JOIN rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
    LEFT JOIN player_favorite_facility pff ON pff.player_id = p.id
    LEFT JOIN facility f ON f.id = pff.facility_id
    WHERE p.id != p_player_id
      AND ps.is_active = TRUE
      -- Rating within tolerance
      AND ABS(COALESCE(rs.value, 3.5) - v_player_rating) <= p_rating_tolerance
      -- Prefer same city if available (city is on player table)
      AND (v_player_city IS NULL OR p.city IS NULL OR p.city = v_player_city)
    ORDER BY p.id, ABS(COALESCE(rs.value, 3.5) - v_player_rating) ASC
  ) sub
  ORDER BY sub.rating_difference ASC, RANDOM()
  LIMIT p_max_results;
END;
$$;

-- ============================================
-- FIX 2: generate_weekly_matches_for_player function
-- ============================================

CREATE OR REPLACE FUNCTION generate_weekly_matches_for_player(
  p_player_id UUID,
  p_target_match_count INT DEFAULT 5
)
RETURNS TABLE(
  match_id UUID,
  sport_name VARCHAR,
  opponent_name TEXT,
  match_date DATE,
  start_time TIME,
  facility_name VARCHAR
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
  -- FIXED: Use player_sport instead of player_sport_profile
  FOR v_sport IN
    SELECT 
      ps.sport_id,
      s.name AS sport_name,
      ps.preferred_match_duration,
      ps.preferred_match_type
    FROM player_sport ps
    JOIN sport s ON s.id = ps.sport_id
    WHERE ps.player_id = p_player_id
      AND ps.is_active = TRUE
  LOOP
    -- Get duration in minutes
    v_duration_minutes := parse_match_duration_to_minutes(v_sport.preferred_match_duration::TEXT);
    
    -- Loop through player's availabilities
    FOR v_availability IN
      SELECT pa.day, pa.period
      FROM player_availability pa
      WHERE pa.player_id = p_player_id
        AND pa.is_active = TRUE
    LOOP
      -- Exit if we've created enough matches
      IF v_matches_created >= p_target_match_count THEN
        EXIT;
      END IF;
      
      -- Calculate the date for this day in the upcoming week
      v_day_offset := CASE v_availability.day::TEXT
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
      v_possible_times := get_time_slot_starts(v_availability.period::TEXT, v_duration_minutes);
      
      -- Pick a random start time
      IF array_length(v_possible_times, 1) > 0 THEN
        v_start_time := v_possible_times[1 + floor(random() * array_length(v_possible_times, 1))::INT];
      ELSE
        v_start_time := '09:00'::TIME;
      END IF;
      
      -- Find a compatible player to be the host
      FOR v_compatible_player IN
        SELECT * FROM get_compatible_players(p_player_id, v_sport.sport_id, 1.0, 5)
      LOOP
        -- Check if we already have a match with this player on this day
        IF NOT EXISTS (
          SELECT 1 FROM match m
          JOIN match_participant mp1 ON mp1.match_id = m.id AND mp1.player_id = p_player_id
          JOIN match_participant mp2 ON mp2.match_id = m.id AND mp2.player_id = v_compatible_player.player_id
          WHERE m.match_date = v_match_date
            AND m.is_auto_generated = TRUE
        ) THEN
          -- Create the match
          INSERT INTO match (
            sport_id,
            match_date,
            start_time,
            end_time,
            created_by,
            facility_id,
            location_name,
            visibility,
            join_mode,
            player_expectation,
            is_auto_generated,
            timezone
          ) VALUES (
            v_sport.sport_id,
            v_match_date,
            v_start_time,
            v_start_time + (v_duration_minutes || ' minutes')::INTERVAL,
            v_compatible_player.player_id, -- Host is the compatible player
            v_compatible_player.facility_id,
            v_compatible_player.facility_name,
            'public',
            'direct',
            COALESCE(v_sport.preferred_match_type, 'both'),
            TRUE,
            'America/Toronto'
          ) RETURNING id INTO v_match_id;
          
          -- Add the host as participant
          INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
          VALUES (v_match_id, v_compatible_player.player_id, 1, TRUE, 'joined')
          ON CONFLICT ON CONSTRAINT match_participant_match_id_player_id_key DO NOTHING;
          
          -- Add the requesting player as interested
          INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
          VALUES (v_match_id, p_player_id, 2, FALSE, 'pending')
          ON CONFLICT ON CONSTRAINT match_participant_match_id_player_id_key DO NOTHING;
          
          v_matches_created := v_matches_created + 1;
          
          -- Return this match
          match_id := v_match_id;
          sport_name := v_sport.sport_name;
          opponent_name := v_compatible_player.display_name;
          generate_weekly_matches_for_player.match_date := v_match_date;
          generate_weekly_matches_for_player.start_time := v_start_time;
          facility_name := v_compatible_player.facility_name;
          
          RETURN NEXT;
          EXIT; -- Move to next availability slot
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  
  RETURN;
END;
$$;

-- ============================================
-- FIX 3: generate_weekly_matches_for_all_players function
-- ============================================

CREATE OR REPLACE FUNCTION generate_weekly_matches_for_all_players(
  p_target_match_count_per_player INT DEFAULT 5
)
RETURNS TABLE(
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
      -- FIXED: Use player_sport instead of player_sport_profile
      AND EXISTS (
        SELECT 1 FROM player_sport ps 
        WHERE ps.player_id = p.id AND ps.is_active = TRUE
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
-- FIX 4: trigger_match_generation_on_onboarding function
-- ============================================

CREATE OR REPLACE FUNCTION trigger_match_generation_on_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matches_created INT;
  v_target_count INT := 10; -- Generate up to 10 matches for new users
BEGIN
  -- Only trigger when onboarding_completed changes from FALSE/NULL to TRUE
  IF (NEW.onboarding_completed = TRUE) 
     AND (OLD.onboarding_completed IS DISTINCT FROM TRUE) THEN
    
    -- Check if the user has completed enough setup to generate matches
    -- FIXED: Use player_sport instead of player_sport_profile
    IF EXISTS (
      SELECT 1 FROM player_sport ps 
      WHERE ps.player_id = NEW.id AND ps.is_active = TRUE
    ) AND EXISTS (
      SELECT 1 FROM player_availability pa 
      WHERE pa.player_id = NEW.id AND pa.is_active = TRUE
    ) THEN
      
      -- Generate matches for this player
      SELECT COUNT(*) INTO v_matches_created
      FROM generate_weekly_matches_for_player(NEW.id, v_target_count);
      
      -- Log the result (visible in Supabase logs)
      RAISE LOG 'Auto-match generation on onboarding: player_id=%, matches_created=%', 
                NEW.id, v_matches_created;
    ELSE
      RAISE LOG 'Auto-match generation skipped (missing sport profile or availability): player_id=%', 
                NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION get_compatible_players IS 'Finds players compatible with a given player for a specific sport based on rating and location. Fixed to use player_sport table.';
COMMENT ON FUNCTION generate_weekly_matches_for_player IS 'Generates weekly matches for a single player based on their preferences. Fixed to use player_sport table.';
COMMENT ON FUNCTION generate_weekly_matches_for_all_players IS 'Generates weekly matches for all active players - called by cron job. Fixed to use player_sport table.';
COMMENT ON FUNCTION trigger_match_generation_on_onboarding IS 'Trigger function that automatically generates weekly matches for a user when they complete onboarding. Fixed to use player_sport table.';

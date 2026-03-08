-- ============================================================================
-- Migration: Add nearby_match_available notification type + spatial trigger
-- Created: 2026-03-07
-- Description: Adds notification type for notifying players when a new match
--              is created near their location (based on max_travel_distance).
--              Excludes group members (who already get match_new_available)
--              and the match creator.
-- ============================================================================

-- =============================================================================
-- STEP 1: Add new notification type
-- =============================================================================
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'nearby_match_available';

-- =============================================================================
-- STEP 2: Trigger function - notify nearby players on match creation
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_nearby_players_on_match_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_point       extensions.geography;
  v_sport_name        TEXT;
  v_player_group_type_id UUID;
  v_notifications     JSONB := '[]'::JSONB;
BEGIN
  -- ---------------------------------------------------------------
  -- Determine the match location as a geography point
  -- ---------------------------------------------------------------
  IF NEW.location_type = 'facility' AND NEW.facility_id IS NOT NULL THEN
    SELECT f.location INTO v_match_point
    FROM facility f
    WHERE f.id = NEW.facility_id AND f.location IS NOT NULL
    LIMIT 1;
  ELSIF NEW.location_type = 'custom'
        AND NEW.custom_latitude IS NOT NULL
        AND NEW.custom_longitude IS NOT NULL THEN
    v_match_point := extensions.ST_SetSRID(
      extensions.ST_MakePoint(NEW.custom_longitude, NEW.custom_latitude),
      4326
    )::extensions.geography;
  END IF;

  -- If no resolvable location, nothing to do
  IF v_match_point IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sport name for payload
  SELECT s.name INTO v_sport_name
  FROM sport s
  WHERE s.id = NEW.sport_id
  LIMIT 1;

  -- Get player_group network type id (to exclude group members who already get match_new_available)
  SELECT id INTO v_player_group_type_id
  FROM network_type
  WHERE name = 'player_group'
  LIMIT 1;

  -- ---------------------------------------------------------------
  -- Build batch of notifications for nearby players
  -- ---------------------------------------------------------------
  WITH group_members AS (
    -- All players in creator's player groups (they already get match_new_available)
    SELECT DISTINCT nm2.player_id
    FROM network_member nm1
    JOIN network n ON n.id = nm1.network_id
                  AND n.network_type_id = v_player_group_type_id
    JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = NEW.created_by
      AND nm1.status = 'active'
      AND v_player_group_type_id IS NOT NULL
  ),
  nearby_players AS (
    SELECT p.id AS user_id
    FROM player p
    WHERE p.location IS NOT NULL
      AND p.max_travel_distance IS NOT NULL
      AND p.max_travel_distance > 0
      AND p.id != NEW.created_by
      -- Spatial filter: player within their max_travel_distance of the match
      AND extensions.ST_DWithin(
            p.location,
            v_match_point,
            p.max_travel_distance * 1000  -- km → meters
          )
      -- Exclude group members (dedup with match_new_available)
      AND p.id NOT IN (SELECT gm.player_id FROM group_members gm)
      -- Exclude anyone already a participant
      AND p.id NOT IN (
        SELECT mp.player_id FROM match_participant mp WHERE mp.match_id = NEW.id
      )
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', np.user_id,
        'type', 'nearby_match_available',
        'target_id', NEW.id,
        'title', 'New match nearby',
        'body', 'A ' || COALESCE(v_sport_name, 'sports') || ' match is available near you. Tap to view!',
        'payload', jsonb_build_object(
          'matchId', NEW.id,
          'creatorId', NEW.created_by,
          'sportName', COALESCE(v_sport_name, '')
        ),
        'priority', 'normal'
      )
    ),
    '[]'::JSONB
  )
  INTO v_notifications
  FROM nearby_players np;

  IF jsonb_array_length(v_notifications) > 0 THEN
    PERFORM insert_notifications(v_notifications);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_nearby_players_on_match_created() IS
  'After a match is inserted with a known location: notifies nearby players (within their max_travel_distance) excluding the creator and group members who already receive match_new_available.';

-- =============================================================================
-- STEP 3: Create trigger on match
-- =============================================================================
DROP TRIGGER IF EXISTS match_notify_nearby_players_on_create ON match;
CREATE TRIGGER match_notify_nearby_players_on_create
  AFTER INSERT ON match
  FOR EACH ROW
  EXECUTE FUNCTION notify_nearby_players_on_match_created();

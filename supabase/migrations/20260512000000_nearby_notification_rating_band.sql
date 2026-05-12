-- ============================================================================
-- Migration: Replace nearby notification skill-floor with a ±0.5 rating band
-- Created: 2026-05-12
-- Description: Previously notify_nearby_players_on_match_created() notified
--              every player whose skill_level was >= the match's minimum. We
--              now want to notify only players whose numeric rating value sits
--              within ±0.5 of the match's min_rating_score value. Players with
--              no rating for the match's sport are still excluded when a
--              minimum is set.
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_nearby_players_on_match_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_point          extensions.geography;
  v_sport_name           TEXT;
  v_player_group_type_id UUID;
  v_min_rating_score     NUMERIC;
  v_min_rating_label     TEXT;
  v_location_name        TEXT;
  v_timezone             TEXT;
  v_host_name            TEXT;
  v_spots_left           INT;
  v_match_date_text      TEXT;
  v_start_time_text      TEXT;
  v_fallback_title       TEXT;
  v_fallback_body        TEXT;
  v_notifications        JSONB := '[]'::JSONB;
BEGIN
  -- Only send nearby notifications for public matches
  IF NEW.visibility IS DISTINCT FROM 'public' THEN
    RETURN NEW;
  END IF;

  -- Resolve the match location as a geography point + a human-readable name
  IF NEW.location_type = 'facility' AND NEW.facility_id IS NOT NULL THEN
    SELECT f.location, f.name, f.timezone
      INTO v_match_point, v_location_name, v_timezone
    FROM facility f
    WHERE f.id = NEW.facility_id
    LIMIT 1;
  ELSIF NEW.location_type = 'custom'
        AND NEW.custom_latitude IS NOT NULL
        AND NEW.custom_longitude IS NOT NULL THEN
    v_match_point := extensions.ST_SetSRID(
      extensions.ST_MakePoint(NEW.custom_longitude, NEW.custom_latitude),
      4326
    )::extensions.geography;
    v_location_name := NULLIF(TRIM(NEW.location_name), '');
  END IF;

  IF v_match_point IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.name INTO v_sport_name
  FROM sport s
  WHERE s.id = NEW.sport_id
  LIMIT 1;

  SELECT COALESCE(NULLIF(TRIM(p.first_name), ''), NULLIF(TRIM(p.display_name), ''))
    INTO v_host_name
  FROM profile p
  WHERE p.id = NEW.created_by
  LIMIT 1;

  -- Resolve the match's minimum rating value (numeric). This now drives both
  -- the recipient band filter and the user-facing label.
  IF NEW.min_rating_score_id IS NOT NULL THEN
    SELECT rs.value INTO v_min_rating_score
    FROM rating_score rs
    WHERE rs.id = NEW.min_rating_score_id
    LIMIT 1;
  END IF;

  IF v_min_rating_score IS NOT NULL THEN
    v_min_rating_label := to_char(v_min_rating_score, 'FM999990.0');
  END IF;

  v_spots_left := CASE WHEN NEW.format = 'doubles' THEN 3 ELSE 1 END;

  v_match_date_text := to_char(NEW.match_date, 'YYYY-MM-DD');
  v_start_time_text := to_char(NEW.start_time, 'HH24:MI');

  SELECT id INTO v_player_group_type_id
  FROM network_type
  WHERE name = 'player_group'
  LIMIT 1;

  v_fallback_title := 'New ' || COALESCE(v_sport_name, 'sports') || ' game nearby';
  v_fallback_body := concat_ws(
    ' · ',
    NULLIF(to_char(NEW.match_date, 'FMMonth FMDDth') || ' at ' || to_char(NEW.start_time, 'FMHH12:MI AM'), ''),
    v_location_name,
    CASE WHEN v_min_rating_label IS NOT NULL THEN v_min_rating_label || '+' END,
    CASE
      WHEN v_spots_left = 1 THEN '1 spot left'
      WHEN v_spots_left > 1 THEN v_spots_left::TEXT || ' spots left'
    END,
    CASE WHEN v_host_name IS NOT NULL THEN 'with ' || v_host_name END
  );

  WITH group_members AS (
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
    WHERE p.id != NEW.created_by
      AND (
        (
          p.location IS NOT NULL
          AND p.max_travel_distance IS NOT NULL
          AND p.max_travel_distance > 0
          AND extensions.ST_DWithin(
                p.location,
                v_match_point,
                p.max_travel_distance * 1000
              )
        )
        OR (
          NEW.facility_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM player_favorite_facility pff
            WHERE pff.player_id = p.id AND pff.facility_id = NEW.facility_id
          )
        )
      )
      AND p.id NOT IN (SELECT gm.player_id FROM group_members gm)
      AND p.id NOT IN (
        SELECT mp.player_id FROM match_participant mp WHERE mp.match_id = NEW.id
      )
      AND p.id IN (
        SELECT ps.player_id FROM player_sport ps
        WHERE ps.sport_id = NEW.sport_id AND ps.is_active = TRUE
      )
      -- Rating band: when match sets a minimum, player must have at least one
      -- rating for this sport whose numeric value sits within ±0.5 of it.
      -- Players with no rating for the sport are filtered out by the IN clause.
      AND (
        NEW.min_rating_score_id IS NULL
        OR p.id IN (
          SELECT prs.player_id
          FROM player_rating_score prs
          JOIN rating_score rs ON rs.id = prs.rating_score_id
          JOIN rating_system r ON r.id = rs.rating_system_id
          WHERE r.sport_id = NEW.sport_id
            AND rs.value BETWEEN v_min_rating_score - 0.5
                             AND v_min_rating_score + 0.5
        )
      )
      AND (
        NEW.preferred_opponent_gender IS NULL
        OR p.gender = NEW.preferred_opponent_gender
      )
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', np.user_id,
        'type', 'nearby_match_available',
        'target_id', NEW.id,
        'title', v_fallback_title,
        'body', v_fallback_body,
        'payload', jsonb_build_object(
          'matchId', NEW.id,
          'creatorId', NEW.created_by,
          'sportName', COALESCE(v_sport_name, ''),
          'matchDate', v_match_date_text,
          'startTime', v_start_time_text,
          'locationName', v_location_name,
          'minRatingScore', v_min_rating_label,
          'spotsLeft', v_spots_left,
          'format', NEW.format::TEXT,
          'timezone', COALESCE(v_timezone, 'America/Toronto'),
          'hostName', v_host_name
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
  'After a public match is inserted with a known location: notifies nearby players (within their max_travel_distance, or who have favorited the facility) whose rating for the match sport is within ±0.5 of the match minimum. Excludes the creator and group members who already receive match_new_available.';

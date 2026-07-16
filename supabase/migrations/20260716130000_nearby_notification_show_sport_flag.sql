-- =============================================================================
-- Nearby-match notification: per-recipient showSport flag
--
-- The push copy only names the sport when it's meaningful to the recipient: a
-- player with a single active sport already knows what "a game near you" means,
-- so naming it is noise. Only multi-sport players (tennis AND pickleball active)
-- need the sport spelled out. We compute that per recipient at creation time and
-- stash it in the payload as `showSport`; the send-notification renderer reads it.
--
-- Only the payload gains a field. Radius, frequency cap, rating gate, exclusions
-- and sport/gender filters are unchanged from 20260716120000.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_nearby_players_on_match_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match_point          extensions.geography;
  v_sport_name           TEXT;
  v_player_group_type_id UUID;
  v_min_rating_score     NUMERIC;
  v_min_rating_label     TEXT;
  v_gate_rating_score_id UUID;
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

  -- Resolve the match's minimum rating value (numeric) for the notification label.
  IF NEW.min_rating_score_id IS NOT NULL THEN
    SELECT rs.value INTO v_min_rating_score
    FROM rating_score rs
    WHERE rs.id = NEW.min_rating_score_id
    LIMIT 1;
  END IF;

  IF v_min_rating_score IS NOT NULL THEN
    v_min_rating_label := to_char(v_min_rating_score, 'FM999990.0');
  END IF;

  -- Resolve the rating to gate recipients on: the explicit match minimum if set,
  -- otherwise the host's active rating for the sport. NULL only when neither
  -- exists (no minimum AND an unrated host) -> no rating filter.
  IF NEW.min_rating_score_id IS NOT NULL THEN
    v_gate_rating_score_id := NEW.min_rating_score_id;
  ELSE
    SELECT prs.rating_score_id INTO v_gate_rating_score_id
    FROM player_sport hps
    JOIN player_rating_score prs ON prs.id = hps.active_rating_score_id
    WHERE hps.player_id = NEW.created_by
      AND hps.sport_id  = NEW.sport_id
    LIMIT 1;
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
          -- Cap the notification radius at 5 km even when the player is willing
          -- to travel further for a match they choose.
          AND extensions.ST_DWithin(
                p.location,
                v_match_point,
                LEAST(p.max_travel_distance, 5) * 1000
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
      -- Frequency cap: no more than 3 nearby-match pushes per rolling 7 days.
      AND (
        SELECT count(*)
        FROM notification n
        WHERE n.user_id = p.id
          AND n.type = 'nearby_match_available'
          AND n.created_at >= now() - INTERVAL '7 days'
      ) < 3
      -- Rating gate: the player's ACTIVE rating for this sport must be the exact
      -- same rating (same rating_score -> same system + value) as the gating
      -- rating, which is the explicit match minimum if set, else the host's
      -- active rating. When neither exists the gate is open. Players with no
      -- active rating for the sport are excluded whenever a gate applies.
      AND (
        v_gate_rating_score_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM player_sport ps_rating
          JOIN player_rating_score prs ON prs.id = ps_rating.active_rating_score_id
          WHERE ps_rating.player_id = p.id
            AND ps_rating.sport_id  = NEW.sport_id
            AND prs.rating_score_id = v_gate_rating_score_id
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
          -- Only name the sport for multi-sport recipients: those with at least
          -- one OTHER active sport besides this match's. Single-sport players get
          -- a sport-agnostic body.
          'showSport', EXISTS (
            SELECT 1 FROM player_sport ps_multi
            WHERE ps_multi.player_id = np.user_id
              AND ps_multi.is_active = TRUE
              AND ps_multi.sport_id <> NEW.sport_id
          ),
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
$function$;

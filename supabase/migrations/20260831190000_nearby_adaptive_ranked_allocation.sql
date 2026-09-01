-- =============================================================================
-- Nearby-match notification: adaptive ceiling, ranked allocation, point fallback
--
-- Join attribution (discovery_push_outcome, 20260831180000) replaced read_at as
-- the outcome metric and changed what the gate should do. Three findings, all
-- measured over 2026-06-01 onward:
--
-- 1. Per-match fanout is where the waste is. Matches with 31+ recipients burned
--    26,893 pushes (80% of all volume) for 62 joins, while the odds of a match
--    getting at least one join barely move past 8-15 recipients (13.7% -> 14.9%).
--    Beyond ~15 we are paying 13x the volume for ~1pp of fill.
--
-- 2. Cold recipients dominate spend. In August, players with 20+ prior pushes
--    and zero conversions took 2,386 pushes (49% of volume) and produced 2 joins
--    (0.08%). New players converted at 3.03% and prior converters at 2.15%.
--
-- 3. 15 public games reached nobody because they carry no facility and no custom
--    coordinates, so v_match_point was NULL and both reach branches failed.
--
-- Changes:
--   a. Match point falls back to the host's home location. Hosts with no
--      location still return early, as before.
--   b. Recipients are ranked (declared availability covering the game hour
--      first, then proximity) and capped at 15 per match. This mirrors the
--      ordering send_last_minute_spot_pushes already uses.
--   c. The flat 3-per-7-days cap becomes an adaptive ceiling: 5 for players who
--      converted in the last 60 days, 1 for players with 20+ pushes and no
--      conversion, 3 otherwise. New players keep the default, so nobody is cold
--      before they have had a chance.
--
-- The ceiling is a rolling 60-day window, so a throttled player recovers as
-- their unconverted pushes age out. Policy lives in discovery_ceiling() so the
-- last-minute lane can adopt the same tiers without the numbers drifting apart.
--
-- Rating gate, 5 km radius cap, sport/gender filters, group and participant
-- exclusions, copy and payload are all unchanged. Body otherwise copied from
-- 20260716140000_nearby_notification_fallback_copy_align.sql, the latest
-- definition of this function.
--
-- Not changed here: send_last_minute_spot_pushes keeps its own flat budget of 2
-- from 20260831170000. It has no send history yet, so there is nothing to tune
-- against. Revisit once it has a few weeks of attributed outcomes.
-- =============================================================================

-- Supports the 60-day history lookup across both discovery types.
CREATE INDEX IF NOT EXISTS idx_notification_discovery_user_created
  ON public.notification (user_id, created_at)
  WHERE type IN ('nearby_match_available', 'match_last_minute_spots');

-- Shared tier policy. Takes counts, does no I/O, so both call sites can reuse it
-- without duplicating the thresholds.
CREATE OR REPLACE FUNCTION public.discovery_ceiling(
  p_pushes_60d integer,
  p_joins_60d  integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_joins_60d, 0) > 0  THEN 5  -- converts, earn headroom
    WHEN COALESCE(p_pushes_60d, 0) >= 20 THEN 1  -- 0.08% join rate, throttle
    ELSE 3                                       -- default, includes new players
  END;
$function$;

COMMENT ON FUNCTION public.discovery_ceiling(integer, integer) IS
  'Discovery pushes allowed per rolling 7 days, given a player 60-day push and join counts. Tiers set from measured join rates: converters 2.15%, new 3.03%, cold (20+ pushes, 0 joins) 0.08%.';

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
  v_when_text            TEXT;
  v_day_delta            INT;
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

  -- Fallback: a public game with neither a facility nor coordinates still
  -- deserves reach. Anchor the fanout on the host's home location.
  IF v_match_point IS NULL THEN
    SELECT pl.location INTO v_match_point
    FROM player pl
    WHERE pl.id = NEW.created_by
    LIMIT 1;

    v_location_name := COALESCE(v_location_name, NULLIF(TRIM(NEW.location_name), ''));
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

  -- Human-readable "when": Today / Tomorrow / weekday / "Wed, Aug 5", mirroring
  -- the push renderer's cascade. Today/Tomorrow stay lowercase because the sport
  -- lead ("Tennis today ...") precedes them; weekdays/dates keep their capital.
  v_day_delta := NEW.match_date
                 - (now() AT TIME ZONE COALESCE(v_timezone, 'America/Toronto'))::date;
  v_when_text := CASE
    WHEN v_day_delta = 0 THEN 'today'
    WHEN v_day_delta = 1 THEN 'tomorrow'
    WHEN v_day_delta BETWEEN 2 AND 6 THEN to_char(NEW.match_date, 'FMDay')
    ELSE to_char(NEW.match_date, 'FMDy, FMMon FMDD')
  END;

  v_fallback_title := CASE
    WHEN v_host_name IS NOT NULL THEN v_host_name || ' wants to play near you'
    ELSE 'New game near you'
  END;

  v_fallback_body :=
    -- Sport lead (capitalized); when absent the "when" carries the capital.
    CASE
      WHEN v_sport_name IS NOT NULL
        THEN upper(left(v_sport_name, 1)) || substr(v_sport_name, 2) || ' ' || v_when_text
      ELSE upper(left(v_when_text, 1)) || substr(v_when_text, 2)
    END
    || CASE WHEN NEW.start_time IS NOT NULL
            THEN ' at ' || to_char(NEW.start_time, 'FMHH12:MI AM') ELSE '' END
    || CASE WHEN v_location_name IS NOT NULL THEN ' at ' || v_location_name ELSE '' END
    || '. '
    || CASE
         WHEN v_spots_left = 1 THEN '1 spot left, tap to join!'
         WHEN v_spots_left > 1 THEN v_spots_left::TEXT || ' spots left, tap to join!'
         ELSE 'Tap to join!'
       END;

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
  -- Cheap eligibility first, so the per-player history scans below run over the
  -- candidate set rather than the whole player table.
  candidates AS (
    SELECT p.id AS user_id, p.location AS player_location
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
  ),
  -- Spend so far this window, against the 60-day record that sets the ceiling.
  budget AS (
    SELECT
      c.user_id,
      count(*) FILTER (
        WHERE n.type = 'nearby_match_available'
          AND n.created_at >= now() - INTERVAL '7 days'
      ) AS pushes_7d,
      count(n.id) AS pushes_60d,
      count(mp.id) AS joins_60d
    FROM candidates c
    LEFT JOIN notification n
           ON n.user_id = c.user_id
          AND n.type IN ('nearby_match_available', 'match_last_minute_spots')
          AND n.created_at >= now() - INTERVAL '60 days'
    LEFT JOIN match_participant mp
           ON mp.match_id  = n.target_id
          AND mp.player_id = n.user_id
          AND mp.status IN ('joined', 'requested')
          AND COALESCE(mp.joined_at, mp.requested_at, mp.created_at) > n.created_at
    GROUP BY c.user_id
  ),
  nearby_players AS (
    SELECT c.user_id
    FROM candidates c
    JOIN budget b ON b.user_id = c.user_id
    WHERE b.pushes_7d < public.discovery_ceiling(b.pushes_60d::int, b.joins_60d::int)
    ORDER BY
      -- Hot players first: declared availability covering the game hour.
      EXISTS (
        SELECT 1 FROM player_availability pa
        WHERE pa.player_id = c.user_id
          AND pa.is_active
          AND pa.day::text = trim(lower(to_char(NEW.match_date, 'day')))
          AND pa.hour_of_day = extract(hour FROM NEW.start_time)::int
      ) DESC,
      extensions.ST_Distance(c.player_location, v_match_point) ASC NULLS LAST
    LIMIT 15
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

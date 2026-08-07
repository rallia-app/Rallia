-- ============================================================================
-- Migration: Last-minute open-spots push
-- Created: 2026-08-05
-- Description: Momentum harvesting item 6. Public, non-auto games starting in
--              2-6 hours that still have open spots get pushed to nearby,
--              rating-compatible players, prioritizing players whose declared
--              availability covers the game's weekday+hour ("hot" players),
--              then proximity.
--
-- Guardrails:
--   - Recipient gates mirror notify_nearby_players_on_match_created: 5 km /
--     max_travel radius OR favorited facility, sport active, exact-rating
--     equality vs the match minimum (else host rating), gender preference,
--     participants/host/player-group members excluded.
--   - Shared discovery budget: nearby_match_available AND
--     match_last_minute_spots pushes COMBINED must stay under 3 in the
--     trailing 7 days for the recipient (this sweep counts both types; the
--     nearby trigger keeps its own cap).
--   - One send ever per (match, player), max 20 recipients per match per run.
--   - Court state is copy flavor, not a gate: "court is booked" when
--     reserved, otherwise a neutral close.
-- ============================================================================

-- Cheap per-recipient dedup + budget scans as the table grows.
CREATE INDEX IF NOT EXISTS idx_notification_last_minute_user_created
  ON public.notification (user_id, created_at)
  WHERE type = 'match_last_minute_spots';

CREATE OR REPLACE FUNCTION public.send_last_minute_spot_pushes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_sent integer;
  v_player_group_type_id uuid;
  r record;
BEGIN
  SELECT id INTO v_player_group_type_id
  FROM network_type WHERE name = 'player_group' LIMIT 1;

  FOR r IN
    SELECT
      m.id,
      m.created_by,
      m.sport_id,
      m.facility_id,
      m.format,
      m.min_rating_score_id,
      m.preferred_opponent_gender,
      m.match_date,
      m.start_time,
      m.court_status,
      sp.name AS sport_name,
      CASE
        WHEN m.location_type = 'facility' THEN f.location
        WHEN m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
          )::extensions.geography
      END AS match_point,
      COALESCE(f.name, NULLIF(TRIM(m.location_name), '')) AS location_name,
      (m.match_date + m.start_time)
        AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC') AS start_ts,
      CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        - (SELECT count(*) FROM match_participant mp
            WHERE mp.match_id = m.id AND mp.status = 'joined') AS spots_left
    FROM public.match m
    LEFT JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp ON sp.id = m.sport_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND COALESCE(m.is_auto_generated, false) = false
  LOOP
    CONTINUE WHEN r.match_point IS NULL;
    CONTINUE WHEN r.start_ts <= now() + interval '2 hours'
             OR r.start_ts > now() + interval '6 hours';
    CONTINUE WHEN r.spots_left <= 0;

    WITH gate AS (
      SELECT COALESCE(
        r.min_rating_score_id,
        (SELECT prs.rating_score_id
           FROM player_sport hps
           JOIN player_rating_score prs ON prs.id = hps.active_rating_score_id
          WHERE hps.player_id = r.created_by AND hps.sport_id = r.sport_id
          LIMIT 1)
      ) AS rating_score_id
    ),
    group_members AS (
      SELECT DISTINCT nm2.player_id
      FROM network_member nm1
      JOIN network n ON n.id = nm1.network_id
                    AND n.network_type_id = v_player_group_type_id
      JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                             AND nm2.status = 'active'
      WHERE nm1.player_id = r.created_by
        AND nm1.status = 'active'
        AND v_player_group_type_id IS NOT NULL
    ),
    recipients AS (
      SELECT p.id AS user_id
      FROM player p, gate g
      WHERE p.id != r.created_by
        AND (
          (
            p.location IS NOT NULL
            AND p.max_travel_distance IS NOT NULL
            AND p.max_travel_distance > 0
            AND extensions.ST_DWithin(
                  p.location, r.match_point,
                  LEAST(p.max_travel_distance, 5) * 1000)
          )
          OR (
            r.facility_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM player_favorite_facility pff
              WHERE pff.player_id = p.id AND pff.facility_id = r.facility_id
            )
          )
        )
        AND p.id NOT IN (SELECT gm.player_id FROM group_members gm)
        AND p.id NOT IN (
          SELECT mp.player_id FROM match_participant mp WHERE mp.match_id = r.id
        )
        AND p.id IN (
          SELECT ps.player_id FROM player_sport ps
          WHERE ps.sport_id = r.sport_id AND ps.is_active = TRUE
        )
        -- One send ever per (match, player).
        AND NOT EXISTS (
          SELECT 1 FROM notification n
          WHERE n.user_id = p.id
            AND n.type = 'match_last_minute_spots'
            AND n.target_id = r.id
        )
        -- Shared discovery budget across nearby + last-minute pushes.
        AND (
          SELECT count(*)
          FROM notification n
          WHERE n.user_id = p.id
            AND n.type IN ('nearby_match_available', 'match_last_minute_spots')
            AND n.created_at >= now() - INTERVAL '7 days'
        ) < 3
        -- Exact-rating equality vs the gate rating (match min, else host).
        AND (
          g.rating_score_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM player_sport ps_rating
            JOIN player_rating_score prs ON prs.id = ps_rating.active_rating_score_id
            WHERE ps_rating.player_id = p.id
              AND ps_rating.sport_id  = r.sport_id
              AND prs.rating_score_id = g.rating_score_id
          )
        )
        AND (
          r.preferred_opponent_gender IS NULL
          OR p.gender = r.preferred_opponent_gender
        )
      ORDER BY
        -- Hot players first: declared availability covering the game hour.
        EXISTS (
          SELECT 1 FROM player_availability pa
          WHERE pa.player_id = p.id
            AND pa.is_active
            AND pa.day::text = trim(lower(to_char(r.match_date, 'day')))
            AND pa.hour_of_day = extract(hour FROM r.start_time)::int
        ) DESC,
        extensions.ST_Distance(p.location, r.match_point) ASC NULLS LAST
      LIMIT 20
    )
    INSERT INTO notification (user_id, type, title, body, payload, target_id, priority)
    SELECT
      rec.user_id,
      'match_last_minute_spots',
      CASE WHEN public.lt_user_is_fr(rec.user_id)
        THEN 'Ça commence bientôt · ' || COALESCE(r.sport_name, 'partie')
          || COALESCE(' à ' || r.location_name, '')
        ELSE 'Starting soon · ' || COALESCE(r.sport_name, 'game')
          || COALESCE(' at ' || r.location_name, '')
      END,
      CASE WHEN public.lt_user_is_fr(rec.user_id)
        THEN 'Aujourd''hui à ' || to_char(r.start_time, 'HH24:MI') || '. '
          || r.spots_left || CASE WHEN r.spots_left > 1 THEN ' places libres' ELSE ' place libre' END
          || CASE WHEN r.court_status = 'reserved'::public.court_status_enum
               THEN ' et le terrain est réservé.' ELSE '.' END
          || ' Touche pour rejoindre.'
        ELSE 'Today at ' || to_char(r.start_time, 'FMHH12:MI AM') || '. '
          || r.spots_left || CASE WHEN r.spots_left > 1 THEN ' spots open' ELSE ' spot open' END
          || CASE WHEN r.court_status = 'reserved'::public.court_status_enum
               THEN ' and the court is booked.' ELSE '.' END
          || ' Tap to join.'
      END,
      jsonb_build_object(
        'matchId', r.id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(r.match_date, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'locationName', r.location_name,
        'spotsLeft', r.spots_left,
        'courtReserved', (r.court_status = 'reserved'::public.court_status_enum)
      ),
      r.id,
      'high'
    FROM recipients rec;

    GET DIAGNOSTICS v_sent = ROW_COUNT;
    v_total := v_total + v_sent;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.send_last_minute_spot_pushes() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_last_minute_spot_pushes() IS
  'Momentum item 6: pushes public games starting in 2-6h with open spots to nearby exact-rating players, availability-fit first. Run by pg_cron every 15 minutes.';

SELECT cron.unschedule('send-last-minute-spot-pushes')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-last-minute-spot-pushes');

SELECT cron.schedule(
  'send-last-minute-spot-pushes',
  '7,22,37,52 * * * *',
  $$ SELECT public.send_last_minute_spot_pushes(); $$
);

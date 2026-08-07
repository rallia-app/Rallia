-- ============================================================================
-- Migration: Play-rhythm gap nudge
-- Created: 2026-08-05
-- Description: Momentum harvesting item 8. "If they always play Thursday 6pm
--              and nothing is planned this week, surface a compatible game in
--              time." Declared rhythm is first-class data: player_availability
--              rows (weekday x hour), refreshed by the weekly check-in.
--
-- Daily sweep, one day ahead: for each player whose declared slot falls
-- TOMORROW, is fresh (confirmed within 60 days), and has no commitment at
-- that hour yet, find one compatible open public game in that slot (gates
-- mirror get_checkin_match_opportunities: exact active-rating equality on
-- the match minimum, gender, favorite facility or within min(10km,
-- max_travel)) and push it. Deep-links to the game itself.
--
-- Fatigue: at most one play_rhythm_nudge per player per rolling 7 days.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notification_rhythm_user_created
  ON public.notification (user_id, created_at)
  WHERE type = 'play_rhythm_nudge';

CREATE OR REPLACE FUNCTION public.send_play_rhythm_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_tomorrow date := (CURRENT_DATE + 1);
  v_day text;
  v_day_fr text;
  r record;
BEGIN
  v_day := CASE EXTRACT(isodow FROM v_tomorrow)::int
    WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'  WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'  WHEN 5 THEN 'friday'   WHEN 6 THEN 'saturday'
    WHEN 7 THEN 'sunday' END;
  v_day_fr := CASE v_day
    WHEN 'monday' THEN 'lundi'      WHEN 'tuesday' THEN 'mardi'
    WHEN 'wednesday' THEN 'mercredi' WHEN 'thursday' THEN 'jeudi'
    WHEN 'friday' THEN 'vendredi'   WHEN 'saturday' THEN 'samedi'
    WHEN 'sunday' THEN 'dimanche' END;

  FOR r IN
    -- DISTINCT ON: a player with several free slots tomorrow still gets ONE nudge.
    SELECT DISTINCT ON (p.id)
      p.id AS user_id,
      pick.match_id,
      pick.start_time,
      pick.sport_name,
      pick.location_name
    FROM public.player p
    -- Player has a fresh declared slot tomorrow...
    JOIN LATERAL (
      SELECT pa.hour_of_day
      FROM public.player_availability pa
      WHERE pa.player_id = p.id
        AND pa.is_active
        AND pa.day::text = v_day
        AND COALESCE(pa.last_confirmed_at, pa.updated_at) >= now() - interval '60 days'
    ) slot ON TRUE
    -- ...with no commitment at that hour yet...
    JOIN LATERAL (
      SELECT 1 AS free
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.match_participant mp
        JOIN public.match mc ON mc.id = mp.match_id
        WHERE mp.player_id = p.id
          AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
          AND mc.cancelled_at IS NULL
          AND mc.match_date = v_tomorrow
          AND EXTRACT(hour FROM mc.start_time)::int = slot.hour_of_day
      )
    ) gap ON TRUE
    -- ...and one compatible open public game exists for the slot.
    JOIN LATERAL (
      SELECT m.id AS match_id, m.start_time, sp.name AS sport_name,
             COALESCE(f.name, NULLIF(TRIM(m.location_name), '')) AS location_name
      FROM public.match m
      JOIN public.sport sp ON sp.id = m.sport_id
      JOIN public.player_sport ps
        ON ps.player_id = p.id AND ps.sport_id = m.sport_id AND ps.is_active
      JOIN public.player_rating_score prs
        ON prs.id = ps.active_rating_score_id
       AND m.min_rating_score_id = prs.rating_score_id
      LEFT JOIN public.facility f ON f.id = m.facility_id AND f.is_active = TRUE
      WHERE m.visibility = 'public'
        AND m.cancelled_at IS NULL
        AND m.min_rating_score_id IS NOT NULL
        AND m.created_by <> p.id
        AND m.match_date = v_tomorrow
        AND EXTRACT(hour FROM m.start_time)::int = slot.hour_of_day
        AND (m.preferred_opponent_gender IS NULL OR m.preferred_opponent_gender = p.gender)
        AND (SELECT count(*) FROM match_participant mp2
              WHERE mp2.match_id = m.id AND mp2.status = 'joined')
            < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        AND NOT EXISTS (
          SELECT 1 FROM match_participant mp3
          WHERE mp3.match_id = m.id
            AND mp3.player_id = p.id
            AND mp3.status IN ('joined', 'requested', 'pending', 'waitlisted')
        )
        AND (
          (m.facility_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM player_favorite_facility pff
            WHERE pff.player_id = p.id AND pff.facility_id = m.facility_id))
          OR (
            p.location IS NOT NULL
            AND f.location IS NOT NULL
            AND extensions.ST_DWithin(
                  p.location, f.location,
                  LEAST(COALESCE(p.max_travel_distance, 10), 10) * 1000)
          )
        )
      ORDER BY
        EXISTS (SELECT 1 FROM player_favorite_facility pff2
                 WHERE pff2.player_id = p.id AND pff2.facility_id = m.facility_id) DESC,
        m.start_time ASC
      LIMIT 1
    ) pick ON TRUE
    WHERE COALESCE(p.push_notifications_enabled, true)
      -- Fatigue: one rhythm nudge per rolling week.
      AND NOT EXISTS (
        SELECT 1 FROM notification n
        WHERE n.user_id = p.id
          AND n.type = 'play_rhythm_nudge'
          AND n.created_at >= now() - interval '7 days'
      )
    ORDER BY p.id, pick.start_time ASC
    LIMIT 500
  LOOP
    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.user_id,
      'play_rhythm_nudge',
      CASE WHEN public.lt_user_is_fr(r.user_id)
        THEN 'Ton créneau du ' || v_day_fr || ' est libre'
        ELSE 'Your ' || initcap(v_day) || ' slot is open'
      END,
      CASE WHEN public.lt_user_is_fr(r.user_id)
        THEN 'Tu joues d''habitude le ' || v_day_fr || '. Une partie de '
          || COALESCE(r.sport_name, 'sport')
          || COALESCE(' à ' || r.location_name, '')
          || ' à ' || to_char(r.start_time, 'HH24:MI')
          || ' cherche encore des joueurs. Touche pour rejoindre.'
        ELSE 'You usually play on ' || initcap(v_day) || 's. A '
          || COALESCE(r.sport_name, 'sports') || ' game'
          || COALESCE(' at ' || r.location_name, '')
          || ' at ' || to_char(r.start_time, 'FMHH12:MI AM')
          || ' still needs players. Tap to join.'
      END,
      jsonb_build_object(
        'matchId', r.match_id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(v_tomorrow, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'locationName', r.location_name
      ),
      r.match_id,
      'normal'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_play_rhythm_nudges() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_play_rhythm_nudges() IS
  'Momentum item 8: daily push surfacing a compatible open game for a player''s declared weekly slot falling tomorrow, when nothing is planned yet. Max 1 per player per week.';

SELECT cron.unschedule('send-play-rhythm-nudges')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-play-rhythm-nudges');

-- 13:00 UTC = morning in the app's core market (ET), before day plans firm up.
SELECT cron.schedule(
  'send-play-rhythm-nudges',
  '0 13 * * *',
  $$ SELECT public.send_play_rhythm_nudges(); $$
);

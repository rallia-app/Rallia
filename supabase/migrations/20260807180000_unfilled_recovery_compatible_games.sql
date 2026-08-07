-- ============================================================================
-- Unfilled-host recovery: count compatible open games, not merely nearby ones
--
-- The recovery push tells a host how many open games are near them. Until now
-- "open" meant same sport, in the next 4 days, below capacity and inside the
-- travel radius. Nothing checked whether the host could actually join: a game
-- reserved for a different level, or restricted to a different opponent
-- gender, was counted all the same. So the number could send someone to a list
-- where nothing was truly available to them, right after their own game failed
-- to fill.
--
-- Compatibility now means the same thing it means everywhere else in the app:
-- exact level equality plus the opponent-gender preference. A game that sets
-- no level floor falls back to its organizer's level, and a game open to every
-- level stays compatible rather than being dropped, so the count does not
-- swing the other way and under-report.
--
-- Body copied verbatim from 20260807160000 with only those gates added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_unfilled_host_recovery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_alt_matches integer;
  v_host_rating uuid;
  v_host_gender public.gender_enum;
  v_title text;
  v_body text;
  r record;
BEGIN
  FOR r IN
    SELECT
      m.id, m.created_by, m.sport_id, m.facility_id, m.match_date,
      m.start_time, m.end_time, m.preferred_opponent_gender, m.player_expectation,
      sp.name AS sport_name,
      (m.match_date + m.start_time)
        AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC') AS start_ts
    FROM public.match m
    LEFT JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp ON sp.id = m.sport_id
    WHERE m.unfilled_recovery_sent_at IS NULL
      AND m.cancelled_at IS NULL
      AND COALESCE(m.is_auto_generated, false) = false
      -- Window filter must live in WHERE (not post-LIMIT) or a backlog of
      -- other unfilled matches can starve the eligible ones.
      AND (m.match_date + m.start_time)
            AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC')
          BETWEEN now() - interval '6 hours' AND now()
      AND (SELECT count(*) FROM match_participant mp
            WHERE mp.match_id = m.id AND mp.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    LIMIT 100
  LOOP

    -- The host's own level and gender decide what counts as joinable below.
    SELECT prs.rating_score_id INTO v_host_rating
    FROM public.player_sport ps
    JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
    WHERE ps.player_id = r.created_by AND ps.sport_id = r.sport_id
    LIMIT 1;

    SELECT p.gender INTO v_host_gender
    FROM public.player p WHERE p.id = r.created_by;

    -- Open games of the same sport in the next 4 days that the host could
    -- actually join. Three things have to hold, not just proximity:
    --   near      within the travel radius (capped 10 km) or a favorite venue
    --   same level  exact equality against the game's floor, or against its
    --               organizer's level when the game sets no floor; a game open
    --               to every level stays compatible
    --   right side  the game's opponent-gender preference admits the host
    -- A host for whom none of these hold gets the generic copy, which is the
    -- honest outcome: promising games they cannot join is worse than silence.
    SELECT count(*) INTO v_alt_matches
    FROM public.match m2
    LEFT JOIN public.facility f2 ON f2.id = m2.facility_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        m2.min_rating_score_id,
        (SELECT prs2.rating_score_id
           FROM public.player_sport ps2
           JOIN public.player_rating_score prs2 ON prs2.id = ps2.active_rating_score_id
          WHERE ps2.player_id = m2.created_by AND ps2.sport_id = m2.sport_id
          LIMIT 1)
      ) AS rating_score_id
    ) g2 ON TRUE
    WHERE m2.visibility = 'public'
      AND m2.cancelled_at IS NULL
      AND m2.sport_id = r.sport_id
      AND m2.created_by != r.created_by
      AND (m2.match_date + m2.start_time)
            AT TIME ZONE COALESCE(f2.timezone, m2.timezone, 'UTC')
          BETWEEN now() AND now() + interval '4 days'
      AND (SELECT count(*) FROM match_participant mp2
            WHERE mp2.match_id = m2.id AND mp2.status = 'joined')
          < CASE WHEN m2.format = 'doubles' THEN 4 ELSE 2 END
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp3
        WHERE mp3.match_id = m2.id AND mp3.player_id = r.created_by
      )
      AND (
        v_host_rating IS NULL
        OR g2.rating_score_id IS NULL
        OR g2.rating_score_id = v_host_rating
      )
      AND (
        m2.preferred_opponent_gender IS NULL
        OR m2.preferred_opponent_gender = v_host_gender
      )
      AND (
        EXISTS (
          SELECT 1 FROM player ph
          WHERE ph.id = r.created_by
            AND ph.location IS NOT NULL
            AND ph.max_travel_distance IS NOT NULL
            AND f2.location IS NOT NULL
            AND extensions.ST_DWithin(
                  ph.location, f2.location,
                  LEAST(ph.max_travel_distance, 10) * 1000)
        )
        OR (
          m2.facility_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM player_favorite_facility pff
            WHERE pff.player_id = r.created_by
              AND pff.facility_id = m2.facility_id
          )
        )
      );

    IF public.lt_user_is_fr(r.created_by) THEN
      v_title := 'Ta partie ne s''est pas remplie';
      v_body := CASE
        WHEN v_alt_matches >= 1 THEN
          'Ça arrive. Il y a ' || v_alt_matches
          || CASE WHEN v_alt_matches > 1 THEN ' parties ouvertes' ELSE ' partie ouverte' END
          || ' près de toi dans les prochains jours. Touche pour trouver la prochaine.'
        ELSE
          'Ça arrive. Touche pour voir les parties ouvertes et te remettre en jeu.'
      END;
    ELSE
      v_title := 'Your game didn''t fill this time';
      v_body := CASE
        WHEN v_alt_matches >= 1 THEN
          'It happens. There ' || CASE WHEN v_alt_matches > 1
            THEN 'are ' || v_alt_matches || ' open games'
            ELSE 'is 1 open game' END
          || ' near you in the coming days. Tap to find your next one.'
        ELSE
          'It happens. Tap to browse open games and get back out there.'
      END;
    END IF;

    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.created_by,
      'match_unfilled_recovery',
      v_title,
      v_body,
      jsonb_build_object(
        'matchId', r.id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(r.match_date, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'openMatchCount', v_alt_matches
      ),
      r.id,
      'high'
    );

    UPDATE public.match SET unfilled_recovery_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_unfilled_host_recovery() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_unfilled_host_recovery() IS
  'Momentum item 7: recovers hosts whose game started unfilled by pointing at compatible open games nearby (same level, gender preference honoured). Hourly pg_cron.';

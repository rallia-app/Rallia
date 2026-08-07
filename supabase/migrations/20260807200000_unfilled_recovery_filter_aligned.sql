-- ============================================================================
-- Unfilled-host recovery: count what the Public Games screen will actually show
--
-- Tapping the push now lands on Public Games with filters applied, so the count
-- in the message and the list behind it have to be the same set. That means
-- the sweep must count exactly what search_public_matches returns for those
-- filters, not its own private notion of "nearby and compatible".
--
-- Aligned to the filter vocabulary:
--   window    dateRange='week' is match_date within [today, today+7] in the
--             game's own timezone. The sweep used a 4-day timestamp window.
--   level     rating=[host's rating score id] maps to
--             m.min_rating_score_id = ANY(...), which cannot express "no floor
--             set", so games without a floor are no longer counted. They are
--             about 11% of public games on prod. The organizer-level fallback
--             goes with it.
--   distance  the filter only offers 2, 5 and 10 km, so the host's radius is
--             bucketed down to the nearest of those and the same value is sent
--             to the app. The favourite-venue fallback has no filter
--             equivalent and is dropped.
--   gender    already mirrored: the RPC applies the same eligibility rule via
--             p_user_gender, so nothing extra is passed.
--
-- One gate stays deliberately out of step. The screen does not hide full games
-- (p_spots_available can express "exactly 1", "exactly 2" or "3 or more", but
-- not "at least one"), while this sweep still refuses to count them. Telling a
-- host whose game just failed to fill about games they cannot join would be
-- worse than the list occasionally showing one more row than the number says.
--
-- The payload carries everything the client needs to rebuild the filters.
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
  v_radius_km integer;
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

    -- The host's level, gender and radius define the filters the tap will
    -- apply, so resolve them once and reuse them for both the count and the
    -- payload. The radius is bucketed to a value the filter can express.
    SELECT prs.rating_score_id INTO v_host_rating
    FROM public.player_sport ps
    JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
    WHERE ps.player_id = r.created_by AND ps.sport_id = r.sport_id
    LIMIT 1;

    SELECT p.gender,
           CASE
             WHEN LEAST(COALESCE(p.max_travel_distance, 10), 10) >= 10 THEN 10
             WHEN LEAST(COALESCE(p.max_travel_distance, 10), 10) >= 5  THEN 5
             ELSE 2
           END
      INTO v_host_gender, v_radius_km
    FROM public.player p WHERE p.id = r.created_by;

    SELECT count(*) INTO v_alt_matches
    FROM public.match m2
    JOIN public.facility f2 ON f2.id = m2.facility_id
    WHERE m2.visibility = 'public'
      AND m2.cancelled_at IS NULL
      AND m2.sport_id = r.sport_id
      AND m2.created_by != r.created_by
      -- dateRange = 'week'. The date bounds alone are not enough: they admit a
      -- game earlier today that has already started, which the screen does not
      -- list, so the start time has to be in the future too.
      AND m2.match_date >= (now() AT TIME ZONE COALESCE(m2.timezone, 'UTC'))::date
      AND m2.match_date <= (now() AT TIME ZONE COALESCE(m2.timezone, 'UTC'))::date
                           + INTERVAL '7 days'
      AND (m2.match_date + m2.start_time)
            AT TIME ZONE COALESCE(f2.timezone, m2.timezone, 'UTC') > now()
      -- Deliberately stricter than the screen: never count a game that is full.
      AND (SELECT count(*) FROM match_participant mp2
            WHERE mp2.match_id = m2.id AND mp2.status = 'joined')
          < CASE WHEN m2.format = 'doubles' THEN 4 ELSE 2 END
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp3
        WHERE mp3.match_id = m2.id AND mp3.player_id = r.created_by
      )
      -- rating = [host's score id]; a host with no rating sends no rating
      -- filter, so the count must not apply one either.
      AND (
        v_host_rating IS NULL
        OR m2.min_rating_score_id = v_host_rating
      )
      -- Mirrors the RPC's p_user_gender eligibility rule.
      AND (
        m2.preferred_opponent_gender IS NULL
        OR m2.preferred_opponent_gender = v_host_gender
      )
      -- distance = v_radius_km
      AND EXISTS (
        SELECT 1 FROM public.player ph
        WHERE ph.id = r.created_by
          AND ph.location IS NOT NULL
          AND f2.location IS NOT NULL
          AND extensions.ST_DWithin(ph.location, f2.location, v_radius_km * 1000)
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
        'openMatchCount', v_alt_matches,
        -- Everything the tap needs to reproduce the counted set.
        'sportId', r.sport_id,
        'ratingScoreId', v_host_rating,
        'distanceKm', v_radius_km,
        'dateRange', 'week'
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
  'Momentum item 7: recovers hosts whose game started unfilled by pointing at the compatible open games nearby, counted to match what Public Games shows for the filters carried in the payload. Hourly pg_cron.';

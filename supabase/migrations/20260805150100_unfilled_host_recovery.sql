-- ============================================================================
-- Migration: Unfilled-host recovery sweep
-- Created: 2026-08-05
-- Description: Momentum harvesting item 7. A match passing its start time
--              unfilled previously triggered nothing server-side; this is the
--              most dangerous supply-churn moment (the host booked, exposed
--              themselves, and got nothing). Detect it and respond with
--              concrete help, never a bare "your game expired":
--                1) "We spotted N compatible players for next week" when the
--                   auto-invite candidate pool for the same slot next week is
--                   non-empty (reuses get_auto_invite_candidates_for_slot);
--                2) else "N open games near you in the coming days";
--                3) else an empathetic generic nudge back to browsing.
--              Tapping lands on Public Games (client redirects like
--              match_cancelled), not on the dead expired match.
--
-- Scope: creator-hosted, non-auto, non-cancelled matches whose start passed
-- within the trailing 6 hours (bounded backfill), below capacity. Once ever
-- per match via match.unfilled_recovery_sent_at. Hourly cron.
-- ============================================================================

ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS unfilled_recovery_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.send_unfilled_host_recovery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_candidates integer;
  v_alt_matches integer;
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

    -- Concrete help, strongest stat first: candidate players for the same
    -- slot next week (only meaningful for facility matches).
    v_candidates := 0;
    IF r.facility_id IS NOT NULL THEN
      SELECT count(*) INTO v_candidates
      FROM public.get_auto_invite_candidates_for_slot(
        r.created_by, r.sport_id, r.facility_id,
        (r.match_date + 7)::date, r.start_time,
        COALESCE(r.end_time, r.start_time + interval '90 minutes'),
        r.preferred_opponent_gender, r.player_expectation, 10
      );
    END IF;

    -- Fallback stat: open public games of the same sport in the next 4 days
    -- that the host could join instead. "Near you" must be true: within the
    -- host's travel radius (capped 10 km) or at one of their favorite
    -- facilities; a host with neither gets the generic copy.
    SELECT count(*) INTO v_alt_matches
    FROM public.match m2
    LEFT JOIN public.facility f2 ON f2.id = m2.facility_id
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
        WHEN v_candidates >= 2 THEN
          'Ça arrive. On a déjà repéré ' || v_candidates
          || ' joueurs compatibles pour le même créneau la semaine prochaine. Touche pour organiser ta prochaine partie.'
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
        WHEN v_candidates >= 2 THEN
          'It happens. We already spotted ' || v_candidates
          || ' compatible players for the same slot next week. Tap to line up your next game.'
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
        'candidateCount', v_candidates,
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
  'Momentum item 7: recovers hosts whose game started unfilled with concrete next steps (candidate players for the slot next week, or nearby open games). Hourly pg_cron.';

SELECT cron.unschedule('send-unfilled-host-recovery')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-unfilled-host-recovery');

SELECT cron.schedule(
  'send-unfilled-host-recovery',
  '25 * * * *',
  $$ SELECT public.send_unfilled_host_recovery(); $$
);

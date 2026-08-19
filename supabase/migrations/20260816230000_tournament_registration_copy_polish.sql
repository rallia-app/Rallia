-- ============================================================================
-- Migration: Natural French copy for the tournament registration pushes
-- Created: 2026-08-16
-- Description: "Touche pour t'inscrire" is translationese nobody writes, and
--              DD/MM dates read like a form. The open and closing-soon
--              fan-outs get a natural CTA ("Inscris-toi vite!") and spelled
--              French dates ("21 août") via a small helper. English copy is
--              already idiomatic and unchanged. Bodies copied from their
--              latest definitions (20260805170100 and 20260816220100).
-- ============================================================================

-- Day-month in natural French, Montréal time ("1er août", "21 août").
CREATE OR REPLACE FUNCTION public.lt_format_date_fr(p_ts timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN extract(day FROM p_ts AT TIME ZONE 'America/Toronto')::int = 1
           THEN '1er' ELSE extract(day FROM p_ts AT TIME ZONE 'America/Toronto')::int::text END
    || ' ' ||
    (ARRAY['janvier','février','mars','avril','mai','juin','juillet','août',
           'septembre','octobre','novembre','décembre'])
    [extract(month FROM p_ts AT TIME ZONE 'America/Toronto')::int];
$$;

REVOKE ALL ON FUNCTION public.lt_format_date_fr(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_format_date_fr(timestamptz) TO authenticated, service_role;

-- 1. Registration-open fan-out (from 20260805170100), FR copy only
CREATE OR REPLACE FUNCTION public.process_tournament_registration_fanout(p_batch_size int DEFAULT 250)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_attempts constant int := 5;
  v_job record;
  v_t record;
  v_point extensions.geography;
  v_batch_count integer := 0;
  v_last uuid;
BEGIN
  -- Single drainer at a time.
  IF NOT pg_try_advisory_xact_lock(hashtext('tournament_registration_fanout')) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_job
  FROM public.tournament_fanout_job
  WHERE status = 'pending'
  ORDER BY id
  LIMIT 1;

  IF v_job IS NULL THEN
    RETURN 0;
  END IF;

  IF v_job.attempts >= c_max_attempts THEN
    UPDATE public.tournament_fanout_job
       SET status = 'error', last_error = 'max attempts reached', updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END IF;

  SELECT t.*, sp.name AS sport_name INTO v_t
  FROM public.tournaments t
  JOIN public.sport sp ON sp.id = t.sport_id
  WHERE t.id = v_job.tournament_id;

  -- Tournament gone or no longer open: close the job quietly.
  IF v_t IS NULL OR v_t.status <> 'registration_open' THEN
    UPDATE public.tournament_fanout_job
       SET status = 'done', updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END IF;

  IF v_t.latitude IS NOT NULL AND v_t.longitude IS NOT NULL THEN
    v_point := extensions.ST_SetSRID(
      extensions.ST_MakePoint(v_t.longitude, v_t.latitude), 4326
    )::extensions.geography;
  END IF;

  BEGIN
    WITH batch AS (
      SELECT p.id AS user_id
      FROM public.player p
      JOIN public.player_sport ps
        ON ps.player_id = p.id AND ps.sport_id = v_t.sport_id AND ps.is_active
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
      LEFT JOIN public.rating_score rs ON rs.id = prs.rating_score_id
      WHERE p.id != v_t.organizer_id
        AND (v_job.last_player_id IS NULL OR p.id > v_job.last_player_id)
        -- Rating band (when set): requires a rated player inside the band.
        AND (
          (v_t.min_rating IS NULL AND v_t.max_rating IS NULL)
          OR (
            rs.value IS NOT NULL
            AND (v_t.min_rating IS NULL OR rs.value >= v_t.min_rating)
            AND (v_t.max_rating IS NULL OR rs.value <= v_t.max_rating)
          )
        )
        -- Geo (when the tournament has coordinates): generous 50 km cap.
        AND (
          v_point IS NULL
          OR (
            p.location IS NOT NULL
            AND extensions.ST_DWithin(
                  p.location, v_point,
                  LEAST(COALESCE(p.max_travel_distance, 25), 50) * 1000)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.tournament_registrations tr
          WHERE tr.tournament_id = v_t.id AND tr.user_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.notification n
          WHERE n.user_id = p.id
            AND n.type = 'tournament_registration_open'
            AND n.target_id = v_t.id
        )
      ORDER BY p.id
      LIMIT p_batch_size
    ),
    ins AS (
      INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
      SELECT
        b.user_id,
        'tournament_registration_open',
        CASE WHEN public.lt_user_is_fr(b.user_id)
          THEN 'Inscriptions ouvertes · ' || v_t.name
          ELSE 'Registration is open · ' || v_t.name
        END,
        CASE WHEN public.lt_user_is_fr(b.user_id)
          THEN 'Tournoi de ' || COALESCE(v_t.sport_name, 'sport')
            || CASE WHEN v_t.start_date IS NOT NULL
                 THEN ' à partir du ' || public.lt_format_date_fr(v_t.start_date) ELSE '' END
            || '. Les places sont limitées. Inscris-toi vite!'
          ELSE COALESCE(initcap(v_t.sport_name), 'Sports') || ' tournament'
            || CASE WHEN v_t.start_date IS NOT NULL
                 THEN ' starting ' || to_char(v_t.start_date, 'FMMon DD') ELSE '' END
            || '. Spots are limited. Tap to register.'
        END,
        jsonb_build_object(
          'tournamentId', v_t.id,
          'tournamentName', v_t.name,
          'sportName', COALESCE(v_t.sport_name, '')
        ),
        v_t.id,
        'normal'
      FROM batch b
      RETURNING user_id
    )
    -- No max(uuid) aggregate on older PG: take the keyset cursor via ORDER BY.
    SELECT count(*),
           (SELECT i2.user_id FROM ins i2 ORDER BY i2.user_id DESC LIMIT 1)
      INTO v_batch_count, v_last
      FROM ins;

    IF v_batch_count < p_batch_size THEN
      UPDATE public.tournament_fanout_job
         SET status = 'done',
             notified_count = notified_count + COALESCE(v_batch_count, 0),
             last_player_id = COALESCE(v_last, last_player_id),
             updated_at = now()
       WHERE id = v_job.id;
    ELSE
      UPDATE public.tournament_fanout_job
         SET notified_count = notified_count + v_batch_count,
             last_player_id = v_last,
             updated_at = now()
       WHERE id = v_job.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.tournament_fanout_job
       SET attempts = attempts + 1, last_error = SQLERRM, updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END;

  RETURN COALESCE(v_batch_count, 0);
END;
$$;

-- 2. Closing-soon fan-out (from 20260816220100), FR copy only
CREATE OR REPLACE FUNCTION public.process_tournament_closing_soon_fanout(p_batch_size int DEFAULT 250)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_attempts constant int := 5;
  v_job record;
  v_t record;
  v_spots integer;
  v_batch_count integer := 0;
  v_last uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('tournament_closing_soon_fanout')) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_job
  FROM public.tournament_closing_fanout_job
  WHERE status = 'pending'
  ORDER BY id
  LIMIT 1;

  IF v_job IS NULL THEN
    RETURN 0;
  END IF;

  IF v_job.attempts >= c_max_attempts THEN
    UPDATE public.tournament_closing_fanout_job
       SET status = 'error', last_error = 'max attempts reached', updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END IF;

  SELECT t.*, sp.name AS sport_name INTO v_t
  FROM public.tournaments t
  JOIN public.sport sp ON sp.id = t.sport_id
  WHERE t.id = v_job.tournament_id;

  -- Gone, no longer open, or past the deadline: close the job quietly.
  IF v_t IS NULL
     OR v_t.status <> 'registration_open'
     OR v_t.registration_closes_at IS NULL
     OR v_t.registration_closes_at <= now()
  THEN
    UPDATE public.tournament_closing_fanout_job
       SET status = 'done', updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END IF;

  SELECT GREATEST(0, v_t.max_participants - count(*)) INTO v_spots
  FROM public.tournament_registrations tr
  WHERE tr.tournament_id = v_t.id
    AND tr.status IN ('registered', 'pending', 'payment_pending');

  -- Full draw: nothing to sell.
  IF v_spots <= 0 THEN
    UPDATE public.tournament_closing_fanout_job
       SET status = 'done', updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END IF;

  BEGIN
    WITH batch AS (
      SELECT n.user_id
      FROM public.notification n
      WHERE n.type = 'tournament_registration_open'
        AND n.target_id = v_t.id
        AND (v_job.last_player_id IS NULL OR n.user_id > v_job.last_player_id)
        AND n.user_id != v_t.organizer_id
        AND NOT EXISTS (
          SELECT 1 FROM public.tournament_registrations tr
          WHERE tr.tournament_id = v_t.id AND tr.user_id = n.user_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.notification n2
          WHERE n2.user_id = n.user_id
            AND n2.type = 'tournament_registration_closing_soon'
            AND n2.target_id = v_t.id
        )
      ORDER BY n.user_id
      LIMIT p_batch_size
    ),
    ins AS (
      INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
      SELECT
        b.user_id,
        'tournament_registration_closing_soon',
        CASE WHEN public.lt_user_is_fr(b.user_id)
          THEN 'Dernière chance · ' || v_t.name
          ELSE 'Last chance · ' || v_t.name
        END,
        CASE WHEN public.lt_user_is_fr(b.user_id)
          THEN 'Les inscriptions ferment le '
            || public.lt_format_date_fr(v_t.registration_closes_at)
            || '. Il reste ' || v_spots
            || CASE WHEN v_spots = 1 THEN ' place' ELSE ' places' END
            || '. Inscris-toi vite!'
          ELSE 'Registration closes '
            || to_char(v_t.registration_closes_at AT TIME ZONE 'America/Toronto', 'FMMon DD')
            || '. ' || v_spots
            || CASE WHEN v_spots = 1 THEN ' spot' ELSE ' spots' END
            || ' left. Tap to register.'
        END,
        jsonb_build_object(
          'tournamentId', v_t.id,
          'tournamentName', v_t.name,
          'sportName', COALESCE(v_t.sport_name, ''),
          'spotsLeft', v_spots,
          'closesAt', v_t.registration_closes_at
        ),
        v_t.id,
        'high'
      FROM batch b
      RETURNING user_id
    )
    SELECT count(*),
           (SELECT i2.user_id FROM ins i2 ORDER BY i2.user_id DESC LIMIT 1)
      INTO v_batch_count, v_last
      FROM ins;

    IF v_batch_count < p_batch_size THEN
      UPDATE public.tournament_closing_fanout_job
         SET status = 'done',
             notified_count = notified_count + COALESCE(v_batch_count, 0),
             last_player_id = COALESCE(v_last, last_player_id),
             updated_at = now()
       WHERE id = v_job.id;
    ELSE
      UPDATE public.tournament_closing_fanout_job
         SET notified_count = notified_count + v_batch_count,
             last_player_id = v_last,
             updated_at = now()
       WHERE id = v_job.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.tournament_closing_fanout_job
       SET attempts = attempts + 1, last_error = SQLERRM, updated_at = now()
     WHERE id = v_job.id;
    RETURN 0;
  END;

  RETURN COALESCE(v_batch_count, 0);
END;
$$;

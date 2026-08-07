-- ============================================================================
-- Migration: Tournament registration-open fan-out (certified organizers)
-- Created: 2026-08-05
-- Description: Momentum harvesting item 9. When a certified organizer's
--              public tournament flips into registration_open, fan the news
--              out to eligible players: sport active, active rating inside
--              the tournament's rating band (when set), and near the
--              tournament when it carries coordinates.
--
-- Design notes:
--   - tournaments previously had NO geo (free-text city only); nullable
--     latitude/longitude columns are added here. Without them the fan-out is
--     sport+rating scoped only.
--   - Fan-out volume can be a whole rating band, so it NEVER runs inline in
--     the organizer's transaction (2026-07-25 broadcast incident): a trigger
--     enqueues a job, a pg_cron worker drains it in keyset batches of 250.
--   - Certification (player.is_certified_organizer) is the anti-spam gate:
--     non-certified organizers' tournaments open silently.
--   - One send ever per (tournament, player): reopen after close never
--     re-blasts (worker checks notification existence).
-- ============================================================================

-- 1. Geo for targeting (backfillable per tournament; Série 1 uses regions)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- 2. Fan-out job queue
CREATE TABLE IF NOT EXISTS public.tournament_fanout_job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
  last_player_id uuid,
  notified_count integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tournament_fanout_job ENABLE ROW LEVEL SECURITY;
-- service-role/worker only: RLS on with no policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_fanout_job TO service_role;

CREATE INDEX IF NOT EXISTS idx_tournament_fanout_job_pending
  ON public.tournament_fanout_job (id)
  WHERE status = 'pending';

-- Cheap dedupe scans.
CREATE INDEX IF NOT EXISTS idx_notification_treg_open_user_created
  ON public.notification (user_id, created_at)
  WHERE type = 'tournament_registration_open';

-- 3. Enqueue trigger: any transition INTO registration_open, certified + public only
CREATE OR REPLACE FUNCTION public.tg_enqueue_tournament_registration_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'registration_open'
     AND OLD.status IS DISTINCT FROM 'registration_open'
     AND NEW.visibility = 'public'
     AND EXISTS (
       SELECT 1 FROM public.player pl
       WHERE pl.id = NEW.organizer_id AND pl.is_certified_organizer
     )
  THEN
    INSERT INTO public.tournament_fanout_job (tournament_id) VALUES (NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_registration_open_fanout ON public.tournaments;
CREATE TRIGGER tournament_registration_open_fanout
  AFTER UPDATE OF status ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enqueue_tournament_registration_fanout();

-- 4. Worker: drains one pending job per run in keyset batches
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
                 THEN ' à partir du ' || to_char(v_t.start_date, 'DD/MM') ELSE '' END
            || '. Les places sont limitées. Touche pour t''inscrire.'
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

REVOKE ALL ON FUNCTION public.process_tournament_registration_fanout(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_enqueue_tournament_registration_fanout() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.process_tournament_registration_fanout(int) IS
  'Momentum item 9: drains tournament registration-open fan-out jobs in keyset batches (certified organizers, sport + rating band + optional geo).';

SELECT cron.unschedule('process-tournament-registration-fanout')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-tournament-registration-fanout');

SELECT cron.schedule(
  'process-tournament-registration-fanout',
  '* * * * *',
  $$ SELECT public.process_tournament_registration_fanout(); $$
);

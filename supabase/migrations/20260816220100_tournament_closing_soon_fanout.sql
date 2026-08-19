-- ============================================================================
-- Migration: Tournament registration closing-soon fan-out
-- Created: 2026-08-16
-- Description: The registration-open fan-out is one-shot per player forever,
--              and the close cron shuts the window silently, so a tournament's
--              whole lifecycle produces exactly one acquisition touch. This
--              adds the second touch: ~48h before registration_closes_at,
--              remind players who received the open notification but never
--              registered, with the real spots-left count.
--
-- Design notes:
--   - Audience = recipients of tournament_registration_open for the same
--     tournament (already filtered for sport, rating band and geo at open
--     time) minus current registrants. No re-derivation of eligibility.
--   - Same queue/worker shape as 20260805170100 (never inline, keyset batches,
--     advisory lock, attempt cap). Separate job table so the two workers
--     cannot steal each other's jobs.
--   - One job ever per tournament (unique index) and one send ever per
--     (tournament, player) via notification-existence dedupe.
--   - Skips quietly when the tournament left registration_open, the deadline
--     passed, or the draw is already full.
--   - Gated per player through the momentum notification gate
--     (admin_settings key momentum_tournament_registration_closing_soon).
-- ============================================================================

-- 1. Job queue
CREATE TABLE IF NOT EXISTS public.tournament_closing_fanout_job (
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

ALTER TABLE public.tournament_closing_fanout_job ENABLE ROW LEVEL SECURITY;
-- service-role/worker only: RLS on with no policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_closing_fanout_job TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_closing_fanout_job_tournament
  ON public.tournament_closing_fanout_job (tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_closing_fanout_job_pending
  ON public.tournament_closing_fanout_job (id)
  WHERE status = 'pending';

-- Audience scan (open-notification recipients per tournament) and dedupe scan.
CREATE INDEX IF NOT EXISTS idx_notification_treg_open_target_user
  ON public.notification (target_id, user_id)
  WHERE type = 'tournament_registration_open';

CREATE INDEX IF NOT EXISTS idx_notification_treg_closing_target_user
  ON public.notification (target_id, user_id)
  WHERE type = 'tournament_registration_closing_soon';

-- 2. Enqueue: hourly scan for public certified-organizer tournaments entering
--    the 48h window. The unique index makes this one-shot per tournament.
CREATE OR REPLACE FUNCTION public.lt_enqueue_tournament_closing_soon()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.tournament_closing_fanout_job (tournament_id)
    SELECT t.id
    FROM public.tournaments t
    JOIN public.player pl ON pl.id = t.organizer_id AND pl.is_certified_organizer
    WHERE t.status = 'registration_open'
      AND t.visibility = 'public'
      AND t.registration_closes_at > now()
      AND t.registration_closes_at <= now() + interval '48 hours'
    ON CONFLICT (tournament_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- 3. Worker: drains one pending job per run in keyset batches
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
            || to_char(v_t.registration_closes_at AT TIME ZONE 'America/Toronto', 'DD/MM')
            || '. Il reste ' || v_spots
            || CASE WHEN v_spots = 1 THEN ' place' ELSE ' places' END
            || '. Touche pour t''inscrire.'
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

REVOKE ALL ON FUNCTION public.lt_enqueue_tournament_closing_soon() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_tournament_closing_soon_fanout(int) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.lt_enqueue_tournament_closing_soon() IS
  'Enqueues one closing-soon fan-out job per public certified-organizer tournament entering the 48h pre-deadline window.';
COMMENT ON FUNCTION public.process_tournament_closing_soon_fanout(int) IS
  'Drains tournament closing-soon fan-out jobs in keyset batches: open-notification recipients minus registrants, with spots-left copy.';

-- 4. Momentum gate: extend the trigger's type list (latest definition:
--    20260805180000) and seed the config row.
DROP TRIGGER IF EXISTS momentum_notification_gate ON public.notification;
CREATE TRIGGER momentum_notification_gate
  BEFORE INSERT ON public.notification
  FOR EACH ROW
  WHEN (NEW.type IN (
    'court_booking_nudge',
    'match_last_minute_spots',
    'match_unfilled_recovery',
    'play_rhythm_nudge',
    'tournament_registration_open',
    'tournament_registration_closing_soon'
  ))
  EXECUTE FUNCTION public.tg_momentum_notification_gate();

INSERT INTO public.admin_settings (key, value, description)
VALUES
  ('momentum_tournament_registration_closing_soon',
   '{"enabled": true, "rollout_pct": 100}',
   'Closing-soon reminder for open tournaments (48h before deadline). rollout_pct < 100 creates a stable holdout.')
ON CONFLICT (key) DO NOTHING;

-- 5. Cron: hourly enqueue scan + per-minute worker
SELECT cron.unschedule('lt-tournament-closing-soon-enqueue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lt-tournament-closing-soon-enqueue');

SELECT cron.schedule(
  'lt-tournament-closing-soon-enqueue',
  '7 * * * *',
  $$ SELECT public.lt_enqueue_tournament_closing_soon(); $$
);

SELECT cron.unschedule('process-tournament-closing-soon-fanout')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-tournament-closing-soon-fanout');

SELECT cron.schedule(
  'process-tournament-closing-soon-fanout',
  '* * * * *',
  $$ SELECT public.process_tournament_closing_soon_fanout(); $$
);

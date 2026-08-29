-- ============================================================================
-- Migration: Recurring games
-- Created: 2026-08-28
-- Description: Lets a host mark a game as recurring. The system then re-creates
--              it on the same weekday/time, with the same settings, once the
--              previous occurrence has ended. The court is never carried over:
--              every occurrence starts unbooked, which is what makes the
--              court-availability alert (next migration) the point of the
--              feature.
--
-- Model:
--   - `match_recurrence` is the series. It holds cadence + lifecycle only; the
--     settings live on `template_match_id`, the game the host originally
--     created. Cloning from the template (not from the newest occurrence)
--     means a one-off tweak to next week's game does not silently rewrite the
--     series.
--   - `match.recurrence_id` marks every game belonging to a series, template
--     included. That single column drives the "latest occurrence" lookup, the
--     idempotency guard, and the recurring badge in the UI.
--
-- Generation trigger: the previous occurrence's END time has passed. With a
-- weekly cadence that lands the next game ~7 days ahead, and it ties creation
-- to the natural moment the host just finished playing. A cancelled occurrence
-- still "ends" on the clock, so cancelling one week does not kill the series.
--
-- Occurrences are open shells: same settings and visibility, host as the only
-- participant (via the existing create_host_participant trigger). Players are
-- not carried over — nobody is committed to a date they never accepted.
--
-- A series ends only when the host stops it. There is deliberately no
-- auto-pause; a dormant series keeps producing games until it is stopped.
--
-- Analytics note: occurrences are NOT flagged is_auto_generated — that flag
-- means "auto-match shell" and is excluded from behavior metrics. Use
-- `recurrence_id IS NOT NULL` to single out recurring games instead.
-- ============================================================================

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.match_recurrence (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE, not RESTRICT: a new FK to player must not become another
  -- delete-account blocker.
  created_by        uuid        NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  template_match_id uuid        NOT NULL REFERENCES public.match(id)  ON DELETE CASCADE,
  -- Weekly today. Column exists so biweekly/monthly need no schema change.
  interval_weeks    int         NOT NULL DEFAULT 1 CHECK (interval_weeks BETWEEN 1 AND 4),
  stopped_at        timestamptz,
  stopped_by        uuid        REFERENCES public.player(id) ON DELETE SET NULL,
  last_generated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One live series per template game.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_recurrence_template
  ON public.match_recurrence (template_match_id);

CREATE INDEX IF NOT EXISTS idx_match_recurrence_active
  ON public.match_recurrence (created_by)
  WHERE stopped_at IS NULL;

ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS recurrence_id uuid
    REFERENCES public.match_recurrence(id) ON DELETE SET NULL;

-- Drives the "latest occurrence" lateral in the generator.
CREATE INDEX IF NOT EXISTS idx_match_recurrence_occurrences
  ON public.match (recurrence_id, match_date DESC)
  WHERE recurrence_id IS NOT NULL;

-- Idempotency: the generator can run twice for the same slot (retry, overlapping
-- cron ticks) and the second insert loses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_recurrence_slot_unique
  ON public.match (recurrence_id, match_date)
  WHERE recurrence_id IS NOT NULL;

COMMENT ON TABLE public.match_recurrence IS
  'A recurring game series. Cadence and lifecycle only — settings are cloned from template_match_id at generation time. Ends only when the host sets stopped_at.';

COMMENT ON COLUMN public.match.recurrence_id IS
  'Series this game belongs to, template included. NULL for one-off games. Use this, not is_auto_generated, to identify recurring games in analytics.';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.match_recurrence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_recurrence_select_own" ON public.match_recurrence;
CREATE POLICY "match_recurrence_select_own"
  ON public.match_recurrence
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- The series must hang off a game the caller actually hosts.
DROP POLICY IF EXISTS "match_recurrence_insert_own" ON public.match_recurrence;
CREATE POLICY "match_recurrence_insert_own"
  ON public.match_recurrence
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.match m
      WHERE m.id = template_match_id
        AND m.created_by = auth.uid()
    )
  );

-- Stopping a series is an UPDATE of stopped_at/stopped_by.
DROP POLICY IF EXISTS "match_recurrence_update_own" ON public.match_recurrence;
CREATE POLICY "match_recurrence_update_own"
  ON public.match_recurrence
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- =============================================================================
-- GRANTS
-- (Supabase is removing default Data API grants — explicit grants required.)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON public.match_recurrence TO authenticated;
GRANT ALL                    ON public.match_recurrence TO service_role;

-- =============================================================================
-- updated_at
-- =============================================================================

DROP TRIGGER IF EXISTS update_match_recurrence_updated_at ON public.match_recurrence;
CREATE TRIGGER update_match_recurrence_updated_at
  BEFORE UPDATE ON public.match_recurrence
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- GENERATOR
--
-- Picks up every live series whose latest occurrence has already ended (wall
-- clock, in that game's own timezone) and clones the template into the next
-- slot. Self-healing: after a cron outage it resumes from the latest occurrence
-- and skips the slots that went by rather than backfilling games in the past.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_recurring_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  int := 0;
  v_new_id uuid;
  v_next   date;
  r        record;
BEGIN
  FOR r IN
    SELECT
      rec.id              AS recurrence_id,
      rec.interval_weeks,
      rec.template_match_id,
      last_occ.match_date AS last_date
    FROM public.match_recurrence rec
    JOIN LATERAL (
      SELECT m.match_date, m.end_time, m.timezone
      FROM public.match m
      WHERE m.recurrence_id = rec.id
      ORDER BY m.match_date DESC
      LIMIT 1
    ) last_occ ON TRUE
    WHERE rec.stopped_at IS NULL
      -- A cancelled occurrence still ends on the clock, so cancelling one week
      -- does not kill the series.
      AND (last_occ.match_date + last_occ.end_time)
            AT TIME ZONE coalesce(last_occ.timezone, 'UTC') <= now()
    LIMIT 200
  LOOP
    v_next   := r.last_date + (r.interval_weeks * 7);
    v_new_id := NULL;

    WHILE v_next < CURRENT_DATE LOOP
      v_next := v_next + (r.interval_weeks * 7);
    END LOOP;

    INSERT INTO public.match (
      recurrence_id, sport_id, created_by, match_date, start_time, end_time, timezone,
      format, player_expectation, duration, custom_duration_minutes,
      location_type, facility_id, location_name, location_address,
      custom_latitude, custom_longitude,
      court_status, is_court_free, cost_split_type, estimated_cost,
      min_rating_score_id, preferred_opponent_gender,
      visibility, visible_in_groups, visible_in_communities, join_mode, notes
    )
    SELECT
      r.recurrence_id, t.sport_id, t.created_by, v_next, t.start_time, t.end_time, t.timezone,
      t.format, t.player_expectation, t.duration, t.custom_duration_minutes,
      t.location_type, t.facility_id, t.location_name, t.location_address,
      t.custom_latitude, t.custom_longitude,
      -- Never inherit a booking: court_id, booking_id and 'reserved' are all
      -- dropped. That unbooked state is what the court-opened alert watches.
      CASE WHEN t.location_type = 'facility'
           THEN 'to_reserve'::public.court_status_enum END,
      t.is_court_free, t.cost_split_type, t.estimated_cost,
      t.min_rating_score_id, t.preferred_opponent_gender,
      t.visibility, t.visible_in_groups, t.visible_in_communities, t.join_mode, t.notes
    FROM public.match t
    WHERE t.id = r.template_match_id
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      UPDATE public.match_recurrence
         SET last_generated_at = now()
       WHERE id = r.recurrence_id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_matches() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.generate_recurring_matches() IS
  'Creates the next occurrence of every live recurring series whose previous occurrence has ended. Clones settings from the series template, always unbooked. Run by pg_cron hourly.';

-- =============================================================================
-- CRON
-- Hourly. A game ending at 20:00 gets its successor within the hour.
-- =============================================================================

SELECT cron.unschedule('generate-recurring-matches')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-matches');

SELECT cron.schedule(
  'generate-recurring-matches',
  '12 * * * *',
  $$ SELECT public.generate_recurring_matches(); $$
);

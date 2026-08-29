-- ============================================================================
-- Migration: Mark system-created games
-- Created: 2026-08-29
-- Description: `recurrence_id` answers "is this game part of a series?", but it
--              is set on the series template too, so it cannot answer "did a
--              person create this game, or did the system?". The template and
--              the occurrence it spawns were otherwise identical on the match
--              row: same created_by, and is_auto_generated false on both (that
--              flag means auto-match shell and is excluded from behaviour
--              metrics, so recurring games must not borrow it).
--
--              `generated_at` closes that gap as a plain predicate:
--                generated_at IS NULL      -> a person created this game
--                generated_at IS NOT NULL  -> the system created it, and when
--
--              Also the clean lever for push volume: gating the nearby-players
--              and group-members insert triggers on `new.generated_at IS NULL`
--              would suppress fanout for system-made games without touching
--              is_auto_generated. Not applied here; the triggers are unchanged.
-- ============================================================================

ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

COMMENT ON COLUMN public.match.generated_at IS
  'When the system created this game (recurring series occurrence). NULL means a person created it. Distinct from is_auto_generated, which marks auto-match shells.';

-- Analytics and trigger predicates filter on "system-made"; the partial index
-- keeps that cheap without carrying a row per human-created game.
CREATE INDEX IF NOT EXISTS idx_match_generated_at
  ON public.match (generated_at)
  WHERE generated_at IS NOT NULL;

-- Backfill: every existing occurrence except its series template was generated.
-- No-op on a database where the feature has not run yet.
UPDATE public.match m
   SET generated_at = m.created_at
  FROM public.match_recurrence r
 WHERE m.recurrence_id = r.id
   AND m.id <> r.template_match_id
   AND m.generated_at IS NULL;

-- =============================================================================
-- GENERATOR
--
-- Body copied verbatim from 20260828121000_match_recurrence.sql (the latest
-- definition) with one change: the insert stamps generated_at.
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
      recurrence_id, generated_at,
      sport_id, created_by, match_date, start_time, end_time, timezone,
      format, player_expectation, duration, custom_duration_minutes,
      location_type, facility_id, location_name, location_address,
      custom_latitude, custom_longitude,
      court_status, is_court_free, cost_split_type, estimated_cost,
      min_rating_score_id, preferred_opponent_gender,
      visibility, visible_in_groups, visible_in_communities, join_mode, notes
    )
    SELECT
      r.recurrence_id, now(),
      t.sport_id, t.created_by, v_next, t.start_time, t.end_time, t.timezone,
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
  'Creates the next occurrence of every live recurring series whose previous occurrence has ended. Clones settings from the series template, always unbooked, stamped with generated_at. Run by pg_cron hourly.';

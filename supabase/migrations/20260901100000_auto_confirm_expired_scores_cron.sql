-- ============================================================================
-- Schedule auto_confirm_expired_scores, and stand the scores it never stood.
-- ============================================================================
-- auto_confirm_expired_scores() has been correct and live since
-- 20260308200000, and nothing has ever called it: no cron entry, no edge
-- function, no client. So every score submitted under the two-way flow whose
-- opponent simply never answered sat at is_verified = false past its deadline,
-- forever. get_player_match_history filters on is_verified, so those games are
-- absent from the profile game history of everyone who played them, while the
-- score sheet told the submitter "Le score sera confirmé automatiquement après
-- le délai".
--
-- Reported from the app on 2026-09-01: a player with three played games saw
-- two. At the time of writing prod holds 49 such rows, 63 players, deadlines
-- from 2026-04-08 to 2026-08-30.
--
-- 20260831160000_lt_one_way_score stopped this for new scores (they are
-- written verified on entry) but did not backfill, so the stranded rows stay
-- stranded. This migration schedules the sweep and runs it once.
--
-- On the flip's side effects: the only thing keyed on the false→true
-- transition is the lt_match_result_propagation trigger (bracket + session
-- standings). Player ratings are not derived from match results anywhere, so
-- there is no rating to recompute. All 49 rows are casual matches with no
-- tournament_matches/session_matches link, so both propagation functions
-- early-return on them; the path stays wired for any future L&T row that
-- reaches its deadline unverified.
-- ============================================================================


-- =====================
-- 1. Fix the rebuttal counter
-- =====================
-- rebuttal_count was declared but never initialised, so `rebuttal_count + 1`
-- stayed NULL and the return value under-reported every auto-accepted
-- rebuttal. That return value is what the cron reports, so it has to be true.
-- Body otherwise re-issued verbatim from 20260308200000, checked against the
-- live definition. search_path pinned and the grants made explicit while the
-- function is being re-issued.

CREATE OR REPLACE FUNCTION public.auto_confirm_expired_scores()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
  rebuttal_count INTEGER := 0;
  v_row RECORD;
  v_set JSONB;
  v_set_number INTEGER;
BEGIN
  -- Auto-confirm original scores when confirmation_deadline passes (no response)
  UPDATE match_result
  SET
    is_verified = TRUE,
    verified_at = NOW()
  WHERE
    is_verified = FALSE
    AND disputed = FALSE
    AND rebuttal_submitted_by IS NULL
    AND confirmation_deadline IS NOT NULL
    AND confirmation_deadline < NOW();

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Auto-accept rebuttals when rebuttal_deadline passes (no response from original team)
  FOR v_row IN
    SELECT id, rebuttal_team1_score, rebuttal_team2_score,
           rebuttal_winning_team, rebuttal_sets, rebuttal_submitted_by
    FROM match_result
    WHERE is_verified = FALSE
      AND disputed = FALSE
      AND rebuttal_submitted_by IS NOT NULL
      AND rebuttal_deadline IS NOT NULL
      AND rebuttal_deadline < NOW()
  LOOP
    -- Delete old match_set rows
    DELETE FROM match_set WHERE match_result_id = v_row.id;

    -- Insert new sets from rebuttal
    v_set_number := 0;
    IF v_row.rebuttal_sets IS NOT NULL THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_row.rebuttal_sets)
      LOOP
        v_set_number := v_set_number + 1;
        INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
        VALUES (
          v_row.id,
          COALESCE((v_set->>'set_number')::INTEGER, v_set_number),
          (v_set->>'team1_score')::INTEGER,
          (v_set->>'team2_score')::INTEGER
        );
      END LOOP;
    END IF;

    -- Copy rebuttal scores to main and mark verified
    UPDATE match_result
    SET
      team1_score = v_row.rebuttal_team1_score,
      team2_score = v_row.rebuttal_team2_score,
      winning_team = v_row.rebuttal_winning_team,
      is_verified = TRUE,
      verified_at = NOW()
    WHERE id = v_row.id;

    rebuttal_count := rebuttal_count + 1;
  END LOOP;

  RETURN updated_count + rebuttal_count;
END;
$$;

COMMENT ON FUNCTION public.auto_confirm_expired_scores() IS
  'Stands every uncontested score whose confirmation deadline has passed, and accepts every rebuttal whose rebuttal deadline has passed. Returns the number of rows verified. Run by the auto-confirm-expired-scores cron every 15 minutes.';

-- Cron runs as postgres and does not need the grant; nothing else should be
-- able to run the sweep on demand.
REVOKE ALL ON FUNCTION public.auto_confirm_expired_scores() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_expired_scores() TO service_role;


-- =====================
-- 2. Schedule it
-- =====================
-- Every 15 minutes, matching the other in-database sweeps
-- (lt-close-session-confirmations, lt-tournament-deadline-resolver). The
-- function is a plain predicate sweep, so a missed or doubled run is a no-op.

SELECT cron.unschedule('auto-confirm-expired-scores') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-confirm-expired-scores'
);

SELECT cron.schedule(
  'auto-confirm-expired-scores',
  '*/15 * * * *',
  $$ SELECT public.auto_confirm_expired_scores(); $$
);


-- =====================
-- 3. Backfill
-- =====================
-- The sweep is its own backfill: one call clears every row that has been
-- waiting. Rows still inside their window, and disputed rows, are untouched by
-- the predicate.

DO $$
DECLARE
  v_pending INTEGER;
  v_verified INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pending
  FROM match_result
  WHERE is_verified = FALSE
    AND disputed = FALSE
    AND (
      (rebuttal_submitted_by IS NULL AND confirmation_deadline IS NOT NULL AND confirmation_deadline < NOW())
      OR (rebuttal_submitted_by IS NOT NULL AND rebuttal_deadline IS NOT NULL AND rebuttal_deadline < NOW())
    );

  v_verified := public.auto_confirm_expired_scores();

  RAISE NOTICE 'auto_confirm_expired_scores backfill: % stranded, % verified', v_pending, v_verified;
END $$;

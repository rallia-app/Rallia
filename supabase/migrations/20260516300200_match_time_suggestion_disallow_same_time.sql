-- =============================================================================
-- Prevent inserting a match_time_suggestion whose suggested_start_time equals
-- the parent match's current start_time. A suggestion that doesn't change the
-- time is a no-op for the host and noise for the suggester, so we reject it
-- at the DB level (the client-side guard can be spoofed).
--
-- A CHECK constraint can't reach into another table, so this runs as a
-- BEFORE INSERT trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_time_suggestion_reject_same_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_start TIME;
BEGIN
  SELECT start_time INTO v_current_start
  FROM public.match
  WHERE id = NEW.match_id;

  IF v_current_start IS NOT NULL AND NEW.suggested_start_time = v_current_start THEN
    RAISE EXCEPTION 'suggested_time_matches_current_time'
      USING HINT = 'Pick a start time different from the match''s current start_time.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.match_time_suggestion_reject_same_time() IS
  'Reject a time suggestion that matches the parent match.start_time exactly.';

DROP TRIGGER IF EXISTS match_time_suggestion_reject_same_time_trg
  ON public.match_time_suggestion;

CREATE TRIGGER match_time_suggestion_reject_same_time_trg
  BEFORE INSERT ON public.match_time_suggestion
  FOR EACH ROW
  EXECUTE FUNCTION public.match_time_suggestion_reject_same_time();

-- =============================================================================
-- MATCH TIME SUGGESTION
--
-- Lets a pending invitee or a joined participant propose a different start time
-- to the match creator without leaving the invite open in the air. The creator
-- can accept (which atomically updates the match time, supersedes any other
-- pending suggestion, and auto-joins the suggester if they were still pending)
-- or decline. The suggester can withdraw a pending suggestion.
--
-- Suggested time is a TIME value interpreted in match.timezone — same
-- convention as match.start_time. Date and timezone always stay pinned to the
-- existing match; the suggester only changes the time of day.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.match_time_suggestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.match(id) ON DELETE CASCADE,
  suggester_id UUID NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
  suggested_start_time TIME NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.player(id),
  CONSTRAINT match_time_suggestion_note_length CHECK (note IS NULL OR char_length(note) <= 280)
);

COMMENT ON TABLE public.match_time_suggestion IS
  'Counter-proposals from invitees/participants to the match creator suggesting a different start time.';
COMMENT ON COLUMN public.match_time_suggestion.suggested_start_time IS
  'Proposed start time. Interpreted in the parent match.timezone (same convention as match.start_time).';

-- One open suggestion per (match, suggester). Withdraw or wait for the host
-- to respond before sending another.
CREATE UNIQUE INDEX IF NOT EXISTS match_time_suggestion_one_pending_per_player
  ON public.match_time_suggestion (match_id, suggester_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS match_time_suggestion_match_pending
  ON public.match_time_suggestion (match_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS match_time_suggestion_suggester
  ON public.match_time_suggestion (suggester_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.match_time_suggestion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_time_suggestion_select ON public.match_time_suggestion;
CREATE POLICY match_time_suggestion_select ON public.match_time_suggestion
  FOR SELECT TO authenticated
  USING (
    suggester_id = auth.uid()
    OR is_match_creator(match_id, auth.uid())
  );

DROP POLICY IF EXISTS match_time_suggestion_insert ON public.match_time_suggestion;
CREATE POLICY match_time_suggestion_insert ON public.match_time_suggestion
  FOR INSERT TO authenticated
  WITH CHECK (
    suggester_id = auth.uid()
    AND is_match_participant(match_id, auth.uid())
    -- Suggester cannot be the match creator
    AND NOT is_match_creator(match_id, auth.uid())
  );

-- Suggester can transition their own pending row to 'withdrawn'.
-- All other status transitions go through SECURITY DEFINER RPCs, so we keep
-- the UPDATE policy narrow.
DROP POLICY IF EXISTS match_time_suggestion_update_suggester ON public.match_time_suggestion;
CREATE POLICY match_time_suggestion_update_suggester ON public.match_time_suggestion
  FOR UPDATE TO authenticated
  USING (suggester_id = auth.uid() AND status = 'pending')
  WITH CHECK (suggester_id = auth.uid());

-- Match creator can decline a pending suggestion via plain UPDATE.
DROP POLICY IF EXISTS match_time_suggestion_update_creator ON public.match_time_suggestion;
CREATE POLICY match_time_suggestion_update_creator ON public.match_time_suggestion
  FOR UPDATE TO authenticated
  USING (is_match_creator(match_id, auth.uid()) AND status = 'pending')
  WITH CHECK (is_match_creator(match_id, auth.uid()));

-- -----------------------------------------------------------------------------
-- GRANTS
-- Required per the Oct-30 2026 Data API grants policy (no implicit grants).
-- -----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON public.match_time_suggestion TO authenticated;
GRANT ALL ON public.match_time_suggestion TO service_role;

-- -----------------------------------------------------------------------------
-- RPC: accept_match_time_suggestion
--
-- Atomic accept path used by the match creator. Combines:
--   * suggestion lock + status flip
--   * cross-row supersede of every other pending suggestion on the same match
--   * match.start_time / end_time / host_edited_at update (duration preserved)
--   * auto-join the suggester if they were a pending invitee (with capacity check)
--
-- Returns a JSONB blob with the data the service layer needs to fire the
-- match-updated broadcast and the per-suggester accepted notification.
-- Raises 'match_full_after_suggestion' when the suggester was a pending invitee
-- but no spot is available at accept time — the suggestion stays pending and
-- the match time is NOT changed, so the host can react without losing state.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_match_time_suggestion(
  p_suggestion_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_suggestion match_time_suggestion%ROWTYPE;
  v_match match%ROWTYPE;
  v_duration_seconds INTEGER;
  v_new_start TIME;
  v_new_end TIME;
  v_total_spots INTEGER;
  v_joined_count INTEGER;
  v_participant_status TEXT;
  v_suggester_was_pending BOOLEAN := false;
  v_superseded_ids UUID[];
  v_other_participant_ids UUID[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the suggestion row first to serialize concurrent accepts on the
  -- same match.
  SELECT * INTO v_suggestion
  FROM match_time_suggestion
  WHERE id = p_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'suggestion_not_found';
  END IF;

  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'suggestion_not_pending';
  END IF;

  -- Caller must be the creator of the match.
  IF NOT is_match_creator(v_suggestion.match_id, v_caller) THEN
    RAISE EXCEPTION 'not_match_creator';
  END IF;

  SELECT * INTO v_match
  FROM match
  WHERE id = v_suggestion.match_id
  FOR UPDATE;

  IF v_match.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'match_cancelled';
  END IF;

  -- Preserve match duration when applying the new start time.
  v_duration_seconds := EXTRACT(EPOCH FROM (v_match.end_time - v_match.start_time))::INTEGER;
  IF v_duration_seconds IS NULL OR v_duration_seconds <= 0 THEN
    -- Fallback to 60 minutes if the existing window is malformed.
    v_duration_seconds := 3600;
  END IF;

  v_new_start := v_suggestion.suggested_start_time;
  v_new_end := (v_new_start::INTERVAL + (v_duration_seconds || ' seconds')::INTERVAL)::TIME;

  -- If the suggester is currently a pending invitee, we need to flip them to
  -- joined as part of this acceptance. Capacity-check first so we don't
  -- silently overbook the match.
  SELECT status INTO v_participant_status
  FROM match_participant
  WHERE match_id = v_suggestion.match_id
    AND player_id = v_suggestion.suggester_id;

  IF v_participant_status = 'pending' THEN
    v_suggester_was_pending := true;

    v_total_spots := CASE WHEN v_match.format = 'doubles' THEN 4 ELSE 2 END;
    SELECT COUNT(*) INTO v_joined_count
    FROM match_participant
    WHERE match_id = v_suggestion.match_id
      AND status = 'joined';

    IF v_joined_count >= v_total_spots THEN
      RAISE EXCEPTION 'match_full_after_suggestion';
    END IF;

    UPDATE match_participant
    SET status = 'joined',
        joined_at = now(),
        updated_at = now()
    WHERE match_id = v_suggestion.match_id
      AND player_id = v_suggestion.suggester_id;
  END IF;

  -- Apply the new time to the match.
  UPDATE match
  SET start_time = v_new_start,
      end_time = v_new_end,
      host_edited_at = now(),
      updated_at = now()
  WHERE id = v_suggestion.match_id;

  -- Mark this suggestion accepted.
  UPDATE match_time_suggestion
  SET status = 'accepted',
      resolved_at = now(),
      resolved_by = v_caller
  WHERE id = v_suggestion.id;

  -- Supersede every other pending suggestion on this match — they're now
  -- pointing at a different start time than what was just accepted.
  WITH superseded AS (
    UPDATE match_time_suggestion
    SET status = 'superseded',
        resolved_at = now(),
        resolved_by = v_caller
    WHERE match_id = v_suggestion.match_id
      AND id <> v_suggestion.id
      AND status = 'pending'
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_superseded_ids FROM superseded;

  -- Snapshot the joined player_ids that the service should broadcast to
  -- (excluding the creator who triggered this update).
  SELECT COALESCE(array_agg(player_id), ARRAY[]::UUID[]) INTO v_other_participant_ids
  FROM match_participant
  WHERE match_id = v_suggestion.match_id
    AND status = 'joined'
    AND player_id <> v_caller;

  RETURN jsonb_build_object(
    'match_id', v_suggestion.match_id,
    'suggestion_id', v_suggestion.id,
    'suggester_id', v_suggestion.suggester_id,
    'suggester_was_pending', v_suggester_was_pending,
    'previous_start_time', v_match.start_time,
    'previous_end_time', v_match.end_time,
    'new_start_time', v_new_start,
    'new_end_time', v_new_end,
    'match_date', v_match.match_date,
    'timezone', v_match.timezone,
    'superseded_suggestion_ids', to_jsonb(v_superseded_ids),
    'participant_ids_to_notify', to_jsonb(v_other_participant_ids)
  );
END;
$$;

COMMENT ON FUNCTION public.accept_match_time_suggestion(UUID) IS
  'Atomically accept a pending time suggestion: update match window, supersede other pending suggestions, auto-join the suggester if they were a pending invitee.';

GRANT EXECUTE ON FUNCTION public.accept_match_time_suggestion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_match_time_suggestion(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- RPC: withdraw_match_time_suggestion
--
-- Suggester-only path. Marks a pending suggestion as withdrawn. Plain UPDATE
-- could work via RLS, but the RPC gives us atomic guards and a single audit
-- point.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_match_time_suggestion(
  p_suggestion_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE match_time_suggestion
  SET status = 'withdrawn',
      resolved_at = now(),
      resolved_by = v_caller
  WHERE id = p_suggestion_id
    AND suggester_id = v_caller
    AND status = 'pending'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'suggestion_not_pending_or_not_owner';
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.withdraw_match_time_suggestion(UUID) IS
  'Mark the caller''s pending time suggestion as withdrawn.';

GRANT EXECUTE ON FUNCTION public.withdraw_match_time_suggestion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_match_time_suggestion(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- VERIFICATION
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'match_time_suggestion'
  ) THEN
    RAISE EXCEPTION 'match_time_suggestion table was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'accept_match_time_suggestion'
  ) THEN
    RAISE EXCEPTION 'accept_match_time_suggestion function was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'withdraw_match_time_suggestion'
  ) THEN
    RAISE EXCEPTION 'withdraw_match_time_suggestion function was not created';
  END IF;
END $$;

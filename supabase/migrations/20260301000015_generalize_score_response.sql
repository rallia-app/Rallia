-- Migration: Generalize score_confirmation for both confirmations and disputes (majority rules)
--
-- Previously, disputes bypassed the score_confirmation table entirely — a single
-- dispute_match_score() call would directly set match_result.disputed = TRUE.
-- In doubles, this meant one player could block the score for all 3 non-submitters.
--
-- Now both confirmations and disputes are tracked per-player in score_confirmation,
-- and majority rules applies:
--   - Singles (1 non-submitter): their vote is final (unchanged behavior)
--   - Doubles (3 non-submitters): 2+ confirms → verified, 2+ disputes → disputed

-- ============================================
-- PHASE 1: ADD ACTION + REASON COLUMNS
-- ============================================

ALTER TABLE score_confirmation
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (action IN ('confirmed', 'disputed')),
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Existing rows get action = 'confirmed' via the DEFAULT (correct — only confirmations were stored before).

-- ============================================
-- PHASE 2: REWRITE confirm_match_score()
-- ============================================

CREATE OR REPLACE FUNCTION confirm_match_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_is_participant BOOLEAN;
  v_total_non_submitter INTEGER;
  v_confirmed_count INTEGER;
BEGIN
  -- Get match_id and verify score exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Check player is a joined participant
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = v_match_id
      AND mp.player_id = p_player_id
      AND mp.status = 'joined'
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Record the confirmation (ignore if already responded)
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'confirmed')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  -- Count total non-submitter joined participants
  SELECT COUNT(*) INTO v_total_non_submitter
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id != mr.submitted_by
    AND mp.status = 'joined';

  -- Count confirmations for this result
  SELECT COUNT(*) INTO v_confirmed_count
  FROM score_confirmation sc
  WHERE sc.match_result_id = p_match_result_id
    AND sc.action = 'confirmed';

  -- Majority rules: verify if confirmations >= ceil(total / 2)
  IF v_confirmed_count >= CEIL(v_total_non_submitter::NUMERIC / 2.0) THEN
    UPDATE match_result
    SET
      is_verified = TRUE,
      verified_at = NOW(),
      confirmed_by = p_player_id
    WHERE id = p_match_result_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PHASE 3: REWRITE dispute_match_score()
-- ============================================

CREATE OR REPLACE FUNCTION dispute_match_score(
  p_match_result_id UUID,
  p_player_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_is_participant BOOLEAN;
  v_total_non_submitter INTEGER;
  v_disputed_count INTEGER;
  v_all_reasons TEXT;
BEGIN
  -- Get match_id and verify score exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Check player is a joined participant
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = v_match_id
      AND mp.player_id = p_player_id
      AND mp.status = 'joined'
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Record the dispute (ignore if already responded)
  INSERT INTO score_confirmation (match_result_id, player_id, action, reason)
  VALUES (p_match_result_id, p_player_id, 'disputed', p_reason)
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  -- Count total non-submitter joined participants
  SELECT COUNT(*) INTO v_total_non_submitter
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id != mr.submitted_by
    AND mp.status = 'joined';

  -- Count disputes for this result
  SELECT COUNT(*) INTO v_disputed_count
  FROM score_confirmation sc
  WHERE sc.match_result_id = p_match_result_id
    AND sc.action = 'disputed';

  -- Majority rules: mark disputed if disputes >= ceil(total / 2)
  IF v_disputed_count >= CEIL(v_total_non_submitter::NUMERIC / 2.0) THEN
    -- Aggregate all dispute reasons
    SELECT STRING_AGG(sc.reason, '; ' ORDER BY sc.confirmed_at)
    INTO v_all_reasons
    FROM score_confirmation sc
    WHERE sc.match_result_id = p_match_result_id
      AND sc.action = 'disputed'
      AND sc.reason IS NOT NULL;

    UPDATE match_result
    SET
      disputed = TRUE,
      dispute_reason = v_all_reasons
    WHERE id = p_match_result_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

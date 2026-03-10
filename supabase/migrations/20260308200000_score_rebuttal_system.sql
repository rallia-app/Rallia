-- Score Rebuttal System
-- Replaces the simple dispute flow with a rebuttal flow:
-- 1. Opponent can propose a different score (rebuttal) instead of just disputing
-- 2. Original team can accept the rebuttal (overwrites score) or dispute it (unsettled)
-- 3. Only 1 opponent needed to confirm/rebuttal (not majority)
-- 4. Auto-accept rebuttal after 24h with no response

-- ============================================================================
-- 1. Add rebuttal columns to match_result
-- ============================================================================

ALTER TABLE match_result
  ADD COLUMN IF NOT EXISTS rebuttal_team1_score INTEGER,
  ADD COLUMN IF NOT EXISTS rebuttal_team2_score INTEGER,
  ADD COLUMN IF NOT EXISTS rebuttal_winning_team INTEGER CHECK (rebuttal_winning_team IN (1, 2)),
  ADD COLUMN IF NOT EXISTS rebuttal_sets JSONB,
  ADD COLUMN IF NOT EXISTS rebuttal_submitted_by UUID REFERENCES player(id),
  ADD COLUMN IF NOT EXISTS rebuttal_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rebuttal_deadline TIMESTAMPTZ;

-- ============================================================================
-- 2. Update confirm_match_score: only opponents can confirm, threshold = 1
-- ============================================================================

CREATE OR REPLACE FUNCTION confirm_match_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
BEGIN
  -- Get match_id and verify score exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id
    AND mr.rebuttal_submitted_by IS NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Get submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get confirming player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only opponents (different team) can confirm
  IF v_player_team = v_submitter_team THEN
    RAISE EXCEPTION 'Only opponents can confirm the score';
  END IF;

  -- Record the confirmation
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'confirmed')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  -- Single opponent confirmation is enough → verify immediately
  UPDATE match_result
  SET
    is_verified = TRUE,
    verified_at = NOW(),
    confirmed_by = p_player_id
  WHERE id = p_match_result_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. New RPC: propose_rebuttal_score
-- ============================================================================

CREATE OR REPLACE FUNCTION propose_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID,
  p_winning_team INTEGER,
  p_sets JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
  v_team1_wins INTEGER := 0;
  v_team2_wins INTEGER := 0;
  v_set JSONB;
  v_needs_swap BOOLEAN;
  v_mapped_sets JSONB;
  v_mapped_winning_team INTEGER;
BEGIN
  -- Verify score exists and isn't already processed or rebutted
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Get submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get rebutting player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only opponents (different team) can propose a rebuttal
  IF v_player_team = v_submitter_team THEN
    RAISE EXCEPTION 'Only opponents can propose a rebuttal score';
  END IF;

  -- The UI sends scores where team1 = "me" (rebuttal submitter).
  -- If the rebuttal submitter is on match team 2, we need to swap
  -- team1/team2 so that rebuttal_team1_score always means match team 1.
  v_needs_swap := (v_player_team = 2);

  -- Remap sets: swap team1_score/team2_score if submitter is team 2
  IF v_needs_swap THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'team1_score', (elem->>'team2_score')::INTEGER,
        'team2_score', (elem->>'team1_score')::INTEGER
      )
    ) INTO v_mapped_sets
    FROM jsonb_array_elements(p_sets) AS elem;
  ELSE
    v_mapped_sets := p_sets;
  END IF;

  -- Remap winning_team
  IF v_needs_swap AND p_winning_team IS NOT NULL THEN
    v_mapped_winning_team := CASE WHEN p_winning_team = 1 THEN 2 ELSE 1 END;
  ELSE
    v_mapped_winning_team := p_winning_team;
  END IF;

  -- Compute team scores from mapped sets
  FOR v_set IN SELECT * FROM jsonb_array_elements(v_mapped_sets)
  LOOP
    IF (v_set->>'team1_score')::INTEGER > (v_set->>'team2_score')::INTEGER THEN
      v_team1_wins := v_team1_wins + 1;
    ELSIF (v_set->>'team2_score')::INTEGER > (v_set->>'team1_score')::INTEGER THEN
      v_team2_wins := v_team2_wins + 1;
    END IF;
  END LOOP;

  -- Store rebuttal data (team1/team2 now refers to actual match teams)
  UPDATE match_result
  SET
    rebuttal_team1_score = v_team1_wins,
    rebuttal_team2_score = v_team2_wins,
    rebuttal_winning_team = v_mapped_winning_team,
    rebuttal_sets = v_mapped_sets,
    rebuttal_submitted_by = p_player_id,
    rebuttal_submitted_at = NOW(),
    rebuttal_deadline = NOW() + INTERVAL '24 hours'
  WHERE id = p_match_result_id;

  -- Record in score_confirmation table
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'rebuttal')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. New RPC: accept_rebuttal_score
-- ============================================================================

CREATE OR REPLACE FUNCTION accept_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
  v_rebuttal_sets JSONB;
  v_rebuttal_t1 INTEGER;
  v_rebuttal_t2 INTEGER;
  v_rebuttal_winner INTEGER;
  v_set JSONB;
  v_set_number INTEGER := 0;
BEGIN
  -- Verify rebuttal exists and isn't already processed
  SELECT mr.match_id, mr.rebuttal_sets, mr.rebuttal_team1_score,
         mr.rebuttal_team2_score, mr.rebuttal_winning_team
  INTO v_match_id, v_rebuttal_sets, v_rebuttal_t1, v_rebuttal_t2, v_rebuttal_winner
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NOT NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Rebuttal not found or already processed';
  END IF;

  -- Get original submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get accepting player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only original team (same team as submitter) can accept the rebuttal
  IF v_player_team != v_submitter_team THEN
    RAISE EXCEPTION 'Only the original submitting team can accept a rebuttal';
  END IF;

  -- Delete old match_set rows
  DELETE FROM match_set WHERE match_result_id = p_match_result_id;

  -- Insert new sets from rebuttal
  FOR v_set IN SELECT * FROM jsonb_array_elements(v_rebuttal_sets)
  LOOP
    v_set_number := v_set_number + 1;
    INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (
      p_match_result_id,
      COALESCE((v_set->>'set_number')::INTEGER, v_set_number),
      (v_set->>'team1_score')::INTEGER,
      (v_set->>'team2_score')::INTEGER
    );
  END LOOP;

  -- Copy rebuttal scores to main scores and mark verified
  UPDATE match_result
  SET
    team1_score = v_rebuttal_t1,
    team2_score = v_rebuttal_t2,
    winning_team = v_rebuttal_winner,
    is_verified = TRUE,
    verified_at = NOW(),
    confirmed_by = p_player_id
  WHERE id = p_match_result_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. New RPC: dispute_rebuttal_score
-- ============================================================================

CREATE OR REPLACE FUNCTION dispute_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
BEGIN
  -- Verify rebuttal exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NOT NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Rebuttal not found or already processed';
  END IF;

  -- Get original submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get disputing player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only original team can dispute the rebuttal
  IF v_player_team != v_submitter_team THEN
    RAISE EXCEPTION 'Only the original submitting team can dispute a rebuttal';
  END IF;

  -- Mark as disputed (unsettled)
  UPDATE match_result
  SET disputed = TRUE
  WHERE id = p_match_result_id;

  -- Record in score_confirmation
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'disputed')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. Update auto_confirm_expired_scores to also handle rebuttal deadlines
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_confirm_expired_scores()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
  rebuttal_count INTEGER;
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

  RETURN updated_count + COALESCE(rebuttal_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. Update score_confirmation action CHECK to include 'rebuttal'
-- ============================================================================

ALTER TABLE score_confirmation
  DROP CONSTRAINT IF EXISTS score_confirmation_action_check;

ALTER TABLE score_confirmation
  ADD CONSTRAINT score_confirmation_action_check
  CHECK (action IN ('confirmed', 'disputed', 'rebuttal'));

-- ============================================================================
-- 8. Update get_pending_score_confirmations to include rebuttal info
--    and scope to opponents only
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pending_score_confirmations(p_player_id UUID)
RETURNS TABLE (
  match_result_id UUID,
  match_id UUID,
  match_date DATE,
  sport_name TEXT,
  sport_icon_url TEXT,
  winning_team INTEGER,
  team1_score INTEGER,
  team2_score INTEGER,
  submitted_by_id UUID,
  submitted_by_name TEXT,
  submitted_by_avatar TEXT,
  confirmation_deadline TIMESTAMPTZ,
  opponent_name TEXT,
  opponent_avatar TEXT,
  player_team INTEGER,
  network_id UUID,
  network_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (mr.id)
      mr.id as match_result_id,
      m.id as match_id,
      m.match_date as match_date,
      s.name::TEXT as sport_name,
      s.icon_url::TEXT as sport_icon_url,
      mr.winning_team,
      mr.team1_score,
      mr.team2_score,
      mr.submitted_by as submitted_by_id,
      COALESCE(sub_profile.display_name, sub_profile.first_name || ' ' || COALESCE(sub_profile.last_name, ''))::TEXT as submitted_by_name,
      sub_profile.profile_picture_url::TEXT as submitted_by_avatar,
      mr.confirmation_deadline,
      COALESCE(opp_profile.display_name, opp_profile.first_name || ' ' || COALESCE(opp_profile.last_name, ''))::TEXT as opponent_name,
      opp_profile.profile_picture_url::TEXT as opponent_avatar,
      my_part.team_number as player_team,
      mn.network_id,
      n.name::TEXT as network_name
    FROM match_result mr
    JOIN match m ON m.id = mr.match_id
    JOIN sport s ON s.id = m.sport_id
    JOIN match_participant my_part ON my_part.match_id = m.id AND my_part.player_id = p_player_id
    -- Get submitter's team number to filter opponents only
    JOIN match_participant sub_part ON sub_part.match_id = m.id AND sub_part.player_id = mr.submitted_by
    LEFT JOIN player sub_player ON sub_player.id = mr.submitted_by
    LEFT JOIN profile sub_profile ON sub_profile.id = sub_player.id
    LEFT JOIN match_participant opp_part ON opp_part.match_id = m.id
      AND opp_part.player_id != p_player_id
      AND opp_part.player_id != mr.submitted_by
    LEFT JOIN player opp_player ON opp_player.id = opp_part.player_id
    LEFT JOIN profile opp_profile ON opp_profile.id = opp_player.id
    LEFT JOIN match_network mn ON mn.match_id = m.id
    LEFT JOIN network n ON n.id = mn.network_id
    WHERE
      mr.is_verified = FALSE
      AND mr.disputed = FALSE
      AND mr.submitted_by != p_player_id
      AND mr.rebuttal_submitted_by IS NULL
      AND mr.confirmation_deadline > NOW()
      -- Only show to opponents (different team than submitter)
      AND my_part.team_number != sub_part.team_number
      -- Exclude scores this player has already individually responded to
      AND NOT EXISTS (
        SELECT 1 FROM score_confirmation sc
        WHERE sc.match_result_id = mr.id AND sc.player_id = p_player_id
      )
    ORDER BY mr.id, mr.confirmation_deadline ASC
  ) sub
  ORDER BY confirmation_deadline ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. Drop the old dispute_match_score function (no longer needed)
-- ============================================================================

DROP FUNCTION IF EXISTS dispute_match_score(UUID, UUID, TEXT);

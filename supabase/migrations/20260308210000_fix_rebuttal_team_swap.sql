-- Fix: propose_rebuttal_score was storing scores from the submitter's UI perspective
-- (team1 = "me") instead of mapping to actual match team numbers.
-- The original submitter is always team 1, so when the opponent (team 2) proposes
-- a rebuttal, their UI team1 = match team 2. We must swap before storing.

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

-- Migration: Assign team_number to match_participant when submitting score via RPC
-- Previously, submit_match_result_for_match stored set scores but never set team_number
-- on participants, breaking score perspective display for non-submitters.
--
-- Adds optional p_partner_id parameter (DEFAULT NULL for backwards compatibility).
-- Singles: submitter = team 1, other participant = team 2
-- Doubles: submitter + partner = team 1, other two = team 2

CREATE OR REPLACE FUNCTION submit_match_result_for_match(
  p_match_id UUID,
  p_submitted_by UUID,
  p_winning_team INT,
  p_sets JSONB,
  p_partner_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_is_participant BOOLEAN;
  v_match_exists BOOLEAN;
  v_has_result BOOLEAN;
  v_match_cancelled BOOLEAN;
  v_match_end_utc TIMESTAMPTZ;
  v_match_ended BOOLEAN;
  v_within_48h BOOLEAN;
  v_set_count INT;
  v_set_el JSONB;
  v_team1_total INT := 0;
  v_team2_total INT := 0;
  v_result_id UUID;
  v_i INT;
  v_match_format TEXT;
  v_joined_count INT;
  v_partner_is_participant BOOLEAN;
BEGIN
  -- Caller must be authenticated; player.id = profile.id = auth.uid()
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be submitting as themselves
  IF v_player_id != p_submitted_by THEN
    RAISE EXCEPTION 'Cannot submit score on behalf of another player';
  END IF;

  -- Participant check: must be a joined participant of this match
  SELECT EXISTS(
    SELECT 1 FROM match_participant mp
    WHERE mp.match_id = p_match_id
      AND mp.player_id = p_submitted_by
      AND mp.status = 'joined'
  ) INTO v_is_participant;
  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'Player is not a joined participant of this match';
  END IF;

  -- Match must exist and not be cancelled
  SELECT EXISTS(SELECT 1 FROM match m WHERE m.id = p_match_id),
         COALESCE((SELECT m.cancelled_at IS NOT NULL FROM match m WHERE m.id = p_match_id), TRUE)
  INTO v_match_exists, v_match_cancelled;
  IF NOT v_match_exists OR v_match_cancelled THEN
    RAISE EXCEPTION 'Match not found or cancelled';
  END IF;

  -- No existing result
  SELECT EXISTS(SELECT 1 FROM match_result mr WHERE mr.match_id = p_match_id)
  INTO v_has_result;
  IF v_has_result THEN
    RAISE EXCEPTION 'Match already has a result';
  END IF;

  -- Match must have ended (end time in match timezone < now)
  SELECT
    CASE
      WHEN m.timezone IS NOT NULL THEN
        CASE
          WHEN m.end_time < m.start_time THEN
            timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp)
          ELSE
            timezone(m.timezone, (m.match_date + m.end_time)::timestamp)
        END
      ELSE
        (m.match_date + m.end_time)::timestamptz
    END
  INTO v_match_end_utc
  FROM match m
  WHERE m.id = p_match_id;

  v_match_ended := v_match_end_utc < NOW();
  IF NOT v_match_ended THEN
    RAISE EXCEPTION 'Match has not ended yet';
  END IF;

  -- Optional: allow only within 48h feedback window
  v_within_48h := v_match_end_utc > (NOW() - INTERVAL '48 hours');
  IF NOT v_within_48h THEN
    RAISE EXCEPTION 'Score can only be registered within 48 hours after match end';
  END IF;

  -- Validate p_winning_team (nullable – NULL means tied match)
  IF p_winning_team IS NOT NULL AND p_winning_team NOT IN (1, 2) THEN
    RAISE EXCEPTION 'winning_team must be 1, 2, or null';
  END IF;

  -- Validate p_sets: array of 1-5 objects with team1_score, team2_score (non-negative integers)
  IF jsonb_typeof(p_sets) != 'array' THEN
    RAISE EXCEPTION 'sets must be a JSON array';
  END IF;
  v_set_count := jsonb_array_length(p_sets);
  IF v_set_count < 1 OR v_set_count > 5 THEN
    RAISE EXCEPTION 'sets must contain 1 to 5 elements';
  END IF;

  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    IF jsonb_typeof(v_set_el) != 'object' THEN
      RAISE EXCEPTION 'Each set must be an object';
    END IF;
    IF NOT (v_set_el ? 'team1_score' AND v_set_el ? 'team2_score') THEN
      RAISE EXCEPTION 'Each set must have team1_score and team2_score';
    END IF;
    IF (v_set_el->>'team1_score')::INT IS NULL OR (v_set_el->>'team1_score')::INT < 0 OR
       (v_set_el->>'team2_score')::INT IS NULL OR (v_set_el->>'team2_score')::INT < 0 THEN
      RAISE EXCEPTION 'Set scores must be non-negative integers';
    END IF;
    IF (v_set_el->>'team1_score')::INT > (v_set_el->>'team2_score')::INT THEN
      v_team1_total := v_team1_total + 1;
    ELSIF (v_set_el->>'team2_score')::INT > (v_set_el->>'team1_score')::INT THEN
      v_team2_total := v_team2_total + 1;
    END IF;
  END LOOP;

  -- ============================================
  -- TEAM ASSIGNMENT
  -- ============================================
  -- Get match format and joined participant count
  SELECT m.format INTO v_match_format
  FROM match m WHERE m.id = p_match_id;

  SELECT COUNT(*) INTO v_joined_count
  FROM match_participant mp
  WHERE mp.match_id = p_match_id AND mp.status = 'joined';

  IF v_match_format = 'singles' THEN
    -- Singles: submitter = team 1, the other joined participant = team 2
    UPDATE match_participant
    SET team_number = 1
    WHERE match_id = p_match_id AND player_id = p_submitted_by AND status = 'joined';

    UPDATE match_participant
    SET team_number = 2
    WHERE match_id = p_match_id AND player_id != p_submitted_by AND status = 'joined';

  ELSIF v_match_format = 'doubles' THEN
    -- Doubles: require p_partner_id
    IF p_partner_id IS NULL THEN
      RAISE EXCEPTION 'p_partner_id is required for doubles matches';
    END IF;

    -- Validate partner is a joined participant (and not the submitter)
    SELECT EXISTS(
      SELECT 1 FROM match_participant mp
      WHERE mp.match_id = p_match_id
        AND mp.player_id = p_partner_id
        AND mp.player_id != p_submitted_by
        AND mp.status = 'joined'
    ) INTO v_partner_is_participant;

    IF NOT v_partner_is_participant THEN
      RAISE EXCEPTION 'Partner is not a valid joined participant of this match';
    END IF;

    -- Submitter + partner = team 1
    UPDATE match_participant
    SET team_number = 1
    WHERE match_id = p_match_id
      AND player_id IN (p_submitted_by, p_partner_id)
      AND status = 'joined';

    -- Other two participants = team 2
    UPDATE match_participant
    SET team_number = 2
    WHERE match_id = p_match_id
      AND player_id NOT IN (p_submitted_by, p_partner_id)
      AND status = 'joined';
  END IF;

  -- Insert match_result
  INSERT INTO match_result (
    match_id,
    winning_team,
    team1_score,
    team2_score,
    is_verified,
    submitted_by,
    confirmation_deadline
  ) VALUES (
    p_match_id,
    p_winning_team,
    v_team1_total,
    v_team2_total,
    FALSE,
    p_submitted_by,
    NOW() + INTERVAL '24 hours'
  )
  RETURNING id INTO v_result_id;

  -- Insert match_set rows
  FOR v_i IN 0..(v_set_count - 1) LOOP
    v_set_el := p_sets->v_i;
    INSERT INTO match_set (
      match_result_id,
      set_number,
      team1_score,
      team2_score
    ) VALUES (
      v_result_id,
      v_i + 1,
      (v_set_el->>'team1_score')::INT,
      (v_set_el->>'team2_score')::INT
    );
  END LOOP;

  RETURN v_result_id;
END;
$$;

-- Migration: Require all participants to confirm score for doubles matches
-- Previously, a single confirmation from any non-submitter would verify the score.
-- Now, each non-submitter joined participant must individually confirm before the score is verified.
-- For singles (1v1), behavior is unchanged: the single opponent confirms and it's verified.

-- ============================================
-- PHASE 1: CREATE SCORE_CONFIRMATION TABLE
-- ============================================

-- Track individual confirmations from each participant
CREATE TABLE IF NOT EXISTS score_confirmation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_result_id UUID NOT NULL REFERENCES match_result(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES player(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_result_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_score_confirmation_match_result
  ON score_confirmation(match_result_id);

-- RLS
ALTER TABLE score_confirmation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Players can view their own confirmations" ON score_confirmation;
CREATE POLICY "Players can view their own confirmations"
  ON score_confirmation FOR SELECT
  USING (player_id = auth.uid());

DROP POLICY IF EXISTS "Players can insert their own confirmations" ON score_confirmation;
CREATE POLICY "Players can insert their own confirmations"
  ON score_confirmation FOR INSERT
  WITH CHECK (player_id = auth.uid());

GRANT SELECT, INSERT ON score_confirmation TO authenticated;

-- ============================================
-- PHASE 2: UPDATE confirm_match_score()
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
  v_total_confirmed INTEGER;
BEGIN
  -- Get match_id and verify score exists and isn't processed
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

  -- Record the individual confirmation (ignore if already confirmed)
  INSERT INTO score_confirmation (match_result_id, player_id)
  VALUES (p_match_result_id, p_player_id)
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  -- Count total non-submitter joined participants
  SELECT COUNT(*) INTO v_total_non_submitter
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id != mr.submitted_by
    AND mp.status = 'joined';

  -- Count total confirmations for this result
  SELECT COUNT(*) INTO v_total_confirmed
  FROM score_confirmation sc
  WHERE sc.match_result_id = p_match_result_id;

  -- Only verify if ALL non-submitter participants have confirmed
  IF v_total_confirmed >= v_total_non_submitter THEN
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
-- PHASE 3: UPDATE get_pending_score_confirmations()
-- ============================================

-- Exclude scores this player has already individually confirmed
DROP FUNCTION IF EXISTS get_pending_score_confirmations(UUID);

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
      AND mr.confirmation_deadline > NOW()
      -- Exclude scores this player has already individually confirmed
      AND NOT EXISTS (
        SELECT 1 FROM score_confirmation sc
        WHERE sc.match_result_id = mr.id AND sc.player_id = p_player_id
      )
    ORDER BY mr.id, mr.confirmation_deadline ASC
  ) sub
  ORDER BY confirmation_deadline ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

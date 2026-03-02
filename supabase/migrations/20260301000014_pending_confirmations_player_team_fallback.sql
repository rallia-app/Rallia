-- Migration: Add player_team COALESCE fallback and aggregated opponent names
-- to get_pending_score_confirmations RPC.
--
-- 1. player_team: Falls back to 1 for submitter, 2 for non-submitter when
--    team_number is NULL (legacy data without team assignment).
-- 2. opponent_name: Aggregates all opponent names with ' & ' for doubles
--    (previously only showed one opponent due to DISTINCT ON).

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
  SELECT
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
    -- Aggregate all opponent names (for doubles: "Alice & Bob")
    (
      SELECT string_agg(
        COALESCE(op.display_name, op.first_name || ' ' || COALESCE(op.last_name, ''))::TEXT,
        ' & '
      )
      FROM match_participant opp_mp
      JOIN player opp_pl ON opp_pl.id = opp_mp.player_id
      JOIN profile op ON op.id = opp_pl.id
      WHERE opp_mp.match_id = m.id
        AND opp_mp.player_id != p_player_id
        AND opp_mp.player_id != mr.submitted_by
        AND opp_mp.status = 'joined'
    ) as opponent_name,
    -- Use first opponent's avatar (for backwards compatibility)
    (
      SELECT op2.profile_picture_url::TEXT
      FROM match_participant opp_mp2
      JOIN player opp_pl2 ON opp_pl2.id = opp_mp2.player_id
      JOIN profile op2 ON op2.id = opp_pl2.id
      WHERE opp_mp2.match_id = m.id
        AND opp_mp2.player_id != p_player_id
        AND opp_mp2.player_id != mr.submitted_by
        AND opp_mp2.status = 'joined'
      LIMIT 1
    ) as opponent_avatar,
    -- COALESCE: use team_number if set, otherwise submitter=1, non-submitter=2
    COALESCE(
      my_part.team_number,
      CASE WHEN mr.submitted_by = p_player_id THEN 1 ELSE 2 END
    )::INTEGER as player_team,
    mn.network_id,
    n.name::TEXT as network_name
  FROM match_result mr
  JOIN match m ON m.id = mr.match_id
  JOIN sport s ON s.id = m.sport_id
  JOIN match_participant my_part ON my_part.match_id = m.id AND my_part.player_id = p_player_id
  LEFT JOIN player sub_player ON sub_player.id = mr.submitted_by
  LEFT JOIN profile sub_profile ON sub_profile.id = sub_player.id
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
  ORDER BY mr.confirmation_deadline ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

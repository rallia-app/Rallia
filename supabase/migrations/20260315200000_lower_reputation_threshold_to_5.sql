-- ============================================================================
-- Lower reputation public threshold from 10 to 5 events
-- ============================================================================
-- Reduces the minimum reputation events required before a player's reputation
-- becomes publicly visible from 10 to 5 events. This allows players to
-- establish their reputation faster (typically after 1-2 matches instead of
-- 2-4 matches).
--
-- The threshold lives in the recalculate_player_reputation function's default
-- parameter. The is_public column on player_reputation is a regular boolean
-- that gets set by the function during recalculation.
-- ============================================================================

-- Update the recalculate function default parameter from 10 to 5
CREATE OR REPLACE FUNCTION recalculate_player_reputation(
  target_player_id UUID,
  apply_decay BOOLEAN DEFAULT false,
  min_events_for_public INT DEFAULT 5
) RETURNS player_reputation AS $$
DECLARE
  p_total_events INT;
  p_positive_events INT;
  p_negative_events INT;
  p_matches_completed INT;
  p_raw_score DECIMAL;
  p_final_score DECIMAL;
  p_tier reputation_tier;
  p_result player_reputation;
BEGIN
  -- Count events
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE base_impact > 0),
    COUNT(*) FILTER (WHERE base_impact < 0),
    COUNT(*) FILTER (WHERE event_type = 'match_completed')
  INTO p_total_events, p_positive_events, p_negative_events, p_matches_completed
  FROM reputation_event
  WHERE player_id = target_player_id;

  -- Calculate raw score from events
  SELECT COALESCE(
    100 + SUM(
      CASE
        WHEN apply_decay AND rc.decay_enabled AND rc.decay_half_life_days IS NOT NULL THEN
          re.base_impact * POWER(0.5, EXTRACT(EPOCH FROM (NOW() - re.event_occurred_at)) / (rc.decay_half_life_days * 86400))
        ELSE
          re.base_impact
      END
    ),
    100
  )
  INTO p_raw_score
  FROM reputation_event re
  LEFT JOIN reputation_config rc ON rc.event_type = re.event_type AND rc.is_active = true
  WHERE re.player_id = target_player_id;

  -- Clamp score to 0-100
  p_final_score := GREATEST(0, LEAST(100, p_raw_score));

  -- Calculate tier using total_events (not matches_completed)
  p_tier := calculate_reputation_tier(p_final_score, p_total_events, min_events_for_public);

  -- Upsert player_reputation
  INSERT INTO player_reputation (
    player_id, reputation_score, reputation_tier,
    total_events, positive_events, negative_events, matches_completed,
    is_public, calculated_at, last_decay_calculation
  ) VALUES (
    target_player_id, p_final_score, p_tier,
    p_total_events, p_positive_events, p_negative_events, p_matches_completed,
    p_total_events >= min_events_for_public, NOW(),
    CASE WHEN apply_decay THEN NOW() ELSE NULL END
  )
  ON CONFLICT (player_id) DO UPDATE SET
    reputation_score = EXCLUDED.reputation_score,
    reputation_tier = EXCLUDED.reputation_tier,
    total_events = EXCLUDED.total_events,
    positive_events = EXCLUDED.positive_events,
    negative_events = EXCLUDED.negative_events,
    matches_completed = EXCLUDED.matches_completed,
    is_public = EXCLUDED.is_public,
    calculated_at = EXCLUDED.calculated_at,
    last_decay_calculation = COALESCE(EXCLUDED.last_decay_calculation, player_reputation.last_decay_calculation)
  RETURNING * INTO p_result;

  RETURN p_result;
END;
$$ LANGUAGE plpgsql;

-- Recalculate is_public for existing rows with the new threshold (5 instead of 10)
-- Players with 5-9 events will now become public
UPDATE player_reputation
SET is_public = (total_events >= 5)
WHERE total_events >= 5 AND is_public = false;

-- Reputation system audit fixes
--
-- 1. Add 'feedback_submitted' to the DB enum
-- 2. Add config row for feedback_submitted
-- 3. Deactivate dead event types (first_match_bonus, match_repeat_opponent, match_ghosted)
-- 4. Update calculate_reputation_tier() to use total_events instead of matches_completed

-- 1. Add feedback_submitted to the enum
ALTER TYPE reputation_event_type ADD VALUE IF NOT EXISTS 'feedback_submitted';

-- 2. Add config row for feedback_submitted
INSERT INTO reputation_config (event_type, default_impact, min_impact, max_impact, decay_enabled)
VALUES ('feedback_submitted', 1, 0, 2, false)
ON CONFLICT (event_type) DO NOTHING;

-- 3. Deactivate dead event types
UPDATE reputation_config
SET is_active = false
WHERE event_type IN ('first_match_bonus', 'match_repeat_opponent', 'match_ghosted');

-- 4. Update calculate_reputation_tier to use total_events instead of matches_completed
--    Drop old signature first, then create with new signature
DROP FUNCTION IF EXISTS calculate_reputation_tier(DECIMAL, INT, INT);

CREATE OR REPLACE FUNCTION calculate_reputation_tier(
  score DECIMAL,
  total_events INT,
  min_events INT DEFAULT 10
) RETURNS reputation_tier AS $$
BEGIN
  IF total_events < min_events THEN
    RETURN 'unknown';
  END IF;

  IF score >= 90 THEN RETURN 'platinum';
  ELSIF score >= 75 THEN RETURN 'gold';
  ELSIF score >= 60 THEN RETURN 'silver';
  ELSE RETURN 'bronze';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 5. Update recalculate_player_reputation to pass total_events to the tier function
CREATE OR REPLACE FUNCTION recalculate_player_reputation(
  target_player_id UUID,
  apply_decay BOOLEAN DEFAULT false
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
  p_tier := calculate_reputation_tier(p_final_score, p_total_events);

  -- Upsert player_reputation
  INSERT INTO player_reputation (
    player_id, reputation_score, reputation_tier,
    total_events, positive_events, negative_events, matches_completed,
    is_public, calculated_at, last_decay_calculation
  ) VALUES (
    target_player_id, p_final_score, p_tier,
    p_total_events, p_positive_events, p_negative_events, p_matches_completed,
    p_total_events >= 10, NOW(),
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

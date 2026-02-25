-- ============================================
-- Fix: Improved User Retention Cohort Function
-- ============================================
-- Changes:
-- 1. W0 is always 100% (users are active in their registration week)
-- 2. Track multiple activity sources, not just matches:
--    - Match participation
--    - Messages sent
--    - Peer rating requests (given/received)
--    - Player ratings given
--    - Profile updates
-- ============================================

DROP FUNCTION IF EXISTS get_retention_cohort(int);

CREATE OR REPLACE FUNCTION get_retention_cohort(
  p_cohort_weeks int DEFAULT 12
) RETURNS TABLE (
  cohort_week date,
  week_number int,
  retained_users bigint,
  retention_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cohort_users AS (
    -- Get users grouped by registration week
    SELECT 
      date_trunc('week', p.created_at)::date AS registration_week,
      p.id AS player_id,
      p.created_at AS registered_at,
      p.updated_at AS profile_updated_at
    FROM player p
    WHERE p.created_at >= NOW() - (p_cohort_weeks || ' weeks')::interval
  ),
  
  -- Week 0: All registered users (100% by definition)
  week_zero_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      0::bigint AS weeks_since_registration
    FROM cohort_users cu
  ),
  
  -- Activity from matches
  match_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', m.created_at) - cu.registration_week)) / 604800)::bigint AS weeks_since_registration
    FROM cohort_users cu
    INNER JOIN match_participant mp ON mp.player_id = cu.player_id
    INNER JOIN match m ON m.id = mp.match_id
    WHERE m.created_at >= cu.registration_week
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', m.created_at) - cu.registration_week)) / 604800) > 0
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', m.created_at) - cu.registration_week)) / 604800) < p_cohort_weeks
  ),
  
  -- Activity from messages sent
  message_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', msg.created_at) - cu.registration_week)) / 604800)::bigint AS weeks_since_registration
    FROM cohort_users cu
    INNER JOIN message msg ON msg.sender_id = cu.player_id
    WHERE msg.created_at >= cu.registration_week
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', msg.created_at) - cu.registration_week)) / 604800) > 0
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', msg.created_at) - cu.registration_week)) / 604800) < p_cohort_weeks
  ),
  
  -- Activity from peer rating requests (as requester or evaluator)
  peer_rating_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prr.created_at) - cu.registration_week)) / 604800)::bigint AS weeks_since_registration
    FROM cohort_users cu
    INNER JOIN peer_rating_request prr ON prr.requester_id = cu.player_id OR prr.evaluator_id = cu.player_id
    WHERE prr.created_at >= cu.registration_week
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prr.created_at) - cu.registration_week)) / 604800) > 0
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prr.created_at) - cu.registration_week)) / 604800) < p_cohort_weeks
  ),
  
  -- Activity from player rating scores (giving ratings)
  rating_score_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prs.created_at) - cu.registration_week)) / 604800)::bigint AS weeks_since_registration
    FROM cohort_users cu
    INNER JOIN player_rating_score prs ON prs.player_id = cu.player_id
    WHERE prs.created_at >= cu.registration_week
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prs.created_at) - cu.registration_week)) / 604800) > 0
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', prs.created_at) - cu.registration_week)) / 604800) < p_cohort_weeks
  ),
  
  -- Activity from profile updates (updated_at differs from created_at)
  profile_activity AS (
    SELECT 
      cu.registration_week,
      cu.player_id,
      FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', cu.profile_updated_at) - cu.registration_week)) / 604800)::bigint AS weeks_since_registration
    FROM cohort_users cu
    WHERE cu.profile_updated_at > cu.registered_at
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', cu.profile_updated_at) - cu.registration_week)) / 604800) > 0
      AND FLOOR(EXTRACT(EPOCH FROM (date_trunc('week', cu.profile_updated_at) - cu.registration_week)) / 604800) < p_cohort_weeks
  ),
  
  -- Combine all activity sources
  all_activity AS (
    SELECT * FROM week_zero_activity
    UNION
    SELECT * FROM match_activity
    UNION
    SELECT * FROM message_activity
    UNION
    SELECT * FROM peer_rating_activity
    UNION
    SELECT * FROM rating_score_activity
    UNION
    SELECT * FROM profile_activity
  ),
  
  cohort_size AS (
    SELECT 
      registration_week,
      COUNT(DISTINCT player_id) AS total_users
    FROM cohort_users
    GROUP BY registration_week
  )
  
  SELECT 
    cs.registration_week AS cohort_week,
    aa.weeks_since_registration::int AS week_number,
    COUNT(DISTINCT aa.player_id) AS retained_users,
    ROUND((COUNT(DISTINCT aa.player_id)::numeric / NULLIF(cs.total_users, 0)) * 100, 2) AS retention_rate
  FROM cohort_size cs
  INNER JOIN all_activity aa ON aa.registration_week = cs.registration_week
  WHERE aa.weeks_since_registration >= 0 AND aa.weeks_since_registration < p_cohort_weeks
  GROUP BY cs.registration_week, aa.weeks_since_registration, cs.total_users
  ORDER BY cs.registration_week DESC, aa.weeks_since_registration;
END;
$$;

GRANT EXECUTE ON FUNCTION get_retention_cohort(int) TO authenticated;

COMMENT ON FUNCTION get_retention_cohort IS 'Returns weekly cohort retention data tracking multiple activity sources: matches, messages, ratings, and profile updates. W0 is always 100%.';

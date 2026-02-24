-- Migration: Admin Analytics RPC Functions
-- Purpose: Add RPC functions for admin analytics aggregations
-- Phase: Admin Analytics Enhancement - Phase 1

-- ============================================
-- Function: get_onboarding_funnel
-- Returns onboarding funnel metrics for a date range
-- ============================================

CREATE OR REPLACE FUNCTION get_onboarding_funnel(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  step_name text,
  users_count bigint,
  completion_rate numeric,
  avg_time_seconds numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH funnel_steps AS (
    -- Step 1: Account Created
    SELECT 
      'account_created' AS step,
      1 AS step_order,
      COUNT(*) AS user_count,
      NULL::numeric AS avg_time
    FROM player
    WHERE created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Step 2: Email Verified (has logged in at least once)
    SELECT 
      'email_verified' AS step,
      2 AS step_order,
      COUNT(DISTINCT p.id) AS user_count,
      AVG(EXTRACT(EPOCH FROM (p.updated_at - p.created_at)))::numeric AS avg_time
    FROM player p
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND p.email_verified = true
    
    UNION ALL
    
    -- Step 3: Profile Completed (has basic info filled)
    SELECT 
      'profile_completed' AS step,
      3 AS step_order,
      COUNT(DISTINCT p.id) AS user_count,
      NULL::numeric AS avg_time
    FROM player p
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND p.first_name IS NOT NULL
      AND p.last_name IS NOT NULL
      AND p.date_of_birth IS NOT NULL
    
    UNION ALL
    
    -- Step 4: Sport Added (has at least one sport)
    SELECT 
      'sport_added' AS step,
      4 AS step_order,
      COUNT(DISTINCT ps.player_id) AS user_count,
      NULL::numeric AS avg_time
    FROM player_sport ps
    JOIN player p ON p.id = ps.player_id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Step 5: First Match (participated in at least one match)
    SELECT 
      'first_match' AS step,
      5 AS step_order,
      COUNT(DISTINCT mp.player_id) AS user_count,
      NULL::numeric AS avg_time
    FROM match_participant mp
    JOIN player p ON p.id = mp.player_id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
  ),
  total_created AS (
    SELECT COALESCE(user_count, 0) AS total
    FROM funnel_steps
    WHERE step = 'account_created'
  )
  SELECT 
    fs.step::text AS step_name,
    fs.user_count AS users_count,
    CASE 
      WHEN tc.total > 0 THEN ROUND((fs.user_count::numeric / tc.total::numeric) * 100, 2)
      ELSE 0
    END AS completion_rate,
    ROUND(fs.avg_time, 0) AS avg_time_seconds
  FROM funnel_steps fs
  CROSS JOIN total_created tc
  ORDER BY fs.step_order;
END;
$$;

-- Grant execute permission to authenticated users (admin check happens in service layer)
GRANT EXECUTE ON FUNCTION get_onboarding_funnel(date, date) TO authenticated;

COMMENT ON FUNCTION get_onboarding_funnel(date, date) IS 'Returns onboarding funnel metrics showing conversion between steps';


-- ============================================
-- Function: get_retention_cohort
-- Returns weekly retention cohort data
-- ============================================

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
      p.id AS player_id
    FROM player p
    WHERE p.created_at >= NOW() - (p_cohort_weeks || ' weeks')::interval
  ),
  activity_weeks AS (
    -- Track activity per week
    SELECT 
      cu.registration_week,
      cu.player_id,
      EXTRACT(WEEK FROM m.created_at) - EXTRACT(WEEK FROM cu.registration_week) AS weeks_since_registration
    FROM cohort_users cu
    LEFT JOIN match_participant mp ON mp.player_id = cu.player_id
    LEFT JOIN match m ON m.id = mp.match_id
    WHERE m.created_at IS NULL OR m.created_at >= cu.registration_week
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
    COALESCE(aw.weeks_since_registration, 0)::int AS week_number,
    COUNT(DISTINCT aw.player_id) AS retained_users,
    ROUND((COUNT(DISTINCT aw.player_id)::numeric / NULLIF(cs.total_users, 0)) * 100, 2) AS retention_rate
  FROM cohort_size cs
  LEFT JOIN activity_weeks aw ON aw.registration_week = cs.registration_week
  WHERE aw.weeks_since_registration >= 0 AND aw.weeks_since_registration < p_cohort_weeks
  GROUP BY cs.registration_week, aw.weeks_since_registration, cs.total_users
  ORDER BY cs.registration_week DESC, aw.weeks_since_registration;
END;
$$;

GRANT EXECUTE ON FUNCTION get_retention_cohort(int) TO authenticated;

COMMENT ON FUNCTION get_retention_cohort IS 'Returns weekly cohort retention data for user engagement analysis';


-- ============================================
-- Function: get_match_analytics
-- Returns match statistics for a date range
-- ============================================

CREATE OR REPLACE FUNCTION get_match_analytics(
  p_start_date date,
  p_end_date date,
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  date date,
  matches_created bigint,
  matches_completed bigint,
  completion_rate numeric,
  avg_participants numeric,
  cancellation_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH daily_matches AS (
    SELECT 
      m.created_at::date AS match_date,
      COUNT(*) AS total_matches,
      COUNT(*) FILTER (WHERE m.match_status = 'completed') AS completed_matches,
      COUNT(*) FILTER (WHERE m.match_status = 'cancelled') AS cancelled_matches
    FROM match m
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
      AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    GROUP BY m.created_at::date
  ),
  daily_participants AS (
    SELECT 
      m.created_at::date AS match_date,
      AVG(mp.participant_count) AS avg_participants
    FROM match m
    LEFT JOIN (
      SELECT match_id, COUNT(*) AS participant_count 
      FROM match_participant 
      GROUP BY match_id
    ) mp ON mp.match_id = m.id
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
      AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    GROUP BY m.created_at::date
  )
  SELECT 
    dm.match_date AS date,
    dm.total_matches AS matches_created,
    dm.completed_matches AS matches_completed,
    CASE 
      WHEN dm.total_matches > 0 
      THEN ROUND((dm.completed_matches::numeric / dm.total_matches::numeric) * 100, 2)
      ELSE 0
    END AS completion_rate,
    ROUND(COALESCE(dp.avg_participants, 0), 1) AS avg_participants,
    CASE 
      WHEN dm.total_matches > 0 
      THEN ROUND((dm.cancelled_matches::numeric / dm.total_matches::numeric) * 100, 2)
      ELSE 0
    END AS cancellation_rate
  FROM daily_matches dm
  LEFT JOIN daily_participants dp ON dp.match_date = dm.match_date
  ORDER BY dm.match_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_match_analytics(date, date, uuid) TO authenticated;

COMMENT ON FUNCTION get_match_analytics IS 'Returns daily match statistics including creation, completion, and participation metrics';


-- ============================================
-- Function: get_screen_analytics
-- Returns screen view statistics for a date range
-- ============================================

CREATE OR REPLACE FUNCTION get_screen_analytics(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  screen_name text,
  view_count bigint,
  unique_users bigint,
  avg_duration_seconds numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Note: This function requires a screen_analytics table to be created
  -- For now, return placeholder data structure
  -- Will be populated once event tracking is implemented
  RETURN QUERY
  SELECT 
    'Dashboard'::text AS screen_name,
    0::bigint AS view_count,
    0::bigint AS unique_users,
    0::numeric AS avg_duration_seconds
  WHERE FALSE; -- Returns empty set until implemented
END;
$$;

GRANT EXECUTE ON FUNCTION get_screen_analytics(date, date) TO authenticated;

COMMENT ON FUNCTION get_screen_analytics IS 'Returns screen view analytics (requires event tracking implementation)';


-- ============================================
-- Function: get_sport_distribution
-- Returns user counts by sport
-- ============================================

CREATE OR REPLACE FUNCTION get_sport_distribution(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  user_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(DISTINCT ps.player_id) INTO v_total
  FROM player_sport ps
  JOIN player p ON p.id = ps.player_id
  WHERE (p_start_date IS NULL OR p.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at::date <= p_end_date);
    
  RETURN QUERY
  SELECT 
    s.id AS sport_id,
    s.name AS sport_name,
    COUNT(DISTINCT ps.player_id) AS user_count,
    CASE 
      WHEN v_total > 0 
      THEN ROUND((COUNT(DISTINCT ps.player_id)::numeric / v_total::numeric) * 100, 2)
      ELSE 0
    END AS percentage
  FROM sport s
  LEFT JOIN player_sport ps ON ps.sport_id = s.id
  LEFT JOIN player p ON p.id = ps.player_id
  WHERE (p_start_date IS NULL OR p.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at::date <= p_end_date)
  GROUP BY s.id, s.name
  ORDER BY COUNT(DISTINCT ps.player_id) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_distribution(date, date) TO authenticated;

COMMENT ON FUNCTION get_sport_distribution IS 'Returns user distribution across sports';


-- ============================================
-- Function: get_user_growth_trend
-- Returns daily/weekly user growth data
-- ============================================

CREATE OR REPLACE FUNCTION get_user_growth_trend(
  p_start_date date,
  p_end_date date,
  p_interval text DEFAULT 'day' -- 'day', 'week', 'month'
) RETURNS TABLE (
  period_start date,
  new_users bigint,
  cumulative_users bigint,
  growth_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      p_start_date,
      p_end_date,
      CASE p_interval
        WHEN 'day' THEN '1 day'::interval
        WHEN 'week' THEN '1 week'::interval
        WHEN 'month' THEN '1 month'::interval
        ELSE '1 day'::interval
      END
    )::date AS period_date
  ),
  users_before AS (
    SELECT COUNT(*) AS count
    FROM player
    WHERE created_at::date < p_start_date
  ),
  period_users AS (
    SELECT 
      CASE p_interval
        WHEN 'day' THEN p.created_at::date
        WHEN 'week' THEN date_trunc('week', p.created_at)::date
        WHEN 'month' THEN date_trunc('month', p.created_at)::date
        ELSE p.created_at::date
      END AS period_date,
      COUNT(*) AS new_users
    FROM player p
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY 1
  ),
  combined AS (
    SELECT 
      ds.period_date,
      COALESCE(pu.new_users, 0) AS new_users,
      SUM(COALESCE(pu.new_users, 0)) OVER (ORDER BY ds.period_date) + (SELECT count FROM users_before) AS cumulative
    FROM date_series ds
    LEFT JOIN period_users pu ON pu.period_date = ds.period_date
  )
  SELECT 
    c.period_date AS period_start,
    c.new_users,
    c.cumulative AS cumulative_users,
    CASE 
      WHEN LAG(c.cumulative) OVER (ORDER BY c.period_date) > 0
      THEN ROUND(((c.cumulative - LAG(c.cumulative) OVER (ORDER BY c.period_date))::numeric 
                  / LAG(c.cumulative) OVER (ORDER BY c.period_date)::numeric) * 100, 2)
      ELSE 0
    END AS growth_rate
  FROM combined c
  ORDER BY c.period_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_growth_trend(date, date, text) TO authenticated;

COMMENT ON FUNCTION get_user_growth_trend IS 'Returns user growth trend with cumulative totals and growth rates';

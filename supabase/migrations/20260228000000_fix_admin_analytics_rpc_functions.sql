-- Migration: Fix Admin Analytics RPC Functions
-- Purpose: Fix schema mismatches and add missing RPC functions
-- This migration fixes issues with column references and type mismatches

-- ============================================
-- DROP AND RECREATE: get_onboarding_funnel
-- Fix: email_verified is in profile table, not player
-- ============================================

DROP FUNCTION IF EXISTS get_onboarding_funnel(date, date);

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
    FROM player p
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Step 2: Email Verified (check profile table)
    SELECT 
      'email_verified' AS step,
      2 AS step_order,
      COUNT(DISTINCT p.id) AS user_count,
      AVG(EXTRACT(EPOCH FROM (pr.updated_at - p.created_at)))::numeric AS avg_time
    FROM player p
    JOIN profile pr ON pr.id = p.id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND pr.email_verified = true
    
    UNION ALL
    
    -- Step 3: Profile Completed (has basic info filled)
    SELECT 
      'profile_completed' AS step,
      3 AS step_order,
      COUNT(DISTINCT p.id) AS user_count,
      NULL::numeric AS avg_time
    FROM player p
    JOIN profile pr ON pr.id = p.id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND pr.first_name IS NOT NULL
      AND pr.last_name IS NOT NULL
      AND pr.birth_date IS NOT NULL
    
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

GRANT EXECUTE ON FUNCTION get_onboarding_funnel(date, date) TO authenticated;


-- ============================================
-- DROP AND RECREATE: get_match_analytics
-- Fix: match table has cancelled_at/closed_at, not match_status
-- ============================================

DROP FUNCTION IF EXISTS get_match_analytics(date, date, uuid);

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
      COUNT(*) FILTER (WHERE m.closed_at IS NOT NULL AND m.cancelled_at IS NULL) AS completed_matches,
      COUNT(*) FILTER (WHERE m.cancelled_at IS NOT NULL) AS cancelled_matches
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


-- ============================================
-- DROP AND RECREATE: get_user_growth_trend
-- Fix: Return type mismatch - use bigint for cumulative_users
-- ============================================

DROP FUNCTION IF EXISTS get_user_growth_trend(date, date, text);

CREATE OR REPLACE FUNCTION get_user_growth_trend(
  p_start_date date,
  p_end_date date,
  p_interval text DEFAULT 'day'
) RETURNS TABLE (
  period date,
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
        WHEN 'week' THEN '1 week'::interval
        WHEN 'month' THEN '1 month'::interval
        ELSE '1 day'::interval
      END
    )::date AS period_date
  ),
  period_users AS (
    SELECT 
      CASE p_interval
        WHEN 'week' THEN date_trunc('week', p.created_at)::date
        WHEN 'month' THEN date_trunc('month', p.created_at)::date
        ELSE p.created_at::date
      END AS period_date,
      COUNT(*) AS new_count
    FROM player p
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY 1
  ),
  cumulative AS (
    SELECT 
      ds.period_date,
      COALESCE(pu.new_count, 0) AS new_users,
      SUM(COALESCE(pu.new_count, 0)) OVER (ORDER BY ds.period_date) AS cumulative_users
    FROM date_series ds
    LEFT JOIN period_users pu ON pu.period_date = ds.period_date
  )
  SELECT 
    c.period_date AS period,
    c.new_users::bigint AS new_users,
    c.cumulative_users::bigint AS cumulative_users,
    CASE 
      WHEN LAG(c.cumulative_users) OVER (ORDER BY c.period_date) > 0 
      THEN ROUND(
        ((c.cumulative_users - LAG(c.cumulative_users) OVER (ORDER BY c.period_date))::numeric / 
         LAG(c.cumulative_users) OVER (ORDER BY c.period_date)::numeric) * 100, 2
      )
      ELSE 0
    END AS growth_rate
  FROM cumulative c
  ORDER BY c.period_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_growth_trend(date, date, text) TO authenticated;


-- ============================================
-- DROP AND RECREATE: get_sport_distribution
-- Fix: Cast sport name to text
-- ============================================

DROP FUNCTION IF EXISTS get_sport_distribution();

CREATE OR REPLACE FUNCTION get_sport_distribution()
RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  player_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH sport_counts AS (
    SELECT 
      s.id AS sport_id,
      s.name::text AS sport_name,
      COUNT(DISTINCT ps.player_id) AS player_count
    FROM sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
    WHERE s.is_active = true
    GROUP BY s.id, s.name
  ),
  total AS (
    SELECT SUM(player_count) AS total_players FROM sport_counts
  )
  SELECT 
    sc.sport_id,
    sc.sport_name,
    sc.player_count,
    CASE 
      WHEN t.total_players > 0 
      THEN ROUND((sc.player_count::numeric / t.total_players::numeric) * 100, 2)
      ELSE 0
    END AS percentage
  FROM sport_counts sc
  CROSS JOIN total t
  ORDER BY sc.player_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_distribution() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_session_metrics
-- Returns session-level engagement metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_session_metrics(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  total_sessions bigint,
  unique_users bigint,
  avg_session_duration numeric,
  avg_screens_per_session numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH daily_sessions AS (
    SELECT 
      sa.view_started_at::date AS session_date,
      sa.player_id,
      COUNT(*) AS screens_viewed,
      SUM(COALESCE(sa.duration_seconds, 0)) AS total_duration
    FROM screen_analytics sa
    WHERE sa.view_started_at::date BETWEEN p_start_date AND p_end_date
      AND sa.player_id IS NOT NULL
    GROUP BY sa.view_started_at::date, sa.player_id
  )
  SELECT 
    ds.session_date AS date,
    COUNT(*)::bigint AS total_sessions,
    COUNT(DISTINCT ds.player_id)::bigint AS unique_users,
    ROUND(AVG(ds.total_duration), 1) AS avg_session_duration,
    ROUND(AVG(ds.screens_viewed), 1) AS avg_screens_per_session
  FROM daily_sessions ds
  GROUP BY ds.session_date
  ORDER BY ds.session_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_session_metrics(date, date) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_feature_adoption
-- Returns feature adoption rates
-- ============================================

CREATE OR REPLACE FUNCTION get_feature_adoption(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  feature_name text,
  users_count bigint,
  adoption_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_users bigint;
BEGIN
  -- Get total active users in period
  SELECT COUNT(DISTINCT p.id) INTO total_users
  FROM player p
  WHERE p.created_at::date <= p_end_date;
  
  RETURN QUERY
  SELECT * FROM (
    -- Match Creation
    SELECT 
      'match_creation'::text AS feature_name,
      COUNT(DISTINCT m.created_by)::bigint AS users_count,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT m.created_by)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END AS adoption_rate
    FROM match m
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Messaging
    SELECT 
      'messaging'::text,
      COUNT(DISTINCT msg.sender_id)::bigint,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT msg.sender_id)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END
    FROM message msg
    WHERE msg.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Player Directory (favorites)
    SELECT 
      'player_directory'::text,
      COUNT(DISTINCT pf.player_id)::bigint,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT pf.player_id)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END
    FROM player_favorite pf
    WHERE pf.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Networks/Groups
    SELECT 
      'networks'::text,
      COUNT(DISTINCT nm.player_id)::bigint,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT nm.player_id)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END
    FROM network_member nm
    WHERE nm.joined_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Rating Verification
    SELECT 
      'rating_verification'::text,
      COUNT(DISTINCT rp.player_rating_score_id)::bigint,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT rp.player_rating_score_id)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END
    FROM rating_proof rp
    WHERE rp.created_at::date BETWEEN p_start_date AND p_end_date
    
    UNION ALL
    
    -- Match Sharing
    SELECT 
      'match_sharing'::text,
      COUNT(DISTINCT ms.shared_by)::bigint,
      CASE WHEN total_users > 0 
        THEN ROUND((COUNT(DISTINCT ms.shared_by)::numeric / total_users::numeric) * 100, 2)
        ELSE 0 
      END
    FROM match_share ms
    WHERE ms.created_at::date BETWEEN p_start_date AND p_end_date
  ) features
  ORDER BY adoption_rate DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_feature_adoption(date, date) TO authenticated;


-- ============================================
-- UPDATE: get_screen_analytics with optional limit
-- ============================================

DROP FUNCTION IF EXISTS get_screen_analytics(date, date);

CREATE OR REPLACE FUNCTION get_screen_analytics(
  p_start_date date,
  p_end_date date,
  p_limit int DEFAULT 20
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
  RETURN QUERY
  SELECT 
    sa.screen_name::text,
    COUNT(*)::bigint AS view_count,
    COUNT(DISTINCT sa.player_id)::bigint AS unique_users,
    ROUND(AVG(COALESCE(sa.duration_seconds, 0)), 1) AS avg_duration_seconds
  FROM screen_analytics sa
  WHERE sa.view_started_at::date BETWEEN p_start_date AND p_end_date
  GROUP BY sa.screen_name
  ORDER BY view_count DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_screen_analytics(date, date, int) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_message_volume
-- Returns daily message volume metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_message_volume(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  direct_messages bigint,
  group_messages bigint,
  match_messages bigint,
  total_messages bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    msg.created_at::date AS date,
    COUNT(*) FILTER (WHERE c.conversation_type = 'direct')::bigint AS direct_messages,
    COUNT(*) FILTER (WHERE c.conversation_type = 'group')::bigint AS group_messages,
    COUNT(*) FILTER (WHERE c.conversation_type = 'match')::bigint AS match_messages,
    COUNT(*)::bigint AS total_messages
  FROM message msg
  JOIN conversation c ON c.id = msg.conversation_id
  WHERE msg.created_at::date BETWEEN p_start_date AND p_end_date
    AND msg.deleted_at IS NULL
  GROUP BY msg.created_at::date
  ORDER BY msg.created_at::date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_message_volume(date, date) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_conversation_health
-- Returns conversation health metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_conversation_health()
RETURNS TABLE (
  active_conversations bigint,
  total_conversations bigint,
  avg_response_time_minutes numeric,
  avg_messages_per_conversation numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH conversation_stats AS (
    SELECT 
      c.id,
      c.updated_at,
      COUNT(msg.id) AS message_count,
      (c.updated_at > NOW() - INTERVAL '7 days') AS is_active
    FROM conversation c
    LEFT JOIN message msg ON msg.conversation_id = c.id AND msg.deleted_at IS NULL
    GROUP BY c.id, c.updated_at
  )
  SELECT 
    COUNT(*) FILTER (WHERE is_active)::bigint AS active_conversations,
    COUNT(*)::bigint AS total_conversations,
    0::numeric AS avg_response_time_minutes, -- Placeholder - would need message pairs to calculate
    ROUND(AVG(message_count), 1) AS avg_messages_per_conversation
  FROM conversation_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION get_conversation_health() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_engagement_distribution
-- Returns user engagement level distribution
-- ============================================

CREATE OR REPLACE FUNCTION get_engagement_distribution()
RETURNS TABLE (
  engagement_level text,
  user_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_users bigint;
BEGIN
  SELECT COUNT(*) INTO total_users FROM player;
  
  RETURN QUERY
  WITH user_activity AS (
    SELECT 
      p.id,
      COUNT(DISTINCT msg.id) AS messages_sent,
      COUNT(DISTINCT mp.id) AS matches_participated,
      CASE
        WHEN COUNT(DISTINCT msg.id) > 50 OR COUNT(DISTINCT mp.id) > 10 THEN 'power_user'
        WHEN COUNT(DISTINCT msg.id) > 10 OR COUNT(DISTINCT mp.id) > 3 THEN 'active'
        WHEN COUNT(DISTINCT msg.id) > 0 OR COUNT(DISTINCT mp.id) > 0 THEN 'casual'
        ELSE 'inactive'
      END AS engagement_level
    FROM player p
    LEFT JOIN message msg ON msg.sender_id = p.id AND msg.created_at > NOW() - INTERVAL '30 days'
    LEFT JOIN match_participant mp ON mp.player_id = p.id AND mp.created_at > NOW() - INTERVAL '30 days'
    GROUP BY p.id
  )
  SELECT 
    ua.engagement_level::text,
    COUNT(*)::bigint AS user_count,
    CASE WHEN total_users > 0 
      THEN ROUND((COUNT(*)::numeric / total_users::numeric) * 100, 2)
      ELSE 0 
    END AS percentage
  FROM user_activity ua
  GROUP BY ua.engagement_level
  ORDER BY 
    CASE ua.engagement_level
      WHEN 'power_user' THEN 1
      WHEN 'active' THEN 2
      WHEN 'casual' THEN 3
      ELSE 4
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION get_engagement_distribution() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_match_chat_adoption
-- Returns match chat adoption metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_match_chat_adoption(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  total_matches bigint,
  matches_with_chat bigint,
  chat_adoption_rate numeric,
  avg_messages_per_match numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH match_chats AS (
    SELECT 
      m.id AS match_id,
      c.id AS conversation_id,
      COUNT(msg.id) AS message_count
    FROM match m
    LEFT JOIN conversation c ON c.match_id = m.id
    LEFT JOIN message msg ON msg.conversation_id = c.id AND msg.deleted_at IS NULL
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY m.id, c.id
  )
  SELECT 
    COUNT(DISTINCT match_id)::bigint AS total_matches,
    COUNT(DISTINCT match_id) FILTER (WHERE conversation_id IS NOT NULL)::bigint AS matches_with_chat,
    CASE WHEN COUNT(DISTINCT match_id) > 0 
      THEN ROUND((COUNT(DISTINCT match_id) FILTER (WHERE conversation_id IS NOT NULL)::numeric / 
                  COUNT(DISTINCT match_id)::numeric) * 100, 2)
      ELSE 0 
    END AS chat_adoption_rate,
    ROUND(AVG(message_count) FILTER (WHERE conversation_id IS NOT NULL), 1) AS avg_messages_per_match
  FROM match_chats;
END;
$$;

GRANT EXECUTE ON FUNCTION get_match_chat_adoption(date, date) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_rating_distribution
-- Returns player rating distribution by sport
-- ============================================

CREATE OR REPLACE FUNCTION get_rating_distribution(
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  rating_label text,
  player_count bigint,
  certified_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_players bigint;
BEGIN
  SELECT COUNT(DISTINCT prs.player_id) INTO total_players
  FROM player_rating_score prs
  JOIN rating_score rs ON rs.id = prs.rating_score_id
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  WHERE p_sport_id IS NULL OR rsys.sport_id = p_sport_id;
  
  RETURN QUERY
  SELECT 
    rs.label::text AS rating_label,
    COUNT(DISTINCT prs.player_id)::bigint AS player_count,
    COUNT(DISTINCT prs.player_id) FILTER (WHERE prs.is_certified)::bigint AS certified_count,
    CASE WHEN total_players > 0 
      THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_players::numeric) * 100, 2)
      ELSE 0 
    END AS percentage
  FROM rating_score rs
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  LEFT JOIN player_rating_score prs ON prs.rating_score_id = rs.id
  WHERE (p_sport_id IS NULL OR rsys.sport_id = p_sport_id)
    AND rsys.is_active = true
  GROUP BY rs.label, rs.value
  ORDER BY rs.value;
END;
$$;

GRANT EXECUTE ON FUNCTION get_rating_distribution(uuid) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_certification_funnel
-- Returns certification funnel metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_certification_funnel()
RETURNS TABLE (
  step_name text,
  users_count bigint,
  completion_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_with_ratings bigint;
BEGIN
  SELECT COUNT(DISTINCT player_id) INTO total_with_ratings FROM player_rating_score;
  
  RETURN QUERY
  SELECT * FROM (
    -- Self-Declared (all with ratings)
    SELECT 
      'self_declared'::text AS step_name,
      total_with_ratings::bigint AS users_count,
      100.00::numeric AS completion_rate
    
    UNION ALL
    
    -- Proof Submitted
    SELECT 
      'proof_submitted'::text,
      COUNT(DISTINCT prs.player_id)::bigint,
      CASE WHEN total_with_ratings > 0 
        THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_with_ratings::numeric) * 100, 2)
        ELSE 0 
      END
    FROM player_rating_score prs
    WHERE EXISTS (SELECT 1 FROM rating_proof rp WHERE rp.player_rating_score_id = prs.id)
    
    UNION ALL
    
    -- Proof Approved
    SELECT 
      'proof_approved'::text,
      COUNT(DISTINCT prs.player_id)::bigint,
      CASE WHEN total_with_ratings > 0 
        THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_with_ratings::numeric) * 100, 2)
        ELSE 0 
      END
    FROM player_rating_score prs
    WHERE prs.approved_proofs_count > 0
    
    UNION ALL
    
    -- Peer Verified
    SELECT 
      'peer_verified'::text,
      COUNT(DISTINCT prs.player_id)::bigint,
      CASE WHEN total_with_ratings > 0 
        THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_with_ratings::numeric) * 100, 2)
        ELSE 0 
      END
    FROM player_rating_score prs
    WHERE prs.peer_evaluation_count > 0
    
    UNION ALL
    
    -- Fully Certified
    SELECT 
      'fully_certified'::text,
      COUNT(DISTINCT prs.player_id)::bigint,
      CASE WHEN total_with_ratings > 0 
        THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_with_ratings::numeric) * 100, 2)
        ELSE 0 
      END
    FROM player_rating_score prs
    WHERE prs.is_certified = true
  ) funnel
  ORDER BY 
    CASE step_name
      WHEN 'self_declared' THEN 1
      WHEN 'proof_submitted' THEN 2
      WHEN 'proof_approved' THEN 3
      WHEN 'peer_verified' THEN 4
      WHEN 'fully_certified' THEN 5
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION get_certification_funnel() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_reputation_distribution
-- Returns reputation score distribution
-- ============================================

CREATE OR REPLACE FUNCTION get_reputation_distribution()
RETURNS TABLE (
  tier text,
  user_count bigint,
  percentage numeric,
  avg_score numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_users bigint;
BEGIN
  SELECT COUNT(*) INTO total_users FROM player_reputation;
  
  RETURN QUERY
  SELECT 
    pr.reputation_tier::text AS tier,
    COUNT(*)::bigint AS user_count,
    CASE WHEN total_users > 0 
      THEN ROUND((COUNT(*)::numeric / total_users::numeric) * 100, 2)
      ELSE 0 
    END AS percentage,
    ROUND(AVG(pr.reputation_score), 1) AS avg_score
  FROM player_reputation pr
  GROUP BY pr.reputation_tier
  ORDER BY MIN(pr.reputation_score) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_reputation_distribution() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_reputation_events
-- Returns reputation event trends
-- ============================================

CREATE OR REPLACE FUNCTION get_reputation_events(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  positive_events bigint,
  negative_events bigint,
  total_events bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    re.event_occurred_at::date AS date,
    COUNT(*) FILTER (WHERE re.base_impact > 0)::bigint AS positive_events,
    COUNT(*) FILTER (WHERE re.base_impact < 0)::bigint AS negative_events,
    COUNT(*)::bigint AS total_events
  FROM reputation_event re
  WHERE re.event_occurred_at::date BETWEEN p_start_date AND p_end_date
  GROUP BY re.event_occurred_at::date
  ORDER BY re.event_occurred_at::date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_reputation_events(date, date) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_peer_rating_activity
-- Returns peer rating request metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_peer_rating_activity()
RETURNS TABLE (
  total_requests bigint,
  completed_requests bigint,
  completion_rate numeric,
  avg_rating_difference numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint AS total_requests,
    COUNT(*) FILTER (WHERE prr.status = 'completed')::bigint AS completed_requests,
    CASE WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE prr.status = 'completed')::numeric / COUNT(*)::numeric) * 100, 2)
      ELSE 0 
    END AS completion_rate,
    0::numeric AS avg_rating_difference -- Placeholder - would need comparison logic
  FROM peer_rating_request prr;
END;
$$;

GRANT EXECUTE ON FUNCTION get_peer_rating_activity() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_report_volume
-- Returns report volume trends
-- ============================================

CREATE OR REPLACE FUNCTION get_report_volume(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  reports_created bigint,
  reports_resolved bigint,
  resolution_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.created_at::date AS date,
    COUNT(*)::bigint AS reports_created,
    COUNT(*) FILTER (WHERE pr.status IN ('resolved', 'dismissed'))::bigint AS reports_resolved,
    CASE WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE pr.status IN ('resolved', 'dismissed'))::numeric / COUNT(*)::numeric) * 100, 2)
      ELSE 0 
    END AS resolution_rate
  FROM player_report pr
  WHERE pr.created_at::date BETWEEN p_start_date AND p_end_date
  GROUP BY pr.created_at::date
  ORDER BY pr.created_at::date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_report_volume(date, date) TO authenticated;


-- ============================================
-- NEW FUNCTION: get_report_types
-- Returns report type distribution
-- ============================================

CREATE OR REPLACE FUNCTION get_report_types()
RETURNS TABLE (
  report_type text,
  count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_reports bigint;
BEGIN
  SELECT COUNT(*) INTO total_reports FROM player_report;
  
  RETURN QUERY
  SELECT 
    pr.report_type::text,
    COUNT(*)::bigint AS count,
    CASE WHEN total_reports > 0 
      THEN ROUND((COUNT(*)::numeric / total_reports::numeric) * 100, 2)
      ELSE 0 
    END AS percentage
  FROM player_report pr
  GROUP BY pr.report_type
  ORDER BY count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_report_types() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_resolution_metrics
-- Returns report resolution metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_resolution_metrics()
RETURNS TABLE (
  avg_resolution_hours numeric,
  resolved_within_sla_rate numeric,
  escalation_rate numeric,
  pending_reports bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH resolution_times AS (
    SELECT 
      pr.id,
      EXTRACT(EPOCH FROM (pr.reviewed_at - pr.created_at)) / 3600 AS hours_to_resolve
    FROM player_report pr
    WHERE pr.reviewed_at IS NOT NULL
  )
  SELECT 
    ROUND(AVG(rt.hours_to_resolve), 1) AS avg_resolution_hours,
    ROUND((COUNT(*) FILTER (WHERE rt.hours_to_resolve <= 24)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 2) AS resolved_within_sla_rate,
    0::numeric AS escalation_rate, -- Placeholder - no escalation tracking
    (SELECT COUNT(*) FROM player_report WHERE status = 'pending')::bigint AS pending_reports
  FROM resolution_times rt;
END;
$$;

GRANT EXECUTE ON FUNCTION get_resolution_metrics() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_ban_statistics
-- Returns ban-related statistics
-- ============================================

CREATE OR REPLACE FUNCTION get_ban_statistics()
RETURNS TABLE (
  total_active_bans bigint,
  temporary_bans bigint,
  permanent_bans bigint,
  bans_this_month bigint,
  recidivism_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ban_stats AS (
    SELECT 
      COUNT(*) FILTER (WHERE pb.is_active) AS active_count,
      COUNT(*) FILTER (WHERE pb.is_active AND pb.ban_type = 'temporary') AS temp_count,
      COUNT(*) FILTER (WHERE pb.is_active AND pb.ban_type = 'permanent') AS perm_count,
      COUNT(*) FILTER (WHERE pb.created_at >= DATE_TRUNC('month', NOW())) AS this_month
    FROM player_ban pb
  ),
  repeat_offenders AS (
    SELECT 
      player_id,
      COUNT(*) AS ban_count
    FROM player_ban
    GROUP BY player_id
    HAVING COUNT(*) > 1
  )
  SELECT 
    bs.active_count::bigint AS total_active_bans,
    bs.temp_count::bigint AS temporary_bans,
    bs.perm_count::bigint AS permanent_bans,
    bs.this_month::bigint AS bans_this_month,
    CASE WHEN (SELECT COUNT(DISTINCT player_id) FROM player_ban) > 0 
      THEN ROUND((SELECT COUNT(*)::numeric FROM repeat_offenders) / 
                 (SELECT COUNT(DISTINCT player_id)::numeric FROM player_ban) * 100, 2)
      ELSE 0 
    END AS recidivism_rate
  FROM ban_stats bs;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ban_statistics() TO authenticated;


-- ============================================
-- NEW FUNCTION: get_feedback_sentiment
-- Returns user feedback sentiment breakdown
-- ============================================

CREATE OR REPLACE FUNCTION get_feedback_sentiment()
RETURNS TABLE (
  category text,
  count bigint,
  percentage numeric,
  status_breakdown jsonb
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_feedback bigint;
BEGIN
  SELECT COUNT(*) INTO total_feedback FROM feedback;
  
  RETURN QUERY
  SELECT 
    f.category::text,
    COUNT(*)::bigint AS count,
    CASE WHEN total_feedback > 0 
      THEN ROUND((COUNT(*)::numeric / total_feedback::numeric) * 100, 2)
      ELSE 0 
    END AS percentage,
    jsonb_object_agg(f.status, status_count) AS status_breakdown
  FROM (
    SELECT 
      f1.category,
      f1.status,
      COUNT(*) AS status_count
    FROM feedback f1
    GROUP BY f1.category, f1.status
  ) f
  GROUP BY f.category
  ORDER BY count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_feedback_sentiment() TO authenticated;


-- ============================================
-- Refresh schema cache comment
-- ============================================
COMMENT ON FUNCTION get_onboarding_funnel(date, date) IS 'Returns onboarding funnel metrics - fixed for profile.email_verified';
COMMENT ON FUNCTION get_match_analytics(date, date, uuid) IS 'Returns match analytics - fixed for cancelled_at/closed_at columns';
COMMENT ON FUNCTION get_user_growth_trend(date, date, text) IS 'Returns user growth trend - fixed return types';
COMMENT ON FUNCTION get_sport_distribution() IS 'Returns sport distribution - fixed varchar to text cast';
COMMENT ON FUNCTION get_session_metrics(date, date) IS 'Returns session engagement metrics';
COMMENT ON FUNCTION get_feature_adoption(date, date) IS 'Returns feature adoption rates';
COMMENT ON FUNCTION get_screen_analytics(date, date, int) IS 'Returns screen analytics with optional limit';
COMMENT ON FUNCTION get_message_volume(date, date) IS 'Returns daily message volume by type';
COMMENT ON FUNCTION get_conversation_health() IS 'Returns conversation health metrics';
COMMENT ON FUNCTION get_engagement_distribution() IS 'Returns user engagement level distribution';
COMMENT ON FUNCTION get_match_chat_adoption(date, date) IS 'Returns match chat adoption metrics';
COMMENT ON FUNCTION get_rating_distribution(uuid) IS 'Returns rating distribution by sport';
COMMENT ON FUNCTION get_certification_funnel() IS 'Returns certification funnel metrics';
COMMENT ON FUNCTION get_reputation_distribution() IS 'Returns reputation score distribution';
COMMENT ON FUNCTION get_reputation_events(date, date) IS 'Returns reputation event trends';
COMMENT ON FUNCTION get_peer_rating_activity() IS 'Returns peer rating request metrics';
COMMENT ON FUNCTION get_report_volume(date, date) IS 'Returns report volume trends';
COMMENT ON FUNCTION get_report_types() IS 'Returns report type distribution';
COMMENT ON FUNCTION get_resolution_metrics() IS 'Returns report resolution metrics';
COMMENT ON FUNCTION get_ban_statistics() IS 'Returns ban statistics';
COMMENT ON FUNCTION get_feedback_sentiment() IS 'Returns feedback sentiment breakdown';

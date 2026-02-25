-- Migration: Fix Remaining Admin Analytics RPC Functions
-- Purpose: Fix additional schema mismatches and add missing network analytics functions

-- ============================================
-- FIX: get_sport_distribution - Explicit text cast
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
      s.id AS sid,
      s.name::text AS sname,
      COUNT(DISTINCT ps.player_id) AS pcount
    FROM sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
    WHERE s.is_active = true
    GROUP BY s.id, s.name
  ),
  total AS (
    SELECT SUM(pcount) AS total_players FROM sport_counts
  )
  SELECT 
    sc.sid AS sport_id,
    sc.sname AS sport_name,
    sc.pcount AS player_count,
    CASE 
      WHEN t.total_players > 0 
      THEN ROUND((sc.pcount::numeric / t.total_players::numeric) * 100, 2)
      ELSE 0
    END AS percentage
  FROM sport_counts sc
  CROSS JOIN total t
  ORDER BY sc.pcount DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_distribution() TO authenticated;


-- ============================================
-- FIX: get_certification_funnel - Avoid ambiguous column reference
-- ============================================

DROP FUNCTION IF EXISTS get_certification_funnel();

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
  WITH funnel_data AS (
    -- Self-Declared (all with ratings)
    SELECT 
      'self_declared'::text AS sname,
      total_with_ratings::bigint AS ucount,
      100.00::numeric AS crate,
      1 AS sort_order
    
    UNION ALL
    
    -- Proof Submitted
    SELECT 
      'proof_submitted'::text,
      COUNT(DISTINCT prs.player_id)::bigint,
      CASE WHEN total_with_ratings > 0 
        THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_with_ratings::numeric) * 100, 2)
        ELSE 0 
      END,
      2
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
      END,
      3
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
      END,
      4
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
      END,
      5
    FROM player_rating_score prs
    WHERE prs.is_certified = true
  )
  SELECT 
    fd.sname AS step_name,
    fd.ucount AS users_count,
    fd.crate AS completion_rate
  FROM funnel_data fd
  ORDER BY fd.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION get_certification_funnel() TO authenticated;


-- ============================================
-- FIX: get_report_volume - Use reviewed_at instead of status enum
-- ============================================

DROP FUNCTION IF EXISTS get_report_volume(date, date);

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
    COUNT(*) FILTER (WHERE pr.reviewed_at IS NOT NULL)::bigint AS reports_resolved,
    CASE WHEN COUNT(*) > 0 
      THEN ROUND((COUNT(*) FILTER (WHERE pr.reviewed_at IS NOT NULL)::numeric / COUNT(*)::numeric) * 100, 2)
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
-- NEW: get_network_growth - Network creation trends
-- ============================================

CREATE OR REPLACE FUNCTION get_network_growth(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  date date,
  networks_created bigint,
  cumulative_networks bigint,
  members_joined bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH daily_networks AS (
    SELECT 
      n.created_at::date AS network_date,
      COUNT(*) AS new_networks
    FROM network n
    WHERE n.created_at::date BETWEEN p_start_date AND p_end_date
      AND n.archived_at IS NULL
    GROUP BY n.created_at::date
  ),
  daily_members AS (
    SELECT 
      nm.joined_at::date AS member_date,
      COUNT(*) AS new_members
    FROM network_member nm
    WHERE nm.joined_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY nm.joined_at::date
  ),
  date_series AS (
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS series_date
  ),
  combined AS (
    SELECT 
      ds.series_date,
      COALESCE(dn.new_networks, 0) AS networks_created,
      COALESCE(dm.new_members, 0) AS members_joined
    FROM date_series ds
    LEFT JOIN daily_networks dn ON dn.network_date = ds.series_date
    LEFT JOIN daily_members dm ON dm.member_date = ds.series_date
  )
  SELECT 
    c.series_date AS date,
    c.networks_created::bigint,
    SUM(c.networks_created) OVER (ORDER BY c.series_date)::bigint AS cumulative_networks,
    c.members_joined::bigint
  FROM combined c
  ORDER BY c.series_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_network_growth(date, date) TO authenticated;


-- ============================================
-- NEW: get_network_size_distribution - Network size breakdown
-- ============================================

CREATE OR REPLACE FUNCTION get_network_size_distribution()
RETURNS TABLE (
  size_category text,
  network_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_networks bigint;
BEGIN
  SELECT COUNT(*) INTO total_networks 
  FROM network 
  WHERE archived_at IS NULL;
  
  RETURN QUERY
  WITH network_sizes AS (
    SELECT 
      n.id,
      COALESCE(n.member_count, 0) AS members,
      CASE
        WHEN COALESCE(n.member_count, 0) <= 5 THEN 'small (1-5)'
        WHEN COALESCE(n.member_count, 0) <= 15 THEN 'medium (6-15)'
        WHEN COALESCE(n.member_count, 0) <= 30 THEN 'large (16-30)'
        ELSE 'very_large (30+)'
      END AS size_cat
    FROM network n
    WHERE n.archived_at IS NULL
  )
  SELECT 
    ns.size_cat AS size_category,
    COUNT(*)::bigint AS network_count,
    CASE WHEN total_networks > 0 
      THEN ROUND((COUNT(*)::numeric / total_networks::numeric) * 100, 2)
      ELSE 0 
    END AS percentage
  FROM network_sizes ns
  GROUP BY ns.size_cat
  ORDER BY 
    CASE ns.size_cat
      WHEN 'small (1-5)' THEN 1
      WHEN 'medium (6-15)' THEN 2
      WHEN 'large (16-30)' THEN 3
      ELSE 4
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION get_network_size_distribution() TO authenticated;


-- ============================================
-- NEW: get_top_network_activity - Most active networks
-- ============================================

CREATE OR REPLACE FUNCTION get_top_network_activity(
  p_limit int DEFAULT 10
) RETURNS TABLE (
  network_id uuid,
  network_name text,
  member_count bigint,
  activity_count bigint,
  last_activity_at timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH network_activity AS (
    SELECT 
      ga.network_id,
      COUNT(*) AS activity_total,
      MAX(ga.created_at) AS last_activity
    FROM group_activity ga
    WHERE ga.created_at > NOW() - INTERVAL '30 days'
    GROUP BY ga.network_id
  )
  SELECT 
    n.id AS network_id,
    n.name::text AS network_name,
    COALESCE(n.member_count, 0)::bigint AS member_count,
    COALESCE(na.activity_total, 0)::bigint AS activity_count,
    COALESCE(na.last_activity, n.updated_at) AS last_activity_at
  FROM network n
  LEFT JOIN network_activity na ON na.network_id = n.id
  WHERE n.archived_at IS NULL
  ORDER BY COALESCE(na.activity_total, 0) DESC, n.member_count DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_top_network_activity(int) TO authenticated;


-- ============================================
-- NEW: get_network_match_integration - Network match sharing metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_network_match_integration()
RETURNS TABLE (
  total_networks bigint,
  networks_with_matches bigint,
  total_shared_matches bigint,
  avg_matches_per_network numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH network_matches AS (
    SELECT 
      mn.network_id,
      COUNT(DISTINCT mn.match_id) AS match_count
    FROM match_network mn
    JOIN network n ON n.id = mn.network_id AND n.archived_at IS NULL
    GROUP BY mn.network_id
  )
  SELECT 
    (SELECT COUNT(*) FROM network WHERE archived_at IS NULL)::bigint AS total_networks,
    COUNT(DISTINCT nm.network_id)::bigint AS networks_with_matches,
    COALESCE(SUM(nm.match_count), 0)::bigint AS total_shared_matches,
    ROUND(AVG(nm.match_count), 1) AS avg_matches_per_network
  FROM network_matches nm;
END;
$$;

GRANT EXECUTE ON FUNCTION get_network_match_integration() TO authenticated;


-- ============================================
-- NEW: get_sport_popularity - Sport popularity metrics
-- ============================================

CREATE OR REPLACE FUNCTION get_sport_popularity()
RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  player_count bigint,
  match_count bigint,
  active_last_30_days bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS sport_id,
    s.name::text AS sport_name,
    COUNT(DISTINCT ps.player_id)::bigint AS player_count,
    COUNT(DISTINCT m.id)::bigint AS match_count,
    COUNT(DISTINCT CASE WHEN m.created_at > NOW() - INTERVAL '30 days' THEN m.id END)::bigint AS active_last_30_days
  FROM sport s
  LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
  LEFT JOIN match m ON m.sport_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.name
  ORDER BY player_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_popularity() TO authenticated;


-- ============================================
-- NEW: get_sport_activity_comparison - Compare sport activity
-- ============================================

CREATE OR REPLACE FUNCTION get_sport_activity_comparison(
  p_start_date date,
  p_end_date date
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  matches_created bigint,
  matches_completed bigint,
  unique_players bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS sport_id,
    s.name::text AS sport_name,
    COUNT(DISTINCT m.id)::bigint AS matches_created,
    COUNT(DISTINCT m.id) FILTER (WHERE m.closed_at IS NOT NULL)::bigint AS matches_completed,
    COUNT(DISTINCT mp.player_id)::bigint AS unique_players
  FROM sport s
  LEFT JOIN match m ON m.sport_id = s.id 
    AND m.created_at::date BETWEEN p_start_date AND p_end_date
  LEFT JOIN match_participant mp ON mp.match_id = m.id
  WHERE s.is_active = true
  GROUP BY s.id, s.name
  ORDER BY matches_created DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_activity_comparison(date, date) TO authenticated;


-- ============================================
-- NEW: get_sport_growth_trends - Sport growth over time
-- ============================================

CREATE OR REPLACE FUNCTION get_sport_growth_trends(
  p_start_date date,
  p_end_date date,
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  date date,
  sport_id uuid,
  sport_name text,
  new_players bigint,
  new_matches bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ds.series_date AS date,
    s.id AS sport_id,
    s.name::text AS sport_name,
    COALESCE(COUNT(DISTINCT ps.id) FILTER (WHERE ps.created_at::date = ds.series_date), 0)::bigint AS new_players,
    COALESCE(COUNT(DISTINCT m.id) FILTER (WHERE m.created_at::date = ds.series_date), 0)::bigint AS new_matches
  FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS ds(series_date)
  CROSS JOIN sport s
  LEFT JOIN player_sport ps ON ps.sport_id = s.id 
    AND ps.created_at::date BETWEEN p_start_date AND p_end_date
  LEFT JOIN match m ON m.sport_id = s.id 
    AND m.created_at::date BETWEEN p_start_date AND p_end_date
  WHERE s.is_active = true
    AND (p_sport_id IS NULL OR s.id = p_sport_id)
  GROUP BY ds.series_date, s.id, s.name
  ORDER BY ds.series_date, s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_growth_trends(date, date, uuid) TO authenticated;


-- ============================================
-- NEW: get_sport_facility_data - Sport facilities info
-- ============================================

CREATE OR REPLACE FUNCTION get_sport_facility_data(
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  facility_count bigint,
  court_count bigint,
  cities_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS sport_id,
    s.name::text AS sport_name,
    COUNT(DISTINCT fs.facility_id)::bigint AS facility_count,
    COUNT(DISTINCT cs.court_id)::bigint AS court_count,
    COUNT(DISTINCT f.city)::bigint AS cities_count
  FROM sport s
  LEFT JOIN facility_sport fs ON fs.sport_id = s.id
  LEFT JOIN facility f ON f.id = fs.facility_id AND f.is_active = true
  LEFT JOIN court_sport cs ON cs.sport_id = s.id
  LEFT JOIN court c ON c.id = cs.court_id AND c.is_active = true
  WHERE s.is_active = true
    AND (p_sport_id IS NULL OR s.id = p_sport_id)
  GROUP BY s.id, s.name
  ORDER BY facility_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_facility_data(uuid) TO authenticated;


-- ============================================
-- Comments for schema cache refresh
-- ============================================
COMMENT ON FUNCTION get_sport_distribution() IS 'Returns sport distribution with proper text casting';
COMMENT ON FUNCTION get_certification_funnel() IS 'Returns certification funnel - fixed ambiguous column';
COMMENT ON FUNCTION get_report_volume(date, date) IS 'Returns report volume - uses reviewed_at for resolution';
COMMENT ON FUNCTION get_network_growth(date, date) IS 'Returns network creation and membership growth';
COMMENT ON FUNCTION get_network_size_distribution() IS 'Returns distribution of networks by member count';
COMMENT ON FUNCTION get_top_network_activity(int) IS 'Returns most active networks in last 30 days';
COMMENT ON FUNCTION get_network_match_integration() IS 'Returns network-match sharing metrics';
COMMENT ON FUNCTION get_sport_popularity() IS 'Returns sport popularity by player and match counts';
COMMENT ON FUNCTION get_sport_activity_comparison(date, date) IS 'Compares sport activity in date range';
COMMENT ON FUNCTION get_sport_growth_trends(date, date, uuid) IS 'Returns daily sport growth trends';
COMMENT ON FUNCTION get_sport_facility_data(uuid) IS 'Returns facility data per sport';

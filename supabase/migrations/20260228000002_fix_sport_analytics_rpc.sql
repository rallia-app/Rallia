-- Migration: Fix Sport Analytics RPC Functions
-- Purpose: Fix type mismatches and parameter handling

-- ============================================
-- FIX: get_sport_distribution - Explicit column assignment
-- The issue is that SELECT column names must match RETURNS TABLE exactly
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
      s.id,
      s.name::text AS s_name,
      COUNT(DISTINCT ps.player_id) AS p_count
    FROM sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
    WHERE s.is_active = true
    GROUP BY s.id, s.name
  ),
  total AS (
    SELECT COALESCE(SUM(p_count), 0) AS total_players FROM sport_counts
  )
  SELECT 
    sc.id AS sport_id,
    sc.s_name AS sport_name,
    sc.p_count AS player_count,
    CASE 
      WHEN t.total_players > 0 
      THEN ROUND((sc.p_count::numeric / t.total_players::numeric) * 100, 2)
      ELSE 0::numeric
    END AS percentage
  FROM sport_counts sc
  CROSS JOIN total t
  ORDER BY sc.p_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_distribution() TO authenticated;


-- ============================================
-- FIX: get_sport_activity_comparison - Make parameters optional with defaults
-- ============================================

DROP FUNCTION IF EXISTS get_sport_activity_comparison(date, date);
DROP FUNCTION IF EXISTS get_sport_activity_comparison();

CREATE OR REPLACE FUNCTION get_sport_activity_comparison(
  p_start_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_end_date date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  total_matches bigint,
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
    COUNT(DISTINCT m.id)::bigint AS total_matches,
    COUNT(DISTINCT m.id) FILTER (WHERE m.closed_at IS NOT NULL)::bigint AS matches_completed,
    COUNT(DISTINCT mp.player_id)::bigint AS unique_players
  FROM sport s
  LEFT JOIN match m ON m.sport_id = s.id 
    AND m.created_at::date BETWEEN p_start_date AND p_end_date
  LEFT JOIN match_participant mp ON mp.match_id = m.id
  WHERE s.is_active = true
  GROUP BY s.id, s.name
  ORDER BY total_matches DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_activity_comparison(date, date) TO authenticated;


-- ============================================
-- FIX: get_sport_growth_trends - Fix timestamp to date conversion
-- ============================================

DROP FUNCTION IF EXISTS get_sport_growth_trends(date, date, uuid);
DROP FUNCTION IF EXISTS get_sport_growth_trends();

CREATE OR REPLACE FUNCTION get_sport_growth_trends(
  p_start_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_end_date date DEFAULT CURRENT_DATE,
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  trend_date date,
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
  WITH date_series AS (
    SELECT d::date AS series_date
    FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval) AS d
  ),
  daily_data AS (
    SELECT 
      ds.series_date,
      s.id AS s_id,
      s.name::text AS s_name,
      COUNT(DISTINCT ps.id) FILTER (WHERE ps.created_at::date = ds.series_date) AS daily_players,
      COUNT(DISTINCT m.id) FILTER (WHERE m.created_at::date = ds.series_date) AS daily_matches
    FROM date_series ds
    CROSS JOIN sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id 
      AND ps.created_at::date BETWEEN p_start_date AND p_end_date
    LEFT JOIN match m ON m.sport_id = s.id 
      AND m.created_at::date BETWEEN p_start_date AND p_end_date
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
    GROUP BY ds.series_date, s.id, s.name
  )
  SELECT 
    dd.series_date AS trend_date,
    dd.s_id AS sport_id,
    dd.s_name AS sport_name,
    COALESCE(dd.daily_players, 0)::bigint AS new_players,
    COALESCE(dd.daily_matches, 0)::bigint AS new_matches
  FROM daily_data dd
  ORDER BY dd.series_date, dd.s_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_growth_trends(date, date, uuid) TO authenticated;


-- ============================================
-- FIX: get_sport_popularity - Add match_count and growth fields
-- ============================================

DROP FUNCTION IF EXISTS get_sport_popularity();

CREATE OR REPLACE FUNCTION get_sport_popularity()
RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  player_count bigint,
  match_count bigint,
  active_last_30_days bigint,
  percentage numeric,
  growth_percent numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  total_players bigint;
BEGIN
  SELECT COALESCE(COUNT(DISTINCT ps.player_id), 0) INTO total_players
  FROM player_sport ps WHERE ps.is_active = true;
  
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      s.id,
      s.name::text AS s_name,
      COUNT(DISTINCT ps.player_id) AS p_count,
      COUNT(DISTINCT m.id) AS m_count,
      COUNT(DISTINCT CASE WHEN m.created_at > NOW() - INTERVAL '30 days' THEN m.id END) AS active_30
    FROM sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
    LEFT JOIN match m ON m.sport_id = s.id
    WHERE s.is_active = true
    GROUP BY s.id, s.name
  ),
  previous_period AS (
    SELECT 
      s.id,
      COUNT(DISTINCT ps.player_id) AS prev_count
    FROM sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id 
      AND ps.is_active = true
      AND ps.created_at < NOW() - INTERVAL '30 days'
    WHERE s.is_active = true
    GROUP BY s.id
  )
  SELECT 
    cp.id AS sport_id,
    cp.s_name AS sport_name,
    cp.p_count AS player_count,
    cp.m_count AS match_count,
    cp.active_30 AS active_last_30_days,
    CASE 
      WHEN total_players > 0 
      THEN ROUND((cp.p_count::numeric / total_players::numeric) * 100, 2)
      ELSE 0::numeric
    END AS percentage,
    CASE 
      WHEN COALESCE(pp.prev_count, 0) > 0 
      THEN ROUND(((cp.p_count - COALESCE(pp.prev_count, 0))::numeric / pp.prev_count::numeric) * 100, 2)
      ELSE 0::numeric
    END AS growth_percent
  FROM current_period cp
  LEFT JOIN previous_period pp ON pp.id = cp.id
  ORDER BY cp.p_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_popularity() TO authenticated;


-- ============================================
-- FIX: get_sport_facility_data - Add utilization fields
-- ============================================

DROP FUNCTION IF EXISTS get_sport_facility_data(uuid);
DROP FUNCTION IF EXISTS get_sport_facility_data();

CREATE OR REPLACE FUNCTION get_sport_facility_data(
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  facility_count bigint,
  court_count bigint,
  cities_count bigint,
  avg_utilization numeric,
  peak_hours text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH facility_stats AS (
    SELECT 
      s.id,
      s.name::text AS s_name,
      COUNT(DISTINCT fs.facility_id) AS f_count,
      COUNT(DISTINCT cs.court_id) AS c_count,
      COUNT(DISTINCT f.city) AS city_count,
      -- Calculate utilization based on bookings for this sport's courts
      COALESCE(
        ROUND(
          (COUNT(DISTINCT b.id) FILTER (WHERE b.booking_date > CURRENT_DATE - 30))::numeric / 
          NULLIF(COUNT(DISTINCT cs.court_id) * 30, 0) * 100,
          1
        ),
        0
      ) AS utilization
    FROM sport s
    LEFT JOIN facility_sport fs ON fs.sport_id = s.id
    LEFT JOIN facility f ON f.id = fs.facility_id AND f.is_active = true
    LEFT JOIN court_sport cs ON cs.sport_id = s.id
    LEFT JOIN court c ON c.id = cs.court_id AND c.is_active = true
    LEFT JOIN booking b ON b.court_id = c.id AND b.status = 'confirmed'
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
    GROUP BY s.id, s.name
  ),
  peak_hours_calc AS (
    SELECT 
      s.id,
      COALESCE(
        (
          SELECT EXTRACT(HOUR FROM b2.start_time)::text || ':00-' || 
                 (EXTRACT(HOUR FROM b2.start_time) + 1)::text || ':00'
          FROM booking b2
          JOIN court c2 ON c2.id = b2.court_id
          JOIN court_sport cs2 ON cs2.court_id = c2.id AND cs2.sport_id = s.id
          WHERE b2.booking_date > CURRENT_DATE - 30
          GROUP BY b2.start_time
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ),
        '17:00-18:00'
      ) AS peak
    FROM sport s
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
  )
  SELECT 
    fs.id AS sport_id,
    fs.s_name AS sport_name,
    fs.f_count AS facility_count,
    fs.c_count AS court_count,
    fs.city_count AS cities_count,
    fs.utilization AS avg_utilization,
    COALESCE(ph.peak, '17:00-18:00')::text AS peak_hours
  FROM facility_stats fs
  LEFT JOIN peak_hours_calc ph ON ph.id = fs.id
  ORDER BY fs.f_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sport_facility_data(uuid) TO authenticated;


-- ============================================
-- Comments for schema cache invalidation
-- ============================================
COMMENT ON FUNCTION get_sport_distribution() IS 'Returns sport distribution - fixed column aliasing';
COMMENT ON FUNCTION get_sport_activity_comparison(date, date) IS 'Sport activity comparison with default params';
COMMENT ON FUNCTION get_sport_growth_trends(date, date, uuid) IS 'Growth trends with fixed date casting';
COMMENT ON FUNCTION get_sport_popularity() IS 'Sport popularity with match count and growth';
COMMENT ON FUNCTION get_sport_facility_data(uuid) IS 'Facility data with utilization metrics';

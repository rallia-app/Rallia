-- Migration: Fix get_sport_distribution function
-- Purpose: 
--   1. Restore the parameters (p_start_date, p_end_date) that the code expects
--   2. Fix the varchar to text type mismatch
-- ============================================

-- Drop all variants of the function to ensure clean state
DROP FUNCTION IF EXISTS get_sport_distribution();
DROP FUNCTION IF EXISTS get_sport_distribution(date, date);

-- Create the function with parameters (matching how the code calls it)
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
  -- Get total count of active players in date range
  SELECT COUNT(DISTINCT ps.player_id) INTO v_total
  FROM player_sport ps
  JOIN player p ON p.id = ps.player_id
  WHERE ps.is_active = true
    AND (p_start_date IS NULL OR p.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at::date <= p_end_date);
  
  -- Default to 1 to avoid division by zero
  IF v_total IS NULL OR v_total = 0 THEN
    v_total := 1;
  END IF;
    
  RETURN QUERY
  SELECT 
    s.id AS sport_id,
    s.name::text AS sport_name,  -- Explicit cast from varchar to text
    COUNT(DISTINCT ps.player_id)::bigint AS user_count,
    CASE 
      WHEN v_total > 0 
      THEN ROUND((COUNT(DISTINCT ps.player_id)::numeric / v_total::numeric) * 100, 2)
      ELSE 0::numeric
    END AS percentage
  FROM sport s
  LEFT JOIN player_sport ps ON ps.sport_id = s.id AND ps.is_active = true
  LEFT JOIN player p ON p.id = ps.player_id
    AND (p_start_date IS NULL OR p.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at::date <= p_end_date)
  WHERE s.is_active = true
  GROUP BY s.id, s.name
  ORDER BY COUNT(DISTINCT ps.player_id) DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_sport_distribution(date, date) TO authenticated;

-- Add comment
COMMENT ON FUNCTION get_sport_distribution(date, date) IS 
  'Returns user distribution across sports with proper text casting for sport name. Fixed varchar(100) to text mismatch.';

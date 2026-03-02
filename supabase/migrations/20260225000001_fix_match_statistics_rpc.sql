-- ============================================================
-- FIX: get_match_statistics RPC function
-- Migration: 20260225000001_fix_match_statistics_rpc.sql
-- Purpose: Fix status column reference in get_match_statistics
-- 
-- Issue: match table doesn't have a 'status' column
-- Solution: Derive status from closed_at and cancelled_at columns
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_match_statistics(
  p_sport_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS TABLE(
  total_matches bigint,
  scheduled_matches bigint,
  completed_matches bigint,
  cancelled_matches bigint,
  avg_participants numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_matches,
    -- Scheduled: not closed and not cancelled
    COUNT(*) FILTER (WHERE m.closed_at IS NULL AND m.cancelled_at IS NULL)::bigint as scheduled_matches,
    -- Completed: has closed_at and not cancelled
    COUNT(*) FILTER (WHERE m.closed_at IS NOT NULL AND m.cancelled_at IS NULL)::bigint as completed_matches,
    -- Cancelled: has cancelled_at
    COUNT(*) FILTER (WHERE m.cancelled_at IS NOT NULL)::bigint as cancelled_matches,
    COALESCE(AVG(
      (SELECT COUNT(*) FROM match_participant mp WHERE mp.match_id = m.id)
    ), 0)::numeric as avg_participants
  FROM match m
  WHERE 
    (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND m.created_at >= CURRENT_DATE - p_days;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_match_statistics(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_match_statistics IS 'Get match statistics - derives status from closed_at/cancelled_at instead of non-existent status column';

-- =============================================================================
-- Migration: extend get_utm_totals_with_comparison
--
-- Two changes:
--
-- 1. Add current_total_signups + previous_total_signups columns so the admin
--    Acquisition tab can compute an "Attribution Rate" KPI
--    (attributed_signups / total_signups). Without that denominator there
--    was no way to measure how well our DIY iOS attribution stack is
--    actually closing the loop.
--
-- 2. Fix a cartesian-product bug in the cur_matches / prev_matches CTEs:
--    the previous version LEFT JOINed `match m ON m.created_by = c.id` and
--    `match_participant mp ON mp.player_id = c.id` against the cohort, so
--    a user who created N matches AND participated in M matches produced
--    N*M rows — `COUNT(*) FILTER` then over-counted N*M instead of N.
--    Replaced with pre-aggregated per-player subqueries (the same shape
--    `get_utm_signup_stats` already uses correctly).
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_utm_totals_with_comparison(integer);

CREATE OR REPLACE FUNCTION public.get_utm_totals_with_comparison(p_days integer DEFAULT 7)
RETURNS TABLE(
  current_signups            bigint,
  current_total_signups      bigint,
  current_matches_created    bigint,
  current_matches_played     bigint,
  previous_signups           bigint,
  previous_total_signups     bigint,
  previous_matches_created   bigint,
  previous_matches_played    bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_days       integer     := GREATEST(p_days, 1);
  v_now        timestamptz := now();
  v_cur_start  timestamptz := v_now - make_interval(days => v_days);
  v_prev_start timestamptz := v_now - make_interval(days => v_days * 2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cohort_current AS (
    SELECT p.id FROM public.profile p
    WHERE p.created_at >= v_cur_start
      AND p.utm_source IS NOT NULL
  ),
  cohort_previous AS (
    SELECT p.id FROM public.profile p
    WHERE p.created_at >= v_prev_start AND p.created_at < v_cur_start
      AND p.utm_source IS NOT NULL
  ),
  -- Pre-aggregate per-player match counts so the cohort join doesn't
  -- multiply rows. Same pattern as get_utm_signup_stats.
  cur_match_created AS (
    SELECT m.created_by AS player_id, COUNT(*)::bigint AS n
    FROM public.match m
    WHERE m.created_at >= v_cur_start
    GROUP BY m.created_by
  ),
  cur_match_played AS (
    SELECT mp.player_id, COUNT(DISTINCT mp.match_id)::bigint AS n
    FROM public.match_participant mp
    JOIN public.match_result mr ON mr.match_id = mp.match_id
    WHERE mr.created_at >= v_cur_start
    GROUP BY mp.player_id
  ),
  prev_match_created AS (
    SELECT m.created_by AS player_id, COUNT(*)::bigint AS n
    FROM public.match m
    WHERE m.created_at >= v_prev_start AND m.created_at < v_cur_start
    GROUP BY m.created_by
  ),
  prev_match_played AS (
    SELECT mp.player_id, COUNT(DISTINCT mp.match_id)::bigint AS n
    FROM public.match_participant mp
    JOIN public.match_result mr ON mr.match_id = mp.match_id
    WHERE mr.created_at >= v_prev_start AND mr.created_at < v_cur_start
    GROUP BY mp.player_id
  )
  SELECT
    -- current period
    (SELECT count(*)::bigint FROM cohort_current),
    (SELECT count(*)::bigint FROM public.profile WHERE created_at >= v_cur_start),
    COALESCE((
      SELECT SUM(mc.n)::bigint
      FROM cohort_current c
      LEFT JOIN cur_match_created mc ON mc.player_id = c.id
    ), 0),
    COALESCE((
      SELECT SUM(mp.n)::bigint
      FROM cohort_current c
      LEFT JOIN cur_match_played mp ON mp.player_id = c.id
    ), 0),
    -- previous period
    (SELECT count(*)::bigint FROM cohort_previous),
    (SELECT count(*)::bigint FROM public.profile
      WHERE created_at >= v_prev_start AND created_at < v_cur_start),
    COALESCE((
      SELECT SUM(mc.n)::bigint
      FROM cohort_previous c
      LEFT JOIN prev_match_created mc ON mc.player_id = c.id
    ), 0),
    COALESCE((
      SELECT SUM(mp.n)::bigint
      FROM cohort_previous c
      LEFT JOIN prev_match_played mp ON mp.player_id = c.id
    ), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_utm_totals_with_comparison(integer) TO authenticated;

-- =============================================================================
-- Migration: Acquisition tab accuracy fixes
--
-- 1. get_utm_signup_stats: add match_creators / match_players — the count of
--    DISTINCT cohort users who created / played >=1 match (not the SUM of
--    matches, which the existing matches_created / matches_played columns
--    already give). The drill-down funnel needs per-user counts so it stays
--    a monotonic user funnel instead of mixing user counts with event sums.
--
-- 2. get_utm_totals_with_comparison: widen the attributed-signup cohort from
--    `utm_source IS NOT NULL` to `utm_source OR utm_medium OR utm_campaign
--    IS NOT NULL`, so the Attribution Rate KPI numerator uses the SAME cohort
--    definition as the campaign table (get_utm_signup_stats) and the PostHog
--    landings query. Previously a signup tagged with only utm_campaign or
--    utm_medium showed in the table but not in the KPI numerator.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) get_utm_signup_stats — add distinct-user activation counts
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_utm_signup_stats(integer);

CREATE OR REPLACE FUNCTION public.get_utm_signup_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  signups         bigint,
  matches_created bigint,
  matches_played  bigint,
  match_creators  bigint,
  match_players   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(p_days, 1));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT
      p.id,
      COALESCE(p.utm_source,   '(none)') AS u_source,
      COALESCE(p.utm_medium,   '(none)') AS u_medium,
      COALESCE(p.utm_campaign, '(none)') AS u_campaign
    FROM public.profile p
    WHERE p.created_at >= v_since
      AND (p.utm_source IS NOT NULL
           OR p.utm_medium IS NOT NULL
           OR p.utm_campaign IS NOT NULL)
  ),
  match_created AS (
    SELECT m.created_by AS player_id, COUNT(*)::bigint AS n
    FROM public.match m
    WHERE m.created_at >= v_since
    GROUP BY m.created_by
  ),
  match_played AS (
    SELECT mp.player_id, COUNT(DISTINCT mp.match_id)::bigint AS n
    FROM public.match_participant mp
    JOIN public.match_result mr ON mr.match_id = mp.match_id
    WHERE mr.created_at >= v_since
    GROUP BY mp.player_id
  )
  -- cohort LEFT JOIN the two per-player aggregates yields exactly one row per
  -- cohort player, so COUNT(*) FILTER (...) counts distinct players, never the
  -- match fan-out.
  SELECT
    c.u_source AS utm_source,
    c.u_medium AS utm_medium,
    c.u_campaign AS utm_campaign,
    COUNT(*)::bigint AS signups,
    COALESCE(SUM(mc.n), 0)::bigint AS matches_created,
    COALESCE(SUM(mp.n), 0)::bigint AS matches_played,
    COUNT(*) FILTER (WHERE mc.n IS NOT NULL)::bigint AS match_creators,
    COUNT(*) FILTER (WHERE mp.n IS NOT NULL)::bigint AS match_players
  FROM cohort c
  LEFT JOIN match_created mc ON mc.player_id = c.id
  LEFT JOIN match_played  mp ON mp.player_id = c.id
  GROUP BY c.u_source, c.u_medium, c.u_campaign
  ORDER BY signups DESC, c.u_campaign;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_utm_signup_stats(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) get_utm_totals_with_comparison — align attributed cohort definition
-- ---------------------------------------------------------------------------

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
      AND (p.utm_source IS NOT NULL
           OR p.utm_medium IS NOT NULL
           OR p.utm_campaign IS NOT NULL)
  ),
  cohort_previous AS (
    SELECT p.id FROM public.profile p
    WHERE p.created_at >= v_prev_start AND p.created_at < v_cur_start
      AND (p.utm_source IS NOT NULL
           OR p.utm_medium IS NOT NULL
           OR p.utm_campaign IS NOT NULL)
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

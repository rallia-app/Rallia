-- =============================================================================
-- Migration: UTM attribution columns on profile + helper RPCs
-- Description:
--   * Adds nullable utm_* columns to public.profile so signup-time attribution
--     persists in the DB (joinable to matches/etc), mirroring the PostHog
--     person properties we already set in posthog-identify.tsx (web) and
--     App.tsx (mobile).
--   * set_profile_utm RPC enforces FIRST-TOUCH semantics — only writes columns
--     that are still NULL, so a returning visitor's later UTM tags never
--     overwrite their original attribution.
--   * get_utm_signup_stats aggregates signups + matches created/played per
--     utm_source/medium/campaign for the admin Acquisition tab.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------

ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT;

-- Indexes scoped by created_at because every analytics query is windowed.
-- Partial indexes keep them small — most rows will have NULL utm columns.
CREATE INDEX IF NOT EXISTS idx_profile_utm_campaign_created_at
  ON public.profile(utm_campaign, created_at DESC)
  WHERE utm_campaign IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_utm_source_created_at
  ON public.profile(utm_source, created_at DESC)
  WHERE utm_source IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. set_profile_utm — write-once attribution write path
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.set_profile_utm(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.set_profile_utm(
  p_player_id uuid,
  p_utm jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Caller can only set their own row. The client passes auth.uid() but we
  -- enforce it server-side too in case the RPC is invoked elsewhere.
  IF auth.uid() IS NULL OR auth.uid() <> p_player_id THEN
    RAISE EXCEPTION 'set_profile_utm: caller does not own player_id';
  END IF;

  -- First-touch: COALESCE keeps the existing value when it's already set.
  -- Empty strings in the input are treated as missing.
  UPDATE public.profile
  SET
    utm_source   = COALESCE(utm_source,   NULLIF(p_utm->>'utm_source',   '')),
    utm_medium   = COALESCE(utm_medium,   NULLIF(p_utm->>'utm_medium',   '')),
    utm_campaign = COALESCE(utm_campaign, NULLIF(p_utm->>'utm_campaign', '')),
    utm_content  = COALESCE(utm_content,  NULLIF(p_utm->>'utm_content',  '')),
    utm_term     = COALESCE(utm_term,     NULLIF(p_utm->>'utm_term',     ''))
  WHERE id = p_player_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_utm(uuid, jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_utm_signup_stats — admin-gated aggregate for the Acquisition tab
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_utm_signup_stats(integer);

CREATE OR REPLACE FUNCTION public.get_utm_signup_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  signups        bigint,
  matches_created bigint,
  matches_played  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(p_days, 1));
BEGIN
  -- Same admin gate + graceful empty-return as the existing invitation RPCs.
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
  SELECT
    c.u_source AS utm_source,
    c.u_medium AS utm_medium,
    c.u_campaign AS utm_campaign,
    COUNT(*)::bigint AS signups,
    COALESCE(SUM(mc.n), 0)::bigint AS matches_created,
    COALESCE(SUM(mp.n), 0)::bigint AS matches_played
  FROM cohort c
  LEFT JOIN match_created mc ON mc.player_id = c.id
  LEFT JOIN match_played  mp ON mp.player_id = c.id
  GROUP BY c.u_source, c.u_medium, c.u_campaign
  ORDER BY signups DESC, c.u_campaign;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_utm_signup_stats(integer) TO authenticated;

-- =============================================================================
-- Migration: Admin-gated invitation/referral click analytics RPCs
-- Description: Aggregates referral_link_click + referral_fingerprint + profile
-- so the admin analytics page can show, per invitation_type:
--   * total clicks, unique devices, matched iOS deferred-deep-link installs,
--     attributed signups, conversion rate
-- And, per type, the top target_id values driving clicks.
-- Both RPCs require the caller to be in public.admin (any role).
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_invitation_stats(integer);

CREATE OR REPLACE FUNCTION public.get_invitation_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  invitation_type text,
  clicks bigint,
  unique_devices bigint,
  matched_installs bigint,
  attributed_signups bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(p_days, 1));
BEGIN
  -- Admin gate. Returning empty (instead of RAISE) keeps the admin UI graceful
  -- during the brief client-side window where the cookie-based supabase client
  -- has not yet replaced the default anon singleton.
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  -- Inner CTEs use `itype` so column names never collide with the RETURNS TABLE
  -- OUT parameters; final SELECT aliases them back to the public column names.
  RETURN QUERY
  WITH click_agg AS (
    SELECT
      COALESCE(rlc.invitation_type, 'referral') AS itype,
      COUNT(*)::bigint AS clicks,
      COUNT(DISTINCT rlc.device_fingerprint)::bigint AS unique_devices
    FROM public.referral_link_click rlc
    WHERE rlc.created_at >= v_since
    GROUP BY 1
  ),
  matched_agg AS (
    SELECT
      COALESCE(rf.invitation_type, 'referral') AS itype,
      COUNT(*) FILTER (WHERE rf.matched_player_id IS NOT NULL)::bigint AS matched_installs
    FROM public.referral_fingerprint rf
    WHERE rf.created_at >= v_since
    GROUP BY 1
  ),
  signup_agg AS (
    SELECT
      p.referral_invitation_type AS itype,
      COUNT(*)::bigint AS attributed_signups
    FROM public.profile p
    WHERE p.referral_invitation_type IS NOT NULL
      AND p.created_at >= v_since
    GROUP BY 1
  ),
  combined AS (
    SELECT itype FROM click_agg
    UNION
    SELECT itype FROM matched_agg
    UNION
    SELECT itype FROM signup_agg
  )
  SELECT
    t.itype AS invitation_type,
    COALESCE(c.clicks, 0)::bigint AS clicks,
    COALESCE(c.unique_devices, 0)::bigint AS unique_devices,
    COALESCE(m.matched_installs, 0)::bigint AS matched_installs,
    COALESCE(s.attributed_signups, 0)::bigint AS attributed_signups
  FROM combined t
  LEFT JOIN click_agg c ON c.itype = t.itype
  LEFT JOIN matched_agg m ON m.itype = t.itype
  LEFT JOIN signup_agg s ON s.itype = t.itype
  ORDER BY COALESCE(c.clicks, 0) DESC, t.itype;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_stats(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.get_invitation_top_targets(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_invitation_top_targets(
  p_invitation_type text,
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  target_id text,
  clicks bigint,
  unique_devices bigint
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
  SELECT
    agg.tid AS target_id,
    agg.c::bigint AS clicks,
    agg.u::bigint AS unique_devices
  FROM (
    SELECT
      COALESCE(rlc.target_id, '(none)') AS tid,
      COUNT(*) AS c,
      COUNT(DISTINCT rlc.device_fingerprint) AS u
    FROM public.referral_link_click rlc
    WHERE rlc.created_at >= v_since
      AND COALESCE(rlc.invitation_type, 'referral') = p_invitation_type
    GROUP BY COALESCE(rlc.target_id, '(none)')
  ) agg
  ORDER BY agg.c DESC, agg.tid
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_top_targets(text, integer, integer) TO authenticated;

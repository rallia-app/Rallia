-- =============================================================================
-- Migration: Invitation analytics accuracy fix + dead-fingerprint cleanup
--
-- Two problems being fixed together because they touch the same surface area:
--
-- 1. `referral_link_click` had a UNIQUE index on
--    `(referral_code, device_fingerprint, COALESCE(invitation_type, 'referral'))`
--    that, after the recent attribution refactor wrote device_fingerprint=''
--    for every row, collapsed every click for the same (code, type) tuple
--    into ONE row via ON CONFLICT DO UPDATE. A link clicked 1,000 times
--    showed as 1 click in the Invitations admin tab. We drop the unique
--    index, rewrite log_referral_click to plain INSERT, and recount unique
--    devices in the stats RPCs via COALESCE(web_distinct_id, ip || '|' || user_agent).
--
-- 2. The `referral_fingerprint` table + its two RPCs (log_referral_fingerprint,
--    match_referral_fingerprint) were part of the iOS deferred-deep-link
--    flow we abandoned in favor of the clipboard handoff. No code writes
--    to the table anymore and no code reads from match_referral_fingerprint.
--    The matched_installs column in get_invitation_stats has been
--    constantly returning 0 since that refactor. Drop the table + RPCs
--    cleanly and remove matched_installs from the stats RPC return.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Drop the collapsing unique index
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_referral_link_click_unique;

-- Add a more useful index for analytics queries that filter by type + window.
CREATE INDEX IF NOT EXISTS idx_referral_link_click_type_created_at
  ON public.referral_link_click(invitation_type, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. log_referral_click — plain INSERT, no ON CONFLICT
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.log_referral_click(
  p_referral_code      VARCHAR(12),
  p_device_fingerprint TEXT,
  p_ip_address         TEXT DEFAULT NULL,
  p_user_agent         TEXT DEFAULT NULL,
  p_invitation_type    TEXT DEFAULT 'referral',
  p_target_id          TEXT DEFAULT NULL,
  p_web_distinct_id    TEXT DEFAULT NULL,
  p_utm                JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.referral_link_click (
    referral_code,
    device_fingerprint,
    ip_address,
    user_agent,
    invitation_type,
    target_id,
    web_distinct_id,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    referrer_host
  )
  VALUES (
    UPPER(p_referral_code),
    p_device_fingerprint,
    p_ip_address,
    p_user_agent,
    COALESCE(p_invitation_type, 'referral'),
    p_target_id,
    NULLIF(p_web_distinct_id, ''),
    NULLIF(p_utm->>'utm_source',    ''),
    NULLIF(p_utm->>'utm_medium',    ''),
    NULLIF(p_utm->>'utm_campaign',  ''),
    NULLIF(p_utm->>'utm_content',   ''),
    NULLIF(p_utm->>'utm_term',      ''),
    NULLIF(p_utm->>'referrer_host', '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_referral_click(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_invitation_stats — drop matched_installs, fix unique counting
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_invitation_stats(integer);

CREATE OR REPLACE FUNCTION public.get_invitation_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  invitation_type    text,
  clicks             bigint,
  unique_devices     bigint,
  attributed_signups bigint
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
  WITH click_agg AS (
    SELECT
      COALESCE(rlc.invitation_type, 'referral') AS itype,
      COUNT(*)::bigint AS clicks,
      -- Visitor identity: prefer PostHog distinct_id (set by UtmCapture from
      -- the ph_did cookie); fall back to ip+ua for visitors whose cookie
      -- hadn't been written yet on first-touch SSR.
      COUNT(DISTINCT COALESCE(
        rlc.web_distinct_id,
        rlc.ip_address || '|' || COALESCE(rlc.user_agent, '')
      ))::bigint AS unique_devices
    FROM public.referral_link_click rlc
    WHERE rlc.created_at >= v_since
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
    SELECT itype FROM signup_agg
  )
  SELECT
    t.itype AS invitation_type,
    COALESCE(c.clicks, 0)::bigint AS clicks,
    COALESCE(c.unique_devices, 0)::bigint AS unique_devices,
    COALESCE(s.attributed_signups, 0)::bigint AS attributed_signups
  FROM combined t
  LEFT JOIN click_agg  c ON c.itype = t.itype
  LEFT JOIN signup_agg s ON s.itype = t.itype
  ORDER BY COALESCE(c.clicks, 0) DESC, t.itype;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_stats(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. get_invitation_top_targets — fix unique counting (mirror)
-- -----------------------------------------------------------------------------

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
      COUNT(DISTINCT COALESCE(
        rlc.web_distinct_id,
        rlc.ip_address || '|' || COALESCE(rlc.user_agent, '')
      )) AS u
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

-- -----------------------------------------------------------------------------
-- 5. Drop dead fingerprint infrastructure
--    log_referral_fingerprint: no callers in apps/web or apps/mobile
--    match_referral_fingerprint: exposed via useReferral but never invoked
--    referral_fingerprint: no writes since the iOS clipboard refactor
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.match_referral_fingerprint(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.log_referral_fingerprint(VARCHAR(12), TEXT, TEXT, TEXT, TEXT, TEXT);
DROP TABLE IF EXISTS public.referral_fingerprint;

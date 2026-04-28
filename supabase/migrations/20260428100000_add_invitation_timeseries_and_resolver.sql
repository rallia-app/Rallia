-- =============================================================================
-- Migration: Invitation analytics — daily click time-series + target_id resolver
-- =============================================================================
-- Adds two admin-gated RPCs powering the trend sparkline and friendly-name
-- drill-down in the /admin/analytics "Invitations & Referrals" card. Both
-- mirror the security model of get_invitation_stats (admin gate, return empty
-- for non-admins instead of raising, so the UI degrades gracefully).
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_invitation_clicks_timeseries(integer);

CREATE OR REPLACE FUNCTION public.get_invitation_clicks_timeseries(p_days integer DEFAULT 30)
RETURNS TABLE(
  invitation_type text,
  bucket_date date,
  clicks bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start date := (now() - make_interval(days => GREATEST(p_days, 1)))::date;
  v_end   date := now()::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  -- Cross-join distinct types × all days so empty days appear as zero.
  RETURN QUERY
  WITH active_types AS (
    SELECT DISTINCT COALESCE(rlc.invitation_type, 'referral') AS itype
    FROM public.referral_link_click rlc
    WHERE rlc.created_at::date >= v_start
  ),
  days AS (
    SELECT generated::date AS d
    FROM generate_series(v_start, v_end, INTERVAL '1 day') AS generated
  ),
  click_counts AS (
    SELECT
      COALESCE(rlc.invitation_type, 'referral') AS itype,
      rlc.created_at::date AS d,
      COUNT(*)::bigint AS c
    FROM public.referral_link_click rlc
    WHERE rlc.created_at::date >= v_start
    GROUP BY 1, 2
  )
  SELECT
    t.itype AS invitation_type,
    d.d AS bucket_date,
    COALESCE(cc.c, 0)::bigint AS clicks
  FROM active_types t
  CROSS JOIN days d
  LEFT JOIN click_counts cc ON cc.itype = t.itype AND cc.d = d.d
  ORDER BY t.itype, d.d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_clicks_timeseries(integer) TO authenticated;


DROP FUNCTION IF EXISTS public.resolve_invitation_targets(text, text[]);

CREATE OR REPLACE FUNCTION public.resolve_invitation_targets(
  p_invitation_type text,
  p_target_ids text[]
)
RETURNS TABLE(
  target_id text,
  display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  IF p_target_ids IS NULL OR array_length(p_target_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  IF p_invitation_type = 'match' THEN
    RETURN QUERY
    SELECT
      tid AS target_id,
      COALESCE(
        NULLIF(
          concat_ws(' · ',
            initcap(s.name::text),
            to_char(m.match_date, 'YYYY-MM-DD'),
            substring(m.start_time::text FROM 1 FOR 5),
            COALESCE(NULLIF(f.name::text, ''), NULLIF(m.location_name, ''))
          ),
          ''
        ),
        tid
      ) AS display_name
    FROM unnest(p_target_ids) AS tid
    LEFT JOIN public.match m ON m.id::text = tid
    LEFT JOIN public.sport s ON s.id = m.sport_id
    LEFT JOIN public.facility f ON f.id = m.facility_id;

  ELSIF p_invitation_type IN ('group', 'community') THEN
    RETURN QUERY
    SELECT
      tid AS target_id,
      COALESCE(NULLIF(n.name::text, ''), tid) AS display_name
    FROM unnest(p_target_ids) AS tid
    LEFT JOIN public.network n ON n.invite_code = upper(tid);

  ELSIF p_invitation_type = 'referral' THEN
    RETURN QUERY
    SELECT
      tid AS target_id,
      COALESCE(
        NULLIF(concat_ws(' ', p.first_name, p.last_name), ''),
        tid
      ) AS display_name
    FROM unnest(p_target_ids) AS tid
    LEFT JOIN public.profile p ON p.referral_code = upper(tid);

  ELSE
    -- flyer / poster / unknown types: return raw target_id unchanged.
    RETURN QUERY
    SELECT tid AS target_id, tid AS display_name
    FROM unnest(p_target_ids) AS tid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invitation_targets(text, text[]) TO authenticated;

-- =============================================================================
-- Migration: Add 'tournament' to the invitation_type CHECK constraints
-- Description: Tournament invite links (/invite/{code}?type=tournament&id=...)
-- were being logged as plain 'referral' because the constraints rejected the
-- real type. Like match/group/community, a tournament invite has a referring
-- user, so attribute_referral's existing referral path already handles it.
-- Note: referral_fingerprint was dropped in 20260518100000, so its constraint
-- is intentionally absent here.
-- =============================================================================

ALTER TABLE public.profile
  DROP CONSTRAINT IF EXISTS profile_referral_invitation_type_check;
ALTER TABLE public.profile
  ADD CONSTRAINT profile_referral_invitation_type_check
  CHECK (referral_invitation_type IN ('referral', 'match', 'group', 'community', 'tournament', 'flyer', 'poster', 'social'));

ALTER TABLE public.referral_link_click
  DROP CONSTRAINT IF EXISTS referral_link_click_invitation_type_check;
ALTER TABLE public.referral_link_click
  ADD CONSTRAINT referral_link_click_invitation_type_check
  CHECK (invitation_type IN ('referral', 'match', 'group', 'community', 'tournament', 'flyer', 'poster', 'social'));

-- Resolve tournament target_ids to names in the admin invitation analytics,
-- instead of falling through to the raw-uuid ELSE branch.
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

  ELSIF p_invitation_type = 'tournament' THEN
    RETURN QUERY
    SELECT
      tid AS target_id,
      COALESCE(
        NULLIF(
          concat_ws(' · ',
            NULLIF(t.name::text, ''),
            to_char(t.start_date, 'YYYY-MM-DD')
          ),
          ''
        ),
        tid
      ) AS display_name
    FROM unnest(p_target_ids) AS tid
    LEFT JOIN public.tournaments t ON t.id::text = tid;

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
    -- flyer / poster / social / unknown types: return raw target_id unchanged.
    RETURN QUERY
    SELECT tid AS target_id, tid AS display_name
    FROM unnest(p_target_ids) AS tid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invitation_targets(text, text[]) TO authenticated;

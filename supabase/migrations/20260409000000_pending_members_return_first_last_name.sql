-- Drop all overloads — return type is changing
DROP FUNCTION IF EXISTS get_pending_community_members(UUID, UUID);
DROP FUNCTION IF EXISTS get_pending_community_members(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION get_pending_community_members(
  p_community_id UUID,
  p_moderator_id UUID DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  request_type network_member_request_type,
  added_by UUID,
  created_at TIMESTAMPTZ,
  player_name TEXT,
  player_first_name TEXT,
  player_last_name TEXT,
  player_profile_picture TEXT,
  referrer_name TEXT,
  rating_value DOUBLE PRECISION,
  rating_label TEXT,
  badge_status TEXT,
  reputation_score NUMERIC,
  reputation_tier TEXT,
  reputation_total_events INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_moderator_id UUID;
  v_is_moderator BOOLEAN;
BEGIN
  v_moderator_id := COALESCE(p_moderator_id, auth.uid());

  IF v_moderator_id IS NULL THEN
    RAISE EXCEPTION 'Moderator ID is required';
  END IF;

  SELECT is_network_moderator(p_community_id, v_moderator_id) INTO v_is_moderator;

  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can view pending members';
  END IF;

  RETURN QUERY
  SELECT
    nm.id,
    nm.player_id,
    nm.request_type,
    nm.added_by,
    nm.created_at,
    COALESCE(p.display_name, p.first_name || ' ' || COALESCE(p.last_name, '')) as player_name,
    p.first_name as player_first_name,
    p.last_name as player_last_name,
    p.profile_picture_url as player_profile_picture,
    COALESCE(r.display_name, r.first_name || ' ' || COALESCE(r.last_name, '')) as referrer_name,
    rating.value as rating_value,
    rating.label::text as rating_label,
    rating.badge_status::text as badge_status,
    pr.reputation_score as reputation_score,
    pr.reputation_tier::text as reputation_tier,
    pr.total_events as reputation_total_events
  FROM public.network_member nm
  JOIN public.profile p ON p.id = nm.player_id
  LEFT JOIN public.profile r ON r.id = nm.added_by AND nm.request_type = 'member_referral'
  LEFT JOIN LATERAL (
    SELECT rs2.value, rs2.label, prs2.badge_status
    FROM public.player_rating_score prs2
    JOIN public.rating_score rs2 ON rs2.id = prs2.rating_score_id
    JOIN public.rating_system rsys2 ON rsys2.id = rs2.rating_system_id
      AND rsys2.sport_id = p_sport_id
    WHERE prs2.player_id = nm.player_id
      AND p_sport_id IS NOT NULL
    LIMIT 1
  ) rating ON true
  LEFT JOIN public.player_reputation pr ON pr.player_id = nm.player_id
  WHERE nm.network_id = p_community_id
    AND nm.status = 'pending'
  ORDER BY nm.created_at ASC;
END;
$$;

-- =============================================================================
-- Migration: Add minimum rating requirement for communities
-- Description: Allows community creators/moderators to set a minimum player
--              rating (e.g., NTRP 3.5+) and optionally require certification.
--              Enforced on join requests and member referrals.
-- =============================================================================

-- =============================================================================
-- STEP 1a: Add columns to network table
-- =============================================================================
ALTER TABLE public.network
  ADD COLUMN IF NOT EXISTS min_rating_score_id UUID REFERENCES public.rating_score(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS require_certified_rating BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.network.min_rating_score_id IS 'Minimum rating score required to join. References rating_scores for value and rating_system_id.';
COMMENT ON COLUMN public.network.require_certified_rating IS 'If true, players must have a certified (green badge) rating, not self-declared.';

-- =============================================================================
-- STEP 1b: Update request_to_join_community() with rating check
-- Latest version was in 20260309200003_fix_community_rejoin_after_removal.sql
-- =============================================================================
CREATE OR REPLACE FUNCTION request_to_join_community(
  p_community_id UUID,
  p_player_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_id UUID;
  v_network_type TEXT;
  v_is_private BOOLEAN;
  v_existing_member_id UUID;
  v_existing_status network_member_status;
  v_member_id UUID;
  v_community_name TEXT;
  v_requester_name TEXT;
  v_moderator RECORD;
  -- Rating check variables
  v_min_rating_score_id UUID;
  v_require_certified BOOLEAN;
  v_min_rating_value DOUBLE PRECISION;
  v_min_rating_system_id UUID;
  v_min_rating_label TEXT;
  v_player_rating_value DOUBLE PRECISION;
  v_player_badge_status TEXT;
BEGIN
  -- Use provided player_id or get from auth
  v_player_id := COALESCE(p_player_id, auth.uid());

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Player ID is required';
  END IF;

  -- Verify this is a public community and get its name + rating requirements
  SELECT nt.name, n.is_private, n.name, n.min_rating_score_id, n.require_certified_rating
  INTO v_network_type, v_is_private, v_community_name, v_min_rating_score_id, v_require_certified
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  WHERE n.id = p_community_id;

  IF v_network_type IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;

  IF v_network_type != 'community' THEN
    RAISE EXCEPTION 'This is not a community';
  END IF;

  IF v_is_private = true THEN
    RAISE EXCEPTION 'Cannot request to join a private community';
  END IF;

  -- Rating requirement check
  IF v_min_rating_score_id IS NOT NULL THEN
    -- Get the minimum rating value and its rating system
    SELECT rs.value, rs.rating_system_id, rs.label
    INTO v_min_rating_value, v_min_rating_system_id, v_min_rating_label
    FROM public.rating_score rs
    WHERE rs.id = v_min_rating_score_id;

    -- Look up the player's rating in the same rating system
    SELECT rs.value, prs.badge_status::TEXT
    INTO v_player_rating_value, v_player_badge_status
    FROM public.player_rating_score prs
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = v_player_id
      AND rs.rating_system_id = v_min_rating_system_id;

    -- Check: player has no rating in this system
    IF v_player_rating_value IS NULL THEN
      RAISE EXCEPTION 'RATING_REQUIRED: You need a rating to join this community (minimum: %)', v_min_rating_label;
    END IF;

    -- Check: player rating is below minimum
    IF v_player_rating_value < v_min_rating_value THEN
      RAISE EXCEPTION 'RATING_TOO_LOW: Your rating does not meet the minimum requirement (minimum: %)', v_min_rating_label;
    END IF;

    -- Check: certified required but player is not certified
    IF v_require_certified AND v_player_badge_status != 'certified' THEN
      RAISE EXCEPTION 'CERTIFIED_REQUIRED: This community requires a certified rating';
    END IF;
  END IF;

  -- Check existing membership status
  SELECT id, status INTO v_existing_member_id, v_existing_status
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = v_player_id;

  -- Handle based on existing status
  IF v_existing_member_id IS NOT NULL THEN
    IF v_existing_status = 'active' THEN
      RAISE EXCEPTION 'Already a member of this community';
    ELSIF v_existing_status = 'pending' THEN
      RAISE EXCEPTION 'Already have a pending request for this community';
    ELSIF v_existing_status = 'blocked' THEN
      RAISE EXCEPTION 'You are blocked from this community';
    ELSIF v_existing_status = 'removed' THEN
      -- User was previously removed - allow rejoin by updating existing record
      UPDATE public.network_member
      SET status = 'pending',
          request_type = 'join_request',
          added_by = v_player_id,
          joined_at = NULL,
          updated_at = NOW()
      WHERE id = v_existing_member_id
      RETURNING id INTO v_member_id;
    END IF;
  ELSE
    -- No existing record - create new pending membership request
    INSERT INTO public.network_member (
      network_id,
      player_id,
      status,
      role,
      request_type,
      added_by
    )
    VALUES (
      p_community_id,
      v_player_id,
      'pending',
      'member',
      'join_request',
      v_player_id  -- Self-requested
    )
    RETURNING id INTO v_member_id;
  END IF;

  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || COALESCE(last_name, ''), display_name, 'Someone')
  INTO v_requester_name
  FROM public.profile
  WHERE id = v_player_id;

  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_player_id,
    v_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'join_request')
  );

  -- Send notification to all moderators
  FOR v_moderator IN
    SELECT nm.player_id
    FROM public.network_member nm
    WHERE nm.network_id = p_community_id
      AND nm.role = 'moderator'
      AND nm.status = 'active'
  LOOP
    INSERT INTO public.notification (
      user_id,
      type,
      target_id,
      title,
      body,
      payload,
      priority
    ) VALUES (
      v_moderator.player_id,
      'community_join_request'::notification_type_enum,
      p_community_id,
      'New Join Request',
      v_requester_name || ' wants to join ' || v_community_name,
      jsonb_build_object(
        'communityId', p_community_id,
        'communityName', v_community_name,
        'requesterId', v_player_id,
        'requesterName', v_requester_name,
        'memberId', v_member_id
      ),
      'normal'::notification_priority_enum
    );
  END LOOP;

  RETURN v_member_id;
END;
$$;

COMMENT ON FUNCTION request_to_join_community IS 'Creates a pending join request for a public community. Enforces minimum rating requirements. Allows users who were previously removed to request again.';

-- =============================================================================
-- STEP 1c: Update get_public_communities() with rating fields
-- Latest version was in 20260405000001_paginate_public_communities_rpc.sql (4 params)
-- =============================================================================
DROP FUNCTION IF EXISTS get_public_communities(UUID, UUID, INT, INT);

CREATE OR REPLACE FUNCTION get_public_communities(
  p_player_id UUID DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL,
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 1000
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_private BOOLEAN,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  is_member BOOLEAN,
  membership_status TEXT,
  membership_role TEXT,
  sport_id UUID,
  is_certified BOOLEAN,
  min_rating_score_id UUID,
  min_rating_value DOUBLE PRECISION,
  min_rating_label TEXT,
  require_certified_rating BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.is_private,
    n.member_count,
    n.created_by,
    n.created_at,
    CASE WHEN nm.id IS NOT NULL THEN TRUE ELSE FALSE END as is_member,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role,
    n.sport_id,
    COALESCE(n.is_certified, FALSE) as is_certified,
    n.min_rating_score_id,
    rs.value as min_rating_value,
    rs.label::TEXT as min_rating_label,
    n.require_certified_rating
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  LEFT JOIN public.network_member nm ON nm.network_id = n.id
    AND nm.player_id = p_player_id
  LEFT JOIN public.rating_score rs ON rs.id = n.min_rating_score_id
  WHERE nt.name = 'community'
    AND n.is_private = FALSE
    AND n.member_count > 0
    AND n.archived_at IS NULL
    AND (p_sport_id IS NULL OR n.sport_id = p_sport_id)
  ORDER BY n.member_count DESC, n.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION get_public_communities IS 'Returns public communities with membership status, certification, and rating requirements for discovery, with pagination support. Optionally filtered by sport.';

GRANT EXECUTE ON FUNCTION get_public_communities(UUID, UUID, INT, INT) TO authenticated;

-- =============================================================================
-- STEP 1d: Update get_player_communities() with rating fields
-- Latest version was in 20260328000000_fix_community_group_sport_filtering.sql
-- =============================================================================
DROP FUNCTION IF EXISTS get_player_communities(UUID, UUID);

CREATE OR REPLACE FUNCTION get_player_communities(
  p_player_id UUID,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_private BOOLEAN,
  member_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ,
  membership_status TEXT,
  membership_role TEXT,
  sport_id UUID,
  is_certified BOOLEAN,
  min_rating_score_id UUID,
  min_rating_value DOUBLE PRECISION,
  min_rating_label TEXT,
  require_certified_rating BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.name,
    n.description,
    n.cover_image_url,
    n.is_private,
    n.member_count,
    n.created_by,
    n.created_at,
    nm.status::TEXT as membership_status,
    nm.role::TEXT as membership_role,
    n.sport_id,
    COALESCE(n.is_certified, FALSE) as is_certified,
    n.min_rating_score_id,
    rs.value as min_rating_value,
    rs.label::TEXT as min_rating_label,
    n.require_certified_rating
  FROM public.network n
  JOIN public.network_type nt ON n.network_type_id = nt.id
  JOIN public.network_member nm ON nm.network_id = n.id AND nm.player_id = p_player_id
  LEFT JOIN public.rating_score rs ON rs.id = n.min_rating_score_id
  WHERE nt.name = 'community'
    AND nm.status = 'active'
    AND (p_sport_id IS NULL OR n.sport_id = p_sport_id)
  ORDER BY n.name ASC;
END;
$$;

COMMENT ON FUNCTION get_player_communities IS 'Returns all communities a player is a member of with certification and rating requirements, optionally filtered by sport (strict match)';

-- =============================================================================
-- STEP 1e: Update refer_player_to_community() with rating check
-- Latest version was in 20260123000002_add_community_support.sql
-- =============================================================================
CREATE OR REPLACE FUNCTION refer_player_to_community(
  p_community_id UUID,
  p_referred_player_id UUID,
  p_referrer_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id UUID;
  v_is_referrer_member BOOLEAN;
  v_existing_member UUID;
  v_member_id UUID;
  -- Rating check variables
  v_min_rating_score_id UUID;
  v_require_certified BOOLEAN;
  v_min_rating_value DOUBLE PRECISION;
  v_min_rating_system_id UUID;
  v_min_rating_label TEXT;
  v_player_rating_value DOUBLE PRECISION;
  v_player_badge_status TEXT;
BEGIN
  -- Use provided referrer_id or get from auth
  v_referrer_id := COALESCE(p_referrer_id, auth.uid());

  IF v_referrer_id IS NULL THEN
    RAISE EXCEPTION 'Referrer ID is required';
  END IF;

  -- Verify the referrer is an active member
  SELECT EXISTS(
    SELECT 1 FROM public.network_member
    WHERE network_id = p_community_id
      AND player_id = v_referrer_id
      AND status = 'active'
  ) INTO v_is_referrer_member;

  IF NOT v_is_referrer_member THEN
    RAISE EXCEPTION 'Only active members can refer other players';
  END IF;

  -- Rating requirement check for the referred player
  SELECT n.min_rating_score_id, n.require_certified_rating
  INTO v_min_rating_score_id, v_require_certified
  FROM public.network n
  WHERE n.id = p_community_id;

  IF v_min_rating_score_id IS NOT NULL THEN
    -- Get the minimum rating value and its rating system
    SELECT rs.value, rs.rating_system_id, rs.label
    INTO v_min_rating_value, v_min_rating_system_id, v_min_rating_label
    FROM public.rating_score rs
    WHERE rs.id = v_min_rating_score_id;

    -- Look up the referred player's rating in the same rating system
    SELECT rs.value, prs.badge_status::TEXT
    INTO v_player_rating_value, v_player_badge_status
    FROM public.player_rating_score prs
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p_referred_player_id
      AND rs.rating_system_id = v_min_rating_system_id;

    -- Check: player has no rating in this system
    IF v_player_rating_value IS NULL THEN
      RAISE EXCEPTION 'RATING_REQUIRED: The referred player needs a rating to join this community (minimum: %)', v_min_rating_label;
    END IF;

    -- Check: player rating is below minimum
    IF v_player_rating_value < v_min_rating_value THEN
      RAISE EXCEPTION 'RATING_TOO_LOW: The referred player''s rating does not meet the minimum requirement (minimum: %)', v_min_rating_label;
    END IF;

    -- Check: certified required but player is not certified
    IF v_require_certified AND v_player_badge_status != 'certified' THEN
      RAISE EXCEPTION 'CERTIFIED_REQUIRED: This community requires a certified rating';
    END IF;
  END IF;

  -- Check if player is already a member or has pending request
  SELECT id INTO v_existing_member
  FROM public.network_member
  WHERE network_id = p_community_id AND player_id = p_referred_player_id;

  IF v_existing_member IS NOT NULL THEN
    RAISE EXCEPTION 'Player is already a member or has a pending request';
  END IF;

  -- Create pending membership referral
  INSERT INTO public.network_member (
    network_id,
    player_id,
    status,
    role,
    request_type,
    added_by
  )
  VALUES (
    p_community_id,
    p_referred_player_id,
    'pending',
    'member',
    'member_referral',
    v_referrer_id
  )
  RETURNING id INTO v_member_id;

  -- Log activity
  INSERT INTO public.network_activity (
    network_id,
    activity_type,
    actor_id,
    target_id,
    metadata
  ) VALUES (
    p_community_id,
    'member_joined',
    v_referrer_id,
    p_referred_player_id,
    jsonb_build_object('status', 'pending', 'request_type', 'member_referral')
  );

  RETURN v_member_id;
END;
$$;

COMMENT ON FUNCTION refer_player_to_community IS 'Allows active members to refer other players (needs approval). Enforces minimum rating requirements.';

-- =============================================================================
-- STEP 1f: Create helper RPC check_player_meets_community_rating()
-- =============================================================================
CREATE OR REPLACE FUNCTION check_player_meets_community_rating(
  p_community_id UUID,
  p_player_id UUID
)
RETURNS TABLE (
  meets_requirement BOOLEAN,
  reason TEXT,
  min_rating_label TEXT,
  player_rating_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_min_rating_score_id UUID;
  v_require_certified BOOLEAN;
  v_min_rating_value DOUBLE PRECISION;
  v_min_rating_system_id UUID;
  v_min_label TEXT;
  v_player_rating_value DOUBLE PRECISION;
  v_player_badge_status TEXT;
  v_player_label TEXT;
BEGIN
  -- Get the community's rating requirements
  SELECT n.min_rating_score_id, n.require_certified_rating
  INTO v_min_rating_score_id, v_require_certified
  FROM public.network n
  WHERE n.id = p_community_id;

  -- No rating requirement set
  IF v_min_rating_score_id IS NULL THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Get the minimum rating details
  SELECT rs.value, rs.rating_system_id, rs.label
  INTO v_min_rating_value, v_min_rating_system_id, v_min_label
  FROM public.rating_score rs
  WHERE rs.id = v_min_rating_score_id;

  -- Look up the player's rating in the same rating system
  SELECT rs.value, prs.badge_status::TEXT, rs.label
  INTO v_player_rating_value, v_player_badge_status, v_player_label
  FROM public.player_rating_score prs
  JOIN public.rating_score rs ON rs.id = prs.rating_score_id
  WHERE prs.player_id = p_player_id
    AND rs.rating_system_id = v_min_rating_system_id;

  -- Player has no rating
  IF v_player_rating_value IS NULL THEN
    RETURN QUERY SELECT FALSE, 'NO_RATING'::TEXT, v_min_label, NULL::TEXT;
    RETURN;
  END IF;

  -- Player rating is below minimum
  IF v_player_rating_value < v_min_rating_value THEN
    RETURN QUERY SELECT FALSE, 'RATING_TOO_LOW'::TEXT, v_min_label, v_player_label;
    RETURN;
  END IF;

  -- Certified required but player is not certified
  IF v_require_certified AND v_player_badge_status != 'certified' THEN
    RETURN QUERY SELECT FALSE, 'CERTIFIED_REQUIRED'::TEXT, v_min_label, v_player_label;
    RETURN;
  END IF;

  -- Player meets requirement
  RETURN QUERY SELECT TRUE, NULL::TEXT, v_min_label, v_player_label;
END;
$$;

COMMENT ON FUNCTION check_player_meets_community_rating IS 'Checks if a player meets a community''s minimum rating requirement. Returns meets_requirement boolean with reason code.';

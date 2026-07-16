-- =============================================================================
-- Localize the remaining hardcoded-English in-app notifications
--
-- The in-app notification center renders the stored notification.title/body
-- verbatim. Five types were still built in English by DB triggers/RPCs, so
-- French users saw English for them. Bring them in line with the rest of the
-- codebase (network_deleted + all L&T types) by branching each title/body on the
-- recipient's locale via the existing public.lt_user_is_fr(uuid) helper.
--
-- Types fixed: match_new_available, community_join_request,
-- community_join_accepted, community_join_rejected, and the new_message title.
--
-- Only the notification title/body literals change; every other line of each
-- function is reproduced verbatim from its latest definition.
-- =============================================================================

-- match_new_available ---------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_group_members_on_match_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_group_type_id UUID;
  v_sport_name TEXT;
  v_notifications JSONB := '[]'::JSONB;
BEGIN
  -- Only run when match is public, or private with visible_in_groups
  IF NEW.visibility IS DISTINCT FROM 'public'
     AND NOT (NEW.visibility = 'private' AND COALESCE(NEW.visible_in_groups, true) = true) THEN
    RETURN NEW;
  END IF;

  -- Get player_group network type id
  SELECT id INTO v_player_group_type_id
  FROM network_type
  WHERE name = 'player_group'
  LIMIT 1;

  IF v_player_group_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Optional: sport name for payload (for push display)
  SELECT s.name INTO v_sport_name
  FROM sport s
  WHERE s.id = NEW.sport_id
  LIMIT 1;

  -- Build batch of notifications for distinct group members (excluding creator)
  -- Recipients: active members of any player_group the creator is in, except the creator
  WITH creator_groups AS (
    SELECT nm.network_id
    FROM network_member nm
    JOIN network n ON n.id = nm.network_id AND n.network_type_id = v_player_group_type_id
    WHERE nm.player_id = NEW.created_by
      AND nm.status = 'active'
  ),
  recipients AS (
    SELECT DISTINCT nm.player_id AS user_id
    FROM network_member nm
    JOIN creator_groups cg ON cg.network_id = nm.network_id
    WHERE nm.player_id IS NOT NULL
      AND nm.player_id != NEW.created_by
      AND nm.status = 'active'
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', r.user_id,
        'type', 'match_new_available',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(r.user_id)
                      THEN 'Nouvelle partie'
                      ELSE 'New game' END,
        'body', CASE WHEN public.lt_user_is_fr(r.user_id)
                     THEN 'Un membre de ton groupe vient de créer une partie où embarquer.'
                     ELSE 'A group member created a match you can join.' END,
        'payload', jsonb_build_object(
          'matchId', NEW.id,
          'creatorId', NEW.created_by,
          'sportName', COALESCE(v_sport_name, '')
        ),
        'priority', 'normal'
      )
    ),
    '[]'::JSONB
  )
  INTO v_notifications
  FROM recipients r;

  IF jsonb_array_length(v_notifications) > 0 THEN
    PERFORM insert_notifications(v_notifications);
  END IF;

  RETURN NEW;
END;
$$;

-- community_join_request (notifies moderators) --------------------------------
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
      CASE WHEN public.lt_user_is_fr(v_moderator.player_id)
           THEN 'Nouvelle demande'
           ELSE 'New Join Request' END,
      CASE WHEN public.lt_user_is_fr(v_moderator.player_id)
           THEN v_requester_name || ' veut rejoindre ' || v_community_name
           ELSE v_requester_name || ' wants to join ' || v_community_name END,
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

-- community_join_accepted -----------------------------------------------------
CREATE OR REPLACE FUNCTION approve_community_member(
  p_community_id UUID,
  p_member_id UUID,
  p_approver_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_approver_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
  v_community_name TEXT;
BEGIN
  -- Use provided approver_id or get from auth
  v_approver_id := COALESCE(p_approver_id, auth.uid());

  IF v_approver_id IS NULL THEN
    RAISE EXCEPTION 'Approver ID is required';
  END IF;

  -- Verify the approver is a moderator
  SELECT is_network_moderator(p_community_id, v_approver_id) INTO v_is_moderator;

  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can approve members';
  END IF;

  -- Get target player ID
  SELECT player_id INTO v_target_player_id
  FROM public.network_member
  WHERE id = p_member_id AND network_id = p_community_id AND status = 'pending';

  IF v_target_player_id IS NULL THEN
    RAISE EXCEPTION 'Pending membership not found';
  END IF;

  -- Get community name
  SELECT name INTO v_community_name
  FROM public.network
  WHERE id = p_community_id;

  -- Approve the membership
  -- NOTE: The update_network_member_count trigger automatically increments
  -- member_count when status changes from 'pending' to 'active', so we
  -- do NOT need to manually update member_count here (that was causing double-count)
  UPDATE public.network_member
  SET status = 'active', joined_at = NOW()
  WHERE id = p_member_id;

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
    v_approver_id,
    v_target_player_id,
    jsonb_build_object('status', 'approved', 'approved_by', v_approver_id)
  );

  -- Send notification to the requester
  INSERT INTO public.notification (
    user_id,
    type,
    target_id,
    title,
    body,
    payload,
    priority
  ) VALUES (
    v_target_player_id,
    'community_join_accepted'::notification_type_enum,
    p_community_id,
    CASE WHEN public.lt_user_is_fr(v_target_player_id)
         THEN 'Demande approuvée!'
         ELSE 'Request Approved!' END,
    CASE WHEN public.lt_user_is_fr(v_target_player_id)
         THEN 'Tu es maintenant membre de ' || v_community_name
         ELSE 'You are now a member of ' || v_community_name END,
    jsonb_build_object(
      'communityId', p_community_id,
      'communityName', v_community_name
    ),
    'normal'::notification_priority_enum
  );

  RETURN true;
END;
$$;

-- community_join_rejected -----------------------------------------------------
CREATE OR REPLACE FUNCTION reject_community_member(
  p_community_id UUID,
  p_member_id UUID,
  p_rejector_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rejector_id UUID;
  v_is_moderator BOOLEAN;
  v_target_player_id UUID;
  v_community_name TEXT;
BEGIN
  -- Use provided rejector_id or get from auth
  v_rejector_id := COALESCE(p_rejector_id, auth.uid());

  IF v_rejector_id IS NULL THEN
    RAISE EXCEPTION 'Rejector ID is required';
  END IF;

  -- Verify the rejector is a moderator
  SELECT is_network_moderator(p_community_id, v_rejector_id) INTO v_is_moderator;

  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can reject members';
  END IF;

  -- Get target player ID
  SELECT player_id INTO v_target_player_id
  FROM public.network_member
  WHERE id = p_member_id AND network_id = p_community_id AND status = 'pending';

  IF v_target_player_id IS NULL THEN
    RAISE EXCEPTION 'Pending membership not found';
  END IF;

  -- Get community name
  SELECT name INTO v_community_name
  FROM public.network
  WHERE id = p_community_id;

  -- Delete the membership request
  DELETE FROM public.network_member
  WHERE id = p_member_id;

  -- Send notification to the requester
  INSERT INTO public.notification (
    user_id,
    type,
    target_id,
    title,
    body,
    payload,
    priority
  ) VALUES (
    v_target_player_id,
    'community_join_rejected'::notification_type_enum,
    p_community_id,
    CASE WHEN public.lt_user_is_fr(v_target_player_id)
         THEN 'Demande refusée'
         ELSE 'Request Not Approved' END,
    CASE WHEN public.lt_user_is_fr(v_target_player_id)
         THEN 'Ta demande pour rejoindre ' || v_community_name || ' a été refusée'
         ELSE 'Your request to join ' || v_community_name || ' was not approved' END,
    jsonb_build_object(
      'communityId', p_community_id,
      'communityName', v_community_name
    ),
    'normal'::notification_priority_enum
  );

  RETURN true;
END;
$$;

-- new_message (localize the title prefix only) --------------------------------
-- Body stays the raw message preview (neutral for user messages). System-message
-- bodies (court prompts) remain English in-app; those need a payload re-render
-- like the push channel already does, out of scope here.
create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
begin
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  v_preview := left(NEW.content, 100);

  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    CASE WHEN public.lt_user_is_fr(cp.player_id)
         THEN 'Message de ' || v_sender_name
         ELSE 'Message from ' || v_sender_name END,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview,
      'messageType', NEW.message_type,
      'facilityName', NEW.metadata->>'facility_name',
      'courtLabel', NEW.metadata->>'court_label'
    ),
    'normal'::notification_priority_enum,
    now()
  from conversation_participant cp
  left join active_conversation ac on ac.player_id = cp.player_id
  where cp.conversation_id = NEW.conversation_id
    and cp.player_id != NEW.sender_id
    and cp.player_id is distinct from (NEW.metadata->>'suppress_notification_for')::uuid
    and cp.is_muted = false
    and (
      ac.player_id is null
      or ac.conversation_id is distinct from NEW.conversation_id
      or ac.active_at <= now() - interval '60 seconds'
    );

  return NEW;
end;
$$ language plpgsql security definer;

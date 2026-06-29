-- ============================================================================
-- Leagues — member lifecycle: leave / remove / suspend / reinstate
-- ============================================================================
-- Closes a gap: league_members models 'suspended'/'inactive' + suspended_at/
-- suspended_until/suspended_reason/left_at, but nothing ever set them (only
-- league_revoke_invite -> inactive, for pending invites). So an active member
-- was stuck in a league forever, and an organizer had no way to remove or
-- suspend a member.
--
-- Ships:
--   league_leave            self-service: a member leaves (or cancels a
--                           pending self-request). Owner can't leave.
--   league_remove_member    organizer removes a member -> inactive (can rejoin)
--   league_suspend_member   organizer suspends an active member -> suspended
--   league_reinstate_member organizer lifts a suspension -> active
--
-- All four mirror league_revoke_invite (SECURITY DEFINER, optimistic version
-- lock, membership audit). No new enum values or columns — every status and
-- column used already exists. The notify_league_membership_change trigger does
-- not misfire: its branches key on NEW.status='pending'/'active'-from-'pending',
-- none of which these transitions produce (the pending-invite cleanup branch
-- still correctly clears a stale invitation when a pending invitee leaves).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- league_leave: caller leaves the league (or withdraws a pending request)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_leave(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_league    leagues;
    v_existing  league_members;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    -- The owner can't leave their own league (it would orphan it).
    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZER_CANNOT_LEAVE';
    END IF;

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id AND user_id = v_caller_id
     FOR UPDATE;
    IF v_existing.id IS NULL OR v_existing.status NOT IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    UPDATE league_members
       SET status     = 'inactive',
           left_at    = now(),
           version    = version + 1,
           updated_at = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'leave', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'prev_status', v_existing.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_leave(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_remove_member: organizer removes a member (-> inactive, can rejoin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_remove_member(
    p_member_id   uuid,
    p_version_was integer
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_league    leagues;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_member.league_id;
    IF v_member.user_id = v_league.organizer_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_REMOVE_ORGANIZER';
    END IF;
    IF v_member.user_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_REMOVE_SELF';
    END IF;

    IF v_member.status NOT IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REMOVABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status     = 'inactive',
           left_at    = now(),
           version    = version + 1,
           updated_at = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'remove_member', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id,
                               'prev_status', v_member.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_remove_member(uuid, integer) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_suspend_member: organizer suspends an active member
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_suspend_member(
    p_member_id   uuid,
    p_version_was integer,
    p_reason      text        DEFAULT NULL,
    p_until       timestamptz DEFAULT NULL
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_league    leagues;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_member.league_id;
    IF v_member.user_id = v_league.organizer_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_SUSPEND_ORGANIZER';
    END IF;
    IF v_member.user_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_SUSPEND_SELF';
    END IF;

    IF v_member.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_SUSPENDABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status           = 'suspended',
           suspended_at     = now(),
           suspended_until  = p_until,
           suspended_reason = p_reason,
           version          = version + 1,
           updated_at       = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'suspend_member', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id,
                               'until', p_until, 'reason', p_reason));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_suspend_member(uuid, integer, text, timestamptz) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_reinstate_member: organizer lifts a suspension (-> active)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_reinstate_member(
    p_member_id   uuid,
    p_version_was integer
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_member.status <> 'suspended' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_SUSPENDED';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status           = 'active',
           suspended_at     = NULL,
           suspended_until  = NULL,
           suspended_reason = NULL,
           version          = version + 1,
           updated_at       = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'reinstate_member', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'user_id', v_row.user_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_reinstate_member(uuid, integer) TO authenticated;

COMMIT;

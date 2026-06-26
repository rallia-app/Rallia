-- ============================================================================
-- Intra-app league invite — membership notification trigger + RPCs
-- ============================================================================
-- Mirrors the tournament invite flow (20260625110100 / 140000 / 150000):
--   notify_league_membership_change  trigger:
--     A) new pending self-request (invited_by NULL) -> notify organizer
--     B) approval (pending->active by someone else)  -> notify the member
--     cleanup: a pending organizer-invite leaving 'pending' clears its stale
--              league_invitation notification
--   league_invite_members  organizer invites existing players (pending +
--                          invited_by + league_invitation notification)
--   league_accept_invite   invitee accepts -> active
--   league_revoke_invite   organizer retracts an outstanding invite (non-terminal)
--
-- This also closes a pre-existing gap: organizers were never notified when a
-- player requested to join an approval-mode league.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Membership notification trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_league_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor  uuid := auth.uid();
    v_league leagues;
    v_name   text;
BEGIN
    SELECT * INTO v_league FROM leagues WHERE id = NEW.league_id;

    -- A) New pending self-request -> organizer side. Organizer-initiated invites
    --    (invited_by set) are excluded — those notify the invitee instead.
    IF NEW.status = 'pending'
       AND NEW.invited_by IS NULL
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
       AND v_league.organizer_id IS DISTINCT FROM v_actor THEN
        SELECT trim(first_name || ' ' || coalesce(last_name, ''))
          INTO v_name FROM profile WHERE id = NEW.user_id;
        PERFORM insert_notification(
            v_league.organizer_id,
            'league_member_request',
            NEW.league_id,
            CASE WHEN public.lt_user_is_fr(v_league.organizer_id)
                 THEN 'Nouvelle demande d''adhésion' ELSE 'New join request' END,
            CASE WHEN public.lt_user_is_fr(v_league.organizer_id)
                 THEN coalesce(nullif(v_name, ''), 'Un joueur') || ' veut rejoindre '
                      || coalesce(v_league.name, 'ta ligue') || '.'
                 ELSE coalesce(nullif(v_name, ''), 'A player') || ' wants to join '
                      || coalesce(v_league.name, 'your league') || '.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', NEW.league_id,
                               'memberId', NEW.id, 'requesterId', NEW.user_id),
            'normal'
        );

    -- B) Approved by someone other than the member (organizer approval).
    ELSIF TG_OP = 'UPDATE'
          AND OLD.status = 'pending' AND NEW.status = 'active'
          AND v_actor IS DISTINCT FROM NEW.user_id THEN
        PERFORM insert_notification(
            NEW.user_id,
            'league_member_approved',
            NEW.league_id,
            CASE WHEN public.lt_user_is_fr(NEW.user_id) THEN 'Tu es accepté' ELSE 'You''re in' END,
            CASE WHEN public.lt_user_is_fr(NEW.user_id)
                 THEN 'Ton adhésion à ' || coalesce(v_league.name, 'la ligue') || ' a été approuvée.'
                 ELSE 'Your membership in ' || coalesce(v_league.name, 'the league') || ' was approved.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', NEW.league_id),
            'high'
        );
    END IF;

    -- Clear the stale invitation notification once a pending organizer-invite is
    -- resolved (accepted -> active, or revoked -> inactive).
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'pending'
       AND OLD.invited_by IS NOT NULL
       AND NEW.status IS DISTINCT FROM 'pending' THEN
        DELETE FROM notification
         WHERE type      = 'league_invitation'
           AND target_id = NEW.league_id
           AND user_id   = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_league_membership_change ON public.league_members;
CREATE TRIGGER notify_league_membership_change
    AFTER INSERT OR UPDATE ON public.league_members
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_league_membership_change();


-- ----------------------------------------------------------------------------
-- league_invite_members: organizer invites existing players (pending rows)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_invite_members(
    p_league_id uuid,
    p_user_ids  uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_league       leagues;
    v_active_count integer;
    v_inviter_name text;
    v_uid          uuid;
    v_existing     league_members;
    v_member_id    uuid;
    v_invited      integer := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(p_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    SELECT first_name INTO v_inviter_name FROM profile WHERE id = v_caller_id;

    SELECT count(*) INTO v_active_count
      FROM league_members WHERE league_id = p_league_id AND status = 'active';

    FOREACH v_uid IN ARRAY p_user_ids LOOP
        CONTINUE WHEN v_uid IS NULL OR v_uid = v_caller_id;
        EXIT WHEN v_league.member_capacity IS NOT NULL
                  AND v_active_count >= v_league.member_capacity
                  AND NOT COALESCE(v_league.waitlist_enabled, false);

        -- Must play the league's sport.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = v_uid AND ps.sport_id = v_league.sport_id AND ps.is_active = true
        );

        SELECT * INTO v_existing
          FROM league_members WHERE league_id = p_league_id AND user_id = v_uid;

        -- Already active / pending / suspended → don't double-invite.
        CONTINUE WHEN v_existing.id IS NOT NULL
                      AND v_existing.status IN ('active', 'pending', 'suspended');

        IF v_existing.id IS NOT NULL THEN
            -- Reactivate a former (inactive) row as a fresh invite.
            UPDATE league_members
               SET status      = 'pending',
                   role        = 'member',
                   invited_by  = v_caller_id,
                   approved_at = NULL,
                   approved_by = NULL,
                   left_at     = NULL,
                   version     = version + 1,
                   updated_at  = now()
             WHERE id = v_existing.id
            RETURNING id INTO v_member_id;
        ELSE
            INSERT INTO league_members (league_id, user_id, role, status, invited_by)
            VALUES (p_league_id, v_uid, 'member', 'pending', v_caller_id)
            RETURNING id INTO v_member_id;
        END IF;

        v_invited := v_invited + 1;

        PERFORM insert_notification(
            v_uid,
            'league_invitation',
            p_league_id,
            CASE WHEN public.lt_user_is_fr(v_uid) THEN 'Invitation à une ligue' ELSE 'League invitation' END,
            CASE WHEN public.lt_user_is_fr(v_uid)
                 THEN COALESCE(v_inviter_name, 'Un organisateur') || ' t''invite à '
                      || COALESCE(v_league.name, 'une ligue') || '. Touche pour accepter.'
                 ELSE COALESCE(v_inviter_name, 'An organizer') || ' invited you to '
                      || COALESCE(v_league.name, 'a league') || '. Tap to accept.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', p_league_id,
                               'leagueName', v_league.name, 'invitedBy', v_caller_id),
            'high'
        );

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('membership', v_member_id, 'invite_member', v_caller_id,
                jsonb_build_object('league_id', p_league_id, 'invitee', v_uid));
    END LOOP;

    RETURN v_invited;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_invite_members(uuid, uuid[]) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_accept_invite: invitee accepts their pending organizer invite
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_accept_invite(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_existing  league_members;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id
       AND user_id   = v_caller_id
       AND status    = 'pending'
       AND invited_by IS NOT NULL
     FOR UPDATE;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    UPDATE league_members
       SET status      = 'active',
           approved_at = now(),
           version     = version + 1,
           updated_at  = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'status', v_row.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_accept_invite(uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- league_revoke_invite: organizer retracts an outstanding invite (non-terminal)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_revoke_invite(
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

    IF v_member.status <> 'pending' OR v_member.invited_by IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REVOCABLE';
    END IF;

    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- Non-terminal: 'inactive' frees the invite and lets the player be re-invited
    -- or self-request later. The trigger clears the stale invitation notification.
    UPDATE league_members
       SET status     = 'inactive',
           left_at    = now(),
           version    = version + 1,
           updated_at = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'revoke_invite', v_caller_id,
            jsonb_build_object('league_id', v_row.league_id, 'invitee', v_row.user_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_revoke_invite(uuid, integer) TO authenticated;

COMMIT;

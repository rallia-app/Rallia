-- ============================================================================
-- Leagues — a turned-down join request tells the player
-- ============================================================================
-- The reject action shipped in 6870a08a reuses league_remove_member on the
-- pending row, and removal has never notified. For a removal, silence is
-- defensible; for a request the player is actively waiting on, their "request
-- sent" state simply reverting to a Join button reads as a bug.
--
-- The membership trigger gains the missing branch: a pending self-request
-- flipped to inactive by someone other than the member notifies the requester.
-- A player withdrawing their own request stays silent, and organizer invites
-- keep their own revoke path. The organizer's "new join request" notification
-- is also cleared once the request is answered either way, the same
-- housekeeping the invite path has always done.
--
-- Same body as 20260626140100 otherwise (its only prior definition).
-- ============================================================================

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

    -- C) Pending self-request turned down by the organizer -> requester side.
    --    A player withdrawing their own request (actor = member) stays silent.
    ELSIF TG_OP = 'UPDATE'
          AND OLD.status = 'pending' AND OLD.invited_by IS NULL
          AND NEW.status = 'inactive'
          AND v_actor IS DISTINCT FROM NEW.user_id THEN
        PERFORM insert_notification(
            NEW.user_id,
            'league_member_rejected',
            NEW.league_id,
            CASE WHEN public.lt_user_is_fr(NEW.user_id)
                 THEN 'Demande refusée' ELSE 'Request declined' END,
            CASE WHEN public.lt_user_is_fr(NEW.user_id)
                 THEN 'Ta demande pour rejoindre ' || coalesce(v_league.name, 'la ligue')
                      || ' n''a pas été retenue. Tu peux redemander plus tard.'
                 ELSE 'Your request to join ' || coalesce(v_league.name, 'the league')
                      || ' wasn''t accepted. You can ask again later.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', NEW.league_id),
            'normal'
        );
    END IF;

    -- Clear the organizer's now-answered join-request notification once the
    -- pending self-request resolves either way (approved or turned down), the
    -- same housekeeping the invite path below has always done.
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'pending'
       AND OLD.invited_by IS NULL
       AND NEW.status IS DISTINCT FROM 'pending' THEN
        DELETE FROM notification
         WHERE type      = 'league_member_request'
           AND target_id = NEW.league_id
           AND payload ->> 'memberId' = NEW.id::text;
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

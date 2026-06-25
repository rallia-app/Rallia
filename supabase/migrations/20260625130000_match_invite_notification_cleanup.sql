-- ============================================================================
-- Clear a stale match_invitation notification when its pending invite resolves
-- ============================================================================
-- A 'match_invitation' notification is sent to an invitee while their
-- match_participant row is 'pending'. Once the invite is resolved — host
-- cancels/revokes it (status -> 'cancelled'), the invitee declines
-- (-> 'declined') or joins (-> 'joined') — the "tap to accept" notification is
-- no longer relevant and should disappear from their list.
--
-- This runs as a SECURITY DEFINER trigger because the deletion cannot happen on
-- the host's client: the notification belongs to the invitee, and RLS only lets
-- a user delete their own notifications. Mirrors the tournament invite cleanup
-- in notify_tournament_registration_change.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.clear_stale_match_invitation_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending' THEN
    DELETE FROM notification
     WHERE type      = 'match_invitation'
       AND target_id = NEW.match_id
       AND user_id   = NEW.player_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_participant_clear_invite_notification ON public.match_participant;
CREATE TRIGGER match_participant_clear_invite_notification
  AFTER UPDATE OF status ON public.match_participant
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_stale_match_invitation_notification();

COMMIT;

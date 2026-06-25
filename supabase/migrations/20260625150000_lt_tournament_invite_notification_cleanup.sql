-- ============================================================================
-- Clear a stale tournament_invitation notification when its pending invite
-- resolves — packaged as a standalone migration.
-- ============================================================================
-- The cleanup block (delete the organizer's "tap to accept" notification once a
-- pending, organizer-initiated invite leaves 'pending') was originally added by
-- editing 20260625110100 in place. Migrations are immutable once applied, so any
-- environment that already ran the block-less 20260625110100 would never pick up
-- the cleanup. This migration re-establishes the function via CREATE OR REPLACE
-- so the behavior lands regardless of which version of 20260625110100 ran first.
--
-- The body below is the current committed definition of
-- notify_tournament_registration_change() from 20260625110100, verbatim,
-- including the cleanup block. Mirrors the match-side
-- clear_stale_match_invitation_notification trigger (20260625130000).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_tournament_registration_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_t_name text;
  v_registrant_name text;
  v_rows jsonb;
BEGIN
  SELECT name INTO v_t_name FROM tournaments WHERE id = NEW.tournament_id;

  -- A) New (or re-) pending self-request -> organizer side. Organizer-initiated
  --    invites (invited_by set) are excluded — those notify the invitee instead.
  IF NEW.status = 'pending'
     AND NEW.invited_by IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT trim(first_name || ' ' || coalesce(last_name, ''))
      INTO v_registrant_name
      FROM profile WHERE id = NEW.user_id;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', o.uid,
      'type', 'tournament_registration_received',
      'target_id', NEW.tournament_id,
      'title', CASE WHEN public.lt_user_is_fr(o.uid)
                 THEN 'Nouvelle demande d''inscription' ELSE 'New registration request' END,
      'body', CASE WHEN public.lt_user_is_fr(o.uid)
                THEN coalesce(nullif(v_registrant_name, ''), 'Un joueur')
                     || ' veut s''inscrire à ' || coalesce(v_t_name, 'ton tournoi') || '.'
                ELSE coalesce(nullif(v_registrant_name, ''), 'A player')
                     || ' wants to join ' || coalesce(v_t_name, 'your tournament') || '.'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.tournament_id,
        'tournamentName', v_t_name,
        'registrationId', NEW.id,
        'registrantId', NEW.user_id,
        'registrantName', v_registrant_name
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT t.organizer_id AS uid FROM tournaments t WHERE t.id = NEW.tournament_id
      UNION
      SELECT co.user_id FROM tournament_co_organizers co WHERE co.tournament_id = NEW.tournament_id
    ) o
    WHERE o.uid IS NOT NULL
      AND o.uid IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- B) Approved by someone outside the entry (organizer or future approval RPC)
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status = 'pending' AND NEW.status = 'registered'
        AND v_actor IS DISTINCT FROM NEW.user_id
        AND v_actor IS DISTINCT FROM NEW.partner_user_id THEN
    PERFORM insert_notification(
      m,
      'tournament_registration_approved',
      NEW.tournament_id,
      CASE WHEN public.lt_user_is_fr(m) THEN 'Inscription approuvée' ELSE 'You''re in' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN 'Ton inscription à ' || coalesce(v_t_name, 'ce tournoi') || ' a été approuvée.'
        ELSE 'Your registration for ' || coalesce(v_t_name, 'the tournament') || ' was approved.'
      END,
      jsonb_build_object('tournamentId', NEW.tournament_id, 'tournamentName', v_t_name),
      'high'
    )
    FROM unnest(array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL)) m;

  -- C) Removed by an organizer
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status = 'disqualified'
        AND OLD.status IN ('registered', 'pending', 'waitlisted') THEN
    PERFORM insert_notification(
      m,
      'tournament_registration_removed',
      NEW.tournament_id,
      CASE WHEN public.lt_user_is_fr(m) THEN 'Retiré du tournoi' ELSE 'Removed from tournament' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN 'Un organisateur t''a retiré de ' || coalesce(v_t_name, 'ce tournoi') || '.'
        ELSE 'An organizer removed you from ' || coalesce(v_t_name, 'the tournament') || '.'
      END,
      jsonb_build_object('tournamentId', NEW.tournament_id, 'tournamentName', v_t_name),
      'high'
    )
    FROM unnest(array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL)) m
    WHERE m IS DISTINCT FROM v_actor;
  END IF;

  -- Clear the now-stale organizer invitation notification once a pending invite
  -- is resolved (accepted, declined/withdrawn, or removed by an organizer).
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'
     AND OLD.invited_by IS NOT NULL
     AND NEW.status IS DISTINCT FROM 'pending' THEN
    DELETE FROM notification
     WHERE type      = 'tournament_invitation'
       AND target_id = NEW.tournament_id
       AND user_id   = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

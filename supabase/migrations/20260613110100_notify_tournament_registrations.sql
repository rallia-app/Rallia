-- Registration-phase tournament notifications, derived from status
-- transitions on tournament_registrations (covers every write path: current
-- RPCs, invite joins, and any future approval RPC).
--
--   A) -> pending                  organizer + co-organizers: request received
--   B) pending -> registered       entry members: approved (only when flipped
--                                  by someone other than the entry itself —
--                                  silent for today's self-accept invite flow)
--   C) active -> disqualified      entry members: removed by an organizer
--
-- English fallback copy in the row (standard for DB-side producers); the
-- payload carries everything needed for localized push rendering later.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_tournament_registration_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_t_name text;
  v_registrant_name text;
  v_rows jsonb;
BEGIN
  SELECT name INTO v_t_name FROM tournaments WHERE id = NEW.tournament_id;

  -- A) New (or re-) pending request -> organizer side
  IF NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT trim(first_name || ' ' || coalesce(last_name, ''))
      INTO v_registrant_name
      FROM profile WHERE id = NEW.user_id;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', o.uid,
      'type', 'tournament_registration_received',
      'target_id', NEW.tournament_id,
      'title', 'New registration request',
      'body', coalesce(nullif(v_registrant_name, ''), 'A player')
              || ' wants to join ' || coalesce(v_t_name, 'your tournament') || '.',
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
      'You''re in',
      'Your registration for ' || coalesce(v_t_name, 'the tournament') || ' was approved.',
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
      'Removed from tournament',
      'An organizer removed you from ' || coalesce(v_t_name, 'the tournament') || '.',
      jsonb_build_object('tournamentId', NEW.tournament_id, 'tournamentName', v_t_name),
      'high'
    )
    FROM unnest(array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL)) m
    WHERE m IS DISTINCT FROM v_actor;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_registrations_notify ON public.tournament_registrations;
CREATE TRIGGER tournament_registrations_notify
  AFTER INSERT OR UPDATE OF status ON public.tournament_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tournament_registration_change();

COMMIT;

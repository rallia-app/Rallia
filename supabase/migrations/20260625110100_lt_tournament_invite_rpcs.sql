-- ============================================================================
-- Intra-app tournament invite — RPCs + trigger guard
-- ============================================================================
-- Organizer (or co-organizer/admin) invites existing players. Each invite is a
-- 'pending' tournament_registrations row marked with invited_by; the invitee
-- gets a 'tournament_invitation' notification and accepts via
-- tournament_accept_invite (singles direct; doubles supplies a partner). This
-- mirrors the games invite flow.
--
-- The registration trigger (20260624100000) treats every new 'pending' row as a
-- self-request and notifies the organizer(s). Invites are organizer-initiated,
-- so we add `AND NEW.invited_by IS NULL` to branch A; the invitee notification
-- is sent explicitly by tournament_invite_players. The rest of the function is
-- the 20260624100000 definition verbatim.
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

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- tournament_invite_players: organizer invites existing players (pending rows).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_invite_players(
    p_tournament_id uuid,
    p_user_ids      uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_active_count integer;
    v_inviter_name text;
    v_uid          uuid;
    v_reg_id       uuid;
    v_invited      integer := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT first_name INTO v_inviter_name FROM profile WHERE id = v_caller_id;

    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND status IN ('registered', 'pending');

    FOREACH v_uid IN ARRAY p_user_ids LOOP
        CONTINUE WHEN v_uid IS NULL OR v_uid = v_caller_id;
        EXIT WHEN v_active_count >= v_tournament.max_participants;

        -- Must play the sport.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = v_uid
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        );

        -- Skip if the player already has ANY row for this tournament (active,
        -- withdrawn or disqualified): don't double-invite or re-invite removed.
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = p_tournament_id
               AND (r.user_id = v_uid OR r.partner_user_id = v_uid)
        );

        INSERT INTO tournament_registrations (tournament_id, user_id, status, invited_by)
        VALUES (p_tournament_id, v_uid, 'pending', v_caller_id)
        RETURNING id INTO v_reg_id;

        v_active_count := v_active_count + 1;
        v_invited      := v_invited + 1;

        PERFORM insert_notification(
            v_uid,
            'tournament_invitation',
            p_tournament_id,
            CASE WHEN public.lt_user_is_fr(v_uid) THEN 'Invitation à un tournoi' ELSE 'Tournament invitation' END,
            CASE WHEN public.lt_user_is_fr(v_uid)
              THEN COALESCE(v_inviter_name, 'Un organisateur') || ' t''invite à ' || COALESCE(v_tournament.name, 'un tournoi') || '. Touche pour accepter.'
              ELSE COALESCE(v_inviter_name, 'An organizer') || ' invited you to ' || COALESCE(v_tournament.name, 'a tournament') || '. Tap to accept.'
            END,
            jsonb_build_object('tournamentId', p_tournament_id, 'tournamentName', v_tournament.name, 'invitedBy', v_caller_id),
            'high'
        );

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('registration', v_reg_id, 'invite_player', v_caller_id,
                jsonb_build_object('tournament_id', p_tournament_id, 'invitee', v_uid));
    END LOOP;

    RETURN v_invited;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_invite_players(uuid, uuid[]) TO authenticated;

-- ============================================================================
-- tournament_accept_invite: invitee accepts their pending organizer invite.
-- Singles: direct. Doubles: invitee supplies a partner (validated like
-- tournament_register). Capacity isn't re-checked — the pending invite already
-- reserved the entry slot.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_accept_invite(
    p_tournament_id uuid,
    p_partner_id    uuid DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_is_doubles   boolean;
    v_existing     tournament_registrations;
    v_row          tournament_registrations;
    v_captain_name text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id
       AND status        = 'pending'
       AND invited_by IS NOT NULL;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    v_is_doubles := v_tournament.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_id = v_caller_id
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_id
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = p_tournament_id
               AND r.id <> v_existing.id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
    END IF;

    UPDATE tournament_registrations
       SET status          = 'registered',
           partner_user_id = CASE WHEN v_is_doubles THEN p_partner_id ELSE partner_user_id END,
           approved_at     = now(),
           version         = version + 1,
           updated_at      = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('tournament_id', p_tournament_id, 'status', v_row.status, 'partner_user_id', v_row.partner_user_id));

    IF v_is_doubles AND p_partner_id IS NOT NULL THEN
        SELECT first_name INTO v_captain_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            p_partner_id,
            'tournament_partner_registered',
            v_tournament.id,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN 'Inscrit comme partenaire' ELSE 'Tournament partner' END,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN COALESCE(v_captain_name, 'Un joueur') || ' t''a inscrit comme partenaire pour ' || v_tournament.name || '.' ELSE COALESCE(v_captain_name, 'A player') || ' registered you as their partner for ' || v_tournament.name || '.' END,
            jsonb_build_object('tournamentId', v_tournament.id, 'captainId', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_accept_invite(uuid, uuid) TO authenticated;

COMMIT;

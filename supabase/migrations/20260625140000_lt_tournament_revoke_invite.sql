-- ============================================================================
-- Intra-app tournament invite — organizer revoke (non-terminal)
-- ============================================================================
-- Mirrors the match host-revoke (which sets the participant to a non-terminal
-- 'cancelled'). Removing a registrant disqualifies them terminally; revoking an
-- *unaccepted invite* should not — so tournament_revoke_invite sets the invited
-- pending row to 'withdrawn' (frees the slot; the registration trigger clears
-- the stale tournament_invitation notification; the player can be re-invited or
-- self-register later).
--
-- tournament_invite_players is recreated so a re-invite reactivates a withdrawn
-- row (rather than skipping it), matching how a match re-invite reactivates a
-- cancelled participant. Signature unchanged (CREATE OR REPLACE keeps grants).
-- ============================================================================

BEGIN;

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
    v_existing     tournament_registrations;
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

        -- Already an active partner on another entry → leave alone.
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id   = p_tournament_id
               AND r.partner_user_id = v_uid
               AND r.status IN ('registered', 'pending', 'waitlisted')
        );

        -- Their own captain row (UNIQUE per tournament + user), if any.
        SELECT * INTO v_existing
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND user_id = v_uid;

        -- Active (already in/invited) or organizer-removed (terminal) → skip.
        CONTINUE WHEN v_existing.id IS NOT NULL
                      AND v_existing.status IN ('registered', 'pending', 'waitlisted', 'disqualified');

        IF v_existing.id IS NOT NULL THEN
            -- Reactivate a withdrawn/revoked row as a fresh invite.
            UPDATE tournament_registrations
               SET status          = 'pending',
                   invited_by      = v_caller_id,
                   partner_user_id = NULL,
                   withdrawn_at    = NULL,
                   approved_at     = NULL,
                   version         = version + 1,
                   updated_at      = now()
             WHERE id = v_existing.id
            RETURNING id INTO v_reg_id;
        ELSE
            INSERT INTO tournament_registrations (tournament_id, user_id, status, invited_by)
            VALUES (p_tournament_id, v_uid, 'pending', v_caller_id)
            RETURNING id INTO v_reg_id;
        END IF;

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

-- ============================================================================
-- tournament_revoke_invite: organizer retracts an outstanding invite.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tournament_revoke_invite(
    p_registration_id uuid,
    p_version_was     integer
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_reg       tournament_registrations;
    v_row       tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_reg FROM tournament_registrations WHERE id = p_registration_id FOR UPDATE;
    IF v_reg.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    IF NOT public.is_tournament_organizer(v_reg.tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Only an outstanding organizer invite can be revoked.
    IF v_reg.status <> 'pending' OR v_reg.invited_by IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REVOCABLE';
    END IF;

    IF v_reg.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- Non-terminal: 'withdrawn' frees the slot and lets the player be re-invited
    -- or self-register later (unlike 'disqualified'). The registration trigger
    -- clears the now-stale tournament_invitation notification.
    UPDATE tournament_registrations
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = v_reg.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_row.id, 'revoke_invite', v_caller_id,
            jsonb_build_object('tournament_id', v_row.tournament_id, 'invitee', v_row.user_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_revoke_invite(uuid, integer) TO authenticated;

COMMIT;

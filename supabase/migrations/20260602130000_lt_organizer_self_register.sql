-- ============================================
-- Leagues & Tournaments — organizer self-registration
-- ============================================
-- Spec: specs/17-leagues-tournaments/tournaments.md §Lifecycle / Registration
--
-- Lets a tournament's organizer (or an admin) add themselves to their own
-- tournament as a participant.
--
-- Previously tournament_register applied the registration_mode gates
-- uniformly to everyone:
--   - an `approval` organizer landed in 'pending' with no self-approval path,
--   - an `invite_only` organizer was rejected outright with NOT_INVITED.
--
-- Since the organizer owns the tournament, requiring an invite or a
-- self-approval is nonsensical. Organizers/admins now always register
-- directly as 'registered', regardless of registration_mode. The
-- registration_open status gate, sport-scope check, and capacity check still
-- apply equally to everyone (the organizer occupies a real bracket slot).
--
-- This is the only behavioural change vs. 20260510170005; the rest of the
-- function body is carried over verbatim.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_register(
    p_tournament_id uuid
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_tournament     tournaments;
    v_active_count   integer;
    v_initial_status registration_status;
    v_is_privileged  boolean;
    v_existing_id    uuid;
    v_row            tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    -- Sport scope: caller must play this sport
    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    -- Status must allow registration
    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Organizers/admins own the tournament: they always register directly as
    -- 'registered', bypassing the approval/invite gates a regular player hits.
    v_is_privileged := public.is_tournament_organizer(p_tournament_id) OR public.is_admin();

    -- Mode-dependent initial status
    IF v_is_privileged OR v_tournament.registration_mode = 'open' THEN
        v_initial_status := 'registered';
    ELSIF v_tournament.registration_mode = 'approval' THEN
        v_initial_status := 'pending';
    ELSIF v_tournament.registration_mode = 'invite_only' THEN
        SELECT id INTO v_existing_id
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND user_id       = v_caller_id
           AND status        = 'pending';
        IF v_existing_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;
        -- Accept the existing invite row by flipping pending → registered
        UPDATE tournament_registrations
           SET status        = 'registered',
               approved_at   = now(),
               version       = version + 1,
               updated_at    = now()
         WHERE id = v_existing_id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('tournament_id', p_tournament_id, 'status', v_row.status)
        );
        RETURN v_row;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Capacity check (open + approval + organizer flows). Counts active
    -- registrations only.
    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        -- Waitlist isn't implemented in V2; surface TOURNAMENT_FULL.
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    -- Insert the registration. UNIQUE (tournament_id, user_id) handles double-clicks.
    BEGIN
        INSERT INTO tournament_registrations (tournament_id, user_id, status)
        VALUES (p_tournament_id, v_caller_id, v_initial_status)
        RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
    END;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'register', v_caller_id,
        jsonb_build_object('tournament_id', p_tournament_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_register(uuid) TO authenticated;

-- ============================================
-- Fix: restore re-registration-after-withdrawal (and capacity lock) in
--      tournament_register
-- ============================================
-- Regression: 20260602130000 (organizer self-registration) rebuilt
-- tournament_register from the ORIGINAL 20260510170005 body ("carried over
-- verbatim" per its own header) and so silently reverted two later fixes:
--
--   1. 20260510170006 — re-register after withdrawal. tournament_withdraw
--      flips status to 'withdrawn' but keeps the row. The 170005 body always
--      INSERTs, so a withdrawn player coming back hit the
--      UNIQUE (tournament_id, user_id) constraint and got ALREADY_REGISTERED.
--   2. 20260527000200 — SELECT ... FOR UPDATE row lock so concurrent
--      registrations for the last slot can't both pass the capacity count.
--
-- This migration re-applies both, layered on the organizer/admin privilege
-- bypass from 20260602130000:
--   - lock the tournament row up front,
--   - organizers/admins always register directly as 'registered',
--   - an existing row for (tournament, user) that is active
--     ('registered'/'pending'/'waitlisted') → ALREADY_REGISTERED,
--   - an existing inactive row ('withdrawn'/'disqualified') → reactivate via
--     UPDATE instead of INSERT,
--   - no row → fresh INSERT (UNIQUE still guards the concurrent double-tap).
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
    v_existing       tournament_registrations;
    v_row            tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock the tournament so concurrent registrations serialize and the
    -- capacity count + insert below can't race past max_participants.
    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
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
        SELECT * INTO v_existing
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND user_id       = v_caller_id;

        IF v_existing.id IS NULL OR v_existing.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;

        -- Accept the existing invite row by flipping pending → registered
        UPDATE tournament_registrations
           SET status        = 'registered',
               approved_at   = now(),
               version       = version + 1,
               updated_at    = now()
         WHERE id = v_existing.id
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

    -- Look for any existing row for this (tournament, user). The UNIQUE
    -- constraint on (tournament_id, user_id) means there's at most one.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id;

    -- Already actively registered → block
    IF v_existing.id IS NOT NULL
       AND v_existing.status IN ('registered', 'pending', 'waitlisted') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
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

    IF v_existing.id IS NOT NULL THEN
        -- Reactivate a previously withdrawn / disqualified row.
        UPDATE tournament_registrations
           SET status        = v_initial_status,
               withdrawn_at  = NULL,
               approved_at   = CASE
                                 WHEN v_initial_status = 'registered' THEN now()
                                 ELSE NULL
                               END,
               version       = version + 1,
               updated_at    = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 're_register', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'previous_status', v_existing.status,
                'status', v_row.status
            )
        );
    ELSE
        -- Fresh insert. UNIQUE handles the concurrent-double-tap race.
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
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_register(uuid) TO authenticated;

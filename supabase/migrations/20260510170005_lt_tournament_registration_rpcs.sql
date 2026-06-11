-- ============================================
-- Leagues & Tournaments — V2: registration lifecycle RPCs
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V2
--       specs/17-leagues-tournaments/tournaments.md §Lifecycle / Registration
--
-- Ships four RPCs covering the simplest registration flow:
--
--   tournament_open_registration   (organizer)  draft → registration_open
--   tournament_close_registration  (organizer)  registration_open → registration_closed
--   tournament_register            (any player) self-register or pending-approval
--   tournament_withdraw            (registrant) registered/pending → withdrawn
--
-- Optimistic locking is enforced via the `version_was` argument; mismatches
-- raise OPTIMISTIC_LOCK_CONFLICT.
--
-- Sport-scope is enforced via the existing assert_caller_plays_sport()
-- helper (170001) before any registration-side mutation.
--
-- Out of scope for V2 (tracked for v1.x slices):
--   - waitlist promotion (TOURNAMENT_FULL is returned instead)
--   - invite_only acceptance flow (NOT_INVITED returned)
--   - doubles partner invites
--   - rating/reputation gates
-- ============================================


-- =====================
-- tournament_open_registration
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_open_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE tournaments
       SET status     = 'registration_open',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        -- Either version mismatched or status was wrong; report which.
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'open_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_open_registration(uuid, integer) TO authenticated;


-- =====================
-- tournament_close_registration
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_close_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE tournaments
       SET status     = 'registration_closed',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'registration_open'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'close_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_close_registration(uuid, integer) TO authenticated;


-- =====================
-- tournament_register
-- =====================
-- Self-registration. Mode-dependent initial status:
--   open         → 'registered'
--   approval     → 'pending'
--   invite_only  → only allowed if an existing 'pending' invite row exists
--                  for this user; otherwise NOT_INVITED.

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

    -- Mode-dependent initial status
    IF v_tournament.registration_mode = 'open' THEN
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

    -- Capacity check (open + approval flows). Counts active registrations only.
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


-- =====================
-- tournament_withdraw
-- =====================
-- Caller withdraws their own registration. Sets status='withdrawn' rather
-- than deleting the row, so audit history (and future payment records) stay
-- intact. Bracket-side cleanup ships in a later slice.

CREATE OR REPLACE FUNCTION public.tournament_withdraw(
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
    v_row       tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    UPDATE tournament_registrations
       SET status        = 'withdrawn',
           withdrawn_at  = now(),
           version       = version + 1,
           updated_at    = now()
     WHERE id      = p_registration_id
       AND user_id = v_caller_id
       AND version = p_version_was
       AND status IN ('registered', 'pending', 'waitlisted')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id AND user_id = v_caller_id AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations WHERE id = p_registration_id AND user_id <> v_caller_id
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_OWNER';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'withdraw', v_caller_id,
        jsonb_build_object('tournament_id', v_row.tournament_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid, integer) TO authenticated;

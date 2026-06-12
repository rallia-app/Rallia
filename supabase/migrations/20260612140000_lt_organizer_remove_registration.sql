-- ============================================
-- Organizer registrant removal + 'disqualified' becomes terminal
-- ============================================
-- Organizers could see registrations but had no moderation tool short of
-- cancelling the whole tournament: treg RLS blocks all direct writes and
-- tournament_withdraw is registrant-owned. This adds:
--
--   1. tournament_remove_registration — organizer/co-organizer/admin removes a
--      registrant while the tournament is pre-bracket ('registration_open' or
--      'registration_closed'; bracket generation flips to 'in_progress').
--      Sets status='disqualified' (frees a capacity slot — the active count
--      only looks at registered/pending).
--   2. tournament_register amended so 'disqualified' is TERMINAL: a removed
--      player gets REGISTRATION_REMOVED instead of reactivating their row.
--      Self-withdrawn ('withdrawn') rows still reactivate.
--
-- The tournament_register body below supersedes 20260612120000. Future
-- rewrites must preserve BOTH re-register-after-withdraw (20260510170006 /
-- 20260612120000) AND disqualified-is-terminal (this file). This applies to
-- organizers too: an organizer who removes their own registration cannot
-- re-add themself.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_remove_registration(
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
    v_t_status  tournament_status;
    v_row       tournament_registrations;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT r.* INTO v_reg
      FROM tournament_registrations r
     WHERE r.id = p_registration_id;

    IF v_reg.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    IF NOT (public.is_tournament_organizer(v_reg.tournament_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Removal is a pre-bracket tool only; once the bracket exists the roster
    -- is locked (use the score-override path for in-progress disputes).
    SELECT status INTO v_t_status FROM tournaments WHERE id = v_reg.tournament_id;
    IF v_t_status NOT IN ('registration_open', 'registration_closed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REMOVE_NOT_ALLOWED';
    END IF;

    UPDATE tournament_registrations
       SET status        = 'disqualified',
           withdrawn_at  = now(),
           version       = version + 1,
           updated_at    = now()
     WHERE id      = p_registration_id
       AND version = p_version_was
       AND status IN ('registered', 'pending', 'waitlisted')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'organizer_remove', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'user_id', v_row.user_id,
            'previous_status', v_reg.status,
            'status', v_row.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_remove_registration(uuid, integer) TO authenticated;

-- ============================================
-- tournament_register — body from 20260612120000 plus the two
-- REGISTRATION_REMOVED gates (invite branch + main path).
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

        -- Organizer-removed players are blocked permanently.
        IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
        END IF;

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

    -- Organizer-removed players are blocked permanently (checked before
    -- capacity so they get REGISTRATION_REMOVED, not TOURNAMENT_FULL).
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
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
        -- Reactivate a previously withdrawn row.
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

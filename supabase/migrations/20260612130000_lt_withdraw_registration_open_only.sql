-- ============================================
-- Fix: withdrawal is only allowed while registration is open
-- ============================================
-- tournament_withdraw (20260510170005) only checked the *registration* status
-- (registered/pending/waitlisted) and never the *tournament* phase, so a player
-- could withdraw after registration closed, once the bracket was live, or even
-- after completion — leaving holes in a locked roster/bracket.
--
-- This re-applies the original body verbatim plus a single gate: the parent
-- tournament must be in 'registration_open'. The status lookup is scoped to the
-- caller's own row, so a missing/other-owner registration still falls through to
-- the original NOT_OWNER / REGISTRATION_NOT_FOUND / OPTIMISTIC_LOCK handling.
-- ============================================

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
    v_status    tournament_status;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Withdrawal is only allowed during the registration-open period. Scope the
    -- lookup to the caller's own row; if it's missing or owned by someone else,
    -- v_status is NULL and we let the UPDATE-fallback below raise the precise
    -- REGISTRATION_NOT_FOUND / NOT_OWNER / OPTIMISTIC_LOCK_CONFLICT error.
    SELECT t.status INTO v_status
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE r.id      = p_registration_id
       AND r.user_id = v_caller_id;

    IF v_status IS NOT NULL AND v_status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WITHDRAW_NOT_ALLOWED';
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

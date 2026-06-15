-- ============================================
-- Organizer approves a pending tournament registration (approval-mode flow)
-- ============================================
-- Approval-mode tournaments park self-registrations at status='pending'
-- (tournament_register). Organizers could already SEE these rows (treg_select
-- RLS) but had no way to accept them, so approval mode dead-ended. This adds
-- tournament_approve_registration: organizer/co-organizer/admin flips a
-- pending row to 'registered' while the tournament is pre-bracket.
--
-- DECLINE is intentionally NOT a new RPC: organizers decline by calling the
-- existing tournament_remove_registration (20260612140000), which sets
-- status='disqualified'. 'disqualified' is terminal (tournament_register
-- blocks re-registration), so a declined player can't spam fresh requests.
--
-- No capacity re-check on approve: pending already counts toward capacity
-- (tournament_register counts status IN ('registered','pending')), so the slot
-- was reserved at request time and approving cannot overflow max_participants.
--
-- No notification code here: the trigger in 20260613110100 (branch B) fires
-- 'tournament_registration_approved' automatically on pending->registered when
-- the actor is neither the registrant nor the partner — always true for an
-- organizer approving someone else's request.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_approve_registration(
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

    -- Approval is a pre-bracket tool only; once the bracket exists the roster
    -- is locked (mirrors tournament_remove_registration's gate).
    SELECT status INTO v_t_status FROM tournaments WHERE id = v_reg.tournament_id;
    IF v_t_status NOT IN ('registration_open', 'registration_closed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPROVE_NOT_ALLOWED';
    END IF;

    -- Only a pending row can be approved. No capacity re-check: pending already
    -- counted toward max_participants when the request was created.
    UPDATE tournament_registrations
       SET status      = 'registered',
           approved_at = now(),
           approved_by = v_caller_id,
           version     = version + 1,
           updated_at  = now()
     WHERE id      = p_registration_id
       AND version = p_version_was
       AND status  = 'pending'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        -- Same version but no longer pending (already approved/declined/withdrawn).
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'approve_registration', v_caller_id,
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

GRANT EXECUTE ON FUNCTION public.tournament_approve_registration(uuid, integer) TO authenticated;

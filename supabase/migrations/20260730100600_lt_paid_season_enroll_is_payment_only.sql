-- ============================================================================
-- Leagues — the free enrolment paths could re-seat a paid player mid-refund
-- ============================================================================
-- On a PAID season two code paths still transition a member INTO 'enrolled'
-- without going through checkout:
--
--   season_enroll            — the free-season RPC, which reuses an existing
--                              row and flips it to 'enrolled';
--   session_confirm_presence — its roster auto-enrol upsert (20260629160100).
--
-- Both are backstopped by tg_season_member_requires_payment, which allows the
-- transition when (season_id, user_id) has a payment at 'succeeded'. That gate
-- holds in the steady state, but the refund handshake is two steps:
--
--   1. season_request_refund (SQL)  -> member 'withdrawn', ledger STILL
--                                      'succeeded' (Stripe hasn't been called)
--   2. lt-refund-registration (fn)  -> Stripe refund, ledger -> 'refunded'
--
-- Between them the ledger still reads 'succeeded', so the withdrawing player
-- can call season_enroll and land back on the paid roster for free. Reproduced
-- locally: request refund, then season_enroll -> no error, back to 'enrolled'.
-- The window is short and the same shape exists for a refund whose Stripe call
-- fails and is retried.
--
-- Fix: on a paid season, neither free path may create or promote an enrolment.
-- Payment is the only way in, which is already true in spirit —
-- season_begin_paid_enrollment reserves the seat and the webhook finalises it
-- with a service-role write straight to season_members, so it does not go
-- through either RPC and is unaffected.
--
--   * season_enroll on a paid season: idempotent for someone already enrolled
--     (unchanged), PAYMENT_REQUIRED for everyone else. It previously produced
--     the same PAYMENT_REQUIRED via the trigger in the normal case, so this is
--     the same answer arriving earlier and unconditionally.
--   * session_confirm_presence: the auto-enrol upsert now runs for free seasons
--     only. On a paid season the roster is the paid roster, and a confirm by a
--     non-enrolled player is refused with PAYMENT_REQUIRED rather than being
--     left to the trigger.
--
-- The trigger stays as the last line of defence; this just stops the two RPCs
-- from ever asking it the question.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.season_enroll(p_season_id uuid)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_existing  season_members;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    -- Enrollment requires standing in the league. The organizer/co-organizer
    -- (who may not be a league_members row) and admins are allowed too.
    IF NOT (
        public.is_league_organizer(v_season.league_id)
        OR public.is_admin()
        OR public.is_active_league_member(v_season.league_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LEAGUE_MEMBER';
    END IF;

    SELECT * INTO v_existing
      FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller_id
     FOR UPDATE;

    -- Organizer-removed members are blocked permanently (mirrors the paid
    -- path's guard in season_begin_paid_enrollment).
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENROLLMENT_REMOVED';
    END IF;

    -- Idempotent: already enrolled -> return as-is. Checked before the paid
    -- guard so an enrolled payer calling this is still a harmless no-op.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'enrolled' THEN
        RETURN v_existing;
    END IF;

    -- Paid season: checkout is the only way onto the roster.
    IF v_season.entry_fee_cents > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE season_members
           SET status       = 'enrolled',
               enrolled_at  = now(),
               withdrawn_at = NULL,
               version      = version + 1,
               updated_at   = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO season_members (season_id, user_id, status)
        VALUES (p_season_id, v_caller_id, 'enrolled')
        RETURNING * INTO v_row;
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'enroll', v_caller_id,
            jsonb_build_object('season_id', p_season_id, 'league_id', v_season.league_id));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_enroll(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.session_confirm_presence(
    p_session_id uuid,
    p_status     session_presence_status,
    p_partner_id uuid DEFAULT NULL
)
RETURNS session_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_session       sessions;
    v_season        seasons;
    v_member_status season_member_status;
    v_existing      session_presence;
    v_target        session_presence_status;
    v_confirmed     integer;
    v_position      integer;
    v_row           session_presence;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_status NOT IN ('confirmed', 'declined', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    IF v_session.confirmation_deadline_at IS NOT NULL
       AND now() > v_session.confirmation_deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIRMATION_CLOSED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT public.is_active_league_member(v_season.league_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    -- >>> season roster gate >>>
    IF p_status = 'confirmed' THEN
        SELECT status INTO v_member_status
          FROM season_members
         WHERE season_id = v_session.season_id AND user_id = v_caller_id
         FOR UPDATE;

        IF v_member_status = 'disqualified' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENROLLMENT_REMOVED';
        END IF;

        IF v_season.entry_fee_cents > 0 THEN
            -- Paid season: the roster is whoever paid. Never auto-enrol here —
            -- that is what let a mid-refund player re-seat themselves for free.
            IF v_member_status IS DISTINCT FROM 'enrolled' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
            END IF;
        ELSE
            -- Free season: confirming presence puts the caller on the roster.
            -- Idempotent — never bumps an already-enrolled row, re-enrols a
            -- withdrawn one, never a disqualified one. FOR UPDATE above
            -- serializes against a concurrent season_remove_member; the extra
            -- exclusion in the upsert's WHERE covers the insert race.
            INSERT INTO season_members (season_id, user_id, status)
            VALUES (v_session.season_id, v_caller_id, 'enrolled')
            ON CONFLICT (season_id, user_id) DO UPDATE
               SET status       = 'enrolled',
                   enrolled_at  = now(),
                   withdrawn_at = NULL,
                   version      = season_members.version + 1,
                   updated_at   = now()
             WHERE season_members.status NOT IN ('enrolled', 'disqualified');
        END IF;
    END IF;
    -- <<< season roster gate <<<

    SELECT * INTO v_existing
      FROM session_presence
     WHERE session_id = p_session_id AND user_id = v_caller_id;

    -- Capacity gate: a confirm past capacity goes to the waitlist (the caller's
    -- own current seat doesn't count against the cap).
    v_target := p_status;
    v_position := NULL;
    IF p_status = 'confirmed' AND v_session.capacity IS NOT NULL THEN
        SELECT count(*) INTO v_confirmed
          FROM session_presence
         WHERE session_id = p_session_id
           AND status = 'confirmed'
           AND user_id <> v_caller_id;

        IF v_confirmed >= v_session.capacity THEN
            v_target := 'waitlisted';
            SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_position
              FROM session_presence
             WHERE session_id = p_session_id AND status = 'waitlisted';
        END IF;
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE session_presence
           SET status               = v_target,
               preferred_partner_id = p_partner_id,
               waitlist_position    = v_position,
               responded_at         = now(),
               version              = version + 1,
               updated_at           = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO session_presence (
            session_id, user_id, status, preferred_partner_id,
            waitlist_position, responded_at
        )
        VALUES (
            p_session_id, v_caller_id, v_target, p_partner_id,
            v_position, now()
        )
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_confirm_presence(uuid, session_presence_status, uuid)
    TO authenticated;

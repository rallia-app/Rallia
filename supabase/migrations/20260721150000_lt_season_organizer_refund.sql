-- Close the organizer half of the paid-season money holes.
--
-- Two related gaps from the 2026-07-21 audit:
--
-- 1. season_remove_member (20260629160100) flips an enrolled member to
--    withdrawn with no fee/ledger awareness. On a paid member whose payment is
--    still live (succeeded, not yet released) that strands the money: the
--    member is off the roster but the succeeded ledger row is still picked up by
--    lt_release_candidates at close and paid to the organizer, while the player
--    has no spot and no refund. This is the organizer-side twin of the
--    season_withdraw hole closed in 20260721140100.
--
-- 2. There was no organizer-callable refund path at all. season_request_refund
--    is owner-gated (NOT_OWNER unless the caller is the member), so guarding
--    remove without a refund route would just dead-end the organizer. Add
--    season_refund_member: the same withdraw-and-compute-refund shape as
--    season_request_refund, gated on the organizer instead of the owner. The
--    lt-refund-registration edge function runs the Stripe refund from the plan
--    it returns, exactly as for the player path.
--
-- The guard only fires while the money is live (stripe_payout_id IS NULL). A
-- member whose season already closed and settled carries a succeeded-but-
-- released row; removing that roster entry strands nothing, so it stays allowed.

-- --------------------------------------------------------------- 1. the guard
CREATE OR REPLACE FUNCTION public.season_remove_member(
    p_season_member_id uuid,
    p_version_was      integer
)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    season_members;
    v_season    seasons;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM season_members WHERE id = p_season_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_member.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_member.status NOT IN ('enrolled', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REMOVABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- Live money on this enrolment: refuse the plain remove and force the
    -- organizer through season_refund_member so the player gets their money.
    -- Released rows (settled at close) carry no live money and stay removable.
    IF EXISTS (
        SELECT 1 FROM lt_registration_payment
         WHERE season_user_id = v_member.id
           AND status = 'succeeded'
           AND stripe_payout_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REFUND_REQUIRED';
    END IF;

    UPDATE season_members
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'remove_member', v_caller_id,
            jsonb_build_object('season_id', v_row.season_id, 'league_id', v_season.league_id,
                               'user_id', v_row.user_id, 'prev_status', v_member.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_remove_member(uuid, integer) TO authenticated;

-- ------------------------------------------------ 2. organizer refund + remove
-- Mirrors season_request_refund (20260716200400) but gated on the organizer,
-- not the member. Returns the same 8-column plan so lt-refund-registration
-- drives the Stripe refund identically. Refund policy applies to the ENTRY
-- only; the service fee and its tax are never returned.
CREATE OR REPLACE FUNCTION public.season_refund_member(
    p_season_member_id uuid,
    p_version_was      integer
)
RETURNS TABLE (
    payment_id               uuid,
    stripe_payment_intent_id text,
    stripe_charge_id         text,
    payout_timing            payout_timing_enum,
    entry_cents              integer,
    refundable_entry_cents   integer,
    released_transfer_id     text,
    currency                 varchar(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_member season_members;
    v_s      seasons;
    v_pay    lt_registration_payment;
    v_refund integer;
    v_rows   integer;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM season_members WHERE id = p_season_member_id;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENROLLMENT_NOT_FOUND';
    END IF;

    SELECT * INTO v_s FROM seasons WHERE id = v_member.season_id;

    IF NOT (public.is_league_organizer(v_s.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_s.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WITHDRAW_NOT_ALLOWED';
    END IF;

    SELECT * INTO v_pay
      FROM lt_registration_payment
     WHERE season_user_id = p_season_member_id AND status = 'succeeded'
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_pay.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_PAID_ENROLLMENT';
    END IF;

    IF v_s.refund_policy_kind = 'none'
       OR (v_s.refund_cutoff_at IS NOT NULL AND now() > v_s.refund_cutoff_at) THEN
        v_refund := 0;
    ELSIF v_s.refund_policy_kind = 'full' THEN
        v_refund := v_pay.entry_cents;
    ELSE
        v_refund := ROUND(v_pay.entry_cents * COALESCE(v_s.refund_partial_bps, 0) / 10000.0);
    END IF;

    -- Optimistic lock is the double-refund guard: a second call finds the row
    -- already withdrawn / version-bumped and loses.
    UPDATE season_members
       SET status       = 'withdrawn',
           withdrawn_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id      = p_season_member_id
       AND version = p_version_was
       AND status IN ('enrolled', 'pending');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', p_season_member_id, 'organizer_refund', v_caller,
            jsonb_build_object('payment_id', v_pay.id, 'refundable_entry_cents', v_refund,
                               'removed_user_id', v_member.user_id));

    payment_id               := v_pay.id;
    stripe_payment_intent_id := v_pay.stripe_payment_intent_id;
    stripe_charge_id         := v_pay.stripe_charge_id;
    payout_timing            := v_pay.payout_timing;
    entry_cents              := v_pay.entry_cents;
    refundable_entry_cents   := v_refund;
    released_transfer_id     := v_pay.released_transfer_id;
    currency                 := v_pay.currency;

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_refund_member(uuid, integer) TO authenticated;

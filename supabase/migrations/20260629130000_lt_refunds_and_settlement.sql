-- ============================================
-- Leagues & Tournaments — refunds + event-end settlement (Phase 3)
-- ============================================
-- Closes the money loop:
--   • tournament_request_refund   — a paid player withdraws; computes the
--     refundable ENTRY (per policy + cutoff, never the service fee), withdraws
--     the registration, and returns a plan for the edge function to execute the
--     Stripe refund.
--   • lt_release_candidates       — held (hold_until_event_end) payments whose
--     event has COMPLETED, ready to transfer to the organizer.
--   • lt_cancel_refund_candidates — paid payments whose event was CANCELLED,
--     ready to fully refund the entry to players.
--
-- The Stripe money movement lives in the lt-refund-registration (client) and
-- lt-settle-event-payments (cron) edge functions; this migration only models
-- the decisions. The service fee is never refunded in any path.
-- ============================================


-- ============================================
-- tournament_request_refund
--   Caller withdraws a paid registration. Atomically withdraws (optimistic
--   lock dedups double-submit) and returns the refund plan. Refundable is the
--   ENTRY portion only, gated by the organizer's policy + cutoff.
-- ============================================
CREATE OR REPLACE FUNCTION public.tournament_request_refund(
    p_registration_id uuid,
    p_version_was     integer
)
RETURNS TABLE (
    payment_id               uuid,
    stripe_payment_intent_id text,
    stripe_charge_id         text,
    payout_timing            payout_timing_enum,
    entry_cents              integer,
    refundable_entry_cents   integer,
    released_transfer_id     text,
    currency                 varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller     uuid := auth.uid();
    v_reg        tournament_registrations;
    v_t          tournaments;
    v_pay        lt_registration_payment;
    v_refundable integer;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_reg
      FROM tournament_registrations
     WHERE id = p_registration_id AND user_id = v_caller;
    IF v_reg.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournament_registrations WHERE id = p_registration_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_OWNER';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_reg.tournament_id;
    IF v_t.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WITHDRAW_NOT_ALLOWED';
    END IF;

    SELECT * INTO v_pay
      FROM lt_registration_payment
     WHERE tournament_registration_id = v_reg.id AND status = 'succeeded'
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_pay.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_PAID_REGISTRATION';
    END IF;

    -- Refundable ENTRY per policy + cutoff. The service fee is never included.
    IF v_t.refund_policy_kind = 'none'
       OR (v_t.refund_cutoff_at IS NOT NULL AND now() > v_t.refund_cutoff_at) THEN
        v_refundable := 0;
    ELSIF v_t.refund_policy_kind = 'full' THEN
        v_refundable := v_pay.entry_cents;
    ELSE  -- partial
        v_refundable := CAST(
            ROUND(v_pay.entry_cents::numeric * COALESCE(v_t.refund_partial_bps, 0) / 10000.0)
            AS integer);
    END IF;

    -- Withdraw. The version lock makes a double-tap fail the second time, which
    -- is what prevents a double refund.
    UPDATE tournament_registrations
       SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
     WHERE id = v_reg.id
       AND version = p_version_was
       AND status IN ('registered', 'pending', 'waitlisted')
    RETURNING * INTO v_reg;
    IF v_reg.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', p_registration_id, 'withdraw_refund', v_caller,
            jsonb_build_object('payment_id', v_pay.id, 'refundable_entry_cents', v_refundable));

    payment_id               := v_pay.id;
    stripe_payment_intent_id := v_pay.stripe_payment_intent_id;
    stripe_charge_id         := v_pay.stripe_charge_id;
    payout_timing            := v_pay.payout_timing;
    entry_cents              := v_pay.entry_cents;
    refundable_entry_cents   := v_refundable;
    released_transfer_id     := v_pay.released_transfer_id;
    currency                 := v_pay.currency;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_request_refund(uuid, integer) TO authenticated;


-- ============================================
-- Settlement candidate queries (service_role only; called by the cron edge fn)
-- ============================================

-- Held funds whose event has COMPLETED → transfer organizer_amount to organizer.
CREATE OR REPLACE FUNCTION public.lt_release_candidates()
RETURNS TABLE (
    payment_id                  uuid,
    stripe_charge_id            text,
    organizer_id                uuid,
    organizer_amount_cents      integer,
    currency                    varchar,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.payout_timing = 'hold_until_event_end'
       AND p.released_transfer_id IS NULL
       AND p.organizer_amount_cents > 0
       AND p.stripe_charge_id IS NOT NULL
       AND t.status = 'completed';
$$;

GRANT EXECUTE ON FUNCTION public.lt_release_candidates() TO service_role;

-- Paid payments whose event was CANCELLED → full entry refund to the player.
CREATE OR REPLACE FUNCTION public.lt_cancel_refund_candidates()
RETURNS TABLE (
    payment_id               uuid,
    stripe_payment_intent_id text,
    stripe_charge_id         text,
    entry_cents              integer,
    currency                 varchar,
    payout_timing            payout_timing_enum,
    released_transfer_id     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND t.status = 'cancelled';
$$;

GRANT EXECUTE ON FUNCTION public.lt_cancel_refund_candidates() TO service_role;

COMMENT ON FUNCTION public.tournament_request_refund(uuid, integer)
    IS 'Paid-registration withdrawal: withdraws the row and returns the refundable entry (policy + cutoff, never the fee) for the edge function to refund.';
COMMENT ON FUNCTION public.lt_release_candidates()
    IS 'Cron: held payments for COMPLETED tournaments, ready to transfer organizer_amount to the organizer.';
COMMENT ON FUNCTION public.lt_cancel_refund_candidates()
    IS 'Cron: paid payments for CANCELLED tournaments, ready for a full entry refund (fee retained).';

-- Paid seasons: refunds + settlement.
--
-- lt-settle-event-payments/index.ts needs ZERO changes for any of this — its
-- event identity lives entirely in the two candidate RPCs below, and both keep
-- their exact return shapes. Adding a UNION'd season leg is the whole job.
--
-- season_request_refund mirrors tournament_request_refund, including the part
-- that matters most: the service fee and its GST/QST are never refunded, only
-- the entry is, and the optimistic-lock guard on the withdraw is what prevents
-- a double refund.

-- ---------------------------------------------------------------------------
-- Release: pay the organizer out once the season is over.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lt_release_candidates()
 RETURNS TABLE(payment_id uuid, stripe_charge_id text, organizer_id uuid, organizer_amount_cents integer, currency character varying, organizer_stripe_account_id text, organizer_onboarded boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- Tournament leg (unchanged).
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.stripe_payout_id IS NULL
       AND p.organizer_amount_cents > 0
       AND t.status = 'completed'
       AND t.end_date < now() - interval '24 hours'
    UNION ALL
    -- Season leg: a season's "event end" is its close, guarded by the same 24h
    -- settle delay so late corrections/refunds land first.
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.stripe_payout_id IS NULL
       AND p.organizer_amount_cents > 0
       AND s.status = 'closed'
       AND s.closed_at < now() - interval '24 hours';
$function$;

-- ---------------------------------------------------------------------------
-- Cancel refunds: give the entry back when the organizer calls the event off.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lt_cancel_refund_candidates()
 RETURNS TABLE(payment_id uuid, stripe_payment_intent_id text, stripe_charge_id text, entry_cents integer, currency character varying, payout_timing payout_timing_enum, released_transfer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- Tournament leg (unchanged).
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND t.status = 'cancelled'
    UNION ALL
    -- Season leg: this is why season_status needed a 'cancelled' value at all.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND s.status = 'cancelled';
$function$;

-- ---------------------------------------------------------------------------
-- season_request_refund — the withdraw-with-refund path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_request_refund(
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

    IF v_member.user_id <> v_caller THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_OWNER';
    END IF;

    SELECT * INTO v_s FROM seasons WHERE id = v_member.season_id;
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

    -- Refund policy applies to the ENTRY only. The service fee and the GST/QST
    -- on it are never returned (20260710210000): Rallia has already remitted it.
    IF v_s.refund_policy_kind = 'none'
       OR (v_s.refund_cutoff_at IS NOT NULL AND now() > v_s.refund_cutoff_at) THEN
        v_refund := 0;
    ELSIF v_s.refund_policy_kind = 'full' THEN
        v_refund := v_pay.entry_cents;
    ELSE
        v_refund := ROUND(v_pay.entry_cents * COALESCE(v_s.refund_partial_bps, 0) / 10000.0);
    END IF;

    -- The optimistic lock here is the double-refund guard: a second concurrent
    -- request finds the row already withdrawn / version-bumped and loses.
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
    VALUES ('membership', p_season_member_id, 'withdraw_refund', v_caller,
            jsonb_build_object('payment_id', v_pay.id, 'refundable_entry_cents', v_refund));

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

GRANT EXECUTE ON FUNCTION public.season_request_refund(uuid, integer) TO authenticated;

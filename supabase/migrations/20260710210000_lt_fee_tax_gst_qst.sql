-- ============================================================================
-- GST/QST (TPS/TVQ) on Rallia's service fee.
--
-- Rallia is GST/QST-registered, so tax is owed on its platform service fee
-- from the first dollar. Position (pending accountant confirmation): the fee
-- customer is the ORGANIZER in both fee_payer modes — Rallia supplies a
-- platform service to the organizer and takes fee + tax off the destination
-- charge via application_fee_amount. Entry-fee tax stays the organizer's
-- (they are the merchant of record); Rallia never taxes the entry.
--
--   player_pays       → player charged entry + fee + tax; organizer gets entry.
--   organizer_absorbs → player charged entry; organizer gets entry − fee − tax.
--
-- v0 rate: QC-only constant 14.975% (TPS 5% + TVQ 9.975%). Paid registration
-- is admin-gated and organizers are all Québec-based; when that changes, the
-- rate becomes f(organizer province) — swap the constant for a lookup here.
-- ============================================================================

-- Tax (cents) on a service fee, half-up like the fee math itself.
CREATE OR REPLACE FUNCTION public.compute_fee_tax_cents(p_fee_cents integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CAST(ROUND(GREATEST(COALESCE(p_fee_cents, 0), 0)::numeric * 14975 / 100000.0) AS integer);
$$;

COMMENT ON FUNCTION public.compute_fee_tax_cents(integer)
    IS 'GST+QST (14.975%) on the platform service fee, half-up. QC-only constant in v0; keyed to organizer province later. TS mirror is display-only.';

GRANT EXECUTE ON FUNCTION public.compute_fee_tax_cents(integer) TO authenticated;


-- Ledger: snapshot the tax alongside the fee it rides on.
ALTER TABLE public.lt_registration_payment
    ADD COLUMN IF NOT EXISTS fee_tax_cents integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE public.lt_registration_payment
        ADD CONSTRAINT lt_registration_payment_fee_tax_pos CHECK (fee_tax_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.lt_registration_payment.fee_tax_cents IS 'GST+QST charged on service_fee_cents (Rallia remits). Collected with the fee via application_fee_amount; never refunded (rides with the non-refundable fee).';
COMMENT ON COLUMN public.lt_registration_payment.amount_charged_cents IS 'Total charged to the player (entry + fee + fee tax for player_pays, entry for organizer_absorbs).';
COMMENT ON COLUMN public.lt_registration_payment.organizer_amount_cents IS 'Amount the organizer ultimately receives (entry for player_pays, entry - fee - fee tax for organizer_absorbs).';


-- ---------------------------------------------------------------------------
-- tournament_fee_quote: add fee_tax_cents to the breakdown.
-- Return shape changes → must drop first (grants re-applied below).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tournament_fee_quote(uuid);

CREATE FUNCTION public.tournament_fee_quote(p_tournament_id uuid)
RETURNS TABLE (
    entry_cents              integer,
    service_fee_cents        integer,
    fee_tax_cents            integer,   -- GST+QST on the service fee
    total_cents              integer,   -- what the player is charged
    organizer_receives_cents integer,
    fee_payer                fee_payer_enum,
    currency                 varchar,
    refund_policy_kind       refund_policy_kind_enum,
    refund_partial_bps       integer,
    refund_cutoff_at         timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t       public.tournaments;
    pol     record;
    fee     integer;
    fee_tax integer;
BEGIN
    SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id;
    IF t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    SELECT * INTO pol FROM public.resolve_service_fee_policy(
        t.organizer_id, t.fee_pct_bps_override, t.fee_flat_cents_override, t.fee_cap_cents_override
    );

    fee     := public.compute_service_fee_cents(t.entry_fee_cents, pol.pct_bps, pol.flat_cents, pol.cap_cents);
    fee_tax := public.compute_fee_tax_cents(fee);

    entry_cents       := t.entry_fee_cents;
    service_fee_cents := fee;
    fee_tax_cents     := fee_tax;
    IF t.fee_payer = 'player_pays' THEN
        total_cents              := t.entry_fee_cents + fee + fee_tax;
        organizer_receives_cents := t.entry_fee_cents;
    ELSE
        total_cents              := t.entry_fee_cents;
        organizer_receives_cents := GREATEST(t.entry_fee_cents - fee - fee_tax, 0);
    END IF;
    fee_payer          := t.fee_payer;
    currency           := t.currency;
    refund_policy_kind := t.refund_policy_kind;
    refund_partial_bps := t.refund_partial_bps;
    refund_cutoff_at   := t.refund_cutoff_at;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.tournament_fee_quote(uuid)
    IS 'All-in price breakdown for a tournament registration (entry, service fee, fee tax, total, organizer take, refund policy).';

GRANT EXECUTE ON FUNCTION public.tournament_fee_quote(uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- tournament_begin_paid_registration: compute + snapshot + return the fee tax.
-- Body otherwise identical to 20260629150000 (invite-claim support kept).
-- Return shape changes → must drop first (grants re-applied below).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tournament_begin_paid_registration(uuid, uuid);

CREATE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    organizer_amount_cents      integer,
    fee_payer                   fee_payer_enum,
    payout_timing               payout_timing_enum,
    currency                    varchar,
    organizer_id                uuid,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_t        tournaments;
    v_pol      record;
    v_fee      integer;
    v_fee_tax  integer;
    v_total    integer;
    v_org      integer;
    v_active   integer;
    v_existing tournament_registrations;
    v_reg      tournament_registrations;
    v_psa      player_stripe_account;
    v_pay_id   uuid;
    v_is_invite_accept boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_t.sport_id);

    IF v_t.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;
    IF v_t.entry_fee_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_PAID';
    END IF;

    -- The caller's existing row, resolved up-front. An outstanding organizer
    -- invite (pending + invited_by) lets them pay to claim the reserved slot,
    -- even when the tournament isn't in 'open' registration mode.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    v_is_invite_accept := v_existing.id IS NOT NULL
                          AND v_existing.status = 'pending'
                          AND v_existing.invited_by IS NOT NULL;

    -- Paid approval flows (pay vs. approval ordering) are a later slice; the one
    -- non-open path supported here is claiming an organizer invite.
    IF v_t.registration_mode <> 'open' AND NOT v_is_invite_accept THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAID_REG_MODE_UNSUPPORTED';
    END IF;

    -- Capacity: count everyone else's live slots (active or a non-expired
    -- pending payment). The caller's own row never blocks them.
    SELECT count(*) INTO v_active
      FROM tournament_registrations tr
      LEFT JOIN lt_registration_payment p
        ON p.tournament_registration_id = tr.id AND p.status = 'pending'
     WHERE tr.tournament_id = p_tournament_id
       AND tr.user_id <> v_caller
       AND (
            tr.status IN ('registered', 'pending')
            OR (tr.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
       );
    IF v_active >= v_t.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    -- Reuse the caller's existing row if present; block if already confirmed or a
    -- non-invite pending (e.g. approval-mode self-register awaiting the organizer).
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'registered'
           OR (v_existing.status = 'pending' AND NOT v_is_invite_accept) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
        UPDATE tournament_registrations
           SET status          = 'payment_pending',
               partner_user_id = p_partner_user_id,
               withdrawn_at    = NULL,
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_reg;

        -- Supersede any still-open pending payment for this registration.
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE tournament_registration_id = v_reg.id AND status = 'pending';
    ELSE
        INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
        VALUES (p_tournament_id, v_caller, p_partner_user_id, 'payment_pending')
        RETURNING * INTO v_reg;
    END IF;

    -- Resolve the effective fee (+ tax on it) and snapshot the breakdown.
    SELECT * INTO v_pol FROM public.resolve_service_fee_policy(
        v_t.organizer_id, v_t.fee_pct_bps_override, v_t.fee_flat_cents_override, v_t.fee_cap_cents_override);
    v_fee     := public.compute_service_fee_cents(v_t.entry_fee_cents, v_pol.pct_bps, v_pol.flat_cents, v_pol.cap_cents);
    v_fee_tax := public.compute_fee_tax_cents(v_fee);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_t.entry_fee_cents + v_fee + v_fee_tax;
        v_org   := v_t.entry_fee_cents;
    ELSE
        v_total := v_t.entry_fee_cents;
        v_org   := GREATEST(v_t.entry_fee_cents - v_fee - v_fee_tax, 0);
    END IF;

    INSERT INTO lt_registration_payment (
        tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_fee_tax, v_t.fee_payer,
        v_total, v_org, v_t.currency,
        v_t.payout_timing, 'pending', now() + interval '15 minutes'
    ) RETURNING id INTO v_pay_id;

    SELECT * INTO v_psa FROM player_stripe_account WHERE player_id = v_t.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_reg.id, 'begin_paid_registration', v_caller,
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total, 'invite_accept', v_is_invite_accept));

    payment_id                  := v_pay_id;
    registration_id             := v_reg.id;
    entry_cents                 := v_t.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_fee_tax;
    amount_charged_cents        := v_total;
    organizer_amount_cents      := v_org;
    fee_payer                   := v_t.fee_payer;
    payout_timing               := v_t.payout_timing;
    currency                    := v_t.currency;
    organizer_id                := v_t.organizer_id;
    organizer_stripe_account_id := v_psa.stripe_account_id;
    organizer_onboarded         := COALESCE(v_psa.onboarding_completed, false);
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid) TO authenticated;

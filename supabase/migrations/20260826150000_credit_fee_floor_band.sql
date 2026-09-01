-- Fee-floor band for partial credit redemption. Stripe refuses a
-- PaymentIntent whose amount is below its application_fee_amount, so a
-- partial credit draw must never leave 0 < charge < fee+tax. The rule:
-- full cover is always allowed (charge 0 skips Stripe entirely); a partial
-- draw is capped at total - fee - tax. Unreachable on prod today (house
-- fee is 0) — this makes the invariant true instead of circumstantial.
-- Quote previews mirror the same band so the UI never over-promises.

-- Reserve up to p_cap (banded) from the player's credits, oldest first,
-- against one payment. Locks the credit rows so concurrent begins
-- serialize and can't double-spend. The band: full cover is allowed, but a
-- PARTIAL draw must leave at least the payment's fee+tax to charge —
-- Stripe refuses a PaymentIntent whose amount is below its
-- application_fee_amount. The floor comes from the ledger row itself, so
-- callers stay unchanged; it is 0 wherever the fee is 0 (house policy).
CREATE OR REPLACE FUNCTION public.reserve_player_credit(p_player uuid, p_payment_id uuid, p_cap integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_floor    integer := 0;
    v_avail    integer := 0;
    v_row      integer;
    v_target   integer;
    v_reserved integer := 0;
    v_take     integer;
    rec        record;
BEGIN
    IF p_cap IS NULL OR p_cap <= 0 THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(service_fee_cents, 0) + COALESCE(fee_tax_cents, 0)
      INTO v_floor
      FROM public.lt_registration_payment
     WHERE id = p_payment_id;
    v_floor := COALESCE(v_floor, 0);

    -- First pass: lock every live credit row and total the availability.
    FOR rec IN
        SELECT id, amount_cents
          FROM public.player_credit
         WHERE player_id = p_player
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY granted_at
           FOR UPDATE
    LOOP
        SELECT rec.amount_cents - COALESCE(SUM(amount_cents), 0)
          INTO v_row
          FROM public.player_credit_redemption
         WHERE credit_id = rec.id AND status IN ('pending', 'redeemed');
        v_avail := v_avail + GREATEST(v_row, 0);
    END LOOP;

    v_target := CASE
        WHEN v_avail >= p_cap THEN p_cap
        ELSE LEAST(v_avail, GREATEST(p_cap - v_floor, 0))
    END;
    IF v_target <= 0 THEN
        RETURN 0;
    END IF;

    -- Second pass over the same (already locked) rows: draw FIFO.
    FOR rec IN
        SELECT id, amount_cents
          FROM public.player_credit
         WHERE player_id = p_player
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY granted_at
    LOOP
        SELECT rec.amount_cents - COALESCE(SUM(amount_cents), 0)
          INTO v_row
          FROM public.player_credit_redemption
         WHERE credit_id = rec.id AND status IN ('pending', 'redeemed');
        v_take := LEAST(GREATEST(v_row, 0), v_target - v_reserved);
        IF v_take > 0 THEN
            INSERT INTO public.player_credit_redemption (credit_id, payment_id, amount_cents)
            VALUES (rec.id, p_payment_id, v_take);
            v_reserved := v_reserved + v_take;
        END IF;
        EXIT WHEN v_reserved >= v_target;
    END LOOP;
    RETURN v_reserved;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reserve_player_credit(uuid, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_player_credit(uuid, uuid, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.tournament_fee_quote(p_tournament_id uuid)
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
    refund_cutoff_at         timestamptz,
    credit_applicable_cents  integer
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

    -- Preview only: the begin RPC re-resolves and reserves under lock.
    -- Banded like the reserve: full cover, or leave at least fee+tax to
    -- charge — Stripe refuses an amount below its application fee.
    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = t.organizer_id AND pr.is_house_organizer) THEN
        credit_applicable_cents := public.player_credit_available_cents(auth.uid());
        IF credit_applicable_cents >= total_cents THEN
            credit_applicable_cents := total_cents;
        ELSE
            credit_applicable_cents := LEAST(credit_applicable_cents, GREATEST(total_cents - fee - fee_tax, 0));
        END IF;
    END IF;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_fee_quote(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.season_fee_quote(p_season_id uuid)
RETURNS TABLE (
    entry_cents             integer,
    service_fee_cents       integer,
    fee_tax_cents           integer,
    total_cents             integer,
    organizer_receives_cents integer,
    fee_payer               fee_payer_enum,
    currency                varchar(3),
    refund_policy_kind      refund_policy_kind_enum,
    refund_partial_bps      integer,
    refund_cutoff_at        timestamptz,
    credit_applicable_cents integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_s      seasons;
    v_org    uuid;
    v_pct    integer;
    v_flat   integer;
    v_cap    integer;
    v_fee    integer;
    v_tax    integer;
BEGIN
    SELECT * INTO v_s FROM seasons WHERE id = p_season_id;
    IF v_s.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT l.organizer_id INTO v_org FROM leagues l WHERE l.id = v_s.league_id;

    SELECT p.pct_bps, p.flat_cents, p.cap_cents
      INTO v_pct, v_flat, v_cap
      FROM public.resolve_service_fee_policy(
             v_org, v_s.fee_pct_bps_override, v_s.fee_flat_cents_override, v_s.fee_cap_cents_override) p;

    v_fee := public.compute_service_fee_cents(v_s.entry_fee_cents, v_pct, v_flat, v_cap);
    v_tax := public.compute_fee_tax_cents(v_fee);

    entry_cents        := v_s.entry_fee_cents;
    service_fee_cents  := v_fee;
    fee_tax_cents      := v_tax;
    fee_payer          := v_s.fee_payer;
    currency           := v_s.currency;
    refund_policy_kind := v_s.refund_policy_kind;
    refund_partial_bps := v_s.refund_partial_bps;
    refund_cutoff_at   := v_s.refund_cutoff_at;

    -- The fee customer is the organizer in both modes; Rallia never taxes entry.
    IF v_s.fee_payer = 'player_pays' THEN
        total_cents              := v_s.entry_fee_cents + v_fee + v_tax;
        organizer_receives_cents := v_s.entry_fee_cents;
    ELSE
        total_cents              := v_s.entry_fee_cents;
        organizer_receives_cents := GREATEST(v_s.entry_fee_cents - v_fee - v_tax, 0);
    END IF;

    -- Banded like the reserve: full cover, or leave at least fee+tax to charge.
    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_org AND pr.is_house_organizer) THEN
        credit_applicable_cents := public.player_credit_available_cents(auth.uid());
        IF credit_applicable_cents >= total_cents THEN
            credit_applicable_cents := total_cents;
        ELSE
            credit_applicable_cents := LEAST(credit_applicable_cents, GREATEST(total_cents - v_fee - v_tax, 0));
        END IF;
    END IF;

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_fee_quote(uuid) TO authenticated;

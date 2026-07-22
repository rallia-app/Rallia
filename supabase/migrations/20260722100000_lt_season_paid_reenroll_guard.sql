-- A removed season member could buy their way back in.
--
-- season_begin_paid_enrollment (20260716200100) predates the 'disqualified'
-- member status (20260721160000) and only refuses re-entry when the existing
-- row is 'enrolled'. A member the organizer removed via season_remove_member
-- (20260721160100) sits at 'disqualified', so they fell through to the reuse
-- branch, got flipped to 'payment_pending', paid, and the webhook flip to
-- 'enrolled' passed tg_season_member_requires_payment — which resolves "paid"
-- by (season_id, user_id) having a succeeded payment, and the removed member's
-- original (about-to-be-refunded) payment still qualifies until the cron runs.
--
-- The tournament leg already blocks this: tournament_begin_paid_registration
-- raises REGISTRATION_REMOVED on a disqualified row (20260721130200). Mirror it
-- here with ENROLLMENT_REMOVED (season vocabulary, like ALREADY_ENROLLED).
--
-- Re-emitted from the 20260716200100 body with the guard added, plus one
-- repair the regression test surfaced: the reuse branch's supersede UPDATE
-- referenced season_user_id unqualified, which collides with the OUT param of
-- the same name and made every retry after a voluntary exit fail at runtime.

CREATE OR REPLACE FUNCTION public.season_begin_paid_enrollment(p_season_id uuid)
RETURNS TABLE (
    payment_id                  uuid,
    season_user_id              uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    organizer_amount_cents      integer,
    fee_payer                   fee_payer_enum,
    payout_timing               payout_timing_enum,
    currency                    varchar(3),
    organizer_id                uuid,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_s      seasons;
    v_league leagues;
    v_member season_members;
    v_pct    integer;
    v_flat   integer;
    v_cap    integer;
    v_fee    integer;
    v_tax    integer;
    v_charge integer;
    v_org_amt integer;
    v_pay_id uuid;
    v_acct   record;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_s FROM seasons WHERE id = p_season_id;
    IF v_s.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_s.league_id;

    IF v_s.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    IF v_s.entry_fee_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_PAID';
    END IF;

    -- Same eligibility gate as season_enroll.
    IF NOT (public.is_league_organizer(v_s.league_id)
            OR public.is_admin()
            OR public.is_active_league_member(v_s.league_id)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LEAGUE_MEMBER';
    END IF;

    SELECT * INTO v_member FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller
     FOR UPDATE;

    -- Organizer-removed members are blocked permanently, as on the tournament
    -- side; without this the reuse branch below re-admits them.
    IF v_member.id IS NOT NULL AND v_member.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENROLLMENT_REMOVED';
    END IF;

    IF v_member.id IS NOT NULL AND v_member.status = 'enrolled' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_ENROLLED';
    END IF;

    SELECT p.pct_bps, p.flat_cents, p.cap_cents INTO v_pct, v_flat, v_cap
      FROM public.resolve_service_fee_policy(
             v_league.organizer_id, v_s.fee_pct_bps_override,
             v_s.fee_flat_cents_override, v_s.fee_cap_cents_override) p;

    v_fee := public.compute_service_fee_cents(v_s.entry_fee_cents, v_pct, v_flat, v_cap);
    v_tax := public.compute_fee_tax_cents(v_fee);

    IF v_s.fee_payer = 'player_pays' THEN
        v_charge  := v_s.entry_fee_cents + v_fee + v_tax;
        v_org_amt := v_s.entry_fee_cents;
    ELSE
        v_charge  := v_s.entry_fee_cents;
        v_org_amt := GREATEST(v_s.entry_fee_cents - v_fee - v_tax, 0);
    END IF;

    -- Claim the slot at payment_pending (the trigger above permits exactly this).
    IF v_member.id IS NULL THEN
        INSERT INTO season_members (season_id, user_id, status)
        VALUES (p_season_id, v_caller, 'payment_pending')
        RETURNING * INTO v_member;
    ELSE
        UPDATE season_members
           SET status       = 'payment_pending',
               withdrawn_at = NULL,
               version      = version + 1,
               updated_at   = now()
         WHERE id = v_member.id
        RETURNING * INTO v_member;

        -- Supersede any still-pending attempt so only one reservation is live.
        -- Qualified: season_user_id alone is ambiguous against the OUT param.
        UPDATE lt_registration_payment p
           SET status = 'cancelled', updated_at = now()
         WHERE p.season_user_id = v_member.id AND p.status = 'pending';
    END IF;

    INSERT INTO lt_registration_payment (
        season_id, season_user_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        p_season_id, v_member.id, v_caller, v_league.organizer_id,
        v_s.entry_fee_cents, v_fee, v_tax, v_s.fee_payer,
        v_charge, v_org_amt, v_s.currency,
        v_s.payout_timing, 'pending', now() + interval '15 minutes'
    )
    RETURNING id INTO v_pay_id;

    SELECT psa.stripe_account_id, psa.onboarding_completed INTO v_acct
      FROM player_stripe_account psa
     WHERE psa.player_id = v_league.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_member.id, 'begin_paid_enrollment', v_caller,
            jsonb_build_object('season_id', p_season_id, 'payment_id', v_pay_id));

    payment_id                  := v_pay_id;
    season_user_id              := v_member.id;
    entry_cents                 := v_s.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_tax;
    amount_charged_cents        := v_charge;
    organizer_amount_cents      := v_org_amt;
    fee_payer                   := v_s.fee_payer;
    payout_timing               := v_s.payout_timing;
    currency                    := v_s.currency;
    organizer_id                := v_league.organizer_id;
    organizer_stripe_account_id := v_acct.stripe_account_id;
    organizer_onboarded         := COALESCE(v_acct.onboarding_completed, false);

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_begin_paid_enrollment(uuid) TO authenticated;

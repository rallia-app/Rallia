-- Credit layering cleanup (items 3+4 of the architecture review):
--
-- 3. reserve_player_credit no longer reads lt_registration_payment for its
--    fee floor — the callers pass it. The credit primitive stops knowing
--    about the payment domain.
-- 4. The begin RPCs reserve BEFORE the ledger insert, against a
--    pre-generated payment id, so the ledger row is written exactly once
--    with final amounts instead of insert-full-then-update-down. The
--    redemption->payment FK becomes DEFERRABLE INITIALLY DEFERRED to allow
--    that ordering inside the transaction; it is checked at commit as before.
--
-- No behavior change: same amounts, same locks, same band.

ALTER TABLE public.player_credit_redemption
    DROP CONSTRAINT player_credit_redemption_payment_id_fkey,
    ADD CONSTRAINT player_credit_redemption_payment_id_fkey
        FOREIGN KEY (payment_id) REFERENCES public.lt_registration_payment(id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

DROP FUNCTION public.reserve_player_credit(uuid, uuid, integer);

-- Reserve up to the banded cap from the player's credits, oldest first,
-- against one payment (whose ledger row may not exist yet — the FK is
-- deferred). Locks the credit rows so concurrent begins serialize and can't
-- double-spend. p_floor is the payment's fee+tax: a partial draw leaves at
-- least that much to charge (Stripe refuses amount < application fee); full
-- cover is always allowed. Returns what was actually reserved.
CREATE FUNCTION public.reserve_player_credit(p_player uuid, p_payment_id uuid, p_cap integer, p_floor integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
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

    v_target := public.credit_band_cap(v_avail, p_cap, COALESCE(p_floor, 0));
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

REVOKE ALL ON FUNCTION public.reserve_player_credit(uuid, uuid, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_player_credit(uuid, uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid    DEFAULT NULL,
    p_terms_version   integer DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    credit_applied_cents        integer,
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
    v_credit   integer := 0;
    v_is_invite_accept boolean := false;
    v_is_doubles     boolean;
    v_is_admin       boolean;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Participation terms. Gate OFF: NULL passes (pre-checkbox clients). A
    -- client that sends a version vouches the player accepted THAT text, so a
    -- stale one is refused before any row is written. Flip point: see header.
    IF p_terms_version IS NOT NULL
       AND p_terms_version <> (SELECT max(version) FROM lt_participation_terms) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TERMS_ACCEPTANCE_REQUIRED';
    END IF;

    -- Row-lock so the capacity count below and the reservation can't race.
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
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

    -- ---------------------------------------------- partner / entry format
    v_is_doubles := v_t.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_user_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_user_id = v_caller
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_user_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_user_id
               AND ps.sport_id  = v_t.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        -- Already in a live entry, as captain or partner. 'Live' includes a
        -- payment still in its window, matching the capacity rule below: an
        -- expired reservation frees the player once the reaper clears it.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id = p_tournament_id
               AND (r.user_id = p_partner_user_id OR r.partner_user_id = p_partner_user_id)
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
        -- UNIQUE(tournament_id, user_id) only covers captains, so check the
        -- caller isn't already somebody else's partner.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id   = p_tournament_id
               AND r.partner_user_id = v_caller
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
    END IF;

    -- ------------------------------------------------- hard rating-band gate
    -- Same rule as tournament_register: organizers live by the band they set,
    -- admins bypass as a support override, and both members of a doubles entry
    -- are checked. Runs before any row is written so nobody pays to be refused.
    v_is_admin := public.is_admin();

    IF NOT v_is_admin THEN
        PERFORM public.lt_assert_rating_band(
            v_caller, v_t.sport_id, v_t.min_rating, v_t.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_user_id, v_t.sport_id, v_t.min_rating, v_t.max_rating, true);
        END IF;
    END IF;

    -- The caller's existing row. An outstanding organizer invite (pending +
    -- invited_by) lets them pay to claim the reserved slot even when the
    -- tournament isn't in 'open' registration mode.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    v_is_invite_accept := v_existing.id IS NOT NULL
                          AND v_existing.status = 'pending'
                          AND v_existing.invited_by IS NOT NULL;

    -- Organizer-removed players are blocked permanently, as in the free path.
    -- Checked before capacity so they get REGISTRATION_REMOVED, not
    -- TOURNAMENT_FULL.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

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
               terms_version   = p_terms_version,
               terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END,
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
        INSERT INTO tournament_registrations (
            tournament_id, user_id, partner_user_id, status,
            terms_version, terms_accepted_at
        )
        VALUES (
            p_tournament_id, v_caller, p_partner_user_id, 'payment_pending',
            p_terms_version, CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END
        )
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

    -- Referral credit — Rallia-run (house) events only. Reserved BEFORE the
    -- ledger insert against a pre-generated payment id (the redemption FK is
    -- deferred), so the ledger row is written exactly once, with final
    -- amounts. reserve_player_credit locks the credit rows, so two
    -- concurrent registrations can't double-spend; the floor keeps a partial
    -- draw clear of Stripe's application-fee minimum.
    v_pay_id := gen_random_uuid();
    IF EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_t.organizer_id AND pr.is_house_organizer) THEN
        v_credit := public.reserve_player_credit(v_caller, v_pay_id, v_total, v_fee + v_fee_tax);
        IF v_credit > 0 THEN
            v_total := v_total - v_credit;
            v_org   := GREATEST(v_org - v_credit, 0);
        END IF;
    END IF;

    INSERT INTO lt_registration_payment (
        id, tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, credit_applied_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_pay_id, v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_fee_tax, v_t.fee_payer,
        v_total, v_credit, v_org, v_t.currency,
        v_t.payout_timing, 'pending', now() + interval '15 minutes'
    );

    SELECT * INTO v_psa FROM player_stripe_account WHERE player_id = v_t.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_reg.id, 'begin_paid_registration', v_caller,
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total, 'invite_accept', v_is_invite_accept,
                               'terms_version', p_terms_version));

    payment_id                  := v_pay_id;
    registration_id             := v_reg.id;
    entry_cents                 := v_t.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_fee_tax;
    amount_charged_cents        := v_total;
    credit_applied_cents        := v_credit;
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

CREATE OR REPLACE FUNCTION public.season_begin_paid_enrollment(
    p_season_id     uuid,
    p_terms_version integer DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    season_user_id              uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    credit_applied_cents        integer,
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
    v_credit integer := 0;
    v_acct   record;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Participation terms. Gate OFF: NULL passes (pre-checkbox clients). A
    -- client that sends a version vouches the player accepted THAT text, so a
    -- stale one is refused before any row is written. Flip point: see header.
    IF p_terms_version IS NOT NULL
       AND p_terms_version <> (SELECT max(version) FROM lt_participation_terms) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TERMS_ACCEPTANCE_REQUIRED';
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
        INSERT INTO season_members (season_id, user_id, status, terms_version, terms_accepted_at)
        VALUES (p_season_id, v_caller, 'payment_pending',
                p_terms_version, CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END)
        RETURNING * INTO v_member;
    ELSE
        UPDATE season_members
           SET status       = 'payment_pending',
               terms_version = p_terms_version,
               terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END,
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

    -- Referral credit: Rallia-run (house) events only (see tournament twin) —
    -- reserved before the single ledger insert against a pre-generated id.
    v_pay_id := gen_random_uuid();
    IF EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_league.organizer_id AND pr.is_house_organizer) THEN
        v_credit := public.reserve_player_credit(v_caller, v_pay_id, v_charge, v_fee + v_tax);
        IF v_credit > 0 THEN
            v_charge  := v_charge - v_credit;
            v_org_amt := GREATEST(v_org_amt - v_credit, 0);
        END IF;
    END IF;

    INSERT INTO lt_registration_payment (
        id, season_id, season_user_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, credit_applied_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_pay_id, p_season_id, v_member.id, v_caller, v_league.organizer_id,
        v_s.entry_fee_cents, v_fee, v_tax, v_s.fee_payer,
        v_charge, v_credit, v_org_amt, v_s.currency,
        v_s.payout_timing, 'pending', now() + interval '15 minutes'
    );

    SELECT psa.stripe_account_id, psa.onboarding_completed INTO v_acct
      FROM player_stripe_account psa
     WHERE psa.player_id = v_league.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_member.id, 'begin_paid_enrollment', v_caller,
            jsonb_build_object('season_id', p_season_id, 'payment_id', v_pay_id,
                               'terms_version', p_terms_version));

    payment_id                  := v_pay_id;
    season_user_id              := v_member.id;
    entry_cents                 := v_s.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_tax;
    amount_charged_cents        := v_charge;
    credit_applied_cents        := v_credit;
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

GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_begin_paid_enrollment(uuid, integer) TO authenticated;

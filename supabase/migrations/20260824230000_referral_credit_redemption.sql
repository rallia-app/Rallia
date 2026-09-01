-- Referral-credit redemption (phase 2 of the $10 credit, decided 2026-08-24):
-- credits apply ONLY on Rallia-run (house organizer) events, so redemption is
-- a straight discount on Rallia's own revenue — no organizer-payout top-ups.
-- Partial redemption is supported; refund semantics: organizer-cancelled
-- ('refunded') re-credits, player forfeit (no status change) burns nothing
-- extra, 'partially_refunded' deliberately leaves the redemption spent.
--
-- The house account is marked by profile.is_house_organizer — a per-env data
-- step (UPDATE by the house account's id) ships separately; until it's set
-- the whole feature is inert.

ALTER TABLE public.profile
    ADD COLUMN IF NOT EXISTS is_house_organizer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profile.is_house_organizer IS
  'Rallia-run (house) organizer account: player credits redeem only on its events.';

ALTER TABLE public.lt_registration_payment
    ADD COLUMN IF NOT EXISTS credit_applied_cents integer NOT NULL DEFAULT 0;

CREATE TABLE public.player_credit_redemption (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_id    uuid NOT NULL REFERENCES public.player_credit(id) ON DELETE RESTRICT,
    payment_id   uuid NOT NULL REFERENCES public.lt_registration_payment(id) ON DELETE RESTRICT,
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    -- pending: reserved by an open payment; redeemed: payment succeeded;
    -- released: payment died (cancelled/failed/expired/superseded) or was
    -- refunded by the organizer — the amount returns to the balance.
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','redeemed','released')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_redemption_credit  ON public.player_credit_redemption (credit_id);
CREATE INDEX idx_credit_redemption_payment ON public.player_credit_redemption (payment_id);

ALTER TABLE public.player_credit_redemption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view own credit redemptions"
  ON public.player_credit_redemption FOR SELECT
  TO authenticated
  USING (credit_id IN (SELECT id FROM public.player_credit WHERE player_id = (SELECT auth.uid())));

GRANT SELECT ON public.player_credit_redemption TO authenticated;
GRANT ALL ON public.player_credit_redemption TO service_role;

-- Available balance: non-expired credits minus their live draws.
CREATE OR REPLACE FUNCTION public.player_credit_available_cents(p_player uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_avail integer;
BEGIN
    IF auth.uid() IS NOT NULL AND p_player IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FORBIDDEN';
    END IF;
    SELECT COALESCE(SUM(GREATEST(c.amount_cents - COALESCE(r.drawn, 0), 0)), 0)
      INTO v_avail
      FROM public.player_credit c
      LEFT JOIN (
            SELECT credit_id, SUM(amount_cents) AS drawn
              FROM public.player_credit_redemption
             WHERE status IN ('pending', 'redeemed')
             GROUP BY credit_id
      ) r ON r.credit_id = c.id
     WHERE c.player_id = p_player
       AND (c.expires_at IS NULL OR c.expires_at > now());
    RETURN v_avail;
END;
$fn$;

REVOKE ALL ON FUNCTION public.player_credit_available_cents(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.player_credit_available_cents(uuid) TO authenticated, service_role;

-- Reserve up to p_cap from the caller's credits (oldest first) against one
-- payment. Locks the credit rows, so concurrent begins serialize here and
-- can't double-spend. Returns what was actually reserved.
CREATE OR REPLACE FUNCTION public.reserve_player_credit(p_player uuid, p_payment_id uuid, p_cap integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_reserved integer := 0;
    v_avail    integer;
    v_take     integer;
    rec        record;
BEGIN
    IF p_cap IS NULL OR p_cap <= 0 THEN
        RETURN 0;
    END IF;
    FOR rec IN
        SELECT id, amount_cents
          FROM public.player_credit
         WHERE player_id = p_player
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY granted_at
           FOR UPDATE
    LOOP
        SELECT rec.amount_cents - COALESCE(SUM(amount_cents), 0)
          INTO v_avail
          FROM public.player_credit_redemption
         WHERE credit_id = rec.id AND status IN ('pending', 'redeemed');
        v_take := LEAST(v_avail, p_cap - v_reserved);
        IF v_take > 0 THEN
            INSERT INTO public.player_credit_redemption (credit_id, payment_id, amount_cents)
            VALUES (rec.id, p_payment_id, v_take);
            v_reserved := v_reserved + v_take;
        END IF;
        EXIT WHEN v_reserved >= p_cap;
    END LOOP;
    RETURN v_reserved;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reserve_player_credit(uuid, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_player_credit(uuid, uuid, integer) TO service_role;

-- Every path that ends a payment flips its ledger status (webhook, reaper,
-- supersede, refunds), so this one trigger is the whole redemption lifecycle.
CREATE OR REPLACE FUNCTION public.trg_lt_payment_credit_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF NEW.status = 'succeeded' THEN
        UPDATE public.player_credit_redemption
           SET status = 'redeemed', updated_at = now()
         WHERE payment_id = NEW.id AND status = 'pending';
    ELSIF NEW.status IN ('cancelled', 'failed') THEN
        UPDATE public.player_credit_redemption
           SET status = 'released', updated_at = now()
         WHERE payment_id = NEW.id AND status = 'pending';
    ELSIF NEW.status = 'refunded' THEN
        -- Organizer-cancelled: the credit part returns to the balance.
        UPDATE public.player_credit_redemption
           SET status = 'released', updated_at = now()
         WHERE payment_id = NEW.id AND status IN ('pending', 'redeemed');
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER lt_payment_credit_sync
    AFTER UPDATE OF status ON public.lt_registration_payment
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION public.trg_lt_payment_credit_sync();


-- =========================================================================
-- Amended copies of the LATEST bodies (20260814140000 / 20260710210000 /
-- 20260716200100) with the credit block added — nothing else changed.
-- =========================================================================

-- ------------------------------------------- 3a. tournament paid entry RPC
DROP FUNCTION IF EXISTS public.tournament_begin_paid_registration(uuid, uuid, integer);

CREATE FUNCTION public.tournament_begin_paid_registration(
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

    -- $10 referral credit: Rallia-run (house) events only. reserve_player_credit
    -- locks the credit rows, so two concurrent registrations can't double-spend;
    -- the charge drops by whatever it actually reserved.
    IF EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_t.organizer_id AND pr.is_house_organizer) THEN
        v_credit := public.reserve_player_credit(v_caller, v_pay_id, v_total);
        IF v_credit > 0 THEN
            v_total := v_total - v_credit;
            v_org   := GREATEST(v_org - v_credit, 0);
            UPDATE lt_registration_payment
               SET amount_charged_cents   = v_total,
                   organizer_amount_cents = v_org,
                   credit_applied_cents   = v_credit,
                   updated_at             = now()
             WHERE id = v_pay_id;
        END IF;
    END IF;

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


DROP FUNCTION IF EXISTS public.season_begin_paid_enrollment(uuid, integer);

CREATE FUNCTION public.season_begin_paid_enrollment(
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

    -- $10 referral credit: Rallia-run (house) events only (see tournament twin).
    IF EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_league.organizer_id AND pr.is_house_organizer) THEN
        v_credit := public.reserve_player_credit(v_caller, v_pay_id, v_charge);
        IF v_credit > 0 THEN
            v_charge  := v_charge - v_credit;
            v_org_amt := GREATEST(v_org_amt - v_credit, 0);
            UPDATE lt_registration_payment
               SET amount_charged_cents   = v_charge,
                   organizer_amount_cents = v_org_amt,
                   credit_applied_cents   = v_credit,
                   updated_at             = now()
             WHERE id = v_pay_id;
        END IF;
    END IF;

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
    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = t.organizer_id AND pr.is_house_organizer) THEN
        credit_applicable_cents := LEAST(public.player_credit_available_cents(auth.uid()), total_cents);
    END IF;
    RETURN NEXT;
END;
$$;



DROP FUNCTION IF EXISTS public.season_fee_quote(uuid);

CREATE FUNCTION public.season_fee_quote(p_season_id uuid)
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

    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_org AND pr.is_house_organizer) THEN
        credit_applicable_cents := LEAST(public.player_credit_available_cents(auth.uid()), total_cents);
    END IF;

    RETURN NEXT;
END;
$$;



GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_begin_paid_enrollment(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_fee_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_fee_quote(uuid) TO authenticated;

-- ============================================================================
-- GST/QST on the ENTRY fee, for events Rallia itself organizes.
--
-- 20260710210000 taxed the service fee and deliberately left the entry alone:
-- under the third-party model the organizer is merchant of record (destination
-- charge + on_behalf_of), so the entry-fee tax follows them and Rallia never
-- touches it.
--
-- That reasoning does not survive a Rallia-run event. The house organizer
-- (profile.is_house_organizer) zeroes the service fee, because Rallia cannot
-- make a taxable supply to itself, and the tax hook hangs off the fee, so:
--
--   fee = 0 -> compute_fee_tax_cents(0) = 0 -> the whole registration is
--   recorded with zero tax, while the entry is now a supply BY a registrant.
--
-- Série 1, 2 and 3 all run that way. The tax was attached to the wrong line
-- item for this case.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- It lays the plumbing and changes NOTHING yet. entry_tax_mode defaults to
-- 'none' on every event, and 'none' reproduces today's arithmetic exactly, so
-- this is a no-op until somebody sets a mode on a specific event. The mode is
-- per event rather than derived from is_house_organizer on purpose: deriving
-- it would silently start taxing the moment that flag moves, and it would not
-- let two Rallia events price differently.
--
--   none     third-party organizer. They own the entry tax. Today's behaviour,
--            byte for byte. The default, and what every existing row keeps.
--   included the advertised entry is the all-in price. Tax is carved OUT of
--            it: 15 $ -> 13,05 $ base + 1,95 $ tax. Player pays the same, the
--            charge is the same, Stripe sees the same amount. Purely a
--            bookkeeping split, which is what makes it safe to flip on an
--            event whose registration is already open.
--   added    tax on top: 15 $ -> the player is charged 17,25 $. Changes the
--            price, so it needs the UI line and a fresh announcement. Wired
--            here so it is not a live bug waiting; not usable until the client
--            renders the extra line.
--
-- Rate: the same QC-only 14.975% constant as the fee tax. When that becomes
-- f(province), both functions change together.
--
-- STILL OPEN, both for the accountant, neither blocking this migration:
--   1. whether a for-profit registrant's tournament entry is a taxable supply
--      at all (expected yes: the ETA recreation exemption is scoped to public
--      sector bodies, which Rallia is not);
--   2. whether referral credit reduces the tax base. Entry tax is computed
--      here on the LISTED entry, before any credit is applied.
--
-- Money flow is unaffected. application_fee_amount stays service_fee + fee_tax
-- (lt-create-registration-payment:415), so entry tax never lands in Rallia's
-- platform cut: it rides in the charge amount, settles into the organizer's
-- connected balance, and the organizer remits it. For a house event that
-- organizer is Rallia, which is the whole point.
--
-- NOTE ON A NAME. lt_cancel_refund_candidates keeps returning its column as
-- entry_cents, though it now carries entry + added tax, so that
-- lt-settle-event-payments needs no lockstep deploy while every event is
-- 'none'. Rename it to refund_cents when 'added' is actually switched on.
-- ============================================================================

-- ----------------------------------------------------------------- 1. enum
DO $$ BEGIN
    CREATE TYPE entry_tax_mode_enum AS ENUM ('none', 'included', 'added');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------- 2. math
-- Tax (cents) on an entry price, half-up like the fee math.
--   added    entry is the base   -> tax = entry * 14.975%
--   included entry is the total  -> tax = entry * 14.975/114.975, so that
--                                   (entry - tax) + tax = entry exactly.
CREATE OR REPLACE FUNCTION public.compute_entry_tax_cents(
    p_entry_cents integer,
    p_mode        entry_tax_mode_enum
)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE COALESCE(p_mode, 'none')
        WHEN 'added' THEN
            CAST(ROUND(GREATEST(COALESCE(p_entry_cents, 0), 0)::numeric * 14975 / 100000.0) AS integer)
        WHEN 'included' THEN
            CAST(ROUND(GREATEST(COALESCE(p_entry_cents, 0), 0)::numeric * 14975 / 114975.0) AS integer)
        ELSE 0
    END;
$$;

COMMENT ON FUNCTION public.compute_entry_tax_cents(integer, entry_tax_mode_enum)
IS 'GST+QST on an entry fee. added = on top of the listed price; included = carved out of it; none = 0 (third-party organizer owns the entry tax). QC-only 14.975% in v0, twin of compute_fee_tax_cents.';

-- The entry-side amount the player is actually charged, and therefore the
-- amount a refund returns. One place to be right, because four refund legs and
-- two withdraw RPCs all need the same answer:
--   included -> the tax is already inside entry_cents, do not add it twice
--   added    -> the player paid entry + tax, both go back
CREATE OR REPLACE FUNCTION public.lt_entry_charged_cents(
    p_entry_cents     integer,
    p_entry_tax_cents integer,
    p_mode            entry_tax_mode_enum
)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
    SELECT COALESCE(p_entry_cents, 0)
         + CASE WHEN COALESCE(p_mode, 'none') = 'added'
                THEN COALESCE(p_entry_tax_cents, 0) ELSE 0 END;
$$;

COMMENT ON FUNCTION public.lt_entry_charged_cents(integer, integer, entry_tax_mode_enum)
IS 'Entry-side cents charged to the player: entry, plus the entry tax only when it was added on top. The refundable base.';

GRANT EXECUTE ON FUNCTION public.compute_entry_tax_cents(integer, entry_tax_mode_enum) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lt_entry_charged_cents(integer, integer, entry_tax_mode_enum) TO authenticated;

-- -------------------------------------------------------------- 3. columns
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS entry_tax_mode entry_tax_mode_enum NOT NULL DEFAULT 'none';
ALTER TABLE public.seasons
    ADD COLUMN IF NOT EXISTS entry_tax_mode entry_tax_mode_enum NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.tournaments.entry_tax_mode
IS 'How GST/QST applies to entry_fee_cents. none = third-party organizer owns it (default). included = entry_fee_cents is the all-in price. added = tax charged on top.';
COMMENT ON COLUMN public.seasons.entry_tax_mode
IS 'How GST/QST applies to entry_fee_cents. none = third-party organizer owns it (default). included = entry_fee_cents is the all-in price. added = tax charged on top.';

-- The ledger snapshot. Both columns, not just the amount: without the mode you
-- cannot tell whether entry_cents contains the tax or sits beside it, and that
-- is exactly the question at remittance time.
ALTER TABLE public.lt_registration_payment
    ADD COLUMN IF NOT EXISTS entry_tax_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.lt_registration_payment
    ADD COLUMN IF NOT EXISTS entry_tax_mode entry_tax_mode_enum NOT NULL DEFAULT 'none';

DO $$ BEGIN
    ALTER TABLE public.lt_registration_payment
        ADD CONSTRAINT lt_registration_payment_entry_tax_pos CHECK (entry_tax_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.lt_registration_payment.entry_tax_cents
IS 'GST+QST on the entry (0 when entry_tax_mode is none). Read it together with entry_tax_mode: included = carved out of entry_cents, added = charged on top of it. Settles to the organizer, who remits; never part of application_fee_amount.';
COMMENT ON COLUMN public.lt_registration_payment.entry_tax_mode
IS 'Entry tax treatment in force when this payment was created, snapshotted so the ledger stays readable after the event is edited.';

-- --------------------------------------------------------------- 4. quotes
-- Bodies from 20260826170000 (the latest, credit band + finalize), with the
-- entry tax folded in. Return shapes gain entry_tax_cents, so DROP + CREATE.

DROP FUNCTION IF EXISTS public.tournament_fee_quote(uuid);

CREATE FUNCTION public.tournament_fee_quote(p_tournament_id uuid)
RETURNS TABLE (
    entry_cents              integer,   -- the listed price, unchanged by the mode
    entry_tax_cents          integer,   -- GST+QST on the entry (0 when mode = none)
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
    t         public.tournaments;
    pol       record;
    fee       integer;
    fee_tax   integer;
    entry_tax integer;
    entry_chg integer;
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

    -- Entry tax. 'included' leaves entry_chg equal to the listed price, so the
    -- charge and every downstream total are untouched; only the split is new.
    entry_tax := public.compute_entry_tax_cents(t.entry_fee_cents, t.entry_tax_mode);
    entry_chg := public.lt_entry_charged_cents(t.entry_fee_cents, entry_tax, t.entry_tax_mode);

    entry_cents       := t.entry_fee_cents;
    entry_tax_cents   := entry_tax;
    service_fee_cents := fee;
    fee_tax_cents     := fee_tax;
    IF t.fee_payer = 'player_pays' THEN
        total_cents              := entry_chg + fee + fee_tax;
        organizer_receives_cents := entry_chg;
    ELSE
        total_cents              := entry_chg;
        organizer_receives_cents := GREATEST(entry_chg - fee - fee_tax, 0);
    END IF;
    fee_payer          := t.fee_payer;
    currency           := t.currency;
    refund_policy_kind := t.refund_policy_kind;
    refund_partial_bps := t.refund_partial_bps;
    refund_cutoff_at   := t.refund_cutoff_at;

    -- Preview only: the begin RPC re-resolves and reserves under lock.
    -- Banded like the reserve: full cover, or leave at least fee+tax to
    -- charge — Stripe refuses an amount below its application fee. The entry
    -- tax is not an application fee, so it stays out of the floor.
    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = t.organizer_id AND pr.is_house_organizer) THEN
        credit_applicable_cents := public.credit_band_cap(
            public.player_credit_available_cents(auth.uid()), total_cents, fee + fee_tax);
    END IF;
    RETURN NEXT;
END;
$$;

DROP FUNCTION IF EXISTS public.season_fee_quote(uuid);

CREATE FUNCTION public.season_fee_quote(p_season_id uuid)
RETURNS TABLE (
    entry_cents             integer,
    entry_tax_cents         integer,
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
    v_s        seasons;
    v_org      uuid;
    v_pct      integer;
    v_flat     integer;
    v_cap      integer;
    v_fee      integer;
    v_tax      integer;
    v_entry_tax integer;
    v_entry_chg integer;
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

    v_entry_tax := public.compute_entry_tax_cents(v_s.entry_fee_cents, v_s.entry_tax_mode);
    v_entry_chg := public.lt_entry_charged_cents(v_s.entry_fee_cents, v_entry_tax, v_s.entry_tax_mode);

    entry_cents        := v_s.entry_fee_cents;
    entry_tax_cents    := v_entry_tax;
    service_fee_cents  := v_fee;
    fee_tax_cents      := v_tax;
    fee_payer          := v_s.fee_payer;
    currency           := v_s.currency;
    refund_policy_kind := v_s.refund_policy_kind;
    refund_partial_bps := v_s.refund_partial_bps;
    refund_cutoff_at   := v_s.refund_cutoff_at;

    -- The service-fee customer is the organizer in both modes. The ENTRY tax
    -- is Rallia's own only when Rallia is the organizer, which is what
    -- entry_tax_mode says; for a third-party season it stays 'none'.
    IF v_s.fee_payer = 'player_pays' THEN
        total_cents              := v_entry_chg + v_fee + v_tax;
        organizer_receives_cents := v_entry_chg;
    ELSE
        total_cents              := v_entry_chg;
        organizer_receives_cents := GREATEST(v_entry_chg - v_fee - v_tax, 0);
    END IF;

    -- Banded like the reserve: full cover, or leave at least fee+tax to charge.
    credit_applicable_cents := 0;
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM profile pr WHERE pr.id = v_org AND pr.is_house_organizer) THEN
        credit_applicable_cents := public.credit_band_cap(
            public.player_credit_available_cents(auth.uid()), total_cents, v_fee + v_tax);
    END IF;

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_fee_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_fee_quote(uuid) TO authenticated;

-- ------------------------------------------------------------- 5. begin RPCs
-- Bodies from 20260826190000 (the latest, credit reserve layering). Only the
-- entry-tax lines and the ledger insert differ. Return shapes gain
-- entry_tax_cents, so DROP + CREATE.

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
    entry_tax_cents             integer,
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
    v_entry_tax integer;
    v_entry_chg integer;
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

    -- Entry tax, on the LISTED entry, before credit. 'none' and 'included'
    -- both leave v_entry_chg at the listed price, so the charge is unchanged.
    v_entry_tax := public.compute_entry_tax_cents(v_t.entry_fee_cents, v_t.entry_tax_mode);
    v_entry_chg := public.lt_entry_charged_cents(v_t.entry_fee_cents, v_entry_tax, v_t.entry_tax_mode);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_entry_chg + v_fee + v_fee_tax;
        v_org   := v_entry_chg;
    ELSE
        v_total := v_entry_chg;
        v_org   := GREATEST(v_entry_chg - v_fee - v_fee_tax, 0);
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
        entry_cents, entry_tax_cents, entry_tax_mode,
        service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, credit_applied_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_pay_id, v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_entry_tax, v_t.entry_tax_mode,
        v_fee, v_fee_tax, v_t.fee_payer,
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
    entry_tax_cents             := v_entry_tax;
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
    entry_tax_cents             integer,
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
    v_entry_tax integer;
    v_entry_chg integer;
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

    -- Entry tax, on the LISTED entry, before credit (twin of the tournament).
    v_entry_tax := public.compute_entry_tax_cents(v_s.entry_fee_cents, v_s.entry_tax_mode);
    v_entry_chg := public.lt_entry_charged_cents(v_s.entry_fee_cents, v_entry_tax, v_s.entry_tax_mode);

    IF v_s.fee_payer = 'player_pays' THEN
        v_charge  := v_entry_chg + v_fee + v_tax;
        v_org_amt := v_entry_chg;
    ELSE
        v_charge  := v_entry_chg;
        v_org_amt := GREATEST(v_entry_chg - v_fee - v_tax, 0);
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
        entry_cents, entry_tax_cents, entry_tax_mode,
        service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, credit_applied_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_pay_id, p_season_id, v_member.id, v_caller, v_league.organizer_id,
        v_s.entry_fee_cents, v_entry_tax, v_s.entry_tax_mode,
        v_fee, v_tax, v_s.fee_payer,
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
    entry_tax_cents             := v_entry_tax;
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

-- ------------------------------------------------------------- 6. refunds
-- A refund must return the entry tax with the entry: unlike the service-fee
-- tax, which rides with the non-refundable fee because Rallia has already
-- remitted it, entry tax collected on a supply that did not happen is not
-- Rallia's to keep. lt_entry_charged_cents is the single answer to "how much
-- of this payment was the entry", and it is a no-op while the mode is 'none'.

-- Body from 20260629130000, refundable base widened. Shape unchanged.
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
    v_base       integer;
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
    -- The entry tax IS: a partial policy prorates entry and tax together.
    v_base := public.lt_entry_charged_cents(
        v_pay.entry_cents, v_pay.entry_tax_cents, v_pay.entry_tax_mode);

    IF v_t.refund_policy_kind = 'none'
       OR (v_t.refund_cutoff_at IS NOT NULL AND now() > v_t.refund_cutoff_at) THEN
        v_refundable := 0;
    ELSIF v_t.refund_policy_kind = 'full' THEN
        v_refundable := v_base;
    ELSE  -- partial
        v_refundable := CAST(
            ROUND(v_base::numeric * COALESCE(v_t.refund_partial_bps, 0) / 10000.0)
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

-- Body from 20260716200400, refundable base widened. Shape unchanged.
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
    v_base   integer;
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
    -- on it are never returned (20260710210000): Rallia has already remitted
    -- it. Entry tax is a different animal and goes back with the entry.
    v_base := public.lt_entry_charged_cents(
        v_pay.entry_cents, v_pay.entry_tax_cents, v_pay.entry_tax_mode);

    IF v_s.refund_policy_kind = 'none'
       OR (v_s.refund_cutoff_at IS NOT NULL AND now() > v_s.refund_cutoff_at) THEN
        v_refund := 0;
    ELSIF v_s.refund_policy_kind = 'full' THEN
        v_refund := v_base;
    ELSE
        v_refund := ROUND(v_base * COALESCE(v_s.refund_partial_bps, 0) / 10000.0);
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

GRANT EXECUTE ON FUNCTION public.tournament_request_refund(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_request_refund(uuid, integer) TO authenticated;

-- Body from 20260811200000 (the latest, forfeit leg), with every leg returning
-- the entry-side charge instead of the bare entry. The column keeps the name
-- entry_cents so lt-settle-event-payments needs no lockstep deploy; see the
-- header note. All four legs still gate on entry_cents > 0, which is the
-- "was this a paid registration" test, not the refund amount.
CREATE OR REPLACE FUNCTION public.lt_cancel_refund_candidates()
RETURNS TABLE(payment_id uuid, stripe_payment_intent_id text, stripe_charge_id text, entry_cents integer, currency character varying, payout_timing payout_timing_enum, released_transfer_id text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    -- Tournament leg: the organizer called the whole event off.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id,
           public.lt_entry_charged_cents(p.entry_cents, p.entry_tax_cents, p.entry_tax_mode),
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND t.status = 'cancelled'
    UNION ALL
    -- Tournament removed-player leg. forfeited_at excludes the mid-pool exit:
    -- that player had their window, so the entry stays with the event.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id,
           public.lt_entry_charged_cents(p.entry_cents, p.entry_tax_cents, p.entry_tax_mode),
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND r.status = 'disqualified'
       AND r.forfeited_at IS NULL
       AND t.status <> 'cancelled'
    UNION ALL
    -- Season cancel leg.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id,
           public.lt_entry_charged_cents(p.entry_cents, p.entry_tax_cents, p.entry_tax_mode),
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND s.status = 'cancelled'
    UNION ALL
    -- Season removed-player leg. payout_id IS NULL keeps an already-settled entry
    -- (removed after the season closed and paid out) from being clawed back.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id,
           public.lt_entry_charged_cents(p.entry_cents, p.entry_tax_cents, p.entry_tax_mode),
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND sm.status = 'disqualified'
       AND p.stripe_payout_id IS NULL
       AND s.status <> 'cancelled';   -- cancel leg already covers these
$function$;

COMMENT ON FUNCTION public.lt_cancel_refund_candidates()
IS 'Payments owed a full entry refund. entry_cents carries the entry-side charge, which includes the entry tax when entry_tax_mode is added.';

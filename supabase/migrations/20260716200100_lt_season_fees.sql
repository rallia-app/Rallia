-- Paid seasons, part 2 of 2: fee columns, ledger wiring, quote + begin RPCs.
--
-- The paid unit is the SEASON (a league is permanent; you pay to play a season).
-- season_members is the row the payment attaches to, exactly as its DDL planned.
--
-- Most of the fee engine is already event-agnostic and is reused untouched:
-- compute_service_fee_cents / resolve_service_fee_policy / compute_fee_tax_cents,
-- the fee_payer/payout_timing/refund_policy_kind enums, platform_service_fee_default
-- and organizer_fee_override (both organizer-keyed), and lt_registration_payment's
-- RLS. The ledger's target CHECK already admits season rows —
--   ((tournament_registration_id IS NOT NULL)::int + (season_id IS NOT NULL)::int = 1)
-- with tournament_registration_id nullable, so nothing there needs relaxing.
--
-- seasons has no organizer_id: the organizer is always leagues.organizer_id via
-- seasons.league_id.

-- ---------------------------------------------------------------------------
-- Fee columns on seasons (mirrors tournaments, 20260629100000:101-144)
-- ---------------------------------------------------------------------------

ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS entry_fee_cents        integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency               varchar(3) NOT NULL DEFAULT 'CAD',
    ADD COLUMN IF NOT EXISTS fee_payer              fee_payer_enum NOT NULL DEFAULT 'player_pays',
    ADD COLUMN IF NOT EXISTS payout_timing          payout_timing_enum NOT NULL DEFAULT 'hold_until_event_end',
    ADD COLUMN IF NOT EXISTS refund_policy_kind     refund_policy_kind_enum NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS refund_partial_bps     integer,
    ADD COLUMN IF NOT EXISTS refund_cutoff_at       timestamptz,
    ADD COLUMN IF NOT EXISTS fee_pct_bps_override   integer,
    ADD COLUMN IF NOT EXISTS fee_flat_cents_override integer,
    ADD COLUMN IF NOT EXISTS fee_cap_cents_override  integer,
    ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_reason       text;

DO $$ BEGIN
    ALTER TABLE seasons ADD CONSTRAINT seasons_entry_fee_pos CHECK (entry_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE seasons ADD CONSTRAINT seasons_refund_partial_range
        CHECK (refund_partial_bps IS NULL OR refund_partial_bps BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE seasons ADD CONSTRAINT seasons_refund_partial_requires_bps
        CHECK ((refund_policy_kind = 'partial') = (refund_partial_bps IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE seasons ADD CONSTRAINT seasons_fee_overrides_range CHECK (
        (fee_pct_bps_override   IS NULL OR fee_pct_bps_override   BETWEEN 0 AND 10000) AND
        (fee_flat_cents_override IS NULL OR fee_flat_cents_override >= 0) AND
        (fee_cap_cents_override  IS NULL OR fee_cap_cents_override  >= 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Ledger: the Phase-4 stub columns get real FKs + indexes.
--
-- season_user_id was outside the target CHECK, so a season row could be written
-- with no member. Tighten it so season_id always carries its member.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    ALTER TABLE lt_registration_payment
        ADD CONSTRAINT lt_reg_payment_season_fkey
        FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE lt_registration_payment
        ADD CONSTRAINT lt_reg_payment_season_user_fkey
        FOREIGN KEY (season_user_id) REFERENCES season_members(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE lt_registration_payment
        ADD CONSTRAINT lt_reg_payment_season_user_required
        CHECK ((season_id IS NULL) = (season_user_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mirrors of lt_reg_payment_registration_idx, for the season leg.
CREATE INDEX IF NOT EXISTS lt_reg_payment_season_idx
    ON lt_registration_payment(season_id) WHERE season_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lt_reg_payment_season_user_idx
    ON lt_registration_payment(season_user_id) WHERE season_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- season_fee_quote — the tournament_fee_quote wrapper, reading seasons and
-- resolving the organizer through leagues.
-- ---------------------------------------------------------------------------

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
    refund_cutoff_at        timestamptz
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

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_fee_quote(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Payment gate on enrollment.
--
-- A trigger rather than a change to season_enroll, so it holds across EVERY
-- insert path. That matters here: season_enroll is not the only door —
-- session_confirm_presence auto-enrolls on confirm (20260629160100 header), and
-- without this a player could skip payment entirely by confirming presence.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_season_member_requires_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fee integer;
BEGIN
    SELECT entry_fee_cents INTO v_fee FROM seasons WHERE id = NEW.season_id;

    -- Organizer invites may sit 'pending' unpaid; they pay when they accept.
    IF COALESCE(v_fee, 0) > 0
       AND NEW.status <> 'payment_pending'
       AND NOT (NEW.status = 'pending' AND NEW.invited_by IS NOT NULL)
    THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_member_requires_payment ON season_members;
CREATE TRIGGER season_member_requires_payment
    BEFORE INSERT ON season_members
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_season_member_requires_payment();

-- ---------------------------------------------------------------------------
-- season_begin_paid_enrollment — mirrors tournament_begin_paid_registration.
-- ---------------------------------------------------------------------------

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
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE season_user_id = v_member.id AND status = 'pending';
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

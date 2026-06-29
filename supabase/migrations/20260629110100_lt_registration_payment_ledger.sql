-- ============================================
-- Leagues & Tournaments — payment ledger + paid-registration RPCs (Phase 2a)
-- ============================================
-- Adds the per-registration payment ledger, the organizer payout-setup gate on
-- publishing a paid tournament, the atomic "reserve a slot + snapshot the fee"
-- RPC the create-payment edge function calls, a guard so paid tournaments can't
-- be joined for free, and a reaper that frees slots held by abandoned payments.
--
-- The ledger is generic (tournaments now, league seasons in Phase 4). Money is
-- moved by the edge functions; this migration only models the state.
-- ============================================


-- ============================================
-- ENUM: payment lifecycle
-- ============================================
DO $$ BEGIN
    CREATE TYPE lt_payment_status_enum AS ENUM (
        'pending',             -- PaymentIntent created, awaiting confirmation
        'succeeded',           -- paid; registration finalized
        'refunded',            -- entry fully refunded (fee retained)
        'partially_refunded',  -- entry partially refunded (fee retained)
        'failed',              -- charge failed
        'cancelled'            -- abandoned / superseded before capture
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================
-- TABLE: lt_registration_payment
-- ============================================
CREATE TABLE IF NOT EXISTS public.lt_registration_payment (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Polymorphic link to the thing being paid for. Exactly one is set.
    tournament_registration_id  uuid        REFERENCES public.tournament_registrations(id) ON DELETE CASCADE,
    season_id                   uuid,        -- Phase 4 (league seasons)
    season_user_id              uuid,        -- Phase 4

    payer_user_id               uuid        NOT NULL REFERENCES public.player(id) ON DELETE RESTRICT,
    organizer_id                uuid        NOT NULL REFERENCES public.player(id) ON DELETE RESTRICT,

    -- Snapshot of the resolved fee at charge time (immune to later config edits).
    entry_cents                 integer     NOT NULL,
    service_fee_cents           integer     NOT NULL,
    fee_payer                   fee_payer_enum NOT NULL,
    amount_charged_cents        integer     NOT NULL,   -- what the player is charged
    organizer_amount_cents      integer     NOT NULL,   -- what the organizer ultimately receives
    currency                    varchar(3)  NOT NULL DEFAULT 'CAD',
    payout_timing               payout_timing_enum NOT NULL,

    status                      lt_payment_status_enum NOT NULL DEFAULT 'pending',

    stripe_payment_intent_id    text,
    stripe_charge_id            text,
    stripe_customer_id          text,

    refund_amount_cents         integer     NOT NULL DEFAULT 0,
    refunded_at                 timestamptz,

    -- hold_until_event_end: filled when funds are transferred to the organizer.
    released_transfer_id        text,
    released_at                 timestamptz,

    expires_at                  timestamptz,   -- pending-payment reservation TTL
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    version                     integer     NOT NULL DEFAULT 1,

    CONSTRAINT lt_reg_payment_target_chk CHECK (
        (tournament_registration_id IS NOT NULL)::int
      + (season_id IS NOT NULL)::int = 1
    ),
    CONSTRAINT lt_reg_payment_amounts_chk CHECK (
        entry_cents >= 0 AND service_fee_cents >= 0
        AND amount_charged_cents >= 0 AND organizer_amount_cents >= 0
        AND refund_amount_cents >= 0
    )
);

COMMENT ON TABLE public.lt_registration_payment IS 'Per-registration payment ledger for paid tournaments / league seasons. One row per sign-up attempt; snapshots the resolved fee so history is stable.';
COMMENT ON COLUMN public.lt_registration_payment.amount_charged_cents IS 'Total charged to the player (entry + fee for player_pays, entry for organizer_absorbs).';
COMMENT ON COLUMN public.lt_registration_payment.organizer_amount_cents IS 'Amount the organizer ultimately receives (entry for player_pays, entry - fee for organizer_absorbs).';
COMMENT ON COLUMN public.lt_registration_payment.released_transfer_id IS 'Stripe transfer id once held funds are paid out at event end (hold_until_event_end).';

CREATE UNIQUE INDEX IF NOT EXISTS lt_reg_payment_pi_idx
    ON public.lt_registration_payment(stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lt_reg_payment_registration_idx
    ON public.lt_registration_payment(tournament_registration_id)
    WHERE tournament_registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lt_reg_payment_organizer_idx
    ON public.lt_registration_payment(organizer_id);
CREATE INDEX IF NOT EXISTS lt_reg_payment_payer_idx
    ON public.lt_registration_payment(payer_user_id);
CREATE INDEX IF NOT EXISTS lt_reg_payment_reaper_idx
    ON public.lt_registration_payment(status, expires_at)
    WHERE status = 'pending';

ALTER TABLE public.lt_registration_payment ENABLE ROW LEVEL SECURITY;

-- Payer sees their own payments; organizer sees payments for their events.
-- Writes happen only through SECURITY DEFINER RPCs / the service-role webhook.
DROP POLICY IF EXISTS lt_reg_payment_read_payer ON public.lt_registration_payment;
CREATE POLICY lt_reg_payment_read_payer ON public.lt_registration_payment
    FOR SELECT TO authenticated USING (payer_user_id = auth.uid());

DROP POLICY IF EXISTS lt_reg_payment_read_organizer ON public.lt_registration_payment;
CREATE POLICY lt_reg_payment_read_organizer ON public.lt_registration_payment
    FOR SELECT TO authenticated USING (organizer_id = auth.uid());

REVOKE ALL ON public.lt_registration_payment FROM anon, authenticated;
GRANT SELECT ON public.lt_registration_payment TO authenticated;


-- ============================================
-- Publish gate: a paid tournament can't open registration until the organizer
-- has finished Stripe payout setup. Re-defines tournament_open_registration
-- with the gate added; rest of the body is unchanged from 20260510170005.
-- ============================================
CREATE OR REPLACE FUNCTION public.tournament_open_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_t         tournaments;
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Paid events require the organizer to have completed Stripe payout setup,
    -- otherwise there is nowhere to send their earnings.
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.entry_fee_cents > 0 THEN
        IF NOT EXISTS (
            SELECT 1 FROM player_stripe_account
             WHERE player_id = v_t.organizer_id AND onboarding_completed
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYOUTS_SETUP_REQUIRED';
        END IF;
    END IF;

    UPDATE tournaments
       SET status     = 'registration_open',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'open_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_open_registration(uuid, integer) TO authenticated;


-- ============================================
-- Guard: a paid tournament can only be joined through the payment flow.
-- Enforced with a BEFORE INSERT trigger rather than by editing the register
-- RPCs, so it holds regardless of which register overload runs now or later
-- (tournament_register has evolved through many migrations: doubles partner,
-- capacity lock, organizer self-register, level soft-gate, …). The only
-- legitimate insert for a paid tournament is the payment_pending reservation
-- written by tournament_begin_paid_registration; the webhook later flips that
-- to 'registered' via UPDATE, which this INSERT trigger never sees.
--
-- (An earlier draft of this migration redefined tournament_register(uuid),
-- which 20260612160200 had already dropped in favor of the (uuid, uuid)
-- partner-aware version. Drop the stray 1-arg overload if present.)
-- ============================================
DROP FUNCTION IF EXISTS public.tournament_register(uuid);

CREATE OR REPLACE FUNCTION public.tg_tournament_registration_requires_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_fee integer;
BEGIN
    SELECT entry_fee_cents INTO v_fee FROM tournaments WHERE id = NEW.tournament_id;
    IF COALESCE(v_fee, 0) > 0 AND NEW.status <> 'payment_pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_registration_requires_payment ON public.tournament_registrations;
CREATE TRIGGER trg_tournament_registration_requires_payment
    BEFORE INSERT ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION public.tg_tournament_registration_requires_payment();


-- ============================================
-- tournament_begin_paid_registration
--   Atomically reserves a slot (payment_pending) and writes a pending ledger
--   row snapshotting the resolved fee. Returns everything the create-payment
--   edge function needs to open a Stripe PaymentIntent. The webhook later
--   finalizes the registration to 'registered'.
-- ============================================
CREATE OR REPLACE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
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
    v_total    integer;
    v_org      integer;
    v_active   integer;
    v_existing tournament_registrations;
    v_reg      tournament_registrations;
    v_psa      player_stripe_account;
    v_pay_id   uuid;
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
    -- Paid approval/invite flows (pay vs. approval ordering) are a later slice.
    IF v_t.registration_mode <> 'open' THEN
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

    -- Reuse the caller's existing row if present; block if already confirmed.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    IF FOUND THEN
        IF v_existing.status IN ('registered', 'pending') THEN
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

    -- Resolve the effective fee and snapshot the breakdown.
    SELECT * INTO v_pol FROM public.resolve_service_fee_policy(
        v_t.organizer_id, v_t.fee_pct_bps_override, v_t.fee_flat_cents_override, v_t.fee_cap_cents_override);
    v_fee := public.compute_service_fee_cents(v_t.entry_fee_cents, v_pol.pct_bps, v_pol.flat_cents, v_pol.cap_cents);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_t.entry_fee_cents + v_fee;
        v_org   := v_t.entry_fee_cents;
    ELSE
        v_total := v_t.entry_fee_cents;
        v_org   := GREATEST(v_t.entry_fee_cents - v_fee, 0);
    END IF;

    INSERT INTO lt_registration_payment (
        tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_t.fee_payer,
        v_total, v_org, v_t.currency,
        v_t.payout_timing, 'pending', now() + interval '15 minutes'
    ) RETURNING id INTO v_pay_id;

    SELECT * INTO v_psa FROM player_stripe_account WHERE player_id = v_t.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_reg.id, 'begin_paid_registration', v_caller,
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total));

    payment_id                  := v_pay_id;
    registration_id             := v_reg.id;
    entry_cents                 := v_t.entry_fee_cents;
    service_fee_cents           := v_fee;
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


-- ============================================
-- Reaper: release slots held by payments that were never completed.
-- Cancels the pending ledger row and reverts the reserved registration to
-- 'withdrawn'. Cron every 5 minutes.
-- ============================================
CREATE OR REPLACE FUNCTION public.lt_expire_stale_registration_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
    v_pay   record;
BEGIN
    FOR v_pay IN
        SELECT id, tournament_registration_id
          FROM lt_registration_payment
         WHERE status = 'pending'
           AND expires_at IS NOT NULL
           AND expires_at < now()
    LOOP
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE id = v_pay.id AND status = 'pending';

        UPDATE tournament_registrations
           SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_pay.tournament_registration_id
           AND status = 'payment_pending';

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_expire_stale_registration_payments() FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_expire_stale_registration_payments()
    IS 'Cron-invoked: frees slots reserved by pending payments past their expires_at by cancelling the ledger row and withdrawing the payment_pending registration.';

SELECT cron.unschedule('lt-expire-stale-registration-payments') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-expire-stale-registration-payments'
);

SELECT cron.schedule(
  'lt-expire-stale-registration-payments',
  '*/5 * * * *',
  $$ SELECT public.lt_expire_stale_registration_payments(); $$
);

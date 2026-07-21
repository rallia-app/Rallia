-- Close the free-entry bypasses in the paid-tournament gate.
--
-- tg_tournament_registration_requires_payment was BEFORE INSERT only
-- (20260629110100), on the assumption that the only way into a paid tournament
-- was the payment_pending reservation written by begin_paid_registration. That
-- assumption is false: several RPCs reach 'registered' through an UPDATE the
-- INSERT trigger never sees. All four are reproducible on a paid tournament:
--
--   1. tournament_register reactivation branch — its ALREADY_REGISTERED guard
--      checks registered/pending/waitlisted but NOT payment_pending, so
--      begin_paid_registration followed by tournament_register flips the
--      reservation straight to 'registered' with the ledger still 'pending'.
--   2. Same branch after the reaper: abandon checkout, wait for the row to go
--      'withdrawn', re-register free.
--   3. tournament_register invite branch — flips a pending invite to
--      'registered' with no fee check, sidestepping tournament_accept_invite's
--      PAYMENT_REQUIRED.
--   4. tournament_approve_registration — organizer approval of a pending paid
--      invite grants a confirmed spot for free.
--
-- This is the same class of bug fixed for seasons in 20260716200500. Fix it the
-- same way: follow the money instead of trusting the caller. Whatever path is
-- taken, a row may only LAND on 'registered' in a paid tournament if a
-- succeeded payment is attached to it.
--
-- Checked on the transition (OLD.status IS DISTINCT FROM 'registered') rather
-- than on every UPDATE of a registered row. That matters: when a tournament is
-- cancelled, lt-settle-event-payments refunds and marks the ledger 'refunded'
-- while the registration stays 'registered'. A blanket check would then raise
-- PAYMENT_REQUIRED on any later touch of a legitimately paid row. Guarding the
-- transition keeps the invariant ("you cannot BECOME registered without
-- paying") without creating that false positive.
--
-- Safe for the webhook: lt-payment-webhook marks the ledger 'succeeded' before
-- it flips the registration, so the EXISTS below is already true.

CREATE OR REPLACE FUNCTION public.tg_tournament_registration_requires_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_fee integer;
BEGIN
    SELECT entry_fee_cents INTO v_fee FROM tournaments WHERE id = NEW.tournament_id;

    -- Free tournament: nothing to enforce.
    IF COALESCE(v_fee, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Unchanged from 20260629150000: a paid slot may only be reserved by the
        -- payment flow (payment_pending) or held as an outstanding organizer
        -- invite (pending + invited_by).
        IF NEW.status <> 'payment_pending'
           AND NOT (NEW.status = 'pending' AND NEW.invited_by IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: only the transition INTO 'registered' is gated. Every exit and
    -- holding state (withdrawn, disqualified, payment_pending, pending) stays
    -- freely reachable so the reaper, refunds and organizer removal still work.
    IF NEW.status = 'registered'
       AND OLD.status IS DISTINCT FROM 'registered'
       AND NOT EXISTS (
           SELECT 1 FROM lt_registration_payment p
            WHERE p.tournament_registration_id = NEW.id
              AND p.status = 'succeeded'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_registration_requires_payment ON public.tournament_registrations;
CREATE TRIGGER trg_tournament_registration_requires_payment
    BEFORE INSERT OR UPDATE ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION public.tg_tournament_registration_requires_payment();

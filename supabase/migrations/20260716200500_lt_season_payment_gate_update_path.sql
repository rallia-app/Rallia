-- Close a payment bypass in the paid-season gate.
--
-- The gate added in 20260716200100 was BEFORE INSERT only, mirroring the
-- tournament trigger. That is not sufficient for seasons, because season_members
-- has an UPDATE path the tournament table doesn't exercise the same way:
-- season_enroll re-uses an existing row (20260629160100) rather than inserting.
--
-- The exploit: begin a paid checkout (row lands at 'payment_pending'), abandon
-- the Stripe sheet, then call season_enroll. It took the UPDATE branch, no
-- INSERT trigger fired, and the row became 'enrolled' — fully enrolled AND
-- ranked, with the ledger still 'pending'. Free entry to a paid season.
--
-- Fix: gate on the RESULTING STATUS for both INSERT and UPDATE, and decide by
-- following the money rather than by trusting the caller. Anything landing on
-- 'enrolled' in a paid season must have a succeeded payment attached.
--
-- This is safe for the webhook because lt-payment-webhook marks the ledger
-- 'succeeded' BEFORE it flips season_members to 'enrolled', so the EXISTS below
-- is already true by the time the member row is touched. It needs no knowledge
-- of who the caller is, which is what makes it airtight: every current and
-- future path (season_enroll, session_confirm_presence's auto-enroll, a manual
-- fix-up) is covered by the same rule.

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

    -- Free season: nothing to enforce.
    IF COALESCE(v_fee, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    -- Organizer invites may sit 'pending' unpaid; they pay when they accept.
    IF NEW.status = 'pending' AND NEW.invited_by IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- The checkout reservation and every exit path are always allowed.
    IF NEW.status IN ('payment_pending', 'withdrawn') THEN
        RETURN NEW;
    END IF;

    -- Everything else (i.e. landing on 'enrolled') must be paid for.
    IF NOT EXISTS (
        SELECT 1 FROM lt_registration_payment p
         WHERE p.season_user_id = NEW.id
           AND p.status = 'succeeded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_member_requires_payment ON season_members;
CREATE TRIGGER season_member_requires_payment
    BEFORE INSERT OR UPDATE ON season_members
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_season_member_requires_payment();

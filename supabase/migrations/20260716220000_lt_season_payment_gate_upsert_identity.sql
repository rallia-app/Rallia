-- Paid seasons were sellable but not playable.
--
-- The gate from 20260716200500 asked "does a succeeded payment point at NEW.id?".
-- That is wrong on the INSERT side of an upsert: session_confirm_presence does
--
--     INSERT INTO season_members (...) VALUES (..., 'enrolled')
--     ON CONFLICT (season_id, user_id) DO UPDATE SET status = 'enrolled' ...
--
-- and Postgres fires BEFORE INSERT triggers *before* it detects the conflict.
-- So NEW.id is a freshly-defaulted uuid that no ledger row references, even for
-- a player who paid days ago. Result: an enrolled, paid player got
-- PAYMENT_REQUIRED when confirming for a session — a paid season could take
-- money and then refuse to let anyone play.
--
-- The row id is not a stable identity here. (season_id, user_id) is — it's the
-- upsert's own conflict target and it survives insert-vs-update. Resolve the
-- payment through it instead.
--
-- The bypass this gate exists to stop is unaffected: an abandoned checkout's row
-- is 'payment_pending' with a 'pending' ledger, so no succeeded payment resolves
-- for that (season_id, user_id) and season_enroll's UPDATE path is still refused.

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

    -- Landing on 'enrolled' must be paid for. Resolve the payment by
    -- (season_id, user_id) rather than NEW.id: on an upsert's INSERT attempt
    -- NEW.id is a fresh default that nothing references yet.
    IF NOT EXISTS (
        SELECT 1
          FROM lt_registration_payment p
          JOIN season_members sm ON sm.id = p.season_user_id
         WHERE sm.season_id = NEW.season_id
           AND sm.user_id   = NEW.user_id
           AND p.status     = 'succeeded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;

    RETURN NEW;
END;
$$;

-- Mark the house (Rallia-run) organizer: contact@rallia.ca (Mathis,
-- 2026-08-26). Referral credits redeem only on this account's events.
-- Email-resolved so one migration is correct in every environment and a
-- clean no-op where the account doesn't exist (fresh local DBs); the NOTICE
-- makes the outcome visible in the apply log either way.

DO $$
DECLARE
    v_id uuid;
BEGIN
    SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = 'contact@rallia.ca';
    IF v_id IS NULL THEN
        RAISE NOTICE 'house organizer: contact@rallia.ca not in this environment; nothing flagged';
    ELSE
        UPDATE public.profile SET is_house_organizer = true WHERE id = v_id;
        RAISE NOTICE 'house organizer flagged: %', v_id;
    END IF;
END $$;

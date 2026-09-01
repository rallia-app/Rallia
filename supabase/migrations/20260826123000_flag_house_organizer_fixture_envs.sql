-- Fixture environments (staging/local) have no contact@rallia.ca; their
-- house account is system@rallia.app (a11a0000…, owner of the seeded Série
-- draws). Flag it ONLY where the real house account is absent, so this can
-- never widen credit redemption to a second account on prod.

DO $$
DECLARE
    v_id uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = 'contact@rallia.ca') THEN
        RAISE NOTICE 'real house account present; fixture fallback skipped';
        RETURN;
    END IF;
    SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = 'system@rallia.app';
    IF v_id IS NULL THEN
        RAISE NOTICE 'no house candidate in this environment; nothing flagged';
    ELSE
        UPDATE public.profile SET is_house_organizer = true WHERE id = v_id;
        RAISE NOTICE 'fixture house organizer flagged: %', v_id;
    END IF;
END $$;

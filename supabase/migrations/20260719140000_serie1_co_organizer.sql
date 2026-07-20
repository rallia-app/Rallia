-- ============================================================================
-- Série 1 — add the second Rallia team member as co-organizer
-- ============================================================================
-- Both accounts resolve by profile email (stable across environments, unlike
-- the UUIDs), and the block NO-OPs where either is absent — fresh local/CI
-- databases have neither, so they stay green. Idempotent via the composite
-- primary key.
--
-- Direct INSERT rather than tournament_add_co_organizer: that RPC authorizes
-- against auth.uid(), which is NULL in a migration.
-- ============================================================================

DO $$
DECLARE
    v_primary uuid;
    v_co      uuid;
    v_added   integer;
BEGIN
    SELECT p.id INTO v_primary
      FROM public.player p JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = 'jdl.sonkin@gmail.com';

    SELECT p.id INTO v_co
      FROM public.player p JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = 'lefrancmathis@gmail.com';

    IF v_primary IS NULL OR v_co IS NULL THEN
        RAISE NOTICE 'Série 1 co-organizer skipped: one of the accounts is not present here.';
        RETURN;
    END IF;

    INSERT INTO public.tournament_co_organizers (tournament_id, user_id, added_by)
    SELECT t.id, v_co, v_primary
      FROM public.tournaments t
     WHERE t.name LIKE 'Tournois Rallia — Série 1 ·%'
       AND t.organizer_id <> v_co
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_added = ROW_COUNT;
    RAISE NOTICE 'Série 1 co-organizer: % row(s) added.', v_added;
END $$;

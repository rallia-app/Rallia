-- =============================================================================
-- Migration: Fix Club de Tennis Mont-Royal zone assignment
-- Description: docs/GMA_Communautes_v2.xlsx (sheet 3) lists Club de Tennis
--              Mont-Royal under the Jarry Serve (nord) communities, but the
--              club's physical address (2106 Av. Grey, H4A 3N4) is in NDG,
--              which the same spreadsheet maps to Monkland Ace (ouest). The
--              "Mont-Royal" in the club's name refers to its history, not its
--              location. This migration moves the venue links from the Jarry
--              Serve tennis communities to the Monkland Ace tennis communities.
-- =============================================================================

DO $$
DECLARE
  v_facility_id UUID;
  v_old_count INTEGER;
  v_new_count INTEGER;
BEGIN
  SELECT id INTO v_facility_id
  FROM public.facility
  WHERE LOWER(name) = LOWER('Club de Tennis Mont-Royal')
    AND postal_code = 'H4A3N4'
    AND is_active = TRUE
  LIMIT 1;

  IF v_facility_id IS NULL THEN
    RAISE NOTICE 'Club de Tennis Mont-Royal facility not found; skipping.';
    RETURN;
  END IF;

  -- Remove links to the wrong (nord) communities
  WITH removed AS (
    DELETE FROM public.network_favorite_facility nff
    USING public.network n
    WHERE nff.facility_id = v_facility_id
      AND nff.network_id = n.id
      AND n.zone = 'nord'
      AND n.name LIKE 'Jarry Serve — Tennis%'
    RETURNING 1
  )
  SELECT count(*) INTO v_old_count FROM removed;

  -- Add links to the correct (ouest) communities
  WITH added AS (
    INSERT INTO public.network_favorite_facility (network_id, facility_id)
    SELECT n.id, v_facility_id
    FROM public.network n
    WHERE n.zone = 'ouest'
      AND n.name LIKE 'Monkland Ace — Tennis%'
      AND n.archived_at IS NULL
    ON CONFLICT (network_id, facility_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_new_count FROM added;

  RAISE NOTICE 'Club de Tennis Mont-Royal: removed % nord link(s), inserted % ouest link(s)',
    v_old_count, v_new_count;
END
$$;

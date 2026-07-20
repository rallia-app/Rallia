-- ============================================================================
-- Circuit Rallia — snap the combined multiplier so headline points read clean
-- ============================================================================
-- round(500 × draw × level) produces values like 1333 or 1556 on the card.
-- Advertised points should read like prices, not like float residue.
--
-- Fix at the multiplier, not the display: the combined draw×level multiplier
-- snaps to steps of 0.2, so champion points (base 500) always land on a
-- multiple of 100 — in the ceiling stamp, the bracket-time stamp AND the
-- award, which all flow through the same product. Snapping display-only would
-- let the card promise 1550 and the ledger pay 1556.
--
-- Step 0.2 (not 0.5): coarser steps re-collapse adjacent floors on small
-- draws — an 8-draw with a 3.0 floor and one with a 4.0 floor would both snap
-- to ×1.5 (750 pts), recreating the plateau the continuous level multiplier
-- (20260717130000) just removed. At 0.2, ordering never inverts.
--
-- Série 1 (32-cap): Débutant ×2.0 → 1000, Inter ×2.6 → 1300, Avancé ×3.2 → 1600.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_snap_ranking_multiplier(p_mult numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT greatest(0.2, round(p_mult * 5) / 5.0);
$$;

COMMENT ON FUNCTION public.lt_snap_ranking_multiplier(numeric) IS
  'Snaps the combined draw×level ranking multiplier to 0.2 steps so champion '
  'points (base 500) are always a multiple of 100.';

GRANT EXECUTE ON FUNCTION public.lt_snap_ranking_multiplier(numeric)
    TO authenticated, service_role;


-- Same body as 20260716230100, with the snap applied to the product.
CREATE OR REPLACE FUNCTION public.lt_tournament_ranking_multiplier(p_tournament_id uuid)
RETURNS TABLE (draw_size integer, multiplier numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t          tournaments;
    v_n          integer;
    v_draw_mult  numeric;
    v_level_mult numeric;
BEGIN
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION 'RANKING_TOURNAMENT_NOT_FOUND: %', p_tournament_id;
    END IF;

    SELECT count(DISTINCT s.reg) INTO v_n
      FROM (
        SELECT player1_registration_id AS reg, player1_is_bye AS is_bye
          FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
        UNION ALL
        SELECT player2_registration_id, player2_is_bye
          FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
      ) s
     WHERE s.reg IS NOT NULL AND s.is_bye = false;

    IF coalesce(v_n, 0) = 0 THEN
        SELECT count(*) INTO v_n
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND status = 'registered';
    END IF;

    v_draw_mult  := public.lt_draw_multiplier(v_n);
    v_level_mult := public.lt_min_rating_level_multiplier(v_t.sport_id, v_t.min_rating);

    draw_size  := v_n;
    multiplier := public.lt_snap_ranking_multiplier(v_draw_mult * v_level_mult);
    RETURN NEXT;
END;
$$;


-- Ceiling stamp: same snap on the capacity projection.
CREATE OR REPLACE FUNCTION public.tournaments_set_ranking_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.ranking_points_ceiling := round(
        public.lt_champion_base()
        * public.lt_snap_ranking_multiplier(
            public.lt_draw_multiplier(NEW.max_participants)
            * public.lt_min_rating_level_multiplier(NEW.sport_id, NEW.min_rating)
          )
    );
    RETURN NEW;
END;
$$;


-- Re-stamp advertised ceilings under the snapped multiplier.
UPDATE public.tournaments
   SET ranking_points_ceiling = round(
         public.lt_champion_base()
         * public.lt_snap_ranking_multiplier(
             public.lt_draw_multiplier(max_participants)
             * public.lt_min_rating_level_multiplier(sport_id, min_rating)
           )
       );

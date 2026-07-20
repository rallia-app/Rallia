-- ============================================================================
-- Circuit Rallia — continuous level multiplier (per rating step, not buckets)
-- ============================================================================
-- The bucket-based multiplier (20260716230100) mapped the min_rating floor
-- through lt_rating_skill_bucket → 1.0 / 1.15 / 1.3, which made every floor
-- inside a band worth the same: a 4.0-floor draw priced identically to a
-- 3.0-floor one (both 'intermediate' on the tennis scale), with a cliff at 4.5.
--
-- This replaces the CASE with linear interpolation over the floor's RANK in
-- the sport's rating scale, from ×1.0 at the scale's bottom step to ×2.0 at
-- its top step:
--
--   mult(floor) = 1 + (rank − 1) / (n − 1)
--
-- Rank-based (not value-based) so it needs no per-sport constants: any scale,
-- tennis or pickleball, spans exactly ×1.0 → ×2.0. On the 10-step tennis
-- scale each 0.5 cran is worth ~+0.111 (~+111 champion points on a 32 draw).
-- NULL floor (open event) stays ×1.0.
--
-- Callers are unchanged: the bracket-time stamp (tournaments_stamp_ranking)
-- and the ceiling stamp (tournaments_set_ranking_ceiling) both resolve through
-- this function. No bracket has been generated anywhere yet, so no firm
-- ranking_multiplier is re-priced — only advertised ceilings, re-stamped below.
-- lt_rating_skill_bucket itself is untouched (the board's level filter and the
-- ledger's level_bucket snapshot keep their 3-band semantics).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_min_rating_level_multiplier(
    p_sport_id uuid, p_min_rating numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_n    integer;
    v_rank integer;
BEGIN
    IF p_min_rating IS NULL THEN
        RETURN 1.0;
    END IF;

    -- rank = position of the highest scale step at or below the floor.
    SELECT count(*), count(*) FILTER (WHERE value <= p_min_rating)
      INTO v_n, v_rank
      FROM rating_score
     WHERE rating_system_id = lt_sport_rating_system(p_sport_id);

    IF coalesce(v_n, 0) < 2 OR v_rank < 1 THEN
        RETURN 1.0;
    END IF;

    RETURN round(1.0 + (v_rank - 1)::numeric / (v_n - 1), 3);
END;
$$;

COMMENT ON FUNCTION public.lt_min_rating_level_multiplier(uuid, numeric) IS
  'Level component of the Circuit Rallia multiplier: linear in the min_rating '
  'floor''s rank within the sport''s rating scale, ×1.0 (bottom step or no '
  'floor) → ×2.0 (top step).';


-- Re-stamp advertised ceilings under the new curve (the trigger only fires on
-- input-column changes, so existing rows keep stale values without this).
UPDATE public.tournaments
   SET ranking_points_ceiling = round(
         public.lt_champion_base()
         * public.lt_draw_multiplier(max_participants)
         * public.lt_min_rating_level_multiplier(sport_id, min_rating)
       );

-- ============================================================================
-- Circuit Rallia — category-doubling level multiplier (Série 1: 500/1000/2000)
-- ============================================================================
-- The continuous curve (20260717130000) spans ×1.0→×2.0 linearly over the
-- scale, headlining Série 1 at 1000/1300/1600. Too flat for a shared board:
-- a Débutant champion (1000) outranked an Avancé finalist (960).
--
-- Replace it with a doubling ladder anchored at the scale's first
-- intermediate rung (per lt_rating_skill_bucket):
--
--   rank ≥ anchor:  2^((rank − anchor) / 2)        doubles every 2 rungs
--                                                  (= every 1.0 on tennis)
--   rank < anchor:  0.5 · 2^((rank − 1)/(anchor − 1))
--                                                  ×0.5 at the bottom rung,
--                                                  joins the anchor at ×1.0
--
-- Tennis (anchor 3.0): 1.5→×0.5 · 3.0→×1.0 · 3.5→×1.414 · 4.0→×2.0 ·
-- 4.5→×2.828 · 5.0→×4.0. Série 1 (32-cap, draw ×2.0) headlines 500/1000/2000;
-- Avancé finalist (1200) > Inter champion (1000) > Inter finalist (600) >
-- Débutant champion (500). NULL floor (open event) stays ×1.0.
--
-- Strictly monotonic per rung, so the 0.2 snap (20260717140000) still never
-- inverts ordering and champion headlines stay multiples of 100 (the three
-- Série 1 combined multipliers land on the grid exactly: 1.0 / 2.0 / 4.0).
-- No firm ranking_multiplier is re-priced (no bracket generated anywhere);
-- advertised ceilings are re-stamped below.
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
    v_n      integer;
    v_rank   integer;
    v_anchor integer;
BEGIN
    IF p_min_rating IS NULL THEN
        RETURN 1.0;
    END IF;

    -- rank = position of the highest scale step at or below the floor;
    -- anchor = position of the scale's first intermediate step.
    SELECT count(*),
           count(*) FILTER (WHERE value <= p_min_rating),
           min(rnk) FILTER (WHERE bucket = 'intermediate')
      INTO v_n, v_rank, v_anchor
      FROM (
        SELECT value,
               row_number() OVER (ORDER BY value) AS rnk,
               public.lt_rating_skill_bucket(skill_level) AS bucket
          FROM rating_score
         WHERE rating_system_id = lt_sport_rating_system(p_sport_id)
      ) s;

    IF coalesce(v_n, 0) < 2 OR v_rank < 1 THEN
        RETURN 1.0;
    END IF;
    IF v_anchor IS NULL OR v_anchor < 2 THEN
        v_anchor := 1;  -- degenerate scale: double from the bottom rung
    END IF;

    IF v_rank >= v_anchor THEN
        RETURN round(power(2.0, (v_rank - v_anchor)::numeric / 2.0), 3);
    END IF;
    RETURN round(0.5 * power(2.0, (v_rank - 1)::numeric / (v_anchor - 1)), 3);
END;
$$;

COMMENT ON FUNCTION public.lt_min_rating_level_multiplier(uuid, numeric) IS
  'Level component of the Circuit Rallia multiplier: ×1.0 at the scale''s '
  'first intermediate rung (or no floor), doubling every 2 rungs above it, '
  '×0.5 at the bottom rung joining the anchor geometrically.';


-- Re-stamp advertised ceilings under the new curve (the trigger only fires on
-- input-column changes, so existing rows keep stale values without this).
UPDATE public.tournaments
   SET ranking_points_ceiling = round(
         public.lt_champion_base()
         * public.lt_snap_ranking_multiplier(
             public.lt_draw_multiplier(max_participants)
             * public.lt_min_rating_level_multiplier(sport_id, min_rating)
           )
       );

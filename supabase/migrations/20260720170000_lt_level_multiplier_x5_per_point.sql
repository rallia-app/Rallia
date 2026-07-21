-- ============================================================================
-- Circuit Rallia — level multiplier: ×5 per rating point, capped at ×16
-- ============================================================================
-- Retunes the curve from 20260720160000 (×4 per rating point) to land the
-- Série 1 headlines on 200 / 1000 / 5000 (32-cap: Débutant 1.5, Inter 3.0,
-- Avancé 4.0). Same shape, three constants moved:
--
--   rank ≥ anchor:  min(5^((rank − anchor) / 2), 16)     √5 ≈ ×2.236 per rung
--   rank < anchor:  0.2^((anchor − rank) / (anchor − 1))
--
-- Tennis (anchor 3.0): 1.5→×0.2 · 2.0→×0.342 · 2.5→×0.585 · 3.0→×1.0 ·
-- 3.5→×2.236 · 4.0→×5.0 · 4.5→×11.18 · 5.0+→×16.
--
-- Why this is the widest sane setting, not just a bigger number: participation
-- is flat 20 (20260720130000) and the combined multiplier bottoms out at the
-- snap floor of ×0.2, so past roughly this width the low categories invert —
-- at ×8 per point a Débutant R16 exit pays 10 while losing round one pays 20,
-- i.e. winning two matches would cost you points. Here the Débutant R16 lands
-- on exactly 20: it ties participation, never dips under it. Anything wider
-- would need participation lowered or every placement floored at 20 first.
--
-- The ×16 cap carries over unchanged and now binds at tennis 5.0 (and
-- pickleball 5.5), holding the biggest possible event at 16,000.
--
-- Strictly monotonic per rung below the cap, so the 0.2 snap (20260717140000)
-- still never inverts ordering. NULL floor (open event) stays ×1.0.
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
        v_anchor := 1;  -- degenerate scale: climb from the bottom rung
    END IF;

    IF v_rank >= v_anchor THEN
        RETURN least(round(power(5.0, (v_rank - v_anchor)::numeric / 2.0), 3), 16.0);
    END IF;
    RETURN round(power(0.2, (v_anchor - v_rank)::numeric / (v_anchor - 1)), 3);
END;
$$;

COMMENT ON FUNCTION public.lt_min_rating_level_multiplier(uuid, numeric) IS
  'Level component of the Circuit Rallia multiplier: ×1.0 at the scale''s '
  'first intermediate rung (or no floor), ×5 per full rating point above it up '
  'to a ×16 cap, ×0.2 at the bottom rung joining the anchor geometrically.';


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

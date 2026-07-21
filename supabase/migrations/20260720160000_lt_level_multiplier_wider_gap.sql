-- ============================================================================
-- Circuit Rallia — widen the level gap: ×4 per rating point, capped at ×16
-- ============================================================================
-- The category-doubling curve (20260720120000) doubled every 2 rungs (×2 per
-- full rating point), headlining Série 1 at 500/1000/2000. On a shared board
-- that is still too flat: eight Débutant titles (4000) outscored eight Avancé
-- quarterfinals (2880), so volume in an easy field beat real results in a hard
-- one across a best-8 season.
--
-- Double every rung instead — ×4 per full rating point — and lower the bottom
-- rung to ×0.25:
--
--   rank ≥ anchor:  min(2^(rank − anchor), 16)
--   rank < anchor:  0.25^((anchor − rank) / (anchor − 1))
--
-- Tennis (anchor 3.0): 1.5→×0.25 · 2.0→×0.397 · 2.5→×0.63 · 3.0→×1.0 ·
-- 3.5→×2.0 · 4.0→×4.0 · 4.5→×8.0 · 5.0+→×16. Série 1 (32-cap, draw ×2.0)
-- headlines 300/1000/4000: an Avancé R16 exit (400) now edges a Débutant title
-- (300), and an Avancé quarterfinal (720) beats two of them.
--
-- The ×16 cap is new and load-bearing. Uncapped, tennis 5.5/6.0 reach ×32/×55.7
-- and a single 6.0-floor 32-draw would pay 27,900 — more than a perfect 8-event
-- Avancé season, which makes the season score meaningless. ×16 lands on the
-- 4th rung above the anchor (tennis 5.0, pickleball 5.5) and flattens
-- everything above it.
--
-- Participation stays flat 20 in every category (20260720130000), so this only
-- widens the upside of a hard field, never the downside. Entering up is already
-- impossible (tournament_register's min_rating gate), and entering DOWN now
-- pays even less, so the wider spread can't be farmed from either direction.
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
        v_anchor := 1;  -- degenerate scale: double from the bottom rung
    END IF;

    IF v_rank >= v_anchor THEN
        RETURN least(round(power(2.0, (v_rank - v_anchor)::numeric), 3), 16.0);
    END IF;
    RETURN round(power(0.25, (v_anchor - v_rank)::numeric / (v_anchor - 1)), 3);
END;
$$;

COMMENT ON FUNCTION public.lt_min_rating_level_multiplier(uuid, numeric) IS
  'Level component of the Circuit Rallia multiplier: ×1.0 at the scale''s '
  'first intermediate rung (or no floor), doubling every rung above it up to a '
  '×16 cap, ×0.25 at the bottom rung joining the anchor geometrically.';


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

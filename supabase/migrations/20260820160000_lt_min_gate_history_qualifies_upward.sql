-- ============================================================================
-- Rating band: 180-day history qualifies a player UPWARD past min_rating
-- ============================================================================
-- The prize-draw ceiling (20260814200000) checks max_rating against the
-- player's 180-day history max, while min_rating still reads the current
-- rating. A player whose genuine drop crosses a band boundary is then judged
-- by the stricter measure on each side and ends up with NO eligible draw:
-- found live on prod 2026-08-20 (Série 2, current 3.5 / history max 4.0 —
-- refused from 3.0–3.5 by the ceiling AND from 4.0+ by the floor).
--
-- Fix: the floor passes if the current rating OR the 180-day history max
-- meets it. For prize draws this makes the model symmetric — you are banded
-- on your 180-day ceiling on both sides — and restores the invariant that
-- every player is eligible for the draw containing that ceiling. Sandbagging
-- protection is untouched: the max side does not change, and qualifying
-- upward is prize-neutral (nobody farms a pool by playing above their level).
--
-- Lives here in lt_assert_rating_band, not the ceiling trigger: the refusal
-- to relax is raised by this helper inside the entry RPCs, before any row
-- exists for a trigger to see. The helper does not know whether a prize is
-- attached, so the relaxation applies to free draws too — deliberate: it only
-- ever admits someone whose recent history already cleared the floor, and it
-- avoids rewriting the ~10 call sites threading a prize flag would require.
--
-- An admin-accepted drop (admin_clear_rating_ceiling) collapses the history
-- max to the current rating, which removes the upward qualification along
-- with the ceiling — coherent: the player then belongs at their current level.
--
-- Same signature, so existing grants stand and no call site changes. Body
-- copied from 20260725120000 (latest definition); only the floor check is new.
-- No new refusal codes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_assert_rating_band(
    p_user_id  uuid,
    p_sport_id uuid,
    p_min      numeric,
    p_max      numeric,
    p_partner  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_prefix  text := CASE WHEN p_partner THEN 'PARTNER_' ELSE '' END;
    v_rating  double precision;
    v_ceiling double precision;
BEGIN
    IF p_min IS NULL AND p_max IS NULL THEN
        RETURN;
    END IF;

    -- active_rating_score_id is the canonical rating path.
    SELECT rs.value INTO v_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE ps.player_id = p_user_id
       AND ps.sport_id  = p_sport_id;

    IF v_rating IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_REQUIRED';
    END IF;
    IF p_min IS NOT NULL AND v_rating < p_min THEN
        -- The floor also accepts the 180-day history max (cleared rows excluded).
        v_ceiling := public.player_rating_ceiling(
            p_user_id, p_sport_id, public.lt_prize_rating_ceiling_days());
        IF v_ceiling IS NULL OR v_ceiling < p_min THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_TOO_LOW';
        END IF;
    END IF;
    IF p_max IS NOT NULL AND v_rating > p_max THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_TOO_HIGH';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.lt_assert_rating_band(uuid, uuid, numeric, numeric, boolean) IS
  'Band gate for entry paths. The floor passes on the current rating OR the '
  '180-day history max, so the prize ceiling can never leave a player with no '
  'eligible draw. The cap reads the current rating only; prize draws also '
  'enforce the 180-day ceiling on it via lt_enforce_prize_rating_ceiling.';

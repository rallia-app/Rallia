-- ============================================================================
-- Circuit Rallia — advertised points ceiling (the "up to 500" on the card)
-- ============================================================================
-- The point of a declared scoring model is that a player can see what an event
-- is worth before entering. ranking_multiplier delivers that, but only once the
-- bracket is generated — before that there is no stamp, and the card would show
-- nothing during the exact window (registration) when it matters most.
--
-- The projection needs min_rating resolved to a level multiplier, which is DB
-- reference data (rating_score.skill_level) the client can't cheaply derive per
-- card. Rather than duplicate that resolution on the client or fire one query
-- per list row, this stamps a `ranking_points_ceiling` — the champion's points
-- at FULL capacity — maintained by a trigger. The card reads one column.
--
--   ceiling = round(500 × draw_mult(max_participants) × level_mult(min_rating))
--
-- max_participants is the ceiling draw (capacity), so this is the most the
-- champion can earn — hence "up to". Once the bracket generates, the UI switches
-- to the firm value round(500 × ranking_multiplier), which the client computes
-- directly (no reference data needed). Both use the shared helpers from
-- 20260716230100, so the ceiling and the eventual real value can't drift.
--
-- 500 is the champion base (see award_tournament_ranking_points). Kept as a
-- single source: lt_champion_base().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_champion_base()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 500 $$;

COMMENT ON FUNCTION public.lt_champion_base() IS
  'Points a champion earns at multiplier 1.0. The headline value every Circuit '
  'Rallia projection scales from.';


ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS ranking_points_ceiling integer;

COMMENT ON COLUMN public.tournaments.ranking_points_ceiling IS
  'Champion points at full capacity: round(500 × draw_mult(max_participants) × '
  'level_mult(min_rating)). The "up to N points" shown before the bracket is '
  'generated. Maintained by tournaments_set_ranking_ceiling.';


CREATE OR REPLACE FUNCTION public.tournaments_set_ranking_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.ranking_points_ceiling := round(
        public.lt_champion_base()
        * public.lt_draw_multiplier(NEW.max_participants)
        * public.lt_min_rating_level_multiplier(NEW.sport_id, NEW.min_rating)
    );
    RETURN NEW;
END;
$$;

-- Only recompute when an input actually changes (or on insert). max_participants
-- and min_rating are both draft-locked, so in practice this fires at create and
-- during draft edits — never mid-registration.
DROP TRIGGER IF EXISTS tournaments_set_ranking_ceiling ON public.tournaments;
CREATE TRIGGER tournaments_set_ranking_ceiling
    BEFORE INSERT OR UPDATE OF max_participants, min_rating, sport_id
    ON public.tournaments
    FOR EACH ROW
    EXECUTE FUNCTION public.tournaments_set_ranking_ceiling();


-- Backfill every existing row (the trigger only covers future writes).
UPDATE public.tournaments
   SET ranking_points_ceiling = round(
         public.lt_champion_base()
         * public.lt_draw_multiplier(max_participants)
         * public.lt_min_rating_level_multiplier(sport_id, min_rating)
       );

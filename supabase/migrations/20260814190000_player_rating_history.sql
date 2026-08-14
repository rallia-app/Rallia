-- ============================================================================
-- Rating history — the ledger a money-draw rating ceiling can be built on
-- ============================================================================
-- Prize draws are rating-banded (lt_assert_rating_band, 20260725120000) and the
-- Série 2 events now carry a real pool. That pairing creates a sandbagging
-- incentive: drop your level, enter a band you would otherwise fail, collect.
--
-- The gate cannot defend against this today because it reads only the CURRENT
-- active rating, and a player fully owns that value. RLS lets them insert,
-- update and delete their own player_rating_score rows (20260320100000), and
-- player_sport.active_rating_score_id is a plain column UPDATE. Nothing keeps a
-- record of what the rating used to be: previous_rating_score_id and
-- level_changed_at exist on the row but no trigger and no client ever writes
-- them, and both die with the row anyway.
--
-- So the ceiling rule ("for a money draw you are held to the highest level you
-- have represented in the last N days") needs a ledger that survives row
-- deletion. This migration adds it, backfills a day-zero baseline, and stops
-- there. NOTHING here changes who can enter what: the gate is untouched and
-- player_rating_ceiling has no callers. That is deliberate — the ledger has to
-- accumulate before a rule written against it means anything.
--
-- What gets logged is the ACTIVE rating per (player, sport), i.e. exactly the
-- quantity lt_assert_rating_band compares, so the future ceiling is a MAX over
-- the same measure the gate already uses. Two properties fall out of that:
--
--   * Values stay comparable. rating_system_one_active_per_sport
--     (20260716230000) guarantees one scale per sport, so MAX is meaningful.
--     A held-but-never-activated score is ignored, which is right: the gate
--     never saw it either.
--   * Laundering is closed. All three ways down write a row — editing the
--     value in place, flipping the pointer to a lower score, and deleting the
--     high score outright (ON DELETE SET NULL nulls the pointer, which is
--     itself a logged change, and activating the replacement logs again).
-- ============================================================================

-- ------------------------------------------------------------------ 1. ledger
CREATE TABLE IF NOT EXISTS public.player_rating_history (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id       uuid NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
    sport_id        uuid NOT NULL REFERENCES public.sport(id)  ON DELETE CASCADE,
    rating_score_id uuid REFERENCES public.rating_score(id)    ON DELETE SET NULL,
    rating_value    double precision,
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_rating_history IS
  'Append-only log of the ACTIVE rating per (player, sport), one row per change. '
  'Written by trigger only. Outlives player_rating_score deletion, which is the '
  'whole point: a rating a player has since deleted still counts against them.';

COMMENT ON COLUMN public.player_rating_history.rating_value IS
  'Denormalised from rating_score.value at write time so the ceiling survives '
  'the score row being deleted. NULL = the player had no active rating.';

CREATE INDEX IF NOT EXISTS idx_player_rating_history_lookup
    ON public.player_rating_history (player_id, sport_id, recorded_at DESC);

ALTER TABLE public.player_rating_history ENABLE ROW LEVEL SECURITY;

-- Readable by the player it describes (they are entitled to see why a draw
-- would refuse them) and by admins. No write policy at all: the trigger
-- functions are SECURITY DEFINER and own the table, so they bypass RLS, and
-- nobody else may forge or erase an entry.
DROP POLICY IF EXISTS player_rating_history_select ON public.player_rating_history;
CREATE POLICY player_rating_history_select ON public.player_rating_history
    FOR SELECT TO authenticated
    USING (
        player_id = (SELECT auth.uid())
        OR (SELECT public.is_admin())
    );

GRANT SELECT ON public.player_rating_history TO authenticated;
GRANT ALL    ON public.player_rating_history TO service_role;

-- ----------------------------------------------------------------- 2. writer
-- Resolves the player's current active rating for the sport and appends it if
-- it differs from the last entry. The no-change short-circuit keeps the table
-- small (the pointer is rewritten by unrelated flows) and makes both the
-- backfill and any replay idempotent.
CREATE OR REPLACE FUNCTION public.log_active_rating_change(
    p_player_id uuid,
    p_sport_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_score_id  uuid;
    v_value     double precision;
    v_last_id   uuid;
    v_last_val  double precision;
    v_have_last boolean;
BEGIN
    SELECT prs.rating_score_id, rs.value
      INTO v_score_id, v_value
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs         ON rs.id  = prs.rating_score_id
     WHERE ps.player_id = p_player_id
       AND ps.sport_id  = p_sport_id;

    SELECT h.rating_score_id, h.rating_value, true
      INTO v_last_id, v_last_val, v_have_last
      FROM player_rating_history h
     WHERE h.player_id = p_player_id
       AND h.sport_id  = p_sport_id
     ORDER BY h.recorded_at DESC, h.id DESC
     LIMIT 1;

    IF v_have_last
       AND v_last_id  IS NOT DISTINCT FROM v_score_id
       AND v_last_val IS NOT DISTINCT FROM v_value THEN
        RETURN;
    END IF;

    INSERT INTO player_rating_history (player_id, sport_id, rating_score_id, rating_value)
    VALUES (p_player_id, p_sport_id, v_score_id, v_value);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_active_rating_change(uuid, uuid) FROM PUBLIC;

-- --------------------------------------------------------------- 3. triggers
-- Pointer moved: a new score activated, or nulled by the active one being
-- deleted. Covers auto_activate_first_player_rating too, which reaches
-- player_sport by UPDATE.
CREATE OR REPLACE FUNCTION public.trg_log_rating_change_from_player_sport()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM log_active_rating_change(NEW.player_id, NEW.sport_id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS player_sport_log_rating_change ON public.player_sport;
CREATE TRIGGER player_sport_log_rating_change
    AFTER INSERT OR UPDATE OF active_rating_score_id ON public.player_sport
    FOR EACH ROW EXECUTE FUNCTION public.trg_log_rating_change_from_player_sport();

-- Level edited in place on the row that is currently active. The pointer never
-- moves here, so the trigger above would not see it.
CREATE OR REPLACE FUNCTION public.trg_log_rating_change_from_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sport_id uuid;
BEGIN
    SELECT ps.sport_id
      INTO v_sport_id
      FROM player_sport ps
     WHERE ps.player_id              = NEW.player_id
       AND ps.active_rating_score_id = NEW.id;

    IF v_sport_id IS NOT NULL THEN
        PERFORM log_active_rating_change(NEW.player_id, v_sport_id);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS player_rating_score_log_rating_change ON public.player_rating_score;
CREATE TRIGGER player_rating_score_log_rating_change
    AFTER UPDATE OF rating_score_id ON public.player_rating_score
    FOR EACH ROW EXECUTE FUNCTION public.trg_log_rating_change_from_score();

-- --------------------------------------------------------------- 4. backfill
-- Day-zero baseline: every player's current active rating, stamped now(). Not
-- backdated — we do not know when these were set, and inventing a date would
-- put a fictional entry inside whatever window the ceiling ends up using.
-- Practical effect: from today, any drop is detectable; before today, nothing
-- is, which is unavoidable.
INSERT INTO public.player_rating_history (player_id, sport_id, rating_score_id, rating_value)
SELECT ps.player_id, ps.sport_id, prs.rating_score_id, rs.value
  FROM public.player_sport ps
  JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
  JOIN public.rating_score rs         ON rs.id  = prs.rating_score_id
 WHERE NOT EXISTS (
     SELECT 1 FROM public.player_rating_history h
      WHERE h.player_id = ps.player_id
        AND h.sport_id  = ps.sport_id
 );

-- ---------------------------------------------------------------- 5. reader
-- The ceiling the money-draw gate will compare against: the highest level the
-- player has represented for this sport within p_days, current rating
-- included. Deliberately uncalled for now — defined here so the semantics live
-- next to the ledger that feeds them, and so the data can be inspected before
-- any rule is switched on.
CREATE OR REPLACE FUNCTION public.player_rating_ceiling(
    p_player_id uuid,
    p_sport_id  uuid,
    p_days      integer
)
RETURNS double precision
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT MAX(h.rating_value)
      FROM player_rating_history h
     WHERE h.player_id = p_player_id
       AND h.sport_id  = p_sport_id
       AND h.recorded_at >= now() - make_interval(days => p_days);
$$;

COMMENT ON FUNCTION public.player_rating_ceiling(uuid, uuid, integer) IS
  'Highest active rating the player has represented for this sport in the last '
  'p_days. NULL when the window holds no rated entry. Intended as the value a '
  'prize-draw rating band is enforced against, so that moving up is instant '
  'while moving down only takes effect after the window.';

GRANT EXECUTE ON FUNCTION public.player_rating_ceiling(uuid, uuid, integer) TO authenticated, service_role;

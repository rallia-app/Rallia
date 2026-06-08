-- =============================================================================
-- Explicit "active rating" per sport
--
-- A player can hold several rating scores for one sport (self / DUPR / UTR /
-- NTRP ...). Until now the single rating a player "represents" for a sport was
-- only ever *inferred* by a certified-then-most-recent heuristic, duplicated
-- across the suggestion RPCs, the search RPCs and the nearby-match notification
-- trigger. This makes that choice explicit and player-owned.
--
-- The marker lives on player_sport (active_rating_score_id) rather than as a
-- boolean on player_rating_score: player_sport is UNIQUE(player_id, sport_id),
-- so a single FK column structurally guarantees AT MOST ONE active rating per
-- sport — no denormalised sport_id, no partial unique index, no per-sport
-- de-activation trigger. Selecting a new active rating is a plain column UPDATE
-- that replaces the previous one (the "pick new → old turns off, no errors"
-- behaviour) for free.
--
--   * Validator trigger  — the referenced player_rating_score must belong to the
--                          same player and resolve to this row's sport.
--   * Auto-activate      — when a player gains their first rating for a sport
--                          (active is still NULL) it becomes active; additional
--                          ratings never override an existing explicit choice.
--   * Backfill           — seed each player_sport with the current effective
--                          rating so day-one behaviour is identical.
--
-- NOTE: ON DELETE SET NULL means deleting the active rating leaves the pointer
-- NULL until the player (or app) picks another. Auto-promotion on delete is
-- intentionally out of scope here.
-- =============================================================================

ALTER TABLE public.player_sport
  ADD COLUMN IF NOT EXISTS active_rating_score_id uuid
    REFERENCES public.player_rating_score (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.player_sport.active_rating_score_id IS
  'The player_rating_score the player currently represents for this sport. '
  'NULL = none selected (consumers may fall back to the certified-then-recent heuristic).';

-- --------------------------------------------------------------------------
-- Validator: keep the pointer pointing at one of THIS player''s ratings, in
-- THIS sport.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_player_sport_active_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_sport_id uuid;
BEGIN
  IF NEW.active_rating_score_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT prs.player_id, rsys.sport_id
    INTO v_owner_id, v_sport_id
  FROM player_rating_score prs
  JOIN rating_score  rs   ON rs.id   = prs.rating_score_id
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  WHERE prs.id = NEW.active_rating_score_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'active_rating_score_id % does not reference an existing player_rating_score', NEW.active_rating_score_id;
  END IF;

  IF v_owner_id <> NEW.player_id THEN
    RAISE EXCEPTION 'active_rating_score_id % belongs to player %, not %', NEW.active_rating_score_id, v_owner_id, NEW.player_id;
  END IF;

  IF v_sport_id <> NEW.sport_id THEN
    RAISE EXCEPTION 'active_rating_score_id % is for a different sport than player_sport %', NEW.active_rating_score_id, NEW.sport_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS player_sport_validate_active_rating ON public.player_sport;
CREATE TRIGGER player_sport_validate_active_rating
  BEFORE INSERT OR UPDATE OF active_rating_score_id ON public.player_sport
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_sport_active_rating();

-- --------------------------------------------------------------------------
-- Auto-activate the first rating a player gains for a sport. Never overrides an
-- existing explicit selection (only fills when active_rating_score_id IS NULL).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_activate_first_player_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sport_id uuid;
BEGIN
  SELECT rsys.sport_id
    INTO v_sport_id
  FROM rating_score  rs
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  WHERE rs.id = NEW.rating_score_id;

  IF v_sport_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE player_sport ps
  SET active_rating_score_id = NEW.id
  WHERE ps.player_id = NEW.player_id
    AND ps.sport_id  = v_sport_id
    AND ps.active_rating_score_id IS NULL;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS player_rating_score_auto_activate ON public.player_rating_score;
CREATE TRIGGER player_rating_score_auto_activate
  AFTER INSERT ON public.player_rating_score
  FOR EACH ROW EXECUTE FUNCTION public.auto_activate_first_player_rating();

-- --------------------------------------------------------------------------
-- Backfill: seed each player_sport's active rating with the current effective
-- rating (certified-status first, then most-recently assigned) — the same
-- heuristic the suggestion/search/notification paths use today, so behaviour is
-- unchanged until players start choosing explicitly.
-- --------------------------------------------------------------------------
WITH effective AS (
  SELECT DISTINCT ON (prs.player_id, rsys.sport_id)
    prs.player_id,
    rsys.sport_id,
    prs.id AS player_rating_score_id
  FROM player_rating_score prs
  JOIN rating_score  rs   ON rs.id   = prs.rating_score_id
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  ORDER BY prs.player_id, rsys.sport_id,
    CASE
      WHEN prs.badge_status = 'certified'::badge_status_enum
        OR prs.is_certified
        OR prs.referrals_count >= 3
        OR prs.approved_proofs_count >= 1 THEN 2
      WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
      ELSE 1
    END DESC,
    prs.assigned_at DESC NULLS LAST
)
UPDATE public.player_sport ps
SET active_rating_score_id = e.player_rating_score_id
FROM effective e
WHERE e.player_id = ps.player_id
  AND e.sport_id  = ps.sport_id
  AND ps.active_rating_score_id IS NULL;

-- ============================================================================
-- Circuit Rallia — replace the tier model with a stamped ranking multiplier
-- ============================================================================
-- The old tier (local / regional / vedette) priced an event from three measured
-- properties of the field: entry count, the AVERAGE skill of the entrants, and
-- the fraction of them carrying a rating. Two of those three fail the fairness
-- test — a player controls neither their opponents' skill nor whether those
-- opponents filled in a rating — and rated_frac in particular meant your points
-- could halve because somebody else's profile was incomplete. The tier also
-- moved in 2x steps at n=16 and strength=2.5, so one extra entrant could double
-- everyone's score, and its 'local' branch flattened a 4-draw champion onto the
-- same 10 points as the player who lost in round one.
--
-- The replacement:
--
--     points = placement × draw_mult × level_mult
--
--   draw_mult  = greatest(0.25, 0.5 × (log2(n) − 1))   — smooth, no cliffs.
--                4→0.5  8→1.0  16→1.5  32→2.0  64→2.5, and a 12-entry draw
--                lands at 1.29 instead of falling off a step.
--   level_mult = the floor the organizer set (min_rating, hard-gated as of
--                20260716210000), resolved to a skill bucket via
--                lt_rating_skill_bucket — the same bucketing the board's level
--                filter uses, so a level means one thing everywhere:
--                none/beginner 1.0, intermediate 1.15, advanced 1.3
--                (professional folds into advanced).
--
-- Both inputs are facts the player could see before entering, which is the
-- whole point. An 8-draw open champion still scores 500, exactly as before, so
-- existing boards do not lurch.
--
-- The multiplier is STAMPED on the tournament when the bracket is generated —
-- the moment registrations become draw slots and n stops moving. Note that
-- bracket_locked_at is NOT that moment: per 20260510170007 it only flips when
-- the first non-bye match completes, which is after play has started. Stamping
-- also pins an event's price at the time it ran, so tuning the curve later
-- cannot silently rewrite history through the award's delete-and-recompute.
--
-- Kept: the zero-win floor. A bye is not a win, and that rule is a fairness
-- feature rather than an accident.
-- ============================================================================


-- --------------------------------------------
-- 1. Stamp columns
-- --------------------------------------------
ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS ranking_draw_size  smallint,
    ADD COLUMN IF NOT EXISTS ranking_multiplier numeric(5,3);

COMMENT ON COLUMN public.tournaments.ranking_draw_size IS
  'Real (non-bye) entries in the main bracket, frozen when the bracket was '
  'generated. The draw size Circuit Rallia actually priced.';
COMMENT ON COLUMN public.tournaments.ranking_multiplier IS
  'draw_mult × level_mult, stamped at bracket generation by '
  'tournaments_stamp_ranking. Every Points Rallia award for this event is '
  'scaled by this exact number.';


-- --------------------------------------------
-- 2. Ledger: tier is gone, the multiplier that priced the row replaces it.
--    Nothing reads `tier` (no app or SQL consumer) and the new model has no
--    discrete tiers, so keeping it would mean writing a fabricated value.
-- --------------------------------------------
ALTER TABLE public.tournament_ranking_points DROP COLUMN IF EXISTS tier;

ALTER TABLE public.tournament_ranking_points
    ADD COLUMN IF NOT EXISTS multiplier numeric(5,3) NOT NULL DEFAULT 1.0;
ALTER TABLE public.tournament_ranking_points ALTER COLUMN multiplier DROP DEFAULT;

COMMENT ON COLUMN public.tournament_ranking_points.multiplier IS
  'The tournament ranking_multiplier this row was scored with. Recorded per row '
  'so a result stays auditable even if the event is later recomputed.';


-- --------------------------------------------
-- 3. Pricing helpers — shared so the live multiplier and the advertised
--    ceiling (20260716230200) can never drift apart.
-- --------------------------------------------

-- Smooth draw-size curve in log2(n): no single extra entrant is ever worth a
-- step change. Clamped because log2 hits 0 at n=2 and goes negative at n=1.
-- 4→0.5  8→1.0  16→1.5  32→2.0  64→2.5.
CREATE OR REPLACE FUNCTION public.lt_draw_multiplier(p_n integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT greatest(0.25, 0.5 * (log(2.0, greatest(coalesce(p_n, 0), 1)::numeric) - 1));
$$;

-- Level multiplier for a floor, read through the sport's single active rating
-- system (see lt_sport_rating_system). No floor = open event = 1.0. Takes the
-- highest score at or below min_rating, so a floor that doesn't land exactly on
-- a rung still resolves to the level it implies. Bucketed via
-- lt_rating_skill_bucket, so pricing and the board's level filter share one
-- definition of a level (professional folds into advanced).
CREATE OR REPLACE FUNCTION public.lt_min_rating_level_multiplier(
    p_sport_id uuid, p_min_rating numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_skill skill_level;
BEGIN
    IF p_min_rating IS NULL THEN
        RETURN 1.0;
    END IF;

    SELECT rs.skill_level INTO v_skill
      FROM rating_score rs
     WHERE rs.rating_system_id = lt_sport_rating_system(p_sport_id)
       AND rs.value <= p_min_rating
     ORDER BY rs.value DESC
     LIMIT 1;

    RETURN CASE public.lt_rating_skill_bucket(v_skill)
        WHEN 'advanced'     THEN 1.3
        WHEN 'intermediate' THEN 1.15
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lt_draw_multiplier(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lt_min_rating_level_multiplier(uuid, numeric)
    TO authenticated, service_role;


-- --------------------------------------------
-- 3b. The live pricing function
-- --------------------------------------------
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

    -- Field size = distinct real (non-bye) entries in the main bracket: the
    -- exact set award_tournament_ranking_points scores, so the stamp can never
    -- disagree with what played. Before a bracket exists, fall back to active
    -- registrations so the card can project a value during registration.
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
    multiplier := round(v_draw_mult * v_level_mult, 3);
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.lt_tournament_ranking_multiplier(uuid) IS
  'What a tournament is worth: draw_mult (smooth log2 of real entries) × '
  'level_mult (min_rating resolved to a skill level). Used to stamp the event '
  'at bracket generation, and callable live for a projection during '
  'registration.';

GRANT EXECUTE ON FUNCTION public.lt_tournament_ranking_multiplier(uuid)
    TO authenticated, service_role;


-- --------------------------------------------
-- 4. Stamp at bracket generation
-- --------------------------------------------
-- tournament_generate_bracket inserts the matches and then flips the tournament
-- to 'in_progress' in the same transaction, so an AFTER UPDATE trigger on that
-- transition sees the finished draw. The trigger's own UPDATE cannot recurse:
-- the WHEN clause requires OLD.status to differ from 'in_progress'. It also
-- deliberately does not bump `version` — the client is holding the version
-- generate_bracket just returned.
CREATE OR REPLACE FUNCTION public.tournaments_stamp_ranking_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_draw int;
    v_mult numeric;
BEGIN
    BEGIN
        SELECT draw_size, multiplier INTO v_draw, v_mult
          FROM lt_tournament_ranking_multiplier(NEW.id);

        UPDATE tournaments
           SET ranking_draw_size  = v_draw,
               ranking_multiplier = v_mult
         WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
        -- Never let a ranking concern block a bracket from being published.
        RAISE WARNING 'tournaments_stamp_ranking failed for tournament %: %',
            NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_stamp_ranking ON public.tournaments;
CREATE TRIGGER tournaments_stamp_ranking
    AFTER UPDATE ON public.tournaments
    FOR EACH ROW
    WHEN (NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress')
    EXECUTE FUNCTION public.tournaments_stamp_ranking_tg();


-- --------------------------------------------
-- 5. Award — reads the stamp instead of measuring the field
-- --------------------------------------------
-- Body is 20260715120000 verbatim minus the entry_players / player_skill /
-- field / tier CTEs and the local-tier placement floor, plus a self-heal for
-- events that predate the stamp (legacy rows, or a bracket built before this
-- migration). The certified-organizer gate, the zero-win floor, the doubles
-- expansion and the dedupe are unchanged.
CREATE OR REPLACE FUNCTION public.award_tournament_ranking_points(
    p_tournament_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t           tournaments;
    v_sport_id    uuid;
    v_season_id   uuid;
    v_double_elim boolean;
    v_certified   boolean;
    v_mult        numeric;
    v_draw        integer;
BEGIN
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION 'AWARD_TOURNAMENT_NOT_FOUND: %', p_tournament_id;
    END IF;
    IF v_t.status <> 'completed' OR v_t.completed_at IS NULL THEN
        RAISE EXCEPTION 'AWARD_TOURNAMENT_NOT_COMPLETED: % (status=%, completed_at=%)',
            p_tournament_id, v_t.status, v_t.completed_at;
    END IF;

    -- Certified-organizer gate: only a certified organizer's tournament awards
    -- Points Rallia. Non-certified → clear any stale rows and award nothing.
    SELECT p.is_certified_organizer INTO v_certified
      FROM player p WHERE p.id = v_t.organizer_id;
    IF v_certified IS NOT TRUE THEN
        DELETE FROM tournament_ranking_points WHERE tournament_id = p_tournament_id;
        RAISE NOTICE 'award_tournament_ranking_points: tournament % organizer % not '
            'certified — no ranking points awarded', p_tournament_id, v_t.organizer_id;
        RETURN;
    END IF;

    v_sport_id    := v_t.sport_id;
    v_double_elim := (v_t.bracket_type = 'double_elimination');

    -- Season (fail loudly — never award into a NULL season)
    SELECT id INTO v_season_id
      FROM ranking_season
     WHERE v_t.completed_at >= starts_at
       AND v_t.completed_at <  ends_at;
    IF v_season_id IS NULL THEN
        RAISE EXCEPTION 'AWARD_NO_RANKING_SEASON: tournament % completed_at %',
            p_tournament_id, v_t.completed_at;
    END IF;

    -- The stamp is the price. Self-heal for events whose bracket predates
    -- tournaments_stamp_ranking, so a backfill never awards at a NULL rate.
    v_mult := v_t.ranking_multiplier;
    IF v_mult IS NULL THEN
        SELECT draw_size, multiplier INTO v_draw, v_mult
          FROM lt_tournament_ranking_multiplier(p_tournament_id);
        UPDATE tournaments
           SET ranking_draw_size  = v_draw,
               ranking_multiplier = v_mult
         WHERE id = p_tournament_id;
        RAISE NOTICE 'award_tournament_ranking_points: tournament % had no ranking '
            'stamp — computed % from the bracket', p_tournament_id, v_mult;
    END IF;

    IF v_double_elim THEN
        RAISE WARNING 'award_tournament_ranking_points: double_elimination bracket % '
            '— awarding champion/finalist + participated only (full placement is v2)',
            p_tournament_id;
    END IF;

    -- Idempotent recompute
    DELETE FROM tournament_ranking_points WHERE tournament_id = p_tournament_id;

    INSERT INTO tournament_ranking_points (
        season_id, tournament_id, registration_id, user_id, sport_id,
        level_bucket, placement, multiplier, points, computed_at
    )
    WITH matches AS (
        SELECT id, round_number, status, winner_registration_id, next_match_id,
               player1_registration_id, player1_is_bye,
               player2_registration_id, player2_is_bye
          FROM tournament_matches
         WHERE tournament_id = p_tournament_id
           AND bracket_side  = 'main'
    ),
    slots AS (
        SELECT id AS match_id, round_number, winner_registration_id,
               player1_registration_id AS reg,       player1_is_bye AS is_bye,
               player2_registration_id AS other_reg, player2_is_bye AS other_bye
          FROM matches
        UNION ALL
        SELECT id, round_number, winner_registration_id,
               player2_registration_id, player2_is_bye,
               player1_registration_id, player1_is_bye
          FROM matches
    ),
    entries AS (
        SELECT DISTINCT reg AS registration_id
          FROM slots
         WHERE reg IS NOT NULL AND is_bye = false
    ),
    final_round AS (
        SELECT max(round_number) AS r FROM matches
    ),
    final_match AS (
        SELECT id, winner_registration_id,
               player1_registration_id, player1_is_bye,
               player2_registration_id, player2_is_bye
          FROM matches
         WHERE next_match_id IS NULL
         LIMIT 1
    ),
    champion AS (
        SELECT winner_registration_id AS reg FROM final_match
    ),
    final_loser AS (
        -- the real, non-winning slot of the final (only used for double-elim)
        SELECT CASE
                 WHEN fm.player1_registration_id IS NOT NULL AND NOT fm.player1_is_bye
                      AND fm.player1_registration_id <> fm.winner_registration_id
                   THEN fm.player1_registration_id
                 WHEN fm.player2_registration_id IS NOT NULL AND NOT fm.player2_is_bye
                      AND fm.player2_registration_id <> fm.winner_registration_id
                   THEN fm.player2_registration_id
                 ELSE NULL
               END AS reg
          FROM final_match fm
    ),
    exits AS (
        SELECT s.reg AS registration_id, min(s.round_number) AS exit_round
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.winner_registration_id IS NOT NULL
           AND s.winner_registration_id <> s.reg
         GROUP BY s.reg
    ),
    real_wins AS (
        SELECT s.reg AS registration_id, count(*) AS wins
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.winner_registration_id = s.reg
           AND s.other_reg IS NOT NULL AND s.other_bye = false
         GROUP BY s.reg
    ),
    placed AS (
        SELECT
            e.registration_id,
            CASE
                WHEN e.registration_id = (SELECT reg FROM champion) THEN 'champion'
                WHEN v_double_elim THEN
                    CASE WHEN e.registration_id = (SELECT reg FROM final_loser)
                         THEN 'finalist' ELSE 'participated' END
                -- Zero-win floor: a bye is not a win.
                WHEN coalesce(rw.wins, 0) = 0                          THEN 'participated'
                WHEN ex.exit_round = (SELECT r FROM final_round)       THEN 'finalist'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 1   THEN 'semifinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 2   THEN 'quarterfinal'
                ELSE 'participated'
            END AS placement
          FROM entries e
          LEFT JOIN exits     ex ON ex.registration_id = e.registration_id
          LEFT JOIN real_wins rw ON rw.registration_id = e.registration_id
    ),
    -- One row per (registration, player). Doubles partners each take the FULL
    -- team result — points are not split.
    expanded AS (
        SELECT r.id AS registration_id, r.user_id AS player_id, p.placement
          FROM placed p
          JOIN tournament_registrations r ON r.id = p.registration_id
        UNION ALL
        SELECT r.id, r.partner_user_id, p.placement
          FROM placed p
          JOIN tournament_registrations r ON r.id = p.registration_id
         WHERE r.partner_user_id IS NOT NULL
    ),
    scored AS (
        SELECT
            ex.registration_id, ex.player_id, ex.placement,
            round(
                CASE ex.placement
                    WHEN 'champion'     THEN 500
                    WHEN 'finalist'     THEN 300
                    WHEN 'semifinal'    THEN 180
                    WHEN 'quarterfinal' THEN 90
                    ELSE 20
                END * v_mult
            )::int AS points,
            public.lt_rating_skill_bucket(rs.skill_level) AS level_bucket
          FROM expanded ex
          LEFT JOIN player_sport ps
                 ON ps.player_id = ex.player_id AND ps.sport_id = v_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs        ON rs.id  = prs.rating_score_id
    ),
    -- Dedupe a player who appears in >1 entry (primary + partner) to one row,
    -- keeping the higher-points result — avoids ON CONFLICT hitting a row twice.
    deduped AS (
        SELECT DISTINCT ON (player_id)
               registration_id, player_id, placement, points, level_bucket
          FROM scored
         ORDER BY player_id, points DESC
    )
    SELECT
        v_season_id, p_tournament_id, d.registration_id, d.player_id, v_sport_id,
        d.level_bucket, d.placement, v_mult, d.points, now()
      FROM deduped d
    ON CONFLICT (tournament_id, user_id) DO UPDATE
        SET registration_id = EXCLUDED.registration_id,
            placement       = EXCLUDED.placement,
            multiplier      = EXCLUDED.multiplier,
            points          = EXCLUDED.points,
            level_bucket    = EXCLUDED.level_bucket,
            computed_at     = EXCLUDED.computed_at
      WHERE EXCLUDED.points > tournament_ranking_points.points;
END;
$$;

REVOKE ALL ON FUNCTION public.award_tournament_ranking_points(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_tournament_ranking_points(uuid) TO service_role;

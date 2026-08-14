-- ============================================================================
-- Circuit Rallia — the pool format plays by the same rules as the bracket
-- ============================================================================
-- Reviewing every event format that feeds the ranking turned up four places
-- where pool_knockout diverged from rules written for single elimination.
--
--   1. THE ZERO-WIN FLOOR WAS TURNED OFF, NOT RE-POINTED.
--      20260811160000 was right that a pool qualifier earned its draw slot and
--      should keep its bracket placement, but it expressed that as
--      `NOT v_pool AND wins = 0`, and `wins` only ever counted main-side wins.
--      The floor therefore stopped applying to pool tournaments entirely. Live
--      path: a 4-player pool where two entrants are forfeited out leaves two
--      survivors who both qualify, and the one who lost the single game they
--      actually played enters the knockout having won nothing. Losing the
--      quarterfinal paid it 90 x multiplier. Rule G (specs/tournament-ranking
--      §1 G) says any placement above participation needs at least one real
--      win. real_wins now counts played wins on BOTH sides, so the guard is
--      unconditional again and the intended pool behaviour is unchanged: a
--      qualifier that won in its pool still keeps the bracket placement.
--
--   2. WALKOVER WINS QUALIFY YOU, BUT THEY ARE STILL NOT WINS.
--      tournament_pool_standings counts walkovers in `wins`, and it must: the
--      format spec (formats/poules-puis-eliminatoires.md §6) promises the
--      leaver's remaining games to their opponents as forfeit wins, and the
--      opponent who showed up cannot be punished for it. That belongs to
--      qualification. It must not reach the Circuit, where
--      docs/circuit-rallia-points.md §6 says walkovers were never played. The
--      pool win test below therefore takes status IN ('completed','retired')
--      only, exactly as the main-side test always has. Standings unchanged.
--
--   3. POOL EVENTS WERE PRICED BY AN ACCIDENT.
--      lt_tournament_ranking_multiplier counts non-bye entries on the MAIN
--      side. A pool tournament flips to in_progress inside
--      tournament_generate_pools, when no main rows exist yet, so it fell into
--      the `n = 0` branch that exists for events whose bracket predates the
--      stamping trigger, and counted registrations instead. That gives the
--      right answer today only because the two counts coincide at that
--      instant. On the award's self-heal path (the stamp trigger swallows its
--      own failures into a WARNING) the same function runs after completion,
--      finds a main side holding only the qualifiers, and reprices a 24-entry
--      event as its 12-team knockout: x1.8 becomes x1.4, a 900-point champion
--      becomes 700. The pool side is now read explicitly, so the stamp and any
--      later recompute agree by construction.
--
--      No re-stamp: pool rows are built from the same `status = 'registered'`
--      set the fallback counted, in the same transaction, so every stamp
--      already on disk is the number this function now returns. Historical
--      ledger rows are never re-priced (spec §5).
--
--   4. A DISQUALIFIED PLAYER STILL COLLECTED PARTICIPATION POINTS.
--      Spec §7: withdrawn or disqualified registrations earn nothing. That was
--      flagged unreachable when it was written, because withdrawal was
--      registration-open-only. tournament_forfeit_registration (20260810190000)
--      made it reachable mid-pools and the award was never taught the rule, so
--      a player removed after playing two pool games kept a 10-point row. As of
--      20260811200000 that same player is deliberately denied their refund on
--      the grounds that they had their window, which makes keeping the points
--      the wrong half of the trade. The award now skips those registrations and
--      the tail below clears rows already written for them.
--
-- Bodies copied from the latest migration holding each function:
-- award_tournament_ranking_points from 20260811160000,
-- lt_tournament_ranking_multiplier from 20260717140000.
-- ============================================================================

-- ============================================
-- 1. lt_tournament_ranking_multiplier — the field is the pool stage.
-- ============================================

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

    IF v_t.bracket_type = 'pool_knockout' THEN
        -- Every entrant plays the pool stage; the main side holds only the
        -- qualifiers. Pool rows never carry byes (the generator skips phantom
        -- pairings), so there is nothing to exclude.
        SELECT count(DISTINCT s.reg) INTO v_n
          FROM (
            SELECT player1_registration_id AS reg
              FROM tournament_matches
             WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
            UNION ALL
            SELECT player2_registration_id
              FROM tournament_matches
             WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
          ) s
         WHERE s.reg IS NOT NULL;
    ELSE
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
    END IF;

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

COMMENT ON FUNCTION public.lt_tournament_ranking_multiplier(uuid) IS
  'Draw x level ranking multiplier for a tournament, snapped to 0.2 steps. '
  'The draw size is the real field: non-bye entries in the main bracket, or '
  'every pool entrant for pool_knockout, whose main side holds only the '
  'qualifiers. Falls back to the registered count before any match exists.';


-- ============================================
-- 2. award_tournament_ranking_points — one zero-win floor for every format,
--    and disqualified entries earn nothing.
-- ============================================

CREATE OR REPLACE FUNCTION public.award_tournament_ranking_points(p_tournament_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    SELECT id INTO v_season_id
      FROM ranking_season
     WHERE v_t.completed_at >= starts_at
       AND v_t.completed_at <  ends_at;
    IF v_season_id IS NULL THEN
        RAISE EXCEPTION 'AWARD_NO_RANKING_SEASON: tournament % completed_at %',
            p_tournament_id, v_t.completed_at;
    END IF;

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

    DELETE FROM tournament_ranking_points WHERE tournament_id = p_tournament_id;

    INSERT INTO tournament_ranking_points (
        season_id, tournament_id, registration_id, user_id, sport_id,
        level_bucket, placement, multiplier, points, computed_at, earned_at
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
        SELECT id AS match_id, round_number, status, winner_registration_id,
               player1_registration_id AS reg,       player1_is_bye AS is_bye,
               player2_registration_id AS other_reg, player2_is_bye AS other_bye
          FROM matches
        UNION ALL
        SELECT id, round_number, status, winner_registration_id,
               player2_registration_id, player2_is_bye,
               player1_registration_id, player1_is_bye
          FROM matches
    ),
    -- Pool-stage appearances (pool_knockout only; empty for single elim).
    -- Pool rows never carry byes and both slots are always filled, so a slot
    -- is a real appearance and `won` needs no bye guard.
    pool_slots AS (
        SELECT p.reg, p.status, p.won
          FROM tournament_matches tm
          CROSS JOIN LATERAL (VALUES
              (tm.player1_registration_id, tm.status,
               tm.winner_registration_id IS NOT NULL
                 AND tm.winner_registration_id = tm.player1_registration_id),
              (tm.player2_registration_id, tm.status,
               tm.winner_registration_id IS NOT NULL
                 AND tm.winner_registration_id = tm.player2_registration_id)
          ) AS p(reg, status, won)
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND p.reg IS NOT NULL
    ),
    -- Withdrawn and disqualified entries earn nothing, however far they got
    -- before leaving (spec §7). Their opponents' advances still count.
    active AS (
        SELECT tr.id
          FROM tournament_registrations tr
         WHERE tr.tournament_id = p_tournament_id
           AND tr.status NOT IN ('withdrawn', 'disqualified')
    ),
    entries AS (
        SELECT DISTINCT reg AS registration_id
          FROM slots
         WHERE reg IS NOT NULL AND is_bye = false
        UNION
        SELECT DISTINCT reg FROM pool_slots
    ),
    played AS (
        SELECT DISTINCT s.reg AS registration_id
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.other_reg IS NOT NULL AND s.other_bye = false
           AND s.status IN ('completed', 'retired')
        UNION
        SELECT DISTINCT ps.reg FROM pool_slots ps
         WHERE ps.status IN ('completed', 'retired')
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
    -- Wins that were contested, wherever they happened. Byes and walkovers
    -- advance a side without being played, so neither lifts a placement above
    -- participation — including the walkover wins the pool standings do count
    -- toward qualification.
    real_wins AS (
        SELECT w.reg AS registration_id, count(*) AS wins
          FROM (
            SELECT s.reg
              FROM slots s
             WHERE s.reg IS NOT NULL AND s.is_bye = false
               AND s.winner_registration_id = s.reg
               AND s.other_reg IS NOT NULL AND s.other_bye = false
               AND s.status IN ('completed', 'retired')
            UNION ALL
            SELECT ps.reg
              FROM pool_slots ps
             WHERE ps.won
               AND ps.status IN ('completed', 'retired')
          ) w
         GROUP BY w.reg
    ),
    placed AS (
        SELECT
            e.registration_id,
            CASE
                WHEN e.registration_id = (SELECT reg FROM champion) THEN 'champion'
                WHEN v_double_elim THEN
                    CASE WHEN e.registration_id = (SELECT reg FROM final_loser)
                         THEN 'finalist' ELSE 'participated' END
                -- No contested win, no placement (rule G). A pool_knockout
                -- entrant earns its draw slot in the pool phase, so its pool
                -- wins satisfy this and it keeps the bracket placement; a
                -- pool-stage exit has no main-side exit round and falls
                -- through to 'participated' below.
                WHEN coalesce(rw.wins, 0) = 0                           THEN 'participated'
                WHEN ex.exit_round = (SELECT r FROM final_round)        THEN 'finalist'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 1    THEN 'semifinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 2    THEN 'quarterfinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 3    THEN 'round_of_16'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 4    THEN 'round_of_32'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 5    THEN 'round_of_64'
                ELSE 'participated'
            END AS placement
          FROM entries e
          JOIN active    a  ON a.id  = e.registration_id
          JOIN played    py ON py.registration_id = e.registration_id
          LEFT JOIN exits     ex ON ex.registration_id = e.registration_id
          LEFT JOIN real_wins rw ON rw.registration_id = e.registration_id
    ),
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
            (CASE WHEN ex.placement = 'participated' THEN 10
                  ELSE (round(
                    CASE ex.placement
                        WHEN 'champion'     THEN 500
                        WHEN 'finalist'     THEN 300
                        WHEN 'semifinal'    THEN 180
                        WHEN 'quarterfinal' THEN 90
                        WHEN 'round_of_16'  THEN 50
                        WHEN 'round_of_32'  THEN 30
                        WHEN 'round_of_64'  THEN 25
                        ELSE 10
                    END * v_mult / 10
                  ) * 10)::int
             END) AS points,
            public.lt_rating_skill_bucket(rs.skill_level) AS level_bucket
          FROM expanded ex
          LEFT JOIN player_sport ps
                 ON ps.player_id = ex.player_id AND ps.sport_id = v_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs        ON rs.id  = prs.rating_score_id
    ),
    deduped AS (
        SELECT DISTINCT ON (player_id)
               registration_id, player_id, placement, points, level_bucket
          FROM scored
         ORDER BY player_id, points DESC
    )
    SELECT
        v_season_id, p_tournament_id, d.registration_id, d.player_id, v_sport_id,
        d.level_bucket, d.placement, v_mult, d.points, now(), v_t.completed_at
      FROM deduped d
    ON CONFLICT (tournament_id, user_id) DO UPDATE
        SET registration_id = EXCLUDED.registration_id,
            placement       = EXCLUDED.placement,
            multiplier      = EXCLUDED.multiplier,
            points          = EXCLUDED.points,
            level_bucket    = EXCLUDED.level_bucket,
            computed_at     = EXCLUDED.computed_at,
            earned_at       = EXCLUDED.earned_at
      WHERE EXCLUDED.points > tournament_ranking_points.points;
END;
$function$;


-- ============================================
-- 3. Clear points already written for entries that left.
-- ============================================
-- A recompute would drop these on its own, but a completed tournament never
-- recomputes unless a score is corrected. Idempotent.

DO $$
DECLARE
    v_removed integer;
BEGIN
    DELETE FROM public.tournament_ranking_points trp
     USING public.tournament_registrations tr
     WHERE tr.id = trp.registration_id
       AND tr.status IN ('withdrawn', 'disqualified');
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RAISE NOTICE 'circuit coherence: cleared % ledger row(s) for withdrawn or '
        'disqualified entries', v_removed;
END $$;

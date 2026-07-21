-- ============================================================================
-- Circuit Rallia — participation drops from 20 to 10
-- ============================================================================
-- The flat participation rung was set at 20 when the level curve was much
-- narrower (20260720130000). Now that the curve runs ×5 per rating point
-- (20260720170000), 20 is too heavy at the bottom: a Débutant R16 exit pays
-- exactly 20, so winning two matches ties with losing your first.
--
-- Halving the rung to 10 restores a real gap there (20 vs 10) and pulls the
-- pure-attendance season ceiling down to 8 × 10 = 80 — negligible against a
-- 5000-point Série 1 title, which is the point: showing up should register,
-- not accumulate into a rank.
--
-- It also reopens headroom in the curve. The binding constraint on widening
-- was the win rungs sinking under the flat participation; at 10 there is one
-- more doubling of room before that recurs.
--
-- Everything else is unchanged: still flat (never multiplied), still awarded
-- only to players with ≥1 real played match, still no ledger row at all for a
-- player whose every appearance was a bye or walkover.
--
-- Body is otherwise identical to the live definition at 20260720130000.
-- ============================================================================

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
    entries AS (
        SELECT DISTINCT reg AS registration_id
          FROM slots
         WHERE reg IS NOT NULL AND is_bye = false
    ),
    -- Played gate: at least one real match actually contested. Byes and
    -- walkovers advance you but were never played; a retirement was.
    played AS (
        SELECT DISTINCT s.reg AS registration_id
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.other_reg IS NOT NULL AND s.other_bye = false
           AND s.status IN ('completed', 'retired')
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
           -- A walkover advances you without a match being played, so it is
           -- not a win. A retirement is.
           AND s.status IN ('completed', 'retired')
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
                WHEN ex.exit_round = (SELECT r FROM final_round) - 3   THEN 'round_of_16'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 4   THEN 'round_of_32'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 5   THEN 'round_of_64'
                ELSE 'participated'
            END AS placement
          FROM entries e
          JOIN played    py ON py.registration_id = e.registration_id
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
            -- Participation is FLAT 10: showing up is the same act in every
            -- category, so it never multiplies. Win rungs snap to the dime
            -- (470, 230, 50), never float residue; the champion keeps landing
            -- on a multiple of 100 (base 500 x 0.2-step mult).
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
$function$;

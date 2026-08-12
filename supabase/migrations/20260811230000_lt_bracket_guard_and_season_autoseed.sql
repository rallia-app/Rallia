-- ============================================================================
-- Circuit Rallia — close the double-elimination gap and stop the season cliff
-- ============================================================================
--
--   1. DOUBLE ELIMINATION IS SCOREABLE BUT NOT PLAYABLE.
--      `double_elimination` has been in the bracket_type enum since
--      20260510165900 and generation for it is still v2. Nothing rejected it:
--      tournament_create validates field size and pool config but never the
--      bracket type, and tournament_generate_bracket guards only
--      pool_knockout. So a direct API caller could create one, have a
--      SINGLE-elimination tree built for it, and then be scored by the award's
--      double-elim branch, which resolves champion and finalist and pays every
--      semifinalist the participation floor of 10.
--
--      No row anywhere uses the value (local, staging and prod are all
--      single_elimination + pool_knockout), and the mobile wizard never offers
--      it, so this is preventive. Postgres cannot drop an enum value, so the
--      gate is a trigger rather than a constraint. A trigger, specifically,
--      because a table CHECK would surface through tournament_create's
--      `WHEN check_violation` handler as INVALID_FEE_SETTINGS, which would be
--      a lie — the same trap its own comment warns about for field sizes. A
--      P0001 raise passes through untouched.
--
--      This also makes tournament_generate_bracket's missing guard unreachable
--      rather than fixing it in place: the row can no longer exist. The award
--      keeps its double-elim branch as defence in depth.
--
--   2. THE RANKING CALENDAR RAN OUT ON 2029-04-01.
--      ranking_season was seeded once, in a migration, from `now() + 2 years`
--      (20260714120000), and nothing extends it. The award RAISEs
--      AWARD_NO_RANKING_SEASON when no row covers `completed_at`, and the
--      completion trigger catches that into a WARNING — so past the last
--      seeded boundary every tournament would have completed normally and
--      silently awarded nobody anything, with no error visible to a player, an
--      organizer, or Sentry.
--
--      Seasons are only an archive since the rolling window (20260726140000),
--      which makes this a hard dependency the live board does not even need.
--      lt_ensure_ranking_season resolves the covering row and creates it if it
--      is missing, so the calendar can no longer run out. Boundaries stay
--      exactly as seeded: SS = Apr 1 → Oct 1, FW = Oct 1 → Apr 1 next year,
--      midnight America/Toronto, keyed by start year (Jan–Mar belongs to the
--      previous year's FW). The seeded horizon is also pushed to 2040 so the
--      archive reads as a continuous calendar rather than only the half-years
--      someone happened to complete an event in.
--
-- Bodies copied from the latest migration holding each function:
-- award_tournament_ranking_points from 20260811210000 (this migration's only
-- change to it is the season lookup on one line).
-- ============================================================================

-- ============================================
-- 1. Unsupported bracket types cannot be stored.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournaments_reject_unsupported_bracket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.bracket_type = 'double_elimination' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UNSUPPORTED_BRACKET_TYPE';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tournaments_reject_unsupported_bracket() IS
  'Blocks bracket types the engine cannot play out. double_elimination has no '
  'generator (it would build a single-elim tree) and no placement mapping (the '
  'award pays every semifinalist the participation floor). Drop the check here '
  'when v2 ships both.';

DROP TRIGGER IF EXISTS tournaments_reject_unsupported_bracket ON public.tournaments;
CREATE TRIGGER tournaments_reject_unsupported_bracket
    BEFORE INSERT OR UPDATE OF bracket_type ON public.tournaments
    FOR EACH ROW
    EXECUTE FUNCTION public.tournaments_reject_unsupported_bracket();


-- ============================================
-- 2. The ranking calendar creates itself on demand.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_ensure_ranking_season(p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id     uuid;
    v_year   integer;
    v_apr    timestamptz;
    v_oct    timestamptz;
    v_code   text;
    v_label  text;
    v_starts timestamptz;
    v_ends   timestamptz;
BEGIN
    SELECT id INTO v_id
      FROM ranking_season
     WHERE p_at >= starts_at AND p_at < ends_at;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    v_year := extract(year FROM p_at AT TIME ZONE 'America/Toronto')::int;
    v_apr  := make_timestamptz(v_year, 4,  1, 0, 0, 0, 'America/Toronto');
    v_oct  := make_timestamptz(v_year, 10, 1, 0, 0, 0, 'America/Toronto');

    IF p_at >= v_oct THEN
        v_code := v_year || '-FW';
        v_label := 'Automne/Hiver ' || v_year;
        v_starts := v_oct;
        v_ends   := make_timestamptz(v_year + 1, 4, 1, 0, 0, 0, 'America/Toronto');
    ELSIF p_at >= v_apr THEN
        v_code := v_year || '-SS';
        v_label := 'Printemps/Été ' || v_year;
        v_starts := v_apr;
        v_ends   := v_oct;
    ELSE
        -- January to March belongs to the previous year's fall/winter.
        v_code := (v_year - 1) || '-FW';
        v_label := 'Automne/Hiver ' || (v_year - 1);
        v_starts := make_timestamptz(v_year - 1, 10, 1, 0, 0, 0, 'America/Toronto');
        v_ends   := v_apr;
    END IF;

    -- DO UPDATE rather than DO NOTHING so a concurrent completion that lost the
    -- race still gets the id back instead of NULL.
    INSERT INTO ranking_season (code, label, starts_at, ends_at)
    VALUES (v_code, v_label, v_starts, v_ends)
    ON CONFLICT (code) DO UPDATE SET label = ranking_season.label
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.lt_ensure_ranking_season(timestamptz) IS
  'The archive season covering an instant, created if the seeded calendar has '
  'run past its end. SS = Apr 1 -> Oct 1, FW = Oct 1 -> Apr 1 next year, '
  'midnight America/Toronto, coded by start year.';

GRANT EXECUTE ON FUNCTION public.lt_ensure_ranking_season(timestamptz) TO service_role;

-- Extend the seeded calendar so the archive is continuous, not only the
-- half-years an event happened to complete in. Idempotent.
DO $$
DECLARE
    y integer;
BEGIN
    FOR y IN extract(year FROM now() AT TIME ZONE 'America/Toronto')::int .. 2040 LOOP
        INSERT INTO public.ranking_season (code, label, starts_at, ends_at)
        VALUES (
            y || '-SS',
            'Printemps/Été ' || y,
            make_timestamptz(y,  4, 1, 0, 0, 0, 'America/Toronto'),
            make_timestamptz(y, 10, 1, 0, 0, 0, 'America/Toronto')
        )
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO public.ranking_season (code, label, starts_at, ends_at)
        VALUES (
            y || '-FW',
            'Automne/Hiver ' || y,
            make_timestamptz(y,     10, 1, 0, 0, 0, 'America/Toronto'),
            make_timestamptz(y + 1,  4, 1, 0, 0, 0, 'America/Toronto')
        )
        ON CONFLICT (code) DO NOTHING;
    END LOOP;
END $$;


-- ============================================
-- 3. The award resolves its season through the helper.
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

    v_season_id := public.lt_ensure_ranking_season(v_t.completed_at);
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

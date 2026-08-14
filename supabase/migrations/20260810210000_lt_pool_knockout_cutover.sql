-- Pool + knockout tournaments — F3: the cut-over from pools to the tree.
--
--   * tournament_generate_knockout — organizer-triggered once every pool
--     match is settled. Qualifiers = top qualifiers_per_pool eligible rows
--     of each pool's standings. Draw size = next power of two >= qualifier
--     count; byes fall to the best-ranked qualifiers (winners first, then
--     the best runners-up) through the existing seed placement. Pool
--     winners are seeded by inter-pool comparison (win ratio over settled,
--     then set ratio, game ratio, pool number). Runners-up are drawn at
--     RANDOM into the remaining seeds, constrained to the opposite half of
--     the draw from their own pool's winner, so two players from one pool
--     can only meet again in the final; if the random draw can't satisfy
--     the constraint after bounded retries it is relaxed (audited).
--     The knockout rows are plain main-side rows: advancement, score entry,
--     overrides, completion and the champion path behave exactly like a
--     single-elimination tournament from here on.
--   * award_tournament_ranking_points — body from 20260726130000 with pool
--     appearances added to the entries/played gates, so a pool-stage exit
--     earns the flat participation points instead of nothing. Single-elim
--     tournaments have no pool rows: byte-identical behaviour.
--
-- The 7-day auto-close safety net for an absent organizer ships with the
-- deadline engine (F4), which owns the cron + nudge machinery.

-- ============================================
-- tournament_generate_knockout
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_generate_knockout(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS SETOF tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_q           integer;
    v_k           integer;
    v_size        integer;
    v_positions   integer[];
    v_half        integer[];
    v_w_half      integer[] := '{}';
    v_winners     uuid[];
    v_winner_pool integer[];
    v_runners     uuid[];
    v_runner_pool integer[];
    v_try_regs    uuid[];
    v_try_pools   integer[];
    v_ok          boolean := false;
    v_attempt     integer := 0;
    v_ordered     uuid[];
    v_row         record;
    v_new_id      uuid;
    v_relaxed     boolean := false;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'KNOCKOUT_ALREADY_GENERATED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_STAGE_REQUIRED';
    END IF;
    IF v_tournament.status <> 'in_progress' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
           AND status NOT IN ('completed', 'retired', 'walkover', 'cancelled')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOLS_NOT_COMPLETE';
    END IF;

    DROP TABLE IF EXISTS _ko_standings;
    CREATE TEMP TABLE _ko_standings ON COMMIT DROP AS
        SELECT s.pool_number, s.pool_rank, s.registration_id,
               s.wins, s.settled, s.sets_won, s.sets_lost, s.games_won, s.games_lost,
               CASE WHEN s.settled = 0 THEN -1
                    ELSE s.wins::numeric / s.settled END AS win_ratio,
               CASE WHEN s.sets_won + s.sets_lost = 0 THEN -1
                    ELSE s.sets_won::numeric / (s.sets_won + s.sets_lost) END AS set_ratio,
               CASE WHEN s.games_won + s.games_lost = 0 THEN -1
                    ELSE s.games_won::numeric / (s.games_won + s.games_lost) END AS game_ratio
          FROM public.tournament_pool_standings(p_tournament_id) s
         WHERE s.eligible
           AND s.pool_rank <= v_tournament.qualifiers_per_pool;

    SELECT count(*) INTO v_q FROM _ko_standings;
    IF v_q < 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    v_size := 2;
    WHILE v_size < v_q LOOP
        v_size := v_size * 2;
    END LOOP;

    -- Slot i of the round-1 grid holds seed positions[i]; a seed's half is
    -- the half its slot falls in.
    v_positions := public.lt_seed_positions(v_size);
    FOR i IN 1..v_size LOOP
        v_half[v_positions[i]] := CASE WHEN i <= v_size / 2 THEN 1 ELSE 2 END;
    END LOOP;

    -- Winners seeded 1..k by inter-pool comparison.
    SELECT array_agg(registration_id ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC),
           array_agg(pool_number     ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC)
      INTO v_winners, v_winner_pool
      FROM _ko_standings WHERE pool_rank = 1;
    v_k := coalesce(array_length(v_winners, 1), 0);
    FOR i IN 1..v_k LOOP
        v_w_half[v_winner_pool[i]] := v_half[i];
    END LOOP;

    SELECT array_agg(registration_id ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC),
           array_agg(pool_number     ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC)
      INTO v_runners, v_runner_pool
      FROM _ko_standings WHERE pool_rank > 1;

    -- Runners-up: random draw into seeds k+1..q, each in the opposite half
    -- from their pool's winner. Bye seeds (q+1..size) stay empty, which is
    -- what hands the byes to the top-ranked qualifiers.
    IF v_runners IS NULL THEN
        v_ok := true;
        v_try_regs := '{}';
    END IF;
    WHILE NOT v_ok AND v_attempt < 60 LOOP
        v_attempt := v_attempt + 1;
        SELECT array_agg(r ORDER BY rnd), array_agg(p ORDER BY rnd)
          INTO v_try_regs, v_try_pools
          FROM (SELECT unnest(v_runners) AS r, unnest(v_runner_pool) AS p, random() AS rnd) x;
        v_ok := true;
        FOR i IN 1..array_length(v_try_regs, 1) LOOP
            IF v_w_half[v_try_pools[i]] IS NOT NULL
               AND v_w_half[v_try_pools[i]] = v_half[v_k + i] THEN
                v_ok := false;
                EXIT;
            END IF;
        END LOOP;
    END LOOP;
    IF NOT v_ok THEN
        v_relaxed := true;   -- accept the last draw; audited below
    END IF;

    v_ordered := v_winners || v_try_regs;

    CREATE TEMP TABLE IF NOT EXISTS _gen_map (
        round_number   smallint NOT NULL,
        match_position smallint NOT NULL,
        match_id       uuid NOT NULL,
        PRIMARY KEY (round_number, match_position)
    ) ON COMMIT DROP;
    TRUNCATE _gen_map;

    FOR v_row IN
        SELECT * FROM public._lt_compute_bracket(v_ordered, v_size)
    LOOP
        INSERT INTO tournament_matches (
            tournament_id, round_number, match_position,
            player1_registration_id, player2_registration_id,
            player1_is_bye, player2_is_bye,
            winner_registration_id, status
        )
        VALUES (
            p_tournament_id, v_row.round_number, v_row.match_position,
            v_row.player1_registration_id, v_row.player2_registration_id,
            v_row.player1_is_bye, v_row.player2_is_bye,
            v_row.winner_registration_id, v_row.status
        )
        RETURNING id INTO v_new_id;

        INSERT INTO _gen_map VALUES (v_row.round_number, v_row.match_position, v_new_id);
    END LOOP;

    UPDATE tournament_matches tm
       SET next_match_id   = nxt.match_id,
           next_match_slot = CASE WHEN cur.match_position % 2 = 1 THEN 1 ELSE 2 END
      FROM _gen_map cur
      JOIN _gen_map nxt
        ON nxt.round_number   = cur.round_number + 1
       AND nxt.match_position = (cur.match_position + 1) / 2
     WHERE tm.id = cur.match_id;

    UPDATE tournaments
       SET version    = version + 1,
           updated_at = now()
     WHERE id = p_tournament_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'generate_knockout', v_caller_id,
        jsonb_build_object(
            'qualifiers', v_q,
            'draw_size', v_size,
            'byes', v_size - v_q,
            'half_constraint_relaxed', v_relaxed
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
           AND bracket_side = 'main'
         ORDER BY round_number, match_position;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_generate_knockout(uuid, integer) TO authenticated;

-- ============================================
-- award_tournament_ranking_points — body from 20260726130000; the only
-- change is pool participation feeding the entries/played gates.
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
    pool_slots AS (
        SELECT p.reg, p.status
          FROM tournament_matches tm
          CROSS JOIN LATERAL (VALUES
              (tm.player1_registration_id, tm.status),
              (tm.player2_registration_id, tm.status)
          ) AS p(reg, status)
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND p.reg IS NOT NULL
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
    real_wins AS (
        SELECT s.reg AS registration_id, count(*) AS wins
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.winner_registration_id = s.reg
           AND s.other_reg IS NOT NULL AND s.other_bye = false
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

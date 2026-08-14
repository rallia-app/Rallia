-- Pool + knockout tournaments — correctness pass on three defects found
-- reviewing the format against specs/17-leagues-tournaments/formats/
-- poules-puis-eliminatoires.md.
--
--   1. tournament_pool_standings ran SECURITY INVOKER while its set/game
--      counters read match_result, whose SELECT policy is limited to the
--      match's own participants. Once a pool game is linked to a real match
--      (the format's primary score path, spec §6) a player saw 0-0 sets for
--      every game they were not in, collapsing the ratio tie-breakers — while
--      tournament_generate_knockout, being SECURITY DEFINER, read the true
--      numbers. Standings on screen could therefore disagree with the
--      standings that decided qualification. Now SECURITY DEFINER with the
--      tmatches_select visibility rule enforced in the body, so every viewer
--      of a tournament sees the same, correct table.
--
--   2. tournament_generate_knockout drew the runners-up by reshuffling all of
--      them and retrying up to 60 times until none shared a half with its own
--      pool winner. On a 16-draw only ~1.5% of shuffles satisfy that, so the
--      loop gave up and silently relaxed the constraint on ~38% of 32-player
--      draws (~4.8% at 24). Spec §7 makes same-pool separation a promise, so
--      the draw is now bucketed by required half and shuffled inside each
--      bucket: still random, exact in one pass, and only relaxed if a bucket
--      genuinely runs short (which the standard seed grid never produces for
--      the supported field sizes).
--
--   3. award_tournament_ranking_points scored every first-round knockout
--      loser as 'participated'. Its zero-wins guard counts main-side wins
--      only, and in this format the knockout entrants earned their slot in
--      the pool phase, so a player who topped their pool and lost the
--      quarterfinal took the same 10 points as one who went 0-3. Spec §10
--      wants the bracket placement. The guard is now single-elimination only;
--      pool tournaments fall through to the exit-round ladder, where a
--      pool-stage exit still lands on 'participated' because it has no
--      main-side exit round. Single-elim behaviour is unchanged.
--
-- Bodies copied from the latest migration holding each function:
-- tournament_pool_standings + _lt_rank_pool_group from 20260810190000,
-- tournament_generate_knockout from 20260810230000 (NOT the cutover copy —
-- the deadline migration added the _lt_seed_default_deadlines call),
-- award_tournament_ranking_points from 20260810210000.

-- ============================================
-- 1. tournament_pool_standings — SECURITY DEFINER + explicit visibility.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_pool_standings(
    p_tournament_id uuid
)
RETURNS TABLE (
    pool_number     integer,
    pool_rank       integer,
    registration_id uuid,
    user_id         uuid,
    partner_user_id uuid,
    wins            integer,
    settled         integer,
    sets_won        integer,
    sets_lost       integer,
    games_won       integer,
    games_lost      integer,
    withdrawn       boolean,
    eligible        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament tournaments;
    v_pool       integer;
    v_active     uuid[];
    v_out        uuid[];
    v_ordered    uuid[];
    v_group      uuid[];
    v_prev_wins  integer;
    v_reg        uuid;
    v_wins       integer;
    v_rank       integer;
BEGIN
    SELECT * INTO v_tournament FROM tournaments t WHERE t.id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;

    -- RLS no longer filters the reads below, so reproduce tmatches_select:
    -- whoever may see the tournament's matches may see its standings.
    IF NOT (
        public.is_admin()
        OR public.tournament_is_public(p_tournament_id)
        OR public.is_tournament_organizer(p_tournament_id)
        OR public.is_tournament_registrant(p_tournament_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_VISIBLE';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _pool_stats (
        reg        uuid PRIMARY KEY,
        pool       integer NOT NULL,
        usr        uuid,
        partner    uuid,
        wins       integer NOT NULL,
        settled    integer NOT NULL,
        sets_w     integer NOT NULL,
        sets_l     integer NOT NULL,
        games_w    integer NOT NULL,
        games_l    integer NOT NULL,
        set_ratio  numeric NOT NULL,
        game_ratio numeric NOT NULL,
        seed_pos   integer NOT NULL,
        is_out     boolean NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE _pool_stats;

    INSERT INTO _pool_stats
    WITH pool_regs AS (
        SELECT DISTINCT tm.pool_number AS pool, r.reg
          FROM tournament_matches tm
          CROSS JOIN LATERAL (VALUES
              (tm.player1_registration_id), (tm.player2_registration_id)
          ) AS r(reg)
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND r.reg IS NOT NULL
    ),
    settled AS (
        SELECT tm.*
          FROM tournament_matches tm
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = 'pool'
           AND tm.status IN ('completed', 'retired', 'walkover')
    ),
    -- Per (registration, settled match): sets/games from the linked verified
    -- match when present, else from the winner-first score text.
    per_match AS (
        SELECT pr.reg,
               s.id AS tm_id,
               (s.winner_registration_id = pr.reg)::int AS win,
               CASE WHEN s.status = 'walkover' THEN 0 ELSE 1 END AS played,
               COALESCE(ms.sets_w, txt.sets_w, 0)  AS sets_w,
               COALESCE(ms.sets_l, txt.sets_l, 0)  AS sets_l,
               COALESCE(ms.games_w, txt.games_w, 0) AS games_w,
               COALESCE(ms.games_l, txt.games_l, 0) AS games_l
          FROM pool_regs pr
          JOIN settled s
            ON pr.reg IN (s.player1_registration_id, s.player2_registration_id)
          LEFT JOIN tournament_registrations reg2 ON reg2.id = pr.reg
          LEFT JOIN LATERAL (
              -- min() collapses a doubles pair to its single team side, so
              -- each set is counted once regardless of participant count.
              SELECT count(*) FILTER (WHERE (tn.t = 1) = (st.team1_score > st.team2_score)
                                        AND st.team1_score <> st.team2_score)::int AS sets_w,
                     count(*) FILTER (WHERE (tn.t = 1) = (st.team1_score < st.team2_score)
                                        AND st.team1_score <> st.team2_score)::int AS sets_l,
                     sum(CASE WHEN tn.t = 1 THEN st.team1_score ELSE st.team2_score END)::int AS games_w,
                     sum(CASE WHEN tn.t = 1 THEN st.team2_score ELSE st.team1_score END)::int AS games_l
                FROM (SELECT min(mp.team_number) AS t
                        FROM match_participant mp
                       WHERE mp.match_id = s.match_id
                         AND mp.player_id IN (reg2.user_id, reg2.partner_user_id)) tn
                JOIN match_result mr ON mr.match_id = s.match_id AND mr.is_verified IS TRUE
                JOIN match_set st ON st.match_result_id = mr.id
               WHERE tn.t IS NOT NULL
          ) ms ON s.match_id IS NOT NULL
          LEFT JOIN LATERAL (
              SELECT sum(CASE WHEN win_side THEN gw ELSE gl END)::int  AS games_w,
                     sum(CASE WHEN win_side THEN gl ELSE gw END)::int  AS games_l,
                     count(*) FILTER (WHERE (gw > gl) = win_side AND gw <> gl)::int AS sets_w,
                     count(*) FILTER (WHERE (gw < gl) = win_side AND gw <> gl)::int AS sets_l
                FROM (
                    SELECT split_part(setp, '-', 1)::int AS gw,
                           split_part(setp, '-', 2)::int AS gl,
                           (s.winner_registration_id = pr.reg) AS win_side
                      FROM regexp_split_to_table(s.score, '\s+') AS setp
                     WHERE setp ~ '^\d+-\d+$'
                ) parsed
          ) txt ON s.match_id IS NULL AND s.score IS NOT NULL
    ),
    totals AS (
        SELECT pm.reg,
               sum(pm.win)::int      AS wins,
               count(*)::int         AS settled,
               sum(pm.sets_w)::int   AS sets_w,
               sum(pm.sets_l)::int   AS sets_l,
               sum(pm.games_w)::int  AS games_w,
               sum(pm.games_l)::int  AS games_l
          FROM per_match pm
         GROUP BY pm.reg
    )
    SELECT pr.reg,
           pr.pool,
           tr.user_id,
           tr.partner_user_id,
           COALESCE(t.wins, 0),
           COALESCE(t.settled, 0),
           COALESCE(t.sets_w, 0),
           COALESCE(t.sets_l, 0),
           COALESCE(t.games_w, 0),
           COALESCE(t.games_l, 0),
           CASE WHEN COALESCE(t.sets_w, 0) + COALESCE(t.sets_l, 0) = 0 THEN -1
                ELSE t.sets_w::numeric / (t.sets_w + t.sets_l) END,
           CASE WHEN COALESCE(t.games_w, 0) + COALESCE(t.games_l, 0) = 0 THEN -1
                ELSE t.games_w::numeric / (t.games_w + t.games_l) END,
           (row_number() OVER (ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC))::int,
           tr.status IN ('withdrawn', 'disqualified')
      FROM pool_regs pr
      JOIN tournament_registrations tr ON tr.id = pr.reg
      LEFT JOIN totals t ON t.reg = pr.reg;

    FOR v_pool IN
        SELECT DISTINCT s.pool FROM _pool_stats s ORDER BY s.pool
    LOOP
        v_active := ARRAY(
            SELECT s.reg FROM _pool_stats s
             WHERE s.pool = v_pool AND NOT s.is_out
             ORDER BY s.wins DESC, s.seed_pos
        );
        v_out := ARRAY(
            SELECT s.reg FROM _pool_stats s
             WHERE s.pool = v_pool AND s.is_out
             ORDER BY s.wins DESC, s.set_ratio DESC, s.game_ratio DESC, s.seed_pos
        );

        -- Actives: group by wins, resolve each tie group through the cascade.
        v_ordered   := '{}';
        v_group     := '{}';
        v_prev_wins := NULL;
        FOREACH v_reg IN ARRAY v_active LOOP
            SELECT s.wins INTO v_wins FROM _pool_stats s WHERE s.reg = v_reg;
            IF v_prev_wins IS NOT NULL AND v_wins <> v_prev_wins THEN
                v_ordered := v_ordered
                    || public._lt_rank_pool_group(p_tournament_id, v_group, 1);
                v_group := '{}';
            END IF;
            v_group     := v_group || v_reg;
            v_prev_wins := v_wins;
        END LOOP;
        IF array_length(v_group, 1) > 0 THEN
            v_ordered := v_ordered
                || public._lt_rank_pool_group(p_tournament_id, v_group, 1);
        END IF;

        v_ordered := v_ordered || v_out;

        v_rank := 0;
        FOREACH v_reg IN ARRAY v_ordered LOOP
            v_rank := v_rank + 1;
            RETURN QUERY
                SELECT s.pool, v_rank, s.reg, s.usr, s.partner,
                       s.wins, s.settled, s.sets_w, s.sets_l, s.games_w, s.games_l,
                       s.is_out, NOT s.is_out
                  FROM _pool_stats s WHERE s.reg = v_reg;
        END LOOP;
    END LOOP;
END;
$$;

-- ============================================
-- 2. tournament_generate_knockout — bucketed runner-up draw.
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
    v_need1       uuid[];
    v_need2       uuid[];
    v_free        uuid[];
    v_c1          integer := 1;
    v_c2          integer := 1;
    v_cf          integer := 1;
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

    -- Runners-up: drawn at random into seeds k+1..q, each constrained to the
    -- half opposite its own pool winner so two players out of one pool can
    -- only meet again in the final (spec §7). Bucket by the half a runner
    -- MUST take, shuffle inside the bucket, then walk the runner seeds in
    -- order: random among the valid arrangements, and exact in one pass.
    -- v_free covers the degenerate pool that contributed a runner but no
    -- eligible winner, which carries no constraint.
    SELECT array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] = 2),
           array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] = 1),
           array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] IS NULL)
      INTO v_need1, v_need2, v_free
      FROM (SELECT u.r, u.p, random() AS rnd
              FROM unnest(v_runners, v_runner_pool) AS u(r, p)) t;

    v_ordered := v_winners;
    FOR s IN v_k + 1 .. v_q LOOP
        IF v_half[s] = 1 THEN
            IF v_c1 <= coalesce(array_length(v_need1, 1), 0) THEN
                v_ordered[s] := v_need1[v_c1]; v_c1 := v_c1 + 1;
            ELSIF v_cf <= coalesce(array_length(v_free, 1), 0) THEN
                v_ordered[s] := v_free[v_cf];  v_cf := v_cf + 1;
            ELSE
                v_ordered[s] := v_need2[v_c2]; v_c2 := v_c2 + 1; v_relaxed := true;
            END IF;
        ELSE
            IF v_c2 <= coalesce(array_length(v_need2, 1), 0) THEN
                v_ordered[s] := v_need2[v_c2]; v_c2 := v_c2 + 1;
            ELSIF v_cf <= coalesce(array_length(v_free, 1), 0) THEN
                v_ordered[s] := v_free[v_cf];  v_cf := v_cf + 1;
            ELSE
                v_ordered[s] := v_need1[v_c1]; v_c1 := v_c1 + 1; v_relaxed := true;
            END IF;
        END IF;
    END LOOP;

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

    PERFORM public._lt_seed_default_deadlines(
        p_tournament_id, 'main', now(), v_tournament.end_date,
        (ln(v_size) / ln(2))::integer);

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

-- ============================================
-- 3. award_tournament_ranking_points — the zero-wins shortcut to
-- 'participated' is single-elimination only.
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
    v_pool        boolean;
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
    v_pool        := (v_t.bracket_type = 'pool_knockout');

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
                -- Single elim: no knockout win, no placement. A pool_knockout
                -- entrant earned its draw slot in the pool phase, so it keeps
                -- the bracket placement; pool-stage exits have no main-side
                -- exit round and fall through to 'participated' below.
                WHEN NOT v_pool AND coalesce(rw.wins, 0) = 0            THEN 'participated'
                WHEN ex.exit_round = (SELECT r FROM final_round)        THEN 'finalist'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 1    THEN 'semifinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 2    THEN 'quarterfinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 3    THEN 'round_of_16'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 4    THEN 'round_of_32'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 5    THEN 'round_of_64'
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

GRANT EXECUTE ON FUNCTION public.tournament_pool_standings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_generate_knockout(uuid, integer) TO authenticated;

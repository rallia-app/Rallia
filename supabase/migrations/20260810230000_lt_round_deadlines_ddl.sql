-- Round deadlines — F4a of the cadence engine (spec:
-- specs/17-leagues-tournaments/round-deadlines.md, generalized to the pool
-- phase of pool_knockout tournaments).
--
--   * tournament_round_deadlines — one deadline per (bracket_side, round).
--     For pool_knockout the pool PHASE carries a single deadline stored as
--     ('pool', round 0): every pool round shares it, per the format spec.
--   * tournament_matches.deadline_override_at — per-match extension.
--     Effective deadline = COALESCE(override, phase/round row).
--   * tournament_set_round_deadlines / tournament_extend_match_deadline —
--     organizer controls, audited, players notified on change.
--   * Publish-time defaults: tournament_generate_pools stamps the pool-phase
--     deadline from the fraction of start→end the pool matches represent;
--     tournament_generate_knockout splits the remaining time evenly across
--     knockout rounds; tournament_generate_bracket (single elim) splits
--     publish→end_date evenly across rounds. Deadlines are advisory data in
--     this slice: countdowns and the resolution ladder consume them next
--     (nudges + ladder ship in F4b).
--
-- No effective deadline on a match = no automation for it: the feature is
-- opt-out by simply clearing the rows.

-- ============================================
-- DDL
-- ============================================

CREATE TABLE IF NOT EXISTS tournament_round_deadlines (
    tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    bracket_side   text NOT NULL DEFAULT 'main'
        CHECK (bracket_side IN ('main', 'losers', 'grand_final', 'pool')),
    round_number   smallint NOT NULL,
    deadline_at    timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tournament_id, bracket_side, round_number)
);

ALTER TABLE tournament_round_deadlines ENABLE ROW LEVEL SECURITY;

-- Same visibility as tournament_matches; writes only through RPCs.
DROP POLICY IF EXISTS trd_select ON tournament_round_deadlines;
CREATE POLICY trd_select ON tournament_round_deadlines FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = tournament_round_deadlines.tournament_id
           AND t.visibility = 'public'
    )
    OR public.is_tournament_organizer(tournament_id)
    OR EXISTS (
        SELECT 1 FROM tournament_registrations r
         WHERE r.tournament_id = tournament_round_deadlines.tournament_id
           AND r.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS trd_no_direct_write ON tournament_round_deadlines;
CREATE POLICY trd_no_direct_write ON tournament_round_deadlines FOR ALL
USING (false) WITH CHECK (false);

GRANT SELECT ON tournament_round_deadlines TO authenticated;

ALTER TABLE tournament_matches
    ADD COLUMN IF NOT EXISTS deadline_override_at timestamptz;

-- ============================================
-- lt_notify_tournament_deadline_changed — one localized notice per player
-- still alive on the affected side/rounds.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_notify_tournament_deadline_changed(
    p_tournament_id uuid,
    p_bracket_side  text,
    p_rounds        smallint[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t    tournaments;
    v_rows jsonb;
BEGIN
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RETURN;
    END IF;

    SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'user_id', u.uid,
        'type', 'tournament_deadline_changed',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                   THEN 'Échéance modifiée' ELSE 'Deadline updated' END,
        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                  THEN v_t.name || ' : l''échéance pour jouer ta partie a changé. Ouvre le tournoi pour la voir.'
                  ELSE v_t.name || ': the deadline to play your game changed. Open the tournament to see it.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'bracketSide', p_bracket_side,
            'rounds', to_jsonb(p_rounds)
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT DISTINCT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid
          FROM tournament_matches tm
          JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE tm.tournament_id = p_tournament_id
           AND tm.bracket_side  = p_bracket_side
           AND (p_bracket_side = 'pool' OR tm.round_number = ANY (p_rounds))
           AND tm.status IN ('pending', 'in_progress', 'disputed')
    ) u;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

-- ============================================
-- tournament_set_round_deadlines — organizer upserts phase/round deadlines.
-- p_rounds: [{"bracket_side":"pool","round_number":0,"deadline_at":"..."},
--            {"bracket_side":"main","round_number":1,"deadline_at":"..."}]
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_set_round_deadlines(
    p_tournament_id uuid,
    p_rounds        jsonb
)
RETURNS SETOF tournament_round_deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_tournament tournaments;
    v_item       jsonb;
    v_side       text;
    v_round      smallint;
    v_at         timestamptz;
    v_prev       timestamptz;
    v_sides      text[] := '{}';
    v_rounds     smallint[] := '{}';
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
    IF v_tournament.status NOT IN ('registration_open', 'registration_closed', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DEADLINES';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_rounds) LOOP
        v_side  := COALESCE(v_item->>'bracket_side', 'main');
        v_round := (v_item->>'round_number')::smallint;
        v_at    := (v_item->>'deadline_at')::timestamptz;
        IF v_side NOT IN ('main', 'pool') OR v_round IS NULL OR v_at IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DEADLINES';
        END IF;

        -- A deadline for a side/round with unresolved matches must be ahead
        -- of now; fully resolved rounds may carry historical values.
        IF v_at <= now() AND EXISTS (
            SELECT 1 FROM tournament_matches tm
             WHERE tm.tournament_id = p_tournament_id
               AND tm.bracket_side  = v_side
               AND (v_side = 'pool' OR tm.round_number = v_round)
               AND tm.status IN ('pending', 'in_progress', 'disputed')
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_IN_PAST';
        END IF;

        INSERT INTO tournament_round_deadlines AS trd
            (tournament_id, bracket_side, round_number, deadline_at)
        VALUES (p_tournament_id, v_side, v_round, v_at)
        ON CONFLICT (tournament_id, bracket_side, round_number)
        DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();

        v_sides  := v_sides  || v_side;
        v_rounds := v_rounds || v_round;
    END LOOP;

    -- Strictly increasing across main rounds.
    v_prev := NULL;
    FOR v_at IN
        SELECT deadline_at FROM tournament_round_deadlines
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
         ORDER BY round_number
    LOOP
        IF v_prev IS NOT NULL AND v_at <= v_prev THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINES_NOT_INCREASING';
        END IF;
        v_prev := v_at;
    END LOOP;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament', p_tournament_id, 'set_round_deadlines', v_caller_id, p_rounds);

    IF 'pool' = ANY (v_sides) THEN
        PERFORM public.lt_notify_tournament_deadline_changed(p_tournament_id, 'pool', '{0}'::smallint[]);
    END IF;
    IF 'main' = ANY (v_sides) THEN
        PERFORM public.lt_notify_tournament_deadline_changed(
            p_tournament_id, 'main',
            ARRAY(SELECT unnest(v_rounds) EXCEPT SELECT 0::smallint));
    END IF;

    RETURN QUERY
        SELECT * FROM tournament_round_deadlines
         WHERE tournament_id = p_tournament_id
         ORDER BY bracket_side, round_number;
END;
$$;

-- ============================================
-- tournament_extend_match_deadline — one match gets its own deadline.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_extend_match_deadline(
    p_tournament_match_id uuid,
    p_deadline_at         timestamptz,
    p_reason              text DEFAULT NULL
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_tm        tournament_matches;
    v_row       tournament_matches;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;
    IF NOT public.is_tournament_organizer(v_tm.tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_RESOLVED';
    END IF;
    IF p_deadline_at IS NULL OR p_deadline_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_IN_PAST';
    END IF;

    UPDATE tournament_matches
       SET deadline_override_at = p_deadline_at,
           version              = version + 1,
           updated_at           = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_row.id, 'extend_deadline', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'deadline_at', p_deadline_at,
            'reason', p_reason
        )
    );

    PERFORM public.lt_notify_tournament_deadline_changed(
        v_row.tournament_id, v_row.bracket_side, ARRAY[v_row.round_number]::smallint[]);

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_set_round_deadlines(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_extend_match_deadline(uuid, timestamptz, text) TO authenticated;

-- ============================================
-- Publish-time defaults. Helper shared by the three generators.
-- ============================================

CREATE OR REPLACE FUNCTION public._lt_seed_default_deadlines(
    p_tournament_id uuid,
    p_side          text,
    p_from          timestamptz,
    p_to            timestamptz,
    p_rounds        integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_span interval;
BEGIN
    IF p_rounds < 1 OR p_to <= p_from THEN
        RETURN;   -- nothing sane to seed; organizer can set deadlines by RPC
    END IF;
    v_span := (p_to - p_from) / p_rounds;
    IF p_side = 'pool' THEN
        INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
        VALUES (p_tournament_id, 'pool', 0, p_to)
        ON CONFLICT (tournament_id, bracket_side, round_number)
        DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
    ELSE
        FOR r IN 1..p_rounds LOOP
            INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
            VALUES (p_tournament_id, 'main', r, p_from + v_span * r)
            ON CONFLICT (tournament_id, bracket_side, round_number)
            DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
        END LOOP;
    END IF;
END;
$$;


-- ============================================
-- Generator re-issues (bodies verbatim from 20260810170100 / 20260810210000)
-- with exactly one addition each: seeding the default deadlines at publish.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_generate_pools(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS SETOF tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_tournament tournaments;
    v_regs       uuid[];
    v_n          integer;
    v_k          integer;
    v_members    uuid[];
    v_line       uuid[];
    v_arr        uuid[];
    v_m          integer;
    v_big        integer;
    v_rounds     integer;
    v_max_rounds integer := 0;
    v_pos        integer[] := '{}';
    v_p1         uuid;
    v_p2         uuid;
    v_sizes      integer[] := '{}';
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
    -- Pools-exist is the more specific signal (generation flips the status),
    -- so check it before status — same rationale as tournament_preview_bracket.
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOLS_ALREADY_GENERATED';
    END IF;
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;

    SELECT array_agg(tr.id ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC)
      INTO v_regs
      FROM tournament_registrations tr
     WHERE tr.tournament_id = p_tournament_id
       AND tr.status = 'registered';

    v_n := coalesce(array_length(v_regs, 1), 0);
    IF v_n < 6 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _pool_assign (
        seed_idx        integer NOT NULL,
        pool_number     integer NOT NULL,
        registration_id uuid    NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE _pool_assign;

    INSERT INTO _pool_assign
        SELECT * FROM public._lt_compute_pool_assignment(v_regs, v_tournament.pool_size);

    SELECT max(a.pool_number) INTO v_k FROM _pool_assign a;

    FOR p IN 1..v_k LOOP
        v_members := ARRAY(
            SELECT a.registration_id FROM _pool_assign a
             WHERE a.pool_number = p ORDER BY a.seed_idx
        );
        v_m := array_length(v_members, 1);
        v_sizes[p] := v_m;

        -- Circle method: pad odd pools with a phantom, pin the head, rotate
        -- the tail one step per round. Phantom pairings are simply skipped.
        v_line := v_members;
        IF v_m % 2 = 1 THEN
            v_line := v_line || NULL::uuid;
        END IF;
        v_big    := array_length(v_line, 1);
        v_rounds := v_big - 1;
        v_max_rounds := greatest(v_max_rounds, v_rounds);

        FOR r IN 1..v_rounds LOOP
            v_arr := ARRAY[v_line[1]];
            FOR j IN 2..v_big LOOP
                v_arr[j] := v_line[2 + ((j - 2 + (r - 1)) % (v_big - 1))];
            END LOOP;

            FOR i IN 1..(v_big / 2) LOOP
                v_p1 := v_arr[i];
                v_p2 := v_arr[v_big + 1 - i];
                CONTINUE WHEN v_p1 IS NULL OR v_p2 IS NULL;

                v_pos[r] := coalesce(v_pos[r], 0) + 1;
                INSERT INTO tournament_matches (
                    tournament_id, bracket_side, pool_number,
                    round_number, match_position,
                    player1_registration_id, player2_registration_id,
                    status
                )
                VALUES (
                    p_tournament_id, 'pool', p,
                    r, v_pos[r],
                    v_p1, v_p2,
                    'pending'
                );
            END LOOP;
        END LOOP;
    END LOOP;

    UPDATE tournaments
       SET status     = 'in_progress',
           version    = version + 1,
           updated_at = now()
     WHERE id = p_tournament_id;

    -- Default pool-phase deadline: the pool rounds' share of the window
    -- between publish (or start_date) and end_date, vs the knockout rounds
    -- still to come. Organizer adjusts via tournament_set_round_deadlines.
    DECLARE
        v_ko_rounds integer := ceil(ln(GREATEST(v_k * v_tournament.qualifiers_per_pool, 2)) / ln(2))::integer;
        v_from      timestamptz := GREATEST(now(), v_tournament.start_date);
    BEGIN
        PERFORM public._lt_seed_default_deadlines(
            p_tournament_id, 'pool', v_from,
            v_from + (v_tournament.end_date - v_from)
                     * v_max_rounds::double precision
                     / GREATEST(v_max_rounds + v_ko_rounds, 1)::double precision,
            1);
    END;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'generate_pools', v_caller_id,
        jsonb_build_object(
            'pool_count', v_k,
            'pool_sizes', to_jsonb(v_sizes),
            'rounds', v_max_rounds,
            'active_count', v_n
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
         ORDER BY round_number, match_position;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.tournament_generate_bracket(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS SETOF tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_size         integer;
    v_rounds       integer;
    v_active_count integer;
    v_seeded_regs  uuid[];
    v_row          record;
    v_new_id       uuid;
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
    -- Pool tournaments publish through tournament_generate_pools; the
    -- knockout tree comes later from the qualifiers (F3).
    IF v_tournament.bracket_type = 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_STAGE_REQUIRED';
    END IF;
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;

    SELECT array_agg(id ORDER BY
        seed_rank ASC NULLS LAST,
        registered_at ASC,
        id ASC
    )
    INTO v_seeded_regs
    FROM tournament_registrations
    WHERE tournament_id = p_tournament_id
      AND status = 'registered';

    v_active_count := coalesce(array_length(v_seeded_regs, 1), 0);
    IF v_active_count < 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    v_size   := v_tournament.max_participants;
    v_rounds := (ln(v_size) / ln(2))::integer;

    CREATE TEMP TABLE IF NOT EXISTS _gen_map (
        round_number   smallint NOT NULL,
        match_position smallint NOT NULL,
        match_id       uuid NOT NULL,
        PRIMARY KEY (round_number, match_position)
    ) ON COMMIT DROP;
    TRUNCATE _gen_map;

    FOR v_row IN
        SELECT * FROM public._lt_compute_bracket(v_seeded_regs, v_size)
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
       SET status     = 'in_progress',
           version    = version + 1,
           updated_at = now()
     WHERE id = p_tournament_id;

    PERFORM public._lt_seed_default_deadlines(
        p_tournament_id, 'main', now(), v_tournament.end_date, v_rounds);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'generate_bracket', v_caller_id,
        jsonb_build_object(
            'bracket_size', v_size,
            'rounds', v_rounds,
            'active_count', v_active_count
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
         ORDER BY round_number, match_position;
END;
$$;

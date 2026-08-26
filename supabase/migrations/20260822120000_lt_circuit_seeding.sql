-- ============================================
-- Leagues & Tournaments — Circuit Rallia seeding, organizer override kept
-- ============================================
-- Until now a draw was seeded by seed_rank (organizer) then registration
-- time: leave the seeds alone and the field was first-come-first-seeded.
-- Every publish path now reads one ladder, lt_tournament_seed_order:
--
--   1. seed_rank ASC NULLS LAST        organizer override, always wins
--   2. Circuit Rallia points DESC      rolling-window board of the tournament's
--                                      sport and board (singles / doubles,
--                                      same derivation as tg_trp_set_board);
--                                      doubles entries = sum of both partners
--   3. active rating DESC NULLS LAST   canonical active_rating_score_id path
--                                      (same as lt_assert_rating_band);
--                                      doubles entries = average of the pair
--   4. registered_at ASC, id ASC       FIFO, as before
--
-- tournament_preview_bracket / tournament_preview_pools and
-- tournament_generate_bracket / tournament_generate_pools all read it, so the
-- preview the organizer sees IS the draw that gets published. Generation also
-- stamps seed_rank 1..N when the organizer left the seeds blank, so the
-- effective seeding is on the record (TournamentDetail seed labels, result
-- posters, tests) instead of being recomputed later against a moving board.
-- A field the organizer already ordered is left exactly as they set it.
--
-- tournament_seed_suggestions exposes the ladder, with the points and rating
-- behind each entry, to the organizer's bracket-setup screen. The screen
-- starts from it and writes back the organizer's final order through
-- tournament_set_seeds, unchanged.
--
-- Not wired (unchanged from before): tournaments.seeding_enabled / max_seeds
-- are still ignored and self_declared_rank is never written.
--
-- Bodies copied from the latest definitions (live md5 verified):
--   tournament_preview_bracket / tournament_preview_pools   20260810170100
--   tournament_generate_bracket / tournament_generate_pools 20260810230000
-- ============================================


-- --------------------------------------------
-- 1. The ladder
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_tournament_seed_order(p_tournament_id uuid)
RETURNS TABLE (
    registration_id uuid,
    suggested_seed  integer,
    seed_rank       smallint,
    circuit_points  integer,
    circuit_rank    integer,
    rating          double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH t AS (
        SELECT tt.id, tt.sport_id,
               CASE WHEN tt.entry_format = 'singles' THEN 'singles' ELSE 'doubles' END AS board
          FROM tournaments tt
         WHERE tt.id = p_tournament_id
    ),
    board AS (
        SELECT b.user_id, b.points, b.rank
          FROM t,
               public.tournament_ranked_board(t.sport_id, NULL, NULL, NULL, t.board) b
    ),
    regs AS (
        SELECT tr.id, tr.seed_rank, tr.registered_at, tr.user_id, tr.partner_user_id
          FROM tournament_registrations tr
         WHERE tr.tournament_id = p_tournament_id
           AND tr.status = 'registered'
    ),
    members AS (
        SELECT r.id AS reg_id, m.user_id
          FROM regs r
          CROSS JOIN LATERAL (VALUES (r.user_id), (r.partner_user_id)) AS m(user_id)
         WHERE m.user_id IS NOT NULL
    ),
    scored AS (
        SELECT m.reg_id,
               sum(coalesce(b.points, 0))::int AS circuit_points,
               min(b.rank)::int                AS circuit_rank,
               avg(rs.value)                   AS rating
          FROM members m
          CROSS JOIN t
          LEFT JOIN board b                 ON b.user_id = m.user_id
          LEFT JOIN player_sport ps         ON ps.player_id = m.user_id AND ps.sport_id = t.sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs         ON rs.id = prs.rating_score_id
         GROUP BY m.reg_id
    )
    SELECT r.id,
           (row_number() OVER (ORDER BY r.seed_rank ASC NULLS LAST,
                                        s.circuit_points DESC,
                                        s.rating DESC NULLS LAST,
                                        r.registered_at ASC,
                                        r.id ASC))::int,
           r.seed_rank,
           s.circuit_points,
           s.circuit_rank,
           s.rating
      FROM regs r
      JOIN scored s ON s.reg_id = r.id
     ORDER BY 2;
$$;
REVOKE EXECUTE ON FUNCTION public.lt_tournament_seed_order(uuid) FROM PUBLIC;
COMMENT ON FUNCTION public.lt_tournament_seed_order(uuid) IS
  'Effective seed order of a tournament''s registered entries: seed_rank '
  '(organizer override) then Circuit Rallia points (rolling board of the '
  'sport + singles/doubles board, partners summed) then active rating '
  '(partners averaged) then registration time. Read by every preview and '
  'publish path; internal, see tournament_seed_suggestions for the RPC.';


-- --------------------------------------------
-- 2. Organizer-facing read
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_seed_suggestions(p_tournament_id uuid)
RETURNS TABLE (
    registration_id uuid,
    suggested_seed  integer,
    seed_rank       smallint,
    circuit_points  integer,
    circuit_rank    integer,
    rating          double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    RETURN QUERY SELECT * FROM public.lt_tournament_seed_order(p_tournament_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_seed_suggestions(uuid) TO authenticated;
COMMENT ON FUNCTION public.tournament_seed_suggestions(uuid) IS
  'Organizer read of lt_tournament_seed_order with the Circuit points and '
  'rating behind each entry. The bracket-setup screen starts from this order '
  'and writes the organizer''s final order back through tournament_set_seeds.';


-- --------------------------------------------
-- 3. Stamp at publish
-- --------------------------------------------
-- Returns the effective order. When any registered entry has no seed_rank,
-- writes 1..N so the published seeding is on the record. Clear-then-assign
-- because treg_seed_unique_per_tournament is a non-deferrable exclusion
-- constraint (same dance as tournament_set_seeds).
CREATE OR REPLACE FUNCTION public._lt_stamp_seed_ranks(p_tournament_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order uuid[];
BEGIN
    SELECT array_agg(o.registration_id ORDER BY o.suggested_seed)
      INTO v_order
      FROM public.lt_tournament_seed_order(p_tournament_id) o;

    IF EXISTS (
        SELECT 1 FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND status = 'registered'
           AND seed_rank IS NULL
    ) THEN
        UPDATE tournament_registrations
           SET seed_rank = NULL
         WHERE tournament_id = p_tournament_id
           AND seed_rank IS NOT NULL;

        UPDATE tournament_registrations tr
           SET seed_rank = o.ord
          FROM unnest(v_order) WITH ORDINALITY AS o(reg_id, ord)
         WHERE tr.id = o.reg_id
           AND tr.tournament_id = p_tournament_id;
    END IF;

    RETURN v_order;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._lt_stamp_seed_ranks(uuid) FROM PUBLIC;


-- --------------------------------------------
-- 4. Previews read the ladder
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_preview_bracket(
    p_tournament_id uuid
)
RETURNS TABLE (
    round_number             integer,
    match_position           integer,
    player1_registration_id  uuid,
    player2_registration_id  uuid,
    player1_is_bye           boolean,
    player2_is_bye           boolean,
    winner_registration_id   uuid,
    status                   tournament_match_status,
    is_phantom               boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_seeded_regs uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.bracket_type = 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_STAGE_REQUIRED';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;

    SELECT array_agg(o.registration_id ORDER BY o.suggested_seed)
      INTO v_seeded_regs
      FROM public.lt_tournament_seed_order(p_tournament_id) o;

    IF coalesce(array_length(v_seeded_regs, 1), 0) < 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    RETURN QUERY
        SELECT b.round_number, b.match_position,
               b.player1_registration_id, b.player2_registration_id,
               b.player1_is_bye, b.player2_is_bye,
               b.winner_registration_id, b.status, b.is_phantom
          FROM public._lt_compute_bracket(v_seeded_regs, v_tournament.max_participants) AS b;
END;
$$;


CREATE OR REPLACE FUNCTION public.tournament_preview_pools(
    p_tournament_id uuid
)
RETURNS TABLE (
    pool_number     integer,
    slot            integer,
    registration_id uuid,
    user_id         uuid,
    partner_user_id uuid,
    seed_rank       smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_tournament tournaments;
    v_regs       uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOLS_ALREADY_GENERATED';
    END IF;
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;

    SELECT array_agg(o.registration_id ORDER BY o.suggested_seed)
      INTO v_regs
      FROM public.lt_tournament_seed_order(p_tournament_id) o;

    RETURN QUERY
        SELECT a.pool_number,
               (row_number() OVER (PARTITION BY a.pool_number ORDER BY a.seed_idx))::integer AS slot,
               a.registration_id,
               tr.user_id,
               tr.partner_user_id,
               tr.seed_rank
          FROM public._lt_compute_pool_assignment(v_regs, v_tournament.pool_size) a
          JOIN tournament_registrations tr ON tr.id = a.registration_id
         ORDER BY a.pool_number, slot;
END;
$$;


-- --------------------------------------------
-- 5. Publish paths read the ladder and stamp it
-- --------------------------------------------
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
    v_auto_seeded  boolean;
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

    -- Effective seed order (seed_rank -> Circuit -> rating -> FIFO); stamps
    -- seed_rank when the organizer left the seeds blank.
    v_auto_seeded := EXISTS (
        SELECT 1 FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND status = 'registered'
           AND seed_rank IS NULL);
    v_seeded_regs := public._lt_stamp_seed_ranks(p_tournament_id);

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
            'active_count', v_active_count,
            'auto_seeded', v_auto_seeded
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
         ORDER BY round_number, match_position;
END;
$$;


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
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_regs        uuid[];
    v_auto_seeded boolean;
    v_n           integer;
    v_k           integer;
    v_members     uuid[];
    v_line        uuid[];
    v_arr         uuid[];
    v_m           integer;
    v_big         integer;
    v_rounds      integer;
    v_max_rounds  integer := 0;
    v_pos         integer[] := '{}';
    v_p1          uuid;
    v_p2          uuid;
    v_sizes       integer[] := '{}';
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

    -- Effective seed order (seed_rank -> Circuit -> rating -> FIFO); stamps
    -- seed_rank when the organizer left the seeds blank.
    v_auto_seeded := EXISTS (
        SELECT 1 FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND status = 'registered'
           AND seed_rank IS NULL);
    v_regs := public._lt_stamp_seed_ranks(p_tournament_id);

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
            'active_count', v_n,
            'auto_seeded', v_auto_seeded
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
         ORDER BY round_number, match_position;
END;
$$;

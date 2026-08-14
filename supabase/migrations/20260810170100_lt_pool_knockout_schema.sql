-- Pool + knockout tournaments — F1: schema + pool generation.
--
-- A pool_knockout tournament runs a round-robin pool phase before the
-- knockout tree. This migration adds:
--   * pool config on tournaments (pool_size, qualifiers_per_pool) and the
--     non-power-of-two field sizes the format needs;
--   * the pool dimension on tournament_matches (bracket_side 'pool' +
--     pool_number); pool rows have no next_match link — they never advance
--     anyone directly (standings + cut-over come in F2/F3);
--   * _lt_compute_pool_assignment (pure serpentine distribution),
--     tournament_preview_pools and tournament_generate_pools;
--   * guards so the single-elimination path is untouched: generate/preview
--     bracket refuse pool tournaments (POOL_STAGE_REQUIRED), pool generation
--     refuses non-pool tournaments (NOT_POOL_TOURNAMENT), and the winner
--     advancement walker ignores pool rows.
--
-- tournament_create is re-issued (same body as 20260731150000) with
-- p_pool_size / p_qualifiers_per_pool appended; the old 26-arg overload is
-- dropped first, grants re-issued after. tournament_update is deliberately
-- NOT touched: bracket_type/max_participants edits stay draft-only with the
-- legacy size list until the wizard slice needs more.

-- ============================================
-- tournaments: pool config + field sizes
-- ============================================

ALTER TABLE tournaments
    ADD COLUMN IF NOT EXISTS pool_size smallint
        CONSTRAINT tournaments_pool_size_check
        CHECK (pool_size IS NULL OR pool_size BETWEEN 3 AND 5),
    ADD COLUMN IF NOT EXISTS qualifiers_per_pool smallint
        CONSTRAINT tournaments_qualifiers_check
        CHECK (qualifiers_per_pool IS NULL OR qualifiers_per_pool IN (1, 2));

ALTER TABLE tournaments
    ADD CONSTRAINT tournaments_pool_config CHECK (
        (bracket_type = 'pool_knockout')
        = (pool_size IS NOT NULL AND qualifiers_per_pool IS NOT NULL)
    );

-- Field size becomes bracket-type-dependent: knockout trees need powers of
-- two, pool fields don't.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_max_participants_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_max_participants_check CHECK (
    CASE WHEN bracket_type = 'pool_knockout'
         THEN max_participants IN (8, 12, 16, 20, 24, 32)
         ELSE max_participants IN (4, 8, 16, 32, 64, 128)
    END
);

-- ============================================
-- tournament_matches: the pool dimension
-- ============================================

ALTER TABLE tournament_matches
    ADD COLUMN IF NOT EXISTS pool_number smallint;

ALTER TABLE tournament_matches DROP CONSTRAINT IF EXISTS tournament_matches_bracket_side_check;
ALTER TABLE tournament_matches ADD CONSTRAINT tournament_matches_bracket_side_check
    CHECK (bracket_side IN ('main', 'losers', 'grand_final', 'pool'));

ALTER TABLE tournament_matches ADD CONSTRAINT tournament_matches_pool_number_coherence
    CHECK ((bracket_side = 'pool') = (pool_number IS NOT NULL));

CREATE INDEX IF NOT EXISTS tournament_matches_pool_idx
    ON tournament_matches(tournament_id, pool_number)
    WHERE pool_number IS NOT NULL;

-- ============================================
-- _lt_compute_pool_assignment — pure serpentine distribution.
-- Input: registrations in seed order, target pool size. Output: one row per
-- registration with its pool. Pool count k = ceil(n / size), lowered until
-- every pool holds >= 3; the n % k largest pools take the extra player.
-- Snake order repeats the edge pool (1 2 3 3 2 1 1 2 3 ...) so top seeds
-- spread across pools and pool strengths stay comparable.
-- ============================================

CREATE OR REPLACE FUNCTION public._lt_compute_pool_assignment(
    p_regs      uuid[],
    p_pool_size smallint
)
RETURNS TABLE (
    seed_idx        integer,
    pool_number     integer,
    registration_id uuid
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_n    integer := coalesce(array_length(p_regs, 1), 0);
    v_k    integer;
    v_base integer;
    v_rem  integer;
    v_cap  integer[] := '{}';
    v_p    integer := 1;
    v_dir  integer := 1;
    v_step integer;
BEGIN
    IF v_n < 6 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    v_k := ceil(v_n::numeric / p_pool_size)::integer;
    IF v_n / v_k < 3 THEN
        v_k := v_n / 3;
    END IF;
    v_base := v_n / v_k;
    v_rem  := v_n % v_k;

    IF v_base < 3 OR (v_base + CASE WHEN v_rem > 0 THEN 1 ELSE 0 END) > 5 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_SIZING_FAILED';
    END IF;

    FOR i IN 1..v_k LOOP
        v_cap[i] := v_base + CASE WHEN i <= v_rem THEN 1 ELSE 0 END;
    END LOOP;

    FOR i IN 1..v_n LOOP
        v_step := 0;
        WHILE v_cap[v_p] <= 0 LOOP
            IF v_dir = 1 AND v_p = v_k THEN v_dir := -1;
            ELSIF v_dir = -1 AND v_p = 1 THEN v_dir := 1;
            ELSE v_p := v_p + v_dir;
            END IF;
            v_step := v_step + 1;
            IF v_step > 2 * v_k + 2 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_SIZING_FAILED';
            END IF;
        END LOOP;

        seed_idx        := i;
        pool_number     := v_p;
        registration_id := p_regs[i];
        RETURN NEXT;
        v_cap[v_p] := v_cap[v_p] - 1;

        IF v_dir = 1 AND v_p = v_k THEN v_dir := -1;
        ELSIF v_dir = -1 AND v_p = 1 THEN v_dir := 1;
        ELSE v_p := v_p + v_dir;
        END IF;
    END LOOP;
END;
$$;

-- ============================================
-- tournament_preview_pools — read-only dry run of the pool composition.
-- Guards mirror tournament_preview_bracket so the client reuses copy.
-- ============================================

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

    SELECT array_agg(tr.id ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC)
      INTO v_regs
      FROM tournament_registrations tr
     WHERE tr.tournament_id = p_tournament_id
       AND tr.status = 'registered';

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

-- ============================================
-- tournament_generate_pools — the pool-phase Publish step. Inserts every
-- round-robin pool match (circle method, one rotation per round) and flips
-- the tournament to in_progress. Pool rows carry no next_match link.
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

-- ============================================
-- Single-elim path guards. Bodies copied verbatim from their latest
-- migrations (20260628120000 generate/preview, 20260628190100 advance);
-- each gains exactly one pool guard.
-- ============================================

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

    SELECT array_agg(tr.id ORDER BY
        tr.seed_rank ASC NULLS LAST,
        tr.registered_at ASC,
        tr.id ASC
    )
    INTO v_seeded_regs
    FROM tournament_registrations tr
    WHERE tr.tournament_id = p_tournament_id
      AND tr.status = 'registered';

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

CREATE OR REPLACE FUNCTION public.lt_advance_tournament_winner(
    p_tournament_match_id  uuid,
    p_winner_registration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_curr        tournament_matches;
    v_next        tournament_matches;
    v_curr_winner uuid := p_winner_registration_id;
    v_other_bye   boolean;
    v_other_reg   uuid;
    v_tournament  tournaments;
BEGIN
    SELECT * INTO v_curr FROM tournament_matches WHERE id = p_tournament_match_id;
    IF v_curr.id IS NULL THEN
        RETURN;
    END IF;

    -- Pool matches advance nobody and never lock the bracket; standings are
    -- derived from the rows themselves (F2).
    IF v_curr.bracket_side = 'pool' THEN
        RETURN;
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_curr.tournament_id;

    IF v_tournament.bracket_locked_at IS NULL THEN
        UPDATE tournaments
           SET bracket_locked_at = now(),
               updated_at        = now()
         WHERE id = v_tournament.id;
    END IF;

    WHILE v_curr.next_match_id IS NOT NULL LOOP
        SELECT * INTO v_next FROM tournament_matches
         WHERE id = v_curr.next_match_id FOR UPDATE;

        IF v_curr.next_match_slot = 1 THEN
            UPDATE tournament_matches
               SET player1_registration_id = v_curr_winner,
                   player1_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        ELSE
            UPDATE tournament_matches
               SET player2_registration_id = v_curr_winner,
                   player2_is_bye          = false,
                   version                 = version + 1,
                   updated_at              = now()
             WHERE id = v_next.id;
        END IF;

        SELECT * INTO v_next FROM tournament_matches WHERE id = v_next.id;

        IF v_curr.next_match_slot = 1 THEN
            v_other_bye := v_next.player2_is_bye;
            v_other_reg := v_next.player2_registration_id;
        ELSE
            v_other_bye := v_next.player1_is_bye;
            v_other_reg := v_next.player1_registration_id;
        END IF;

        IF v_other_bye AND v_other_reg IS NULL THEN
            UPDATE tournament_matches
               SET winner_registration_id = v_curr_winner,
                   status                 = 'completed',
                   version                = version + 1,
                   updated_at             = now()
             WHERE id = v_next.id
            RETURNING * INTO v_next;
            v_curr := v_next;
        ELSE
            PERFORM public.lt_notify_tournament_match_ready(v_next.id);
            EXIT;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM tournament_matches m
         WHERE m.tournament_id = v_tournament.id
           AND m.next_match_id IS NULL
           AND m.bracket_side = 'main'
           AND m.status = 'completed'
           AND m.winner_registration_id IS NOT NULL
    ) THEN
        UPDATE tournaments
           SET status     = 'completed',
               version    = version + 1,
               updated_at = now()
         WHERE id = v_tournament.id
           AND status = 'in_progress';
    END IF;
END;
$$;

-- ============================================
-- tournament_create — same body as 20260731150000 plus pool config params
-- (appended). Signature changes → drop the 26-arg overload, re-grant after.
-- ============================================

DROP FUNCTION IF EXISTS public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer, numeric, smallint
);

CREATE OR REPLACE FUNCTION public.tournament_create(
    p_name              text,
    p_sport_id          uuid,
    p_max_participants  smallint,
    p_start_date        timestamptz,
    p_end_date          timestamptz,
    p_description       text                          DEFAULT NULL,
    p_visibility        tournament_visibility         DEFAULT 'private',
    p_registration_mode tournament_registration_mode  DEFAULT 'open',
    p_bracket_type      bracket_type                  DEFAULT 'single_elimination',
    p_match_format      match_format                  DEFAULT NULL,
    p_entry_format      entry_format                  DEFAULT 'singles',
    p_facility_id       uuid                          DEFAULT NULL,
    p_venue_name        text                          DEFAULT NULL,
    p_network_id        uuid                          DEFAULT NULL,
    p_registration_opens_at  timestamptz              DEFAULT NULL,
    p_registration_closes_at timestamptz              DEFAULT NULL,
    p_rules             text                          DEFAULT NULL,
    p_logo_url          text                          DEFAULT NULL,
    p_min_rating        numeric                       DEFAULT NULL,
    p_fee               jsonb                         DEFAULT NULL,
    p_venue_address     text                          DEFAULT NULL,
    p_city              text                          DEFAULT NULL,
    p_prize_money_cents integer                       DEFAULT NULL,
    p_max_rating        numeric                       DEFAULT NULL,
    p_points_per_game   smallint                      DEFAULT NULL,
    p_pool_size         smallint                      DEFAULT NULL,
    p_qualifiers_per_pool smallint                    DEFAULT NULL
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_sport_name    text;
    v_match_format  match_format;
    v_points        smallint;
    v_recent_count  integer;
    v_closes_at     timestamptz;
    v_pool_size     smallint;
    v_qualifiers    smallint;
    v_row           tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    PERFORM public.assert_caller_plays_sport(p_sport_id);

    IF p_min_rating IS NOT NULL AND p_max_rating IS NOT NULL
       AND p_max_rating < p_min_rating THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
    END IF;

    -- Explicit, before the table CHECKs fire: check_violation below is mapped
    -- to INVALID_FEE_SETTINGS, which would be a lie for size/pool problems.
    IF p_bracket_type = 'pool_knockout' THEN
        IF p_max_participants NOT IN (8, 12, 16, 20, 24, 32) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_SIZE';
        END IF;
        v_pool_size  := COALESCE(p_pool_size, 4::smallint);
        v_qualifiers := COALESCE(p_qualifiers_per_pool, 2::smallint);
        IF v_pool_size NOT BETWEEN 3 AND 5 OR v_qualifiers NOT IN (1, 2) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POOL_CONFIG';
        END IF;
    ELSE
        IF p_max_participants NOT IN (4, 8, 16, 32, 64, 128) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_SIZE';
        END IF;
        IF p_pool_size IS NOT NULL OR p_qualifiers_per_pool IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POOL_CONFIG';
        END IF;
        v_pool_size  := NULL;
        v_qualifiers := NULL;
    END IF;

    IF p_network_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM network n
              JOIN network_type nt ON nt.id = n.network_type_id
             WHERE n.id = p_network_id
               AND nt.name = 'community'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NETWORK_NOT_COMMUNITY';
        END IF;
    END IF;

    IF NOT public.is_admin() THEN
        SELECT count(*) INTO v_recent_count
          FROM tournaments
         WHERE organizer_id = v_caller_id
           AND created_at  > now() - interval '24 hours';

        IF v_recent_count >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATE_LIMITED';
        END IF;
    END IF;

    SELECT name INTO v_sport_name FROM sport WHERE id = p_sport_id;

    v_match_format := COALESCE(p_match_format, 'two_of_three'::match_format);
    v_points       := p_points_per_game;

    IF v_match_format IN ('pickleball_to_11', 'pickleball_to_15', 'pickleball_to_21') THEN
        v_points := COALESCE(v_points, CASE v_match_format
            WHEN 'pickleball_to_11' THEN 11::smallint
            WHEN 'pickleball_to_15' THEN 15::smallint
            ELSE 21::smallint
        END);
        v_match_format := 'two_of_three'::match_format;
    END IF;

    IF v_sport_name = 'pickleball' THEN
        v_points := COALESCE(v_points, 11::smallint);
    END IF;

    IF v_points IS NOT NULL AND v_points NOT IN (11, 15, 21) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POINTS_PER_GAME';
    END IF;

    v_closes_at := COALESCE(
        p_registration_closes_at,
        GREATEST(p_start_date - interval '24 hours', now())
    );

    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date,
        description, rules, logo_url, min_rating, max_rating, visibility, registration_mode,
        bracket_type, match_format, points_per_game, entry_format,
        pool_size, qualifiers_per_pool,
        facility_id, venue_name, venue_address, city, network_id,
        registration_opens_at, registration_closes_at,
        organizer_id, prize_money_cents,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_partial_bps, refund_cutoff_at
    )
    VALUES (
        p_name, p_sport_id, p_max_participants, p_start_date, p_end_date,
        p_description, p_rules, p_logo_url, p_min_rating, p_max_rating, p_visibility, p_registration_mode,
        p_bracket_type, v_match_format, v_points, p_entry_format,
        v_pool_size, v_qualifiers,
        p_facility_id, p_venue_name, p_venue_address, p_city, p_network_id,
        p_registration_opens_at, v_closes_at,
        v_caller_id, p_prize_money_cents,
        COALESCE((p_fee->>'entry_fee_cents')::integer, 0),
        COALESCE(p_fee->>'currency', 'CAD'),
        COALESCE((p_fee->>'fee_payer')::fee_payer_enum, 'player_pays'),
        COALESCE((p_fee->>'payout_timing')::payout_timing_enum, 'hold_until_event_end'),
        COALESCE((p_fee->>'refund_policy_kind')::refund_policy_kind_enum, 'none'),
        (p_fee->>'refund_partial_bps')::integer,
        NULLIF(p_fee->>'refund_cutoff_at', '')::timestamptz
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'name', v_row.name,
            'sport_id', v_row.sport_id,
            'max_participants', v_row.max_participants,
            'start_date', v_row.start_date,
            'end_date', v_row.end_date,
            'visibility', v_row.visibility,
            'registration_mode', v_row.registration_mode,
            'entry_fee_cents', v_row.entry_fee_cents,
            'fee_payer', v_row.fee_payer
        )
    );

    RETURN v_row;
EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FEE_SETTINGS';
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_create(
    text, uuid, smallint, timestamptz, timestamptz,
    text, tournament_visibility, tournament_registration_mode,
    bracket_type, match_format, entry_format,
    uuid, text, uuid, timestamptz, timestamptz, text, text, numeric, jsonb,
    text, text, integer, numeric, smallint, smallint, smallint
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.tournament_preview_pools(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_generate_pools(uuid, integer) TO authenticated;

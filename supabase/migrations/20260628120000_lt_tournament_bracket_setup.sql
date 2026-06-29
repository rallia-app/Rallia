-- ============================================
-- Leagues & Tournaments — Bracket setup: seeding + dry-run preview
-- ============================================
-- Adds the organizer's pre-publish bracket workflow:
--   1. tournament_set_seeds       — write seed_rank from an ordered reg list
--   2. tournament_preview_bracket — read-only dry run, computes the bracket
--                                   WITHOUT inserting rows or changing status
--   3. tournament_generate_bracket stays the "Publish" action (already
--      seed-aware; flips status -> in_progress and notifies participants).
--
-- The single-elimination placement math is extracted out of
-- tournament_generate_bracket into a pure helper, _lt_compute_bracket, so the
-- preview and the real generation share ONE source of truth (zero drift).
-- generate's externally observable behaviour is unchanged — the existing
-- supabase/tests/tournaments_flow_test.sql guards that.
--
-- seed_rank, seeding_enabled, max_seeds, and lt_seed_positions() already
-- exist from the original V3 schema; only the RPCs are new here.
-- ============================================


-- =====================
-- Pure helper: logical single-elimination bracket from a seeded reg list.
-- Mirrors the round-1 binary seed placement + BYE auto-advancement that
-- tournament_generate_bracket used inline. No table access -> IMMUTABLE.
-- =====================
CREATE OR REPLACE FUNCTION public._lt_compute_bracket(
    p_seeded_regs uuid[],
    p_size        integer
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
IMMUTABLE
AS $$
DECLARE
    v_active_count integer := coalesce(array_length(p_seeded_regs, 1), 0);
    v_rounds       integer;
    v_positions    integer[];
    v_prev_winners uuid[];
    v_prev_phantom boolean[];
    v_curr_winners uuid[];
    v_curr_phantom boolean[];
    v_round            integer;
    v_matches_in_round integer;
    v_m                integer;
    v_st  tournament_match_status;
    v_win uuid;
    v_ph  boolean;
BEGIN
    IF p_size < 2 OR (p_size & (p_size - 1)) <> 0 THEN
        RAISE EXCEPTION 'BAD_BRACKET_SIZE: %', p_size;
    END IF;
    v_rounds    := (ln(p_size) / ln(2))::integer;
    v_positions := public.lt_seed_positions(p_size);

    -- Round 1: seeds -> standard positions, missing seeds become BYEs.
    v_matches_in_round := p_size / 2;
    v_curr_winners := ARRAY[]::uuid[];
    v_curr_phantom := ARRAY[]::boolean[];

    FOR v_m IN 1..v_matches_in_round LOOP
        DECLARE
            v_seed1 integer := v_positions[(v_m - 1) * 2 + 1];
            v_seed2 integer := v_positions[(v_m - 1) * 2 + 2];
        BEGIN
            player1_registration_id := CASE WHEN v_seed1 <= v_active_count THEN p_seeded_regs[v_seed1] ELSE NULL END;
            player2_registration_id := CASE WHEN v_seed2 <= v_active_count THEN p_seeded_regs[v_seed2] ELSE NULL END;
            player1_is_bye := player1_registration_id IS NULL;
            player2_is_bye := player2_registration_id IS NULL;

            IF NOT player1_is_bye AND NOT player2_is_bye THEN
                v_st := 'pending'; v_win := NULL; v_ph := false;
            ELSIF player1_is_bye AND player2_is_bye THEN
                v_st := 'completed'; v_win := NULL; v_ph := true;
            ELSE
                v_st := 'completed'; v_win := coalesce(player1_registration_id, player2_registration_id); v_ph := false;
            END IF;

            round_number := 1; match_position := v_m;
            winner_registration_id := v_win; status := v_st; is_phantom := v_ph;
            RETURN NEXT;

            v_curr_winners := v_curr_winners || COALESCE(v_win, NULL::uuid);
            v_curr_phantom := v_curr_phantom || v_ph;
        END;
    END LOOP;

    -- Rounds 2..final: winners (and phantom BYE chains) feed forward.
    FOR v_round IN 2..v_rounds LOOP
        v_prev_winners := v_curr_winners;
        v_prev_phantom := v_curr_phantom;
        v_curr_winners := ARRAY[]::uuid[];
        v_curr_phantom := ARRAY[]::boolean[];
        v_matches_in_round := p_size / (2 ^ v_round)::integer;

        FOR v_m IN 1..v_matches_in_round LOOP
            DECLARE
                v_f1  integer := (v_m - 1) * 2 + 1;
                v_f2  integer := (v_m - 1) * 2 + 2;
                v_w1  uuid    := v_prev_winners[v_f1];
                v_w2  uuid    := v_prev_winners[v_f2];
                v_ph1 boolean := v_prev_phantom[v_f1];
                v_ph2 boolean := v_prev_phantom[v_f2];
            BEGIN
                player1_is_bye := v_ph1;
                player2_is_bye := v_ph2;

                IF v_ph1 AND v_ph2 THEN
                    v_st := 'completed'; v_win := NULL; v_ph := true;
                ELSIF v_ph1 AND v_w2 IS NOT NULL THEN
                    v_st := 'completed'; v_win := v_w2; v_ph := false;
                ELSIF v_ph2 AND v_w1 IS NOT NULL THEN
                    v_st := 'completed'; v_win := v_w1; v_ph := false;
                ELSE
                    v_st := 'pending'; v_win := NULL; v_ph := false;
                END IF;

                round_number := v_round; match_position := v_m;
                player1_registration_id := v_w1; player2_registration_id := v_w2;
                winner_registration_id := v_win; status := v_st; is_phantom := v_ph;
                RETURN NEXT;

                v_curr_winners := v_curr_winners || COALESCE(v_win, NULL::uuid);
                v_curr_phantom := v_curr_phantom || v_ph;
            END;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;


-- =====================
-- tournament_generate_bracket — now delegates placement to _lt_compute_bracket,
-- inserts the rows, then wires next_match links. Behaviour-identical to the
-- prior inline version; still the "Publish" step (status -> in_progress).
-- =====================
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

    -- Insert every computed match, recording its id by (round, position).
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

    -- Wire each match to its successor: match (r, m) feeds (r+1, ceil(m/2)),
    -- slot 1 when m is odd, slot 2 when m is even.
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


-- =====================
-- tournament_preview_bracket — read-only dry run. Same inputs as generate,
-- returns the computed bracket without inserting or changing status. Organizer
-- (or admin) only. Errors mirror generate so the client can reuse copy.
-- =====================
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
    -- Bracket-exists is the more specific signal, so check it before status.
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


-- =====================
-- tournament_set_seeds — organizer assigns seed_rank from an ordered list of
-- registration ids (seed 1 first). The list must be exactly the tournament's
-- registered set (no dupes, no foreign ids, complete). Optional step before
-- generation; does NOT bump tournament.version so the client's version stays
-- valid for the subsequent Publish (generate) call.
-- =====================
CREATE OR REPLACE FUNCTION public.tournament_set_seeds(
    p_tournament_id            uuid,
    p_ordered_registration_ids uuid[],
    p_version_was              integer
)
RETURNS SETOF tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id        uuid := auth.uid();
    v_tournament       tournaments;
    v_registered_count integer;
    v_provided_count   integer := coalesce(array_length(p_ordered_registration_ids, 1), 0);
    v_distinct_count   integer;
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
    IF v_tournament.status <> 'registration_closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;

    SELECT count(*) INTO v_registered_count
    FROM tournament_registrations
    WHERE tournament_id = p_tournament_id AND status = 'registered';

    SELECT count(DISTINCT u) INTO v_distinct_count
    FROM unnest(p_ordered_registration_ids) AS u;

    IF v_provided_count <> v_registered_count OR v_provided_count <> v_distinct_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEED_SET_MISMATCH';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(p_ordered_registration_ids) AS u(id)
        LEFT JOIN tournament_registrations tr
          ON tr.id = u.id
         AND tr.tournament_id = p_tournament_id
         AND tr.status = 'registered'
        WHERE tr.id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEED_FOREIGN_ID';
    END IF;

    -- Clear existing seeds first. The per-tournament seed_rank exclusion
    -- constraint (treg_seed_unique_per_tournament) is NOT deferrable and is
    -- enforced per row, so reassigning a new permutation over an already-seeded
    -- set would transiently collide mid-statement. NULL seed_rank is exempt
    -- from the (partial) constraint, so null them all, then assign the order.
    UPDATE tournament_registrations
       SET seed_rank = NULL
     WHERE tournament_id = p_tournament_id
       AND seed_rank IS NOT NULL;

    UPDATE tournament_registrations tr
       SET seed_rank = o.ord
      FROM unnest(p_ordered_registration_ids) WITH ORDINALITY AS o(reg_id, ord)
     WHERE tr.id = o.reg_id
       AND tr.tournament_id = p_tournament_id;

    RETURN QUERY
        SELECT * FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND status = 'registered'
         ORDER BY seed_rank ASC NULLS LAST, registered_at ASC, id ASC;
END;
$$;


GRANT EXECUTE ON FUNCTION public.tournament_preview_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_set_seeds(uuid, uuid[], integer) TO authenticated;

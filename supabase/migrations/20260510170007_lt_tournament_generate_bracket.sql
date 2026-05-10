-- ============================================
-- Leagues & Tournaments — V3: tournament_generate_bracket RPC
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V3
--       specs/17-leagues-tournaments/tournament-bracket.md §Algorithm
--
-- Transitions a tournament from `registration_closed` → `in_progress`,
-- inserts a full single-elimination bracket (rounds 1..log2(N)) with
-- deterministic seed placement (binary-placement algorithm) and BYE
-- auto-advancement.
--
-- Out of scope for V3 (later slices):
--   - tournament_reset_bracket
--   - tournament_swap_players (manual organizer edits)
--   - double_elimination
--   - actual match scoring (V4)
--
-- The bracket_locked_at column is intentionally NOT set here — per spec it
-- only flips when the first non-BYE match completes (V4 trigger).
-- ============================================


-- =====================
-- Helper: standard binary-placement seed → bracket position permutation.
-- Pure function, mirrors packages/shared-utils/src/tournament/seedPositions.ts.
-- =====================

CREATE OR REPLACE FUNCTION public.lt_seed_positions(p_size integer)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    v_positions integer[] := ARRAY[1];
    v_next      integer[];
    v_total     integer;
    v_p         integer;
BEGIN
    IF p_size < 2 OR (p_size & (p_size - 1)) <> 0 THEN
        RAISE EXCEPTION 'BAD_BRACKET_SIZE: %', p_size;
    END IF;
    WHILE coalesce(array_length(v_positions, 1), 0) < p_size LOOP
        v_total := array_length(v_positions, 1) * 2;
        v_next := ARRAY[]::integer[];
        FOREACH v_p IN ARRAY v_positions LOOP
            v_next := v_next || v_p;
            v_next := v_next || (v_total + 1 - v_p);
        END LOOP;
        v_positions := v_next;
    END LOOP;
    RETURN v_positions;
END;
$$;


-- =====================
-- tournament_generate_bracket
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

    -- Sorted registration ids by seeding criteria. Index = seed - 1.
    v_seeded_regs  uuid[];
    -- Bracket-position → seed mapping from lt_seed_positions(size).
    v_positions    integer[];

    -- match_winners[round][position] (1-indexed) — registration id or NULL.
    -- Stored flat as v_winners_round1[], v_winners_round2[], etc. via a 2D
    -- jagged array using a single TEXT-indexed jsonb to simplify; we use a
    -- plain integer[] reset per round and read the previous-round result.
    v_prev_winners uuid[];
    v_curr_winners uuid[];

    -- Per-round iteration vars
    v_round            integer;
    v_matches_in_round integer;
    v_m                integer;

    -- Per-match vars
    v_p1_reg_id   uuid;
    v_p2_reg_id   uuid;
    v_is_bye1     boolean;
    v_is_bye2     boolean;
    v_match_status tournament_match_status;
    v_winner_reg  uuid;
    v_next_match_id uuid;
    v_next_slot   smallint;
    v_new_id      uuid;

    -- Map of (round, position) → match_id, used to resolve next_match_id
    -- when inserting later rounds. Flattened to a single uuid[] keyed by
    -- (round - 1) * MAX_MATCHES_PER_ROUND + (position - 1) is fragile;
    -- easier to just look up by round + position via a temp table.
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
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
    END IF;

    -- Reject if any matches already exist (use tournament_reset_bracket later).
    IF EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = p_tournament_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
    END IF;

    -- Pull active registrations in seeding order. V3 uses a simple criteria:
    --   1) organizer-assigned seed_rank ASC NULLS LAST
    --   2) registered_at ASC
    -- (Rating-based seeding ships in a later slice with the rating join.)
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

    v_size := v_tournament.max_participants;
    v_rounds := (ln(v_size) / ln(2))::integer;
    v_positions := public.lt_seed_positions(v_size);

    -- A temp table is the simplest way to store (round, position) → match_id
    -- so later rounds can find their feeders' new ids and set next_match_id.
    CREATE TEMP TABLE _gen_matches (
        round_number   smallint NOT NULL,
        match_position smallint NOT NULL,
        match_id       uuid NOT NULL,
        winner_reg_id  uuid,
        PRIMARY KEY (round_number, match_position)
    ) ON COMMIT DROP;

    -- ============================================
    -- Round 1: insert all R1 matches with seeded players + BYE handling
    -- ============================================

    v_matches_in_round := v_size / 2;
    v_curr_winners := ARRAY[]::uuid[];

    FOR v_m IN 1..v_matches_in_round LOOP
        DECLARE
            v_seed1 integer := v_positions[(v_m - 1) * 2 + 1];
            v_seed2 integer := v_positions[(v_m - 1) * 2 + 2];
        BEGIN
            v_p1_reg_id := CASE WHEN v_seed1 <= v_active_count THEN v_seeded_regs[v_seed1] ELSE NULL END;
            v_p2_reg_id := CASE WHEN v_seed2 <= v_active_count THEN v_seeded_regs[v_seed2] ELSE NULL END;
            v_is_bye1 := v_p1_reg_id IS NULL;
            v_is_bye2 := v_p2_reg_id IS NULL;

            IF NOT v_is_bye1 AND NOT v_is_bye2 THEN
                v_match_status := 'pending';
                v_winner_reg := NULL;
            ELSIF v_is_bye1 AND v_is_bye2 THEN
                -- Phantom match (organizer chose a bracket much larger than registration count).
                v_match_status := 'completed';
                v_winner_reg := NULL;
            ELSE
                v_match_status := 'completed';
                v_winner_reg := coalesce(v_p1_reg_id, v_p2_reg_id);
            END IF;

            INSERT INTO tournament_matches (
                tournament_id, round_number, match_position,
                player1_registration_id, player2_registration_id,
                player1_is_bye, player2_is_bye,
                winner_registration_id, status
            )
            VALUES (
                p_tournament_id, 1, v_m,
                v_p1_reg_id, v_p2_reg_id,
                v_is_bye1, v_is_bye2,
                v_winner_reg, v_match_status
            )
            RETURNING id INTO v_new_id;

            INSERT INTO _gen_matches (round_number, match_position, match_id, winner_reg_id)
            VALUES (1, v_m, v_new_id, v_winner_reg);

            v_curr_winners := v_curr_winners || COALESCE(v_winner_reg, NULL::uuid);
        END;
    END LOOP;

    -- ============================================
    -- Rounds 2..final: insert with feeder-derived player slots, propagate
    -- auto-advancement when one or both feeders had a determinate winner.
    -- ============================================

    FOR v_round IN 2..v_rounds LOOP
        v_prev_winners := v_curr_winners;
        v_curr_winners := ARRAY[]::uuid[];
        v_matches_in_round := v_size / (2 ^ v_round)::integer;

        FOR v_m IN 1..v_matches_in_round LOOP
            DECLARE
                v_feeder1 integer := (v_m - 1) * 2 + 1;
                v_feeder2 integer := (v_m - 1) * 2 + 2;
                v_w1 uuid := v_prev_winners[v_feeder1];
                v_w2 uuid := v_prev_winners[v_feeder2];
            BEGIN
                v_is_bye1 := v_w1 IS NULL;
                v_is_bye2 := v_w2 IS NULL;

                IF NOT v_is_bye1 AND NOT v_is_bye2 THEN
                    v_match_status := 'pending';
                    v_winner_reg := NULL;
                ELSIF v_is_bye1 AND v_is_bye2 THEN
                    v_match_status := 'completed';
                    v_winner_reg := NULL;
                ELSE
                    v_match_status := 'completed';
                    v_winner_reg := coalesce(v_w1, v_w2);
                END IF;

                INSERT INTO tournament_matches (
                    tournament_id, round_number, match_position,
                    player1_registration_id, player2_registration_id,
                    player1_is_bye, player2_is_bye,
                    winner_registration_id, status
                )
                VALUES (
                    p_tournament_id, v_round, v_m,
                    v_w1, v_w2,
                    v_is_bye1, v_is_bye2,
                    v_winner_reg, v_match_status
                )
                RETURNING id INTO v_new_id;

                INSERT INTO _gen_matches (round_number, match_position, match_id, winner_reg_id)
                VALUES (v_round, v_m, v_new_id, v_winner_reg);

                v_curr_winners := v_curr_winners || COALESCE(v_winner_reg, NULL::uuid);

                -- Wire next_match_id on the two feeders to point at this new match
                v_next_slot := 1;
                UPDATE tournament_matches
                   SET next_match_id   = v_new_id,
                       next_match_slot = v_next_slot
                 WHERE id = (
                     SELECT match_id FROM _gen_matches
                      WHERE round_number = v_round - 1 AND match_position = v_feeder1
                 );
                v_next_slot := 2;
                UPDATE tournament_matches
                   SET next_match_id   = v_new_id,
                       next_match_slot = v_next_slot
                 WHERE id = (
                     SELECT match_id FROM _gen_matches
                      WHERE round_number = v_round - 1 AND match_position = v_feeder2
                 );
            END;
        END LOOP;
    END LOOP;

    -- ============================================
    -- Tournament: registration_closed → in_progress
    -- ============================================

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

    -- Return the full match list for the caller to populate the UI immediately
    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
         ORDER BY round_number, match_position;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_generate_bracket(uuid, integer) TO authenticated;

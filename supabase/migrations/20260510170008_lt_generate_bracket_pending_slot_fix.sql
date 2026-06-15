-- ============================================
-- Fix: tournament_generate_bracket — distinguish "phantom BYE" from "pending"
-- ============================================
-- The original V3 RPC tracked winners with `v_prev_winners[i] uuid`. NULL was
-- ambiguous — it meant either the prior match was both-BYE (phantom; this
-- slot in the next round is a true BYE) OR the prior match is real-vs-real
-- and just hasn't been played (this slot in the next round is TBD, not a
-- BYE).
--
-- Symptom: with bracket size 4 and 3 registrants, R1 M1 auto-advances seed
-- 1 (BYE win), R1 M2 stays pending (real vs real). R2 M1 should be pending
-- (one player + one TBD slot), but the buggy code marked it completed with
-- the seed-1 winner because slot 2 was NULL → treated as BYE.
--
-- Fix: track a parallel `v_prev_phantom[i] boolean` array. A slot in the
-- next round is BYE only when the feeder match was phantom; otherwise an
-- empty winner slot means "not yet played" → next-round slot is NULL with
-- is_bye = false and the match stays pending.
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
    v_positions    integer[];

    -- Per-round results carried forward
    v_prev_winners uuid[];     -- registration_id of the winner (NULL = no winner)
    v_prev_phantom boolean[];  -- true if the prior match had no players at all
    v_curr_winners uuid[];
    v_curr_phantom boolean[];

    v_round            integer;
    v_matches_in_round integer;
    v_m                integer;

    v_p1_reg_id    uuid;
    v_p2_reg_id    uuid;
    v_is_bye1      boolean;
    v_is_bye2      boolean;
    v_match_status tournament_match_status;
    v_winner_reg   uuid;
    v_phantom      boolean;
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
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
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

    v_size := v_tournament.max_participants;
    v_rounds := (ln(v_size) / ln(2))::integer;
    v_positions := public.lt_seed_positions(v_size);

    CREATE TEMP TABLE _gen_matches (
        round_number   smallint NOT NULL,
        match_position smallint NOT NULL,
        match_id       uuid NOT NULL,
        PRIMARY KEY (round_number, match_position)
    ) ON COMMIT DROP;

    -- ============================================
    -- Round 1
    -- ============================================
    v_matches_in_round := v_size / 2;
    v_curr_winners := ARRAY[]::uuid[];
    v_curr_phantom := ARRAY[]::boolean[];

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
                v_phantom := false;
            ELSIF v_is_bye1 AND v_is_bye2 THEN
                v_match_status := 'completed';
                v_winner_reg := NULL;
                v_phantom := true;
            ELSE
                v_match_status := 'completed';
                v_winner_reg := coalesce(v_p1_reg_id, v_p2_reg_id);
                v_phantom := false;
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

            INSERT INTO _gen_matches VALUES (1, v_m, v_new_id);
            v_curr_winners := v_curr_winners || COALESCE(v_winner_reg, NULL::uuid);
            v_curr_phantom := v_curr_phantom || v_phantom;
        END;
    END LOOP;

    -- ============================================
    -- Rounds 2..final
    -- ============================================
    FOR v_round IN 2..v_rounds LOOP
        v_prev_winners := v_curr_winners;
        v_prev_phantom := v_curr_phantom;
        v_curr_winners := ARRAY[]::uuid[];
        v_curr_phantom := ARRAY[]::boolean[];
        v_matches_in_round := v_size / (2 ^ v_round)::integer;

        FOR v_m IN 1..v_matches_in_round LOOP
            DECLARE
                v_feeder1 integer := (v_m - 1) * 2 + 1;
                v_feeder2 integer := (v_m - 1) * 2 + 2;
                v_w1     uuid    := v_prev_winners[v_feeder1];
                v_w2     uuid    := v_prev_winners[v_feeder2];
                v_ph1    boolean := v_prev_phantom[v_feeder1];
                v_ph2    boolean := v_prev_phantom[v_feeder2];
            BEGIN
                -- Slot is BYE only when the feeder was a phantom (both-BYE) match.
                -- Otherwise an empty winner means the feeder is still pending → TBD.
                v_is_bye1 := v_ph1;
                v_is_bye2 := v_ph2;

                IF v_ph1 AND v_ph2 THEN
                    -- Both feeders phantom → this match is also phantom.
                    v_match_status := 'completed';
                    v_winner_reg := NULL;
                    v_phantom := true;
                ELSIF v_ph1 AND v_w2 IS NOT NULL THEN
                    -- Feeder 1 phantom, feeder 2 already determined → auto-advance w2.
                    v_match_status := 'completed';
                    v_winner_reg := v_w2;
                    v_phantom := false;
                ELSIF v_ph2 AND v_w1 IS NOT NULL THEN
                    v_match_status := 'completed';
                    v_winner_reg := v_w1;
                    v_phantom := false;
                ELSE
                    -- One or both feeders are pending real matches → wait for results.
                    v_match_status := 'pending';
                    v_winner_reg := NULL;
                    v_phantom := false;
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

                INSERT INTO _gen_matches VALUES (v_round, v_m, v_new_id);
                v_curr_winners := v_curr_winners || COALESCE(v_winner_reg, NULL::uuid);
                v_curr_phantom := v_curr_phantom || v_phantom;

                -- Wire feeders' next_match_id
                UPDATE tournament_matches
                   SET next_match_id   = v_new_id,
                       next_match_slot = 1
                 WHERE id = (
                     SELECT match_id FROM _gen_matches
                      WHERE round_number = v_round - 1 AND match_position = v_feeder1
                 );
                UPDATE tournament_matches
                   SET next_match_id   = v_new_id,
                       next_match_slot = 2
                 WHERE id = (
                     SELECT match_id FROM _gen_matches
                      WHERE round_number = v_round - 1 AND match_position = v_feeder2
                 );
            END;
        END LOOP;
    END LOOP;

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

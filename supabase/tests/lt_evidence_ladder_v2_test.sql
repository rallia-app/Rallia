-- ============================================
-- The evidence model and the ladder that reads it
-- ============================================
-- Covers 20260831120000 and 20260831130000.
--
--   lt_side_signals
--     * no gate answer, nothing done      -> U, S = 0
--     * gate skipped, answered late       -> P (aware, S < 2)
--     * answered fast with hours          -> E
--     * a full grid, proposals ignored    -> P: the reactivity cap, the whole
--                                           point of the model
--
--   the ladder
--     * a non-funnel event is NEVER acted on, only audited. This is the
--       safety property that lets it leave dry-run: without gate answers
--       every side is U and the whole draw would double-forfeit.
--     * one side E, one P                 -> walkover to E, forfeit score,
--                                           unresponsive on the P side
--     * neither aware                     -> double forfeit, NO reputation
--                                           (nobody can be proven to have known)
--     * protocol incomplete               -> resolves, but penalises nobody
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_evidence_ladder_v2_test.sql
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_t        tournaments;
    v_tm       tournament_matches;
    v_other    tournament_matches;
    v_r1       uuid;
    v_r2       uuid;
    v_u1       uuid[];
    v_u2       uuid[];
    v_sig      jsonb;
    v_before   int;
    v_after    int;
    v_round    smallint := 0;
BEGIN
    SELECT t.* INTO v_t FROM tournaments t
      JOIN tournament_matches tm ON tm.tournament_id = t.id AND tm.bracket_side = 'pool'
     WHERE t.status = 'in_progress' AND t.bracket_type = 'pool_knockout'
     GROUP BY t.id HAVING count(*) FILTER (WHERE tm.status = 'pending') >= 2
     LIMIT 1;
    IF v_t.id IS NULL THEN RAISE EXCEPTION 'fixture: no live pool event'; END IF;

    SELECT * INTO v_tm FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND status = 'pending'
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
       AND NOT player1_is_bye AND NOT player2_is_bye
     ORDER BY id LIMIT 1;

    v_r1 := v_tm.player1_registration_id;
    v_r2 := v_tm.player2_registration_id;
    v_u1 := public.lt_registration_users(v_r1);
    v_u2 := public.lt_registration_users(v_r2);

    -- Clean slate for this phase.
    DELETE FROM tournament_phase_availability
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = v_round;
    DELETE FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_tm.id;
    UPDATE tournament_matches SET match_id = NULL,
           deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE id = v_tm.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    UPDATE tournaments SET min_availability_hours = 6 WHERE id = v_t.id;

    -- 1. Nothing at all: the machine cannot prove they knew.
    v_sig := public.lt_side_signals(v_tm.id, v_r1);
    IF v_sig->>'state' <> 'U' OR (v_sig->>'s')::int <> 0 THEN
        RAISE EXCEPTION 'silent side should be U/0, got %', v_sig;
    END IF;

    -- 2. Answered by SKIPPING, and late: aware, but no hours and no acts.
    --    This is the spec's "only tapped the ack" case, S = 1.
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome,
         responded_at, hours_in_window, grid_snapshot)
    SELECT v_t.id, 'pool', v_round, u, 'skipped',
           (SELECT min(created_at) FROM tournament_matches
             WHERE tournament_id = v_t.id AND bracket_side = 'pool') + interval '5 days',
           0, '[]'::jsonb
      FROM unnest(v_u1) u;
    v_sig := public.lt_side_signals(v_tm.id, v_r1);
    IF v_sig->>'state' <> 'P' THEN
        RAISE EXCEPTION 'late thin answer should be P, got %', v_sig;
    END IF;

    -- 3. Answered promptly with real hours: engaged.
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome,
         responded_at, hours_in_window, grid_snapshot)
    SELECT v_t.id, 'pool', v_round, u, 'edited',
           (SELECT min(created_at) FROM tournament_matches
             WHERE tournament_id = v_t.id AND bracket_side = 'pool'),
           12, '[{"day":"monday","hour":18}]'::jsonb
      FROM unnest(v_u2) u;
    v_sig := public.lt_side_signals(v_tm.id, v_r2);
    IF v_sig->>'state' <> 'E' THEN
        RAISE EXCEPTION 'prompt full answer should be E, got %', v_sig;
    END IF;

    -- 4. THE CAP: side 1 files a rich grid, side 2 proposes, side 1 ignores it.
    UPDATE tournament_phase_availability
       SET hours_in_window = 20,
           responded_at = (SELECT min(created_at) FROM tournament_matches
                            WHERE tournament_id = v_t.id AND bracket_side = 'pool')
     WHERE tournament_id = v_t.id AND round_number = v_round AND player_id = ANY (v_u1);
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after, occurred_at)
    VALUES ('tournament_match', v_tm.id, 'funnel_booked', v_u2[1], '{}'::jsonb,
            now() - interval '3 days');
    v_sig := public.lt_side_signals(v_tm.id, v_r1);
    IF v_sig->>'state' <> 'P' OR (v_sig->>'capped')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'a grid plus silence on proposals must cap to P, got %', v_sig;
    END IF;

    -- 5. SAFETY: off the funnel, the ladder decides nothing.
    UPDATE tournaments SET scheduling_funnel_enabled = false WHERE id = v_t.id;
    PERFORM public.lt_resolve_due_tournament_matches(false);
    SELECT * INTO v_other FROM tournament_matches WHERE id = v_tm.id;
    IF v_other.status <> 'pending' THEN
        RAISE EXCEPTION 'a non-funnel event must never be acted on, got %', v_other.status;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM leagues_tournaments_audit
         WHERE entity_id = v_tm.id AND action LIKE 'dryrun_%'
    ) THEN
        RAISE EXCEPTION 'a non-funnel event should still be audited';
    END IF;

    -- 6. On the funnel: E beats P, with the format forfeit score.
    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    DELETE FROM leagues_tournaments_audit
     WHERE entity_id = v_tm.id AND action LIKE 'dryrun_%';
    SELECT count(*) INTO v_before FROM reputation_event
     WHERE player_id = ANY (v_u1) AND event_type = 'tournament_unresponsive';

    PERFORM public.lt_resolve_due_tournament_matches(false);

    SELECT * INTO v_other FROM tournament_matches WHERE id = v_tm.id;
    IF v_other.status <> 'walkover' OR v_other.winner_registration_id <> v_r2 THEN
        RAISE EXCEPTION 'expected a walkover to the engaged side, got % / %',
              v_other.status, v_other.winner_registration_id;
    END IF;
    IF v_other.score IS DISTINCT FROM public.lt_forfeit_score(
           v_t.match_format, v_t.games_per_set, v_t.points_per_game,
           v_r2 = v_other.player1_registration_id) THEN
        RAISE EXCEPTION 'walkover missing the format forfeit score: %', v_other.score;
    END IF;

    SELECT count(*) INTO v_after FROM reputation_event
     WHERE player_id = ANY (v_u1) AND event_type = 'tournament_unresponsive';
    IF v_after <= v_before THEN
        RAISE EXCEPTION 'the passive side should take the unresponsive event';
    END IF;

    -- 7. Nobody aware: double forfeit, and NOBODY is penalised.
    SELECT * INTO v_other FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND status = 'pending'
       AND id <> v_tm.id
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
       AND NOT player1_is_bye AND NOT player2_is_bye
     ORDER BY id LIMIT 1;
    IF v_other.id IS NOT NULL THEN
        DELETE FROM tournament_phase_availability
         WHERE tournament_id = v_t.id AND round_number = v_round
           AND player_id = ANY (public.lt_registration_users(v_other.player1_registration_id)
                             || public.lt_registration_users(v_other.player2_registration_id));
        UPDATE tournament_matches
           SET deadline_nudge48_at = now() - interval '2 days',
               deadline_nudge12_at = now() - interval '12 hours'
         WHERE id = v_other.id;
        SELECT count(*) INTO v_before FROM reputation_event
         WHERE event_type = 'tournament_unresponsive'
           AND (metadata->>'tournamentMatchId')::uuid = v_other.id;

        PERFORM public.lt_resolve_due_tournament_matches(false);

        SELECT count(*) INTO v_after FROM reputation_event
         WHERE event_type = 'tournament_unresponsive'
           AND (metadata->>'tournamentMatchId')::uuid = v_other.id;
        IF v_after <> v_before THEN
            RAISE EXCEPTION 'two unreachable sides must not be penalised: knowledge is unproven';
        END IF;
    END IF;

    RAISE NOTICE 'lt_evidence_ladder_v2_test: ALL PASS';
END;
$$;

ROLLBACK;

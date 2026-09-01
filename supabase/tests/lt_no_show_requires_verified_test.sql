-- ============================================
-- The no-show rung only trusts a verified check-in
-- ============================================
-- Covers 20260901110000.
--
-- R3 awards a walkover and -50 reputation to the side that did not check in.
-- It read a bare checked_in_at, so on a game with no coordinates, where
-- presence is self-declared and cannot be contradicted, the rung paid whoever
-- tapped first from anywhere.
--
--   * a self-declared check-in does NOT produce no_show: both sides fall to
--     the gap rule, which is symmetric and costs nobody a walkover
--   * a verified check-in still does, so the rung is gated, not removed
--   * an unverified check-in is not a scheduling act either: it must not move
--     a side's engagement signals, or a player who answered nothing reaches
--     the top state and escapes the no-effort forfeit through the other door
--   * and check_in_verified cannot be flipped by the player it judges, or the
--     gate would only be a suggestion
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_no_show_requires_verified_test.sql
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_t      tournaments;
    v_tm     tournament_matches;
    v_r1     uuid;
    v_r2     uuid;
    v_u1     uuid[];
    v_u2     uuid[];
    v_m      uuid;
    v_rule   text;
    v_winner uuid;
    v_res    jsonb;
    v_msg    text;
    v_sig_a  jsonb;
    v_sig_b  jsonb;
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
    IF v_tm.id IS NULL THEN RAISE EXCEPTION 'fixture: no usable pairing'; END IF;

    v_r1 := v_tm.player1_registration_id;
    v_r2 := v_tm.player2_registration_id;
    v_u1 := public.lt_registration_users(v_r1);
    v_u2 := public.lt_registration_users(v_r2);

    -- Past the deadline, with the full nudge protocol behind it.
    DELETE FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_tm.id;
    UPDATE tournament_matches
       SET deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE id = v_tm.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';

    -- The game they agreed on, at no particular place.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, location_type)
    VALUES (v_t.sport_id, v_u1[1], now()::date, '19:00', '20:30', 'tbd')
    RETURNING id INTO v_m;
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_m, v_u1[1], 1, 'joined'), (v_m, v_u2[1], 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET team_number = EXCLUDED.team_number, status = 'joined';
    UPDATE tournament_matches SET match_id = v_m WHERE id = v_tm.id;

    -- 1. Side 1 says it was there. Nothing can confirm or contradict that.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_u1[1]::text)::text, true);
    v_res := public.check_in_to_match(v_m);
    IF (v_res->>'success')::boolean IS NOT TRUE
       OR (v_res->>'verified')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'expected an accepted, unverified check-in, got %', v_res;
    END IF;

    PERFORM public.lt_resolve_due_tournament_matches(true);
    SELECT a.payload_after->>'rule', (a.payload_after->>'winner_registration_id')::uuid
      INTO v_rule, v_winner
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament_match' AND a.entity_id = v_tm.id
     ORDER BY a.occurred_at DESC LIMIT 1;
    IF v_rule IS NULL THEN
        RAISE EXCEPTION 'the ladder did not reach this pairing';
    END IF;
    IF v_rule = 'no_show' THEN
        RAISE EXCEPTION 'a self-declared check-in must not win a walkover, got rule=% winner=%',
                        v_rule, v_winner;
    END IF;

    -- 2. The same arrival, verified. Only the column under test changes, so a
    --    pass here is the gate and nothing else.
    DELETE FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_tm.id;
    PERFORM set_config('rallia.check_in', 'on', true);
    UPDATE match_participant SET check_in_verified = true
     WHERE match_id = v_m AND player_id = v_u1[1];
    PERFORM set_config('rallia.check_in', '', true);

    PERFORM public.lt_resolve_due_tournament_matches(true);
    SELECT a.payload_after->>'rule', (a.payload_after->>'winner_registration_id')::uuid
      INTO v_rule, v_winner
      FROM leagues_tournaments_audit a
     WHERE a.scope = 'tournament_match' AND a.entity_id = v_tm.id
     ORDER BY a.occurred_at DESC LIMIT 1;
    IF v_rule <> 'no_show' OR v_winner <> v_r1 THEN
        RAISE EXCEPTION 'a verified check-in must still win the rung, got rule=% winner=%',
                        v_rule, v_winner;
    END IF;

    -- 3. And the player it judges cannot write that column.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_u2[1]::text)::text, true);
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE match_participant SET check_in_verified = true
         WHERE match_id = v_m AND player_id = v_u2[1];
        RESET ROLE;
        RAISE EXCEPTION 'expected CHECK_IN_VIA_RPC_ONLY, the forge was allowed';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        RESET ROLE;
        IF v_msg <> 'CHECK_IN_VIA_RPC_ONLY' THEN RAISE; END IF;
    END;

    -- 4. The same claim must not read as effort. Side 2 has answered nothing
    --    on this pairing; a check-in it cannot be held to must leave its
    --    engagement signals exactly where they were.
    v_sig_a := public.lt_side_signals(v_tm.id, v_r2);
    PERFORM set_config('rallia.check_in', 'on', true);
    UPDATE match_participant SET checked_in_at = now(), check_in_verified = false
     WHERE match_id = v_m AND player_id = v_u2[1];
    PERFORM set_config('rallia.check_in', '', true);
    v_sig_b := public.lt_side_signals(v_tm.id, v_r2);
    IF v_sig_a IS DISTINCT FROM v_sig_b THEN
        RAISE EXCEPTION 'an unverified check-in must not move the signals: % -> %',
                        v_sig_a, v_sig_b;
    END IF;

    RAISE NOTICE 'lt_no_show_requires_verified_test: ALL PASS';
END;
$$;

ROLLBACK;

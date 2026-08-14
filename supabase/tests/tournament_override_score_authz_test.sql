-- ============================================
-- Tournaments — organizer-override score: authorization + guards (DB-level)
-- ============================================
-- Covers the permission gate and the interesting guards on
-- tournament_override_score (20260527000100 + correction 20260622120300).
-- The Jest suite mocks Supabase, so it only proves the client forwards the RPC
-- args — it never exercises the authz gate. This file does:
--   * a registered PARTICIPANT cannot override a score  -> NOT_ORGANIZER
--   * an unrelated OUTSIDER cannot override a score      -> NOT_ORGANIZER
--   * a CO-ORGANIZER can override (gate uses is_tournament_organizer)
--   * declaring a winner who isn't in the match          -> WINNER_NOT_IN_MATCH
--   * correcting an upstream result after the next match
--     has been played                                    -> NEXT_MATCH_ALREADY_PLAYED
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_override_score_authz_test.sql
--
-- One transaction, ROLLBACK at the end. Auth is simulated via the
-- request.jwt.claims GUC (what auth.uid() reads).
-- ============================================

BEGIN;

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"). Staff is granted around the create calls only and
-- dropped straight after: the fixture-picking helpers filter admins out, so a
-- lingering row would shift which players a later block picks, and the
-- organizer has to stay an ordinary player for the authz assertions to mean
-- anything.
-- SECURITY DEFINER so the grant still works inside a block that has switched
-- to the authenticated role, where admin's RLS would refuse the insert.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- --------------------------------------------------------------------------
-- Helper: build a 4-player, in_progress singles tournament and return the
-- organizer + players + a real (non-bye) round-1 match id via OUT params.
-- Defined for this transaction only.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_live_tournament(
    p_name text,
    p_size int DEFAULT 4,   -- registered players = bracket size (power of two, no byes)
    OUT o_org uuid,
    OUT o_players uuid[],
    OUT o_tid uuid,
    OUT o_match_id uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_t     tournaments;
    v_p     uuid;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) ORDER BY player_id LIMIT 10) s;
    ASSERT array_length(o_players, 1) = 10, 'need 10 active tennis players';
    o_org := o_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => p_size::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    o_tid := v_t.id;
    SELECT * INTO v_t FROM tournament_open_registration(o_tid, v_t.version);

    -- Register players 2..(size+1): a full bracket, no byes -> all round-1 matches real.
    -- The organizer (player 1) and any players past size+1 stay unregistered so the
    -- authz tests have genuine outsiders / co-organizer candidates on hand.
    FOREACH v_p IN ARRAY o_players[2 : p_size + 1] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p::text)::text, true);
        PERFORM tournament_register(o_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(o_tid, v_t.version);
    PERFORM tournament_generate_bracket(o_tid, v_t.version);

    SELECT id INTO o_match_id
      FROM tournament_matches
     WHERE tournament_id = o_tid
       AND round_number = 1
       AND NOT player1_is_bye AND NOT player2_is_bye
       AND player1_registration_id IS NOT NULL
       AND player2_registration_id IS NOT NULL
     ORDER BY match_position
     LIMIT 1;
    ASSERT o_match_id IS NOT NULL, 'expected a real round-1 match';
END $$;

-- --------------------------------------------------------------------------
-- 1. a registered PARTICIPANT cannot override a score -> NOT_ORGANIZER
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Override Authz — participant');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    -- Player 2 is a genuine participant, not the organizer.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    BEGIN
        PERFORM tournament_override_score(v_mid, v_tm.player1_registration_id, '6-0 6-0');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'a participant must not be able to override a score';

    -- And the match is untouched.
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;
    ASSERT v_tm.winner_registration_id IS NULL, 'match must stay unresolved after a rejected override';

    RAISE NOTICE 'PASS 1: participant override rejected (NOT_ORGANIZER), match unchanged';
END $$;

-- --------------------------------------------------------------------------
-- 2. an unrelated OUTSIDER cannot override a score -> NOT_ORGANIZER
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Override Authz — outsider');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    -- Player 6 never registered for this tournament.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[6]::text)::text, true);
    BEGIN
        PERFORM tournament_override_score(v_mid, v_tm.player1_registration_id, '6-1 6-1');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'an outsider must not be able to override a score';

    RAISE NOTICE 'PASS 2: outsider override rejected (NOT_ORGANIZER)';
END $$;

-- --------------------------------------------------------------------------
-- 3. a CO-ORGANIZER can override (gate uses is_tournament_organizer)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_after tournament_matches;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Override Authz — co-organizer');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    -- Primary organizer promotes player 6 (an outsider) to co-organizer.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_add_co_organizer(v_tid, v_players[6]);

    -- Co-organizer overrides the score — must succeed and complete the match.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[6]::text)::text, true);
    SELECT * INTO v_after
      FROM tournament_override_score(v_mid, v_tm.player1_registration_id, '7-5 6-4');
    ASSERT v_after.status = 'completed', 'co-organizer override should complete the match';
    ASSERT v_after.winner_registration_id = v_tm.player1_registration_id, 'winner should be recorded';
    ASSERT v_after.score = '7-5 6-4', 'score should be recorded';

    RAISE NOTICE 'PASS 3: co-organizer can override (match completed)';
END $$;

-- --------------------------------------------------------------------------
-- 4. declaring a winner not assigned to the match -> WINNER_NOT_IN_MATCH
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_foreign uuid; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Override Authz — foreign winner');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    -- A registration in this tournament but NOT in this particular match.
    SELECT id INTO v_foreign
      FROM tournament_registrations
     WHERE tournament_id = v_tid
       AND id NOT IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
     LIMIT 1;
    ASSERT v_foreign IS NOT NULL, 'expected a registration outside this match';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    BEGIN
        PERFORM tournament_override_score(v_mid, v_foreign, '6-2 6-2');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'WINNER_NOT_IN_MATCH'); END;
    ASSERT v_ok, 'declaring a non-participant winner must be rejected';

    RAISE NOTICE 'PASS 4: foreign winner rejected (WINNER_NOT_IN_MATCH)';
END $$;

-- --------------------------------------------------------------------------
-- 5. correcting an upstream result after its next match is played
--    -> NEXT_MATCH_ALREADY_PLAYED
--    Uses an 8-bracket so the round-2 match can be played while the tournament
--    itself is still in_progress (the final is untouched). A 4-bracket would
--    complete the whole event on the first final, tripping
--    TOURNAMENT_NOT_IN_PROGRESS before this guard is ever reached.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_r1a tournament_matches; v_r1b tournament_matches; v_r2 tournament_matches;
    v_t tournaments; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid
      INTO v_org, v_players, v_tid
      FROM pg_temp.mk_live_tournament('Override Authz — locked correction', 8);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    -- Pick a round-1 match and the round-2 match it feeds, plus the sibling feeder.
    SELECT * INTO v_r1a FROM tournament_matches
     WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_r2 FROM tournament_matches WHERE id = v_r1a.next_match_id;
    SELECT * INTO v_r1b FROM tournament_matches
     WHERE tournament_id = v_tid AND round_number = 1
       AND id <> v_r1a.id AND next_match_id = v_r2.id
     LIMIT 1;
    ASSERT v_r2.id IS NOT NULL AND v_r1b.id IS NOT NULL, 'expected two feeders into one round-2 match';

    -- Play both feeders, then the round-2 match they lead to.
    PERFORM tournament_override_score(v_r1a.id, v_r1a.player1_registration_id, '6-0 6-0');
    PERFORM tournament_override_score(v_r1b.id, v_r1b.player1_registration_id, '6-0 6-0');
    SELECT * INTO v_r2 FROM tournament_matches WHERE id = v_r2.id;
    PERFORM tournament_override_score(v_r2.id, v_r2.player1_registration_id, '6-4 6-4');

    -- Sanity: the tournament is still running (final + other half unplayed).
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'in_progress', 'tournament should still be in_progress, got ' || v_t.status;

    -- Correcting the first feeder is now unsafe: its next match already has a result.
    BEGIN
        PERFORM tournament_override_score(v_r1a.id, v_r1a.player2_registration_id, '3-6 4-6');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NEXT_MATCH_ALREADY_PLAYED'); END;
    ASSERT v_ok, 'correcting an upstream result after its next match is played must be blocked';

    RAISE NOTICE 'PASS 5: upstream correction blocked (NEXT_MATCH_ALREADY_PLAYED)';
END $$;

ROLLBACK;

-- ============================================
-- L&T — participants record their own result (DB-level)
-- ============================================
-- Covers 20260830120000_lt_participant_score_entry: tournament_override_score
-- and session_record_score now accept the pairing's own participants, under a
-- narrower contract than the organizer's.
--
-- Tournaments:
--   * a participant OF the match records a fresh result  -> completed,
--     bracket advanced, audit action 'player_record_score'
--   * the same participant cannot correct it              -> MATCH_NOT_OVERRIDABLE
--   * a participant cannot declare a bare winner          -> SCORE_REQUIRED
--
-- Sessions:
--   * a participant of the pairing records a fresh result -> completed,
--     audit action 'player_record_score'
--   * a scored pairing refuses a participant re-entry     -> ALREADY_SCORED
--   * a league member outside the pairing is refused      -> NOT_ORGANIZER
--   * a participant cannot declare a walkover             -> INVALID_STATUS
--
-- And 20260830130000_lt_pairing_score_context, the single read behind the
-- pairing-chat entry point: its can_self_score verdict must agree with the
-- write guards above, and it must stay invisible to non-participants.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_participant_score_entry_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

-- Event creation is staff-only (20260812150000): staff is granted around the
-- create calls only and dropped straight after, so the organizer stays an
-- ordinary player and is_admin() can't void the gates under test.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- --------------------------------------------------------------------------
-- Helper: 4-player in_progress singles tournament (same shape as the authz
-- test's) returning organizer, players, tournament, and a real round-1 match.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_live_tournament(
    p_name text,
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

    PERFORM pg_temp.as_user(o_org);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    o_tid := v_t.id;
    SELECT * INTO v_t FROM tournament_open_registration(o_tid, v_t.version);

    FOREACH v_p IN ARRAY o_players[2:5] LOOP
        PERFORM pg_temp.as_user(v_p);
        PERFORM tournament_register(o_tid);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
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
-- Helper: a league with one published 2-player session, sheet generated,
-- pairing UNSCORED. Returns organizer, session, season, match, both players,
-- and a third league member outside the pairing.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_open_session(
    p_name      text,
    OUT o_org   uuid,
    OUT o_sid   uuid,
    OUT o_seaid uuid,
    OUT o_match_id uuid,
    OUT o_version int,
    OUT o_team_a uuid,
    OUT o_team_b uuid,
    OUT o_bystander uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_p     uuid[];
    v_l     leagues;
    v_sea   seasons;
    v_sess  sessions;
    v_m     session_matches;
    v_i     int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(v_p, 1) = 4, 'need 4 active non-admin tennis players';
    o_org := v_p[1];

    PERFORM pg_temp.as_user(o_org);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);

    -- Three members besides the organizer: two confirm (one pairing), the
    -- third stays out of the session and plays the bystander.
    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);
    o_seaid := v_sea.id;

    SELECT * INTO v_sess FROM session_create(v_sea.id, 'N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    o_sid := v_sess.id;

    SELECT * INTO v_m FROM session_matches WHERE session_id = v_sess.id LIMIT 1;
    ASSERT v_m.id IS NOT NULL, 'the sheet must hold a match';
    o_match_id := v_m.id;
    o_version  := v_m.version;
    o_team_a   := v_m.team_a_user_ids[1];
    o_team_b   := v_m.team_b_user_ids[1];
    o_bystander := v_p[4];
END $$;

-- --------------------------------------------------------------------------
-- 1. TOURNAMENT: a participant of the match records a fresh result
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_after tournament_matches; v_next tournament_matches;
    v_reporter uuid; v_action text;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Participant Entry — record');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    -- Report as the player behind player1's registration.
    SELECT user_id INTO v_reporter FROM tournament_registrations
     WHERE id = v_tm.player1_registration_id;
    PERFORM pg_temp.as_user(v_reporter);

    SELECT * INTO v_after
      FROM tournament_override_score(v_mid, v_tm.player1_registration_id, '6-3 6-4');
    ASSERT v_after.status = 'completed', 'participant entry should complete the match';
    ASSERT v_after.winner_registration_id = v_tm.player1_registration_id, 'winner should be recorded';
    ASSERT v_after.score = '6-3 6-4', 'score should be recorded';

    -- The winner advanced into the next round.
    SELECT * INTO v_next FROM tournament_matches WHERE id = v_after.next_match_id;
    ASSERT v_tm.player1_registration_id IN (v_next.player1_registration_id, v_next.player2_registration_id),
        'winner should advance into the next match';

    -- The audit trail names the participant path.
    SELECT action INTO v_action FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_mid
     ORDER BY occurred_at DESC LIMIT 1;
    ASSERT v_action = 'player_record_score', 'audit action should be player_record_score, got ' || v_action;

    RAISE NOTICE 'PASS 1: participant recorded a fresh result (completed, advanced, audited)';
END $$;

-- --------------------------------------------------------------------------
-- 2. TOURNAMENT: a participant cannot correct a recorded result
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_reporter uuid; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Participant Entry — no correction');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    SELECT user_id INTO v_reporter FROM tournament_registrations
     WHERE id = v_tm.player1_registration_id;
    PERFORM pg_temp.as_user(v_reporter);
    PERFORM tournament_override_score(v_mid, v_tm.player1_registration_id, '6-3 6-4');

    -- The opponent tries to flip the result: corrections are organizer-only.
    SELECT user_id INTO v_reporter FROM tournament_registrations
     WHERE id = v_tm.player2_registration_id;
    PERFORM pg_temp.as_user(v_reporter);
    BEGIN
        PERFORM tournament_override_score(v_mid, v_tm.player2_registration_id, '3-6 4-6');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'MATCH_NOT_OVERRIDABLE'); END;
    ASSERT v_ok, 'a participant must not correct a recorded result';

    RAISE NOTICE 'PASS 2: participant correction rejected (MATCH_NOT_OVERRIDABLE)';
END $$;

-- --------------------------------------------------------------------------
-- 3. TOURNAMENT: a participant cannot declare a bare winner (no score)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_reporter uuid; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Participant Entry — score required');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    SELECT user_id INTO v_reporter FROM tournament_registrations
     WHERE id = v_tm.player1_registration_id;
    PERFORM pg_temp.as_user(v_reporter);
    BEGIN
        PERFORM tournament_override_score(v_mid, v_tm.player1_registration_id, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SCORE_REQUIRED'); END;
    ASSERT v_ok, 'a participant must provide a score';

    RAISE NOTICE 'PASS 3: bare-winner participant entry rejected (SCORE_REQUIRED)';
END $$;

-- --------------------------------------------------------------------------
-- 4. SESSION: a participant of the pairing records a fresh result
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_a uuid; v_b uuid; v_by uuid;
    v_row session_matches; v_action text;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b, o_bystander
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_a, v_b, v_by
      FROM pg_temp.mk_open_session('Participant Entry L — record');

    PERFORM pg_temp.as_user(v_b);
    SELECT * INTO v_row FROM session_record_score(v_mid, 'b', '6-2 6-2', 'completed', v_ver);
    ASSERT v_row.status = 'completed', 'participant entry should complete the pairing';
    ASSERT v_row.winner_team = 'b', 'winner team should be recorded';
    ASSERT v_row.score = '6-2 6-2', 'score should be recorded';

    SELECT action INTO v_action FROM leagues_tournaments_audit
     WHERE scope = 'session_match' AND entity_id = v_mid
     ORDER BY occurred_at DESC LIMIT 1;
    ASSERT v_action = 'player_record_score', 'audit action should be player_record_score, got ' || v_action;

    RAISE NOTICE 'PASS 4: session participant recorded a fresh result';
END $$;

-- --------------------------------------------------------------------------
-- 5. SESSION: a scored pairing refuses a participant re-entry
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_a uuid; v_b uuid; v_by uuid;
    v_row session_matches; v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b, o_bystander
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_a, v_b, v_by
      FROM pg_temp.mk_open_session('Participant Entry L — no re-entry');

    PERFORM pg_temp.as_user(v_a);
    SELECT * INTO v_row FROM session_record_score(v_mid, 'a', '6-1 6-1', 'completed', v_ver);

    PERFORM pg_temp.as_user(v_b);
    BEGIN
        PERFORM session_record_score(v_mid, 'b', '1-6 1-6', 'completed', v_row.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ALREADY_SCORED'); END;
    ASSERT v_ok, 'a participant must not re-score a settled pairing';

    RAISE NOTICE 'PASS 5: participant re-entry rejected (ALREADY_SCORED)';
END $$;

-- --------------------------------------------------------------------------
-- 6. SESSION: a league member outside the pairing is refused
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_a uuid; v_b uuid; v_by uuid;
    v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b, o_bystander
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_a, v_b, v_by
      FROM pg_temp.mk_open_session('Participant Entry L — bystander');

    PERFORM pg_temp.as_user(v_by);
    BEGIN
        PERFORM session_record_score(v_mid, 'a', '6-0 6-0', 'completed', v_ver);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'a member outside the pairing must be refused';

    RAISE NOTICE 'PASS 6: bystander rejected (NOT_ORGANIZER)';
END $$;

-- --------------------------------------------------------------------------
-- 7. SESSION: a participant cannot declare a walkover
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_a uuid; v_b uuid; v_by uuid;
    v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b, o_bystander
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_a, v_b, v_by
      FROM pg_temp.mk_open_session('Participant Entry L — no walkover');

    PERFORM pg_temp.as_user(v_a);
    BEGIN
        PERFORM session_record_score(v_mid, 'a', 'W/O', 'walkover', v_ver);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'INVALID_STATUS'); END;
    ASSERT v_ok, 'a participant walkover claim must be refused';

    RAISE NOTICE 'PASS 7: participant walkover rejected (INVALID_STATUS)';
END $$;

-- --------------------------------------------------------------------------
-- 8. CONTEXT (tournament): a participant sees a scoreable pairing, with the
--    payload the sheet needs; once scored the same read flips to false.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_reporter uuid; v_ctx jsonb;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Context — tournament');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    SELECT user_id INTO v_reporter FROM tournament_registrations
     WHERE id = v_tm.player1_registration_id;
    PERFORM pg_temp.as_user(v_reporter);

    v_ctx := lt_pairing_score_context(p_tournament_match_id => v_mid);
    ASSERT v_ctx IS NOT NULL, 'a participant must get a context';
    ASSERT (v_ctx->>'kind') = 'tournament', 'kind should be tournament';
    ASSERT (v_ctx->>'can_self_score')::boolean, 'an open pairing must be self-scoreable';
    ASSERT (v_ctx->>'player1_registration_id')::uuid = v_tm.player1_registration_id,
        'sides must be carried through for the sheet';
    ASSERT COALESCE(v_ctx->>'player1_name', '') <> '', 'side names must be resolved';
    ASSERT v_ctx ? 'match_format' AND v_ctx ? 'is_final', 'format and final flag must be present';

    -- Record it, then read again: the entry point has to disappear.
    PERFORM tournament_override_score(v_mid, v_tm.player1_registration_id, '6-3 6-4');
    v_ctx := lt_pairing_score_context(p_tournament_match_id => v_mid);
    ASSERT NOT (v_ctx->>'can_self_score')::boolean, 'a scored pairing is no longer self-scoreable';
    ASSERT (v_ctx->>'reason') = 'ALREADY_SCORED', 'reason should be ALREADY_SCORED, got ' ||
        COALESCE(v_ctx->>'reason', 'null');

    RAISE NOTICE 'PASS 8: tournament context true then ALREADY_SCORED';
END $$;

-- --------------------------------------------------------------------------
-- 9. CONTEXT (tournament): a player outside the pairing sees nothing at all
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_mid uuid;
    v_tm tournament_matches; v_other uuid; v_ctx jsonb;
BEGIN
    SELECT o_org, o_players, o_tid, o_match_id
      INTO v_org, v_players, v_tid, v_mid
      FROM pg_temp.mk_live_tournament('Context — outsider');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_mid;

    SELECT tr.user_id INTO v_other
      FROM tournament_registrations tr
     WHERE tr.tournament_id = v_tid
       AND tr.id NOT IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
     LIMIT 1;
    ASSERT v_other IS NOT NULL, 'expected a registered player outside this match';

    PERFORM pg_temp.as_user(v_other);
    v_ctx := lt_pairing_score_context(p_tournament_match_id => v_mid);
    ASSERT v_ctx IS NULL, 'a player outside the pairing must get no context';

    -- The organizer, who can always act on it, still gets one.
    PERFORM pg_temp.as_user(v_org);
    v_ctx := lt_pairing_score_context(p_tournament_match_id => v_mid);
    ASSERT v_ctx IS NOT NULL, 'the organizer must get a context';

    RAISE NOTICE 'PASS 9: context hidden from outsiders, visible to the organizer';
END $$;

-- --------------------------------------------------------------------------
-- 10. CONTEXT (session): a participant gets the pairing payload, the decider
--     flag, and the row version the write RPC needs.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_seaid uuid; v_mid uuid; v_ver int;
    v_a uuid; v_b uuid; v_by uuid; v_ctx jsonb;
BEGIN
    SELECT o_org, o_sid, o_seaid, o_match_id, o_version, o_team_a, o_team_b, o_bystander
      INTO v_org, v_sid, v_seaid, v_mid, v_ver, v_a, v_b, v_by
      FROM pg_temp.mk_open_session('Context — session');

    PERFORM pg_temp.as_user(v_a);
    v_ctx := lt_pairing_score_context(p_session_match_id => v_mid);
    ASSERT v_ctx IS NOT NULL, 'a pairing participant must get a context';
    ASSERT (v_ctx->>'kind') = 'session', 'kind should be session';
    ASSERT (v_ctx->>'can_self_score')::boolean, 'an open pairing must be self-scoreable';
    ASSERT (v_ctx->>'version_was')::int = v_ver, 'the row version must be carried for the write';
    ASSERT (v_ctx->>'season_id')::uuid = v_seaid, 'season must be carried for cache invalidation';
    -- The sheet holds the only pairing, so scoring it closes the session.
    ASSERT (v_ctx->>'is_decider')::boolean, 'the only open pairing is the decider';

    -- A league member who is not on this pairing sees nothing.
    PERFORM pg_temp.as_user(v_by);
    ASSERT lt_pairing_score_context(p_session_match_id => v_mid) IS NULL,
        'a bystander must get no context';

    RAISE NOTICE 'PASS 10: session context carries version/season/decider, hidden from bystanders';
END $$;

ROLLBACK;

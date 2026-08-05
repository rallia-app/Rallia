-- ============================================
-- Leagues — the session pairing chat and its pre-play link (DB-level)
-- ============================================
-- Covers 20260730190000_lt_session_pairing_chat_glue.
--
-- Two players drawn against each other on a session sheet share ONE chat. The
-- game they organize from it is attached to their pairing before it is played,
-- and that same chat becomes the match chat instead of a second one spawning.
--
--   * get_or_create_session_pairing_chat is idempotent and seats both players
--   * a non-participant                  -> NOT_A_PARTICIPANT
--   * a game created from the chat links session_matches.match_id ...
--   * ... and reuses the chat (one 'match' conversation, not two)
--   * a verified result then settles the pairing through the bridge
--   * a second attach on a linked pairing -> ALREADY_LINKED
--   * a drill pairing                     -> no chat, NOT_LINKABLE
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_pairing_chat_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- --------------------------------------------------------------------------
-- Helper: a league with an open season and one published, drawn session whose
-- sheet holds a single pairing. The organizer is NOT in the pairing, so it
-- doubles as the outsider for the authorization checks.
--
-- p_slot picks a distinct trio per test block: league_create allows 5 per
-- organizer per 24h, so every block needs its own organizer.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_drawn_session(
    p_name        text,
    p_slot        int,
    OUT o_org     uuid,
    OUT o_sid     uuid,
    OUT o_sm_id   uuid,
    OUT o_team_a  uuid,
    OUT o_team_b  uuid,
    OUT o_sport   uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_all  uuid[];
    v_p    uuid[];
    v_l    leagues;
    v_sea  seasons;
    v_sess sessions;
    v_m    session_matches;
    v_i    int;
BEGIN
    SELECT id INTO o_sport FROM sport WHERE name = 'tennis';
    -- is_admin() bypasses the organizer gate, so the fixture avoids admins.
    SELECT array_agg(player_id) INTO v_all FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = o_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id) s;
    ASSERT array_length(v_all, 1) >= 3 * p_slot,
        format('need %s active non-admin tennis players', 3 * p_slot);
    v_p := v_all[3 * (p_slot - 1) + 1 : 3 * p_slot];
    o_org := v_p[1];

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => o_sport,
        p_visibility => 'public', p_join_mode => 'open');

    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);

    SELECT * INTO v_sess FROM session_create(v_sea.id, 'N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    -- Only the two non-organizer members show up, so the sheet is one pairing.
    FOR v_i IN 2..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    o_sid := v_sess.id;

    SELECT * INTO v_m FROM session_matches WHERE session_id = v_sess.id LIMIT 1;
    ASSERT v_m.id IS NOT NULL, 'the sheet must hold a match';
    o_sm_id  := v_m.id;
    o_team_a := v_m.team_a_user_ids[1];
    o_team_b := v_m.team_b_user_ids[1];
END $$;

-- --------------------------------------------------------------------------
-- Helper: post a match_organizer card into a conversation and return its id.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.post_card(p_conv uuid, p_sender uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO public.message (conversation_id, sender_id, content, message_type, metadata)
    VALUES (p_conv, p_sender, 'When are we playing?', 'user',
            jsonb_build_object('kind', 'match_organizer'))
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- --------------------------------------------------------------------------
-- 1. the chat is idempotent, tagged, and seats exactly the pairing
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_conv uuid; v_again uuid; v_row conversation; v_n int;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — idempotent', 1);

    PERFORM pg_temp.as_user(v_a);
    v_conv := get_or_create_session_pairing_chat(v_sm);
    ASSERT v_conv IS NOT NULL, 'a pairing must get a chat';

    SELECT * INTO v_row FROM conversation WHERE id = v_conv;
    ASSERT v_row.conversation_type = 'match',
        'the pairing chat must be a match chat so it can become THE match chat';
    ASSERT v_row.session_match_id = v_sm, 'the chat must carry its pairing tag';
    ASSERT v_row.match_id IS NULL, 'no game exists yet, so match_id stays NULL';

    -- The opponent asking gets the same chat, not a second one.
    PERFORM pg_temp.as_user(v_b);
    v_again := get_or_create_session_pairing_chat(v_sm);
    ASSERT v_again = v_conv, 'both opponents must land in ONE chat';

    SELECT count(*) INTO v_n FROM conversation WHERE session_match_id = v_sm;
    ASSERT v_n = 1, format('one chat per pairing, found %s', v_n);

    SELECT count(*) INTO v_n FROM conversation_participant WHERE conversation_id = v_conv;
    ASSERT v_n = 2, format('both players must be seated, found %s', v_n);
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_a)
       AND EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_b),
        'the seats must belong to the pairing';

    RAISE NOTICE 'PASS 1: one tagged chat per pairing, both players seated';
END $$;

-- --------------------------------------------------------------------------
-- 2. an outsider cannot open (or discover) a pairing chat
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — outsider', 2);

    -- The organizer sat this session out, so they are not in the pairing.
    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM get_or_create_session_pairing_chat(v_sm);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_A_PARTICIPANT'); END;
    ASSERT v_ok, 'a non-participant must raise NOT_A_PARTICIPANT';
    ASSERT NOT EXISTS (SELECT 1 FROM conversation WHERE session_match_id = v_sm),
        'a refused call must not leave a chat behind';

    RAISE NOTICE 'PASS 2: outsiders are refused';
END $$;

-- --------------------------------------------------------------------------
-- 3. a game organized from the chat links the pairing pre-play, and that same
--    chat becomes the match chat (no duplicate conversation)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_conv uuid; v_msg uuid; v_match uuid; v_row session_matches; v_n int;
    v_conv_row conversation;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — pre-play link', 3);

    PERFORM pg_temp.as_user(v_a);
    v_conv  := get_or_create_session_pairing_chat(v_sm);
    v_msg   := pg_temp.post_card(v_conv, v_a);
    v_match := create_casual_match(
        p_sport_id          => v_sport,
        p_slot_start        => now() + interval '4 days',
        p_player_ids        => ARRAY[v_a, v_b],
        p_format            => 'singles',
        p_source_message_id => v_msg,
        p_option_index      => 0);

    SELECT * INTO v_row FROM session_matches WHERE id = v_sm;
    ASSERT v_row.match_id = v_match,
        'the game must be attached to the pairing before it is played';
    ASSERT v_row.status = 'pending', 'attaching pre-play must not settle the pairing';

    SELECT * INTO v_conv_row FROM conversation WHERE id = v_conv;
    ASSERT v_conv_row.match_id = v_match, 'the pairing chat must become the match chat';

    SELECT count(*) INTO v_n FROM conversation WHERE match_id = v_match;
    ASSERT v_n = 1, format('the game must not spawn a second chat, found %s', v_n);

    -- Both players are on the game itself.
    SELECT count(*) INTO v_n FROM match_participant
     WHERE match_id = v_match AND status = 'joined';
    ASSERT v_n = 2, format('both players must be on the game, found %s', v_n);

    RAISE NOTICE 'PASS 3: pre-play link lands and the chat is reused';
END $$;

-- --------------------------------------------------------------------------
-- 4. confirming the game settles the pairing through the existing bridge
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_conv uuid; v_msg uuid; v_match uuid; v_mr uuid; v_winning int;
    v_row session_matches; v_leader uuid; v_seaid uuid;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — result propagates', 4);

    PERFORM pg_temp.as_user(v_a);
    v_conv  := get_or_create_session_pairing_chat(v_sm);
    v_msg   := pg_temp.post_card(v_conv, v_a);
    v_match := create_casual_match(
        p_sport_id          => v_sport,
        p_slot_start        => now() + interval '4 days',
        p_player_ids        => ARRAY[v_a, v_b],
        p_format            => 'singles',
        p_source_message_id => v_msg,
        p_option_index      => 0);

    -- Fast-forward: the game has been played. The submit RPC refuses a game
    -- that has not ended yet, and scoring closes 48h after it does, so pin a
    -- whole slot in yesterday rather than only moving the date.
    UPDATE match
       SET match_date = (now() AT TIME ZONE timezone)::date - 1,
           start_time = '10:00', end_time = '11:00'
     WHERE id = v_match;

    -- Team a's player submits the score through the canonical flow: the RPC
    -- puts the submitter on team 1, so winning_team = 1 means team a won.
    SELECT submit_match_result_for_match(
        v_match, v_a, 1,
        '[{"team1_score": 6, "team2_score": 4}, {"team1_score": 6, "team2_score": 2}]'::jsonb
    ) INTO v_mr;

    SELECT team_number INTO v_winning FROM match_participant
     WHERE match_id = v_match AND player_id = v_a;
    ASSERT v_winning = 1, 'the submit RPC must put the submitter on team 1';

    -- The opponent confirms: verification is what drives the bridge.
    UPDATE match_result SET is_verified = true, confirmed_by = v_b WHERE id = v_mr;

    SELECT * INTO v_row FROM session_matches WHERE id = v_sm;
    ASSERT v_row.status = 'completed', 'a verified result must settle the pairing';
    ASSERT v_row.winner_team = 'a',
        format('the session-side winner must be a, got %s', v_row.winner_team);

    SELECT season_id INTO v_seaid FROM sessions WHERE id = v_sid;
    SELECT user_id INTO v_leader FROM season_rankings
     WHERE season_id = v_seaid ORDER BY points DESC, user_id LIMIT 1;
    ASSERT v_leader = v_a, 'the standings must follow the game result';

    RAISE NOTICE 'PASS 4: a confirmed game settles the pairing and the standings';
END $$;

-- --------------------------------------------------------------------------
-- 5. a pairing already linked cannot be re-attached
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_conv uuid; v_msg uuid; v_match uuid; v_other uuid; v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — already linked', 5);

    PERFORM pg_temp.as_user(v_a);
    v_conv  := get_or_create_session_pairing_chat(v_sm);
    v_msg   := pg_temp.post_card(v_conv, v_a);
    v_match := create_casual_match(
        p_sport_id          => v_sport,
        p_slot_start        => now() + interval '4 days',
        p_player_ids        => ARRAY[v_a, v_b],
        p_format            => 'singles',
        p_source_message_id => v_msg,
        p_option_index      => 0);

    -- A second, unrelated game by the same host.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, timezone,
                       format, location_type, join_mode, visibility)
    VALUES (v_sport, v_a, current_date + 5, '10:00', '11:00', 'America/Toronto',
            'singles', 'tbd', 'direct', 'private')
    RETURNING id INTO v_other;

    BEGIN
        PERFORM session_attach_match_pre_play(v_sm, v_other);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ALREADY_LINKED'); END;
    ASSERT v_ok, 'a linked pairing must raise ALREADY_LINKED';

    ASSERT (SELECT match_id FROM session_matches WHERE id = v_sm) = v_match,
        'a refused attach must leave the original link alone';

    -- And an outsider cannot attach their own game to someone else's pairing.
    v_ok := false;
    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM session_attach_match_pre_play(v_sm, v_other);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM IN ('ALREADY_LINKED', 'NOT_A_PARTICIPANT')); END;
    ASSERT v_ok, 'an outsider must not attach to a pairing they are not in';

    RAISE NOTICE 'PASS 5: a linked pairing is closed to further attaches';
END $$;

-- --------------------------------------------------------------------------
-- 6. drills carry no chat and cannot be linked
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_sid uuid; v_sm uuid; v_a uuid; v_b uuid; v_sport uuid;
    v_conv uuid; v_other uuid; v_ok boolean := false;
BEGIN
    SELECT o_org, o_sid, o_sm_id, o_team_a, o_team_b, o_sport
      INTO v_org, v_sid, v_sm, v_a, v_b, v_sport
      FROM pg_temp.mk_drawn_session('Pairing chat — drill', 6);

    UPDATE session_matches SET is_drill = true WHERE id = v_sm;

    PERFORM pg_temp.as_user(v_a);
    v_conv := get_or_create_session_pairing_chat(v_sm);
    ASSERT v_conv IS NULL, 'a drill has no game to organize, so no chat';

    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, timezone,
                       format, location_type, join_mode, visibility)
    VALUES (v_sport, v_a, current_date + 5, '10:00', '11:00', 'America/Toronto',
            'singles', 'tbd', 'direct', 'private')
    RETURNING id INTO v_other;

    BEGIN
        PERFORM session_attach_match_pre_play(v_sm, v_other);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_LINKABLE'); END;
    ASSERT v_ok, 'a drill must raise NOT_LINKABLE';

    RAISE NOTICE 'PASS 6: drills stay out of the bridge';
END $$;

ROLLBACK;

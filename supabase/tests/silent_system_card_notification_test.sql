-- ============================================
-- Silent system messages — no new_message fan-out
-- ============================================
-- The system-posted Match Organizer card writes metadata.silent = true because
-- the pairing already gets a tournament_match_ready push. notify_new_message
-- ignored the flag until 20260812250000, and since the card's sender is the
-- Rallia system player, BOTH participants matched the fan-out predicate and got
-- "Message de Rallia" on top of the tournament push.
--
-- Asserts the guard suppresses silent messages, and only those.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/silent_system_card_notification_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

-- Event creation went staff-only in 20260812150000. Staff is granted around the
-- create call only: the fixture-picking helper filters admins out, so a
-- lingering row would shift which players the block picks.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- --------------------------------------------------------------------------
-- 1. Trigger level: silent suppresses, everything else still fans out
-- --------------------------------------------------------------------------
DO $$
DECLARE
    c_system constant uuid := 'a11a0000-0000-4000-8000-000000000001';
    v_conv   uuid;
    v_sender uuid;
    v_before int;
    v_after  int;
BEGIN
    SELECT c.id INTO v_conv
    FROM conversation c
    JOIN conversation_participant cp ON cp.conversation_id = c.id
    WHERE c.conversation_type <> 'announcement'
      AND cp.is_muted = false
    GROUP BY c.id HAVING count(*) >= 2 LIMIT 1;
    ASSERT v_conv IS NOT NULL, 'need a seeded non-announcement conversation';

    SELECT cp.player_id INTO v_sender
      FROM conversation_participant cp WHERE cp.conversation_id = v_conv LIMIT 1;

    -- Control: a plain message from a participant still notifies the others.
    SELECT count(*) INTO v_before FROM notification WHERE target_id = v_conv;
    INSERT INTO message (conversation_id, sender_id, content, message_type)
    VALUES (v_conv, v_sender, 'loud message', 'text');
    SELECT count(*) INTO v_after FROM notification WHERE target_id = v_conv;
    ASSERT v_after > v_before, 'plain messages must still notify';

    -- silent = true notifies nobody, even though the system sender is not a
    -- participant so every member matches the fan-out predicate.
    v_before := v_after;
    INSERT INTO message (conversation_id, sender_id, content, message_type, metadata)
    VALUES (v_conv, c_system, 'silent card', 'match_organizer',
            jsonb_build_object('silent', true, 'posted_by', 'system'));
    SELECT count(*) INTO v_after FROM notification WHERE target_id = v_conv;
    ASSERT v_after = v_before, format('silent message notified %s player(s)', v_after - v_before);

    -- The guard keys on true only: silent = false and a metadata-carrying
    -- message without the flag both stay loud. Sent as 'text' because the
    -- partial unique index allows a single system card per conversation.
    INSERT INTO message (conversation_id, sender_id, content, message_type, metadata)
    VALUES (v_conv, c_system, 'not silent', 'text',
            jsonb_build_object('silent', false, 'posted_by', 'system'));
    SELECT count(*) INTO v_after FROM notification WHERE target_id = v_conv;
    ASSERT v_after > v_before, 'silent = false must still notify';

    v_before := v_after;
    INSERT INTO message (conversation_id, sender_id, content, message_type, metadata)
    VALUES (v_conv, c_system, 'no flag', 'text',
            jsonb_build_object('posted_by', 'system'));
    SELECT count(*) INTO v_after FROM notification WHERE target_id = v_conv;
    ASSERT v_after > v_before, 'a message without the flag must still notify';

    RAISE NOTICE 'PASS: metadata.silent suppresses the new_message fan-out, and only when true';
END $$;

-- --------------------------------------------------------------------------
-- 2. End to end: an auto-posted round card rides its own tournament push
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     int;
    v_r1m1    tournament_matches;
    v_r1m2    tournament_matches;
    v_r2m1    tournament_matches;
    v_conv    uuid;
    v_card    uuid;
    v_n       int;
    i         int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
             ORDER BY player_id LIMIT 9) s;
    ASSERT array_length(v_players, 1) = 9, 'need 9 active tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Silent Card Cup', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;

    FOR i IN 2..9 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    SELECT * INTO v_r1m1 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_r1m2 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 2;

    -- Resolving both feeders makes R2M1 playable: match-ready fires and the
    -- poster drops a system card into that pairing's round chat.
    PERFORM lt_advance_tournament_winner(v_r1m1.id, v_r1m1.player1_registration_id);
    PERFORM lt_advance_tournament_winner(v_r1m2.id, v_r1m2.player1_registration_id);

    SELECT * INTO v_r2m1 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 2 AND match_position = 1;

    SELECT id INTO v_conv FROM conversation
     WHERE tournament_match_id = v_r2m1.id LIMIT 1;
    ASSERT v_conv IS NOT NULL, 'the pairing should have a round chat';

    SELECT id INTO v_card FROM message
     WHERE conversation_id = v_conv
       AND message_type = 'match_organizer'
       AND metadata->>'posted_by' = 'system';
    ASSERT v_card IS NOT NULL, 'the round chat should carry an auto-posted card';

    SELECT count(*) INTO v_n FROM notification
     WHERE type = 'tournament_match_ready' AND target_id = v_tid;
    ASSERT v_n = 2, format('expected 2 match-ready notifications, got %s', v_n);

    SELECT count(*) INTO v_n FROM notification
     WHERE type = 'new_message' AND target_id = v_conv;
    ASSERT v_n = 0, format('the card must not notify on top of the push, got %s', v_n);

    RAISE NOTICE 'PASS: the auto-posted round card notifies nobody; only tournament_match_ready reaches the pair';
END $$;

ROLLBACK;

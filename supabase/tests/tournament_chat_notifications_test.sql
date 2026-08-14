-- ============================================
-- Tournament chat + notifications — DB-level integration test
-- ============================================
-- Exercises the trigger-driven tournament conversation lifecycle
-- (20260613100100) and the tournament notification triggers
-- (20260613110100, 20260613120000) against the real RPCs.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_chat_notifications_test.sql
--
-- Runs in one transaction and ROLLBACKs; safe to re-run. The deferred
-- tournament_match_notify_completed constraint trigger is exercised via
-- SET CONSTRAINTS ALL IMMEDIATE (it normally fires at COMMIT).
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
-- 1. Chat lifecycle: create → register → withdraw → re-register → rename
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_conv    uuid;
    v_count   integer;
    v_reg     tournament_registrations;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'seed missing tennis sport';

    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 8
      ) s;
    ASSERT array_length(v_players, 1) = 8, 'need 8 active tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Chat Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open'
    );
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;

    -- Conversation created with the tournament, organizer seeded.
    SELECT id INTO v_conv FROM conversation
     WHERE tournament_id = v_tid AND conversation_type = 'tournament';
    ASSERT v_conv IS NOT NULL, 'tournament conversation not created';
    ASSERT (SELECT title FROM conversation WHERE id = v_conv) = 'Chat Cup',
        'conversation title should match tournament name';
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_org),
        'organizer not seeded into tournament chat';

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    -- 5 players register → all join the chat.
    FOR i IN 2..6 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;
    SELECT count(*) INTO v_count FROM conversation_participant WHERE conversation_id = v_conv;
    ASSERT v_count = 6, 'expected 6 chat participants (org + 5), got ' || v_count;

    -- Withdraw removes from chat; organizer untouched.
    SELECT * INTO v_reg FROM tournament_registrations
     WHERE tournament_id = v_tid AND user_id = v_players[6];
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[6]::text)::text, true);
    PERFORM tournament_withdraw(v_reg.id, v_reg.version);
    ASSERT NOT EXISTS (SELECT 1 FROM conversation_participant
                        WHERE conversation_id = v_conv AND player_id = v_players[6]),
        'withdrawn player still in tournament chat';
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_org),
        'organizer removed from tournament chat on withdraw';

    -- Re-register puts them back.
    PERFORM tournament_register(v_tid);
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_players[6]),
        're-registered player not re-added to tournament chat';

    -- Rename syncs the conversation title.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    PERFORM tournament_update(v_tid, v_ver, jsonb_build_object('name', 'Chat Cup Renamed'));
    ASSERT (SELECT title FROM conversation WHERE id = v_conv) = 'Chat Cup Renamed',
        'conversation title not synced on rename';

    RAISE NOTICE 'PASS 1: tournament chat lifecycle (create/register/withdraw/re-register/rename)';
END $$;

-- --------------------------------------------------------------------------
-- 2. Doubles entry: partner joins/leaves the chat with the entry
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_conv    uuid;
    v_reg     tournament_registrations;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 8
      ) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Doubles Chat Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_entry_format => 'doubles'
    );
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT id INTO v_conv FROM conversation WHERE tournament_id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_ver);

    -- Captain registers with a partner → both pair members in the chat.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_tid, v_players[3]);
    ASSERT v_reg.partner_user_id = v_players[3], 'partner not stored on entry';
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_players[2]),
        'captain not in doubles tournament chat';
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_players[3]),
        'partner not in doubles tournament chat';

    -- Withdraw removes both.
    PERFORM tournament_withdraw(v_reg.id, v_reg.version);
    ASSERT NOT EXISTS (SELECT 1 FROM conversation_participant
                        WHERE conversation_id = v_conv
                          AND player_id IN (v_players[2], v_players[3])),
        'pair members still in chat after entry withdrawal';

    RAISE NOTICE 'PASS 2: doubles entry members follow the entry in/out of the chat';
END $$;

-- --------------------------------------------------------------------------
-- 3. Registration notifications: received / approved / silent self-accept /
--    removed (+ pending stays out of the chat)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_conv    uuid;
    v_reg2    tournament_registrations;
    v_reg3    tournament_registrations;
    v_count   integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 8
      ) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Approval Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_registration_mode => 'approval'
    );
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT id INTO v_conv FROM conversation WHERE tournament_id = v_tid;
    PERFORM tournament_open_registration(v_tid, v_ver);

    -- Pending request → organizer notified, requester stays out of the chat.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg2 FROM tournament_register(v_tid);
    ASSERT v_reg2.status = 'pending', 'approval mode should yield pending';
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_registration_received' AND target_id = v_tid;
    ASSERT v_count = 1, 'expected 1 registration_received notification, got ' || v_count;
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type = 'tournament_registration_received'
                      AND target_id = v_tid AND user_id = v_org),
        'registration_received not addressed to organizer';
    ASSERT NOT EXISTS (SELECT 1 FROM conversation_participant
                        WHERE conversation_id = v_conv AND player_id = v_players[2]),
        'pending registrant should not be in the chat';

    -- Organizer approves (simulated future approval path) → member notified + in chat.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    UPDATE tournament_registrations SET status = 'registered', updated_at = now()
     WHERE id = v_reg2.id;
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type = 'tournament_registration_approved'
                      AND target_id = v_tid AND user_id = v_players[2]),
        'approved notification missing';
    ASSERT EXISTS (SELECT 1 FROM conversation_participant
                    WHERE conversation_id = v_conv AND player_id = v_players[2]),
        'approved registrant not added to chat';

    -- Self-accept (registrant flips own row, e.g. invite flow) → silent.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    SELECT * INTO v_reg3 FROM tournament_register(v_tid);
    UPDATE tournament_registrations SET status = 'registered', updated_at = now()
     WHERE id = v_reg3.id;
    ASSERT NOT EXISTS (SELECT 1 FROM notification
                        WHERE type = 'tournament_registration_approved'
                          AND target_id = v_tid AND user_id = v_players[3]),
        'self-accept must not produce an approved notification';

    -- Organizer removes an entry → member notified + out of the chat.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_reg2 FROM tournament_registrations WHERE id = v_reg2.id;
    PERFORM tournament_remove_registration(v_reg2.id, v_reg2.version);
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type = 'tournament_registration_removed'
                      AND target_id = v_tid AND user_id = v_players[2]),
        'removed notification missing';
    ASSERT NOT EXISTS (SELECT 1 FROM conversation_participant
                        WHERE conversation_id = v_conv AND player_id = v_players[2]),
        'removed registrant still in chat';

    RAISE NOTICE 'PASS 3: registration notifications (received/approved/silent/removed)';
END $$;

-- --------------------------------------------------------------------------
-- 4. Bracket published, impactful edit, match completed, champion
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_count   integer;
    v_match   tournament_matches;
    v_loser_user uuid;
    v_winner_user uuid;
    v_guard   integer := 0;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 8
      ) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Lifecycle Cup', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_registration_mode => 'open'
    );
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    FOR i IN 2..6 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    -- Bracket published: one notification per registered member (5), byes flagged.
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_bracket_published' AND target_id = v_tid;
    ASSERT v_count = 5, 'expected 5 bracket_published notifications, got ' || v_count;
    -- Byes carry no round-1 opponent in the payload. Assert on the structured
    -- payload, not the body text, so the check is locale-independent (the body
    -- is localized per recipient — fr-CA seed players get French wording).
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_bracket_published' AND target_id = v_tid
       AND (payload->>'opponentName') IS NULL;
    ASSERT v_count = 3, 'expected 3 bye notifications (no round-1 opponent), got ' || v_count;
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_bracket_published' AND target_id = v_tid
       AND (payload->>'opponentName') IS NOT NULL;
    ASSERT v_count = 2, 'expected 2 notifications naming a round-1 opponent, got ' || v_count;

    -- Impactful edit while in_progress → tournament_updated to the 5 members.
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    PERFORM tournament_update(v_tid, v_ver, jsonb_build_object(
        'start_date', (now() + interval '14 days')::text,
        'end_date',   (now() + interval '15 days')::text));
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_updated' AND target_id = v_tid;
    ASSERT v_count = 5, 'expected 5 tournament_updated notifications, got ' || v_count;
    ASSERT (SELECT bool_and(payload->'changedFields' ? 'start_date') FROM notification
             WHERE type = 'tournament_updated' AND target_id = v_tid),
        'changedFields should include start_date';

    -- First real-vs-real bracket slot: override, then force the deferred
    -- trigger to fire (it normally runs at COMMIT, after advancement).
    SELECT * INTO v_match FROM tournament_matches
     WHERE tournament_id = v_tid AND status = 'pending'
       AND player1_is_bye = false AND player2_is_bye = false
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
     ORDER BY round_number, match_position
     LIMIT 1;
    ASSERT v_match.id IS NOT NULL, 'no real round-1 slot found';
    SELECT user_id INTO v_winner_user FROM tournament_registrations WHERE id = v_match.player1_registration_id;
    SELECT user_id INTO v_loser_user  FROM tournament_registrations WHERE id = v_match.player2_registration_id;

    PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
    SET CONSTRAINTS ALL IMMEDIATE;

    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type = 'tournament_match_completed' AND target_id = v_tid
                      AND user_id = v_loser_user AND (payload->>'won')::boolean = false),
        'loser did not get a result-recorded notification';
    ASSERT EXISTS (SELECT 1 FROM notification
                    WHERE type = 'tournament_match_completed' AND target_id = v_tid
                      AND user_id = v_winner_user AND (payload->>'won')::boolean = true
                      AND (payload->>'round')::int = 2),
        'winner did not get a round-2 advancement notification';

    -- Play the bracket out → champion announcement to the 5 members.
    LOOP
        v_guard := v_guard + 1;
        ASSERT v_guard < 50, 'override loop did not converge';
        SELECT * INTO v_match FROM tournament_matches
         WHERE tournament_id = v_tid AND status = 'pending'
           AND player1_is_bye = false AND player2_is_bye = false
           AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
         ORDER BY round_number, match_position
         LIMIT 1;
        EXIT WHEN v_match.id IS NULL;
        PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
    END LOOP;

    ASSERT (SELECT status FROM tournaments WHERE id = v_tid) = 'completed',
        'tournament should be completed';
    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_completed' AND target_id = v_tid;
    ASSERT v_count = 5, 'expected 5 tournament_completed notifications, got ' || v_count;
    ASSERT (SELECT bool_and(payload->>'championName' IS NOT NULL) FROM notification
             WHERE type = 'tournament_completed' AND target_id = v_tid),
        'championName missing from completed payload';

    RAISE NOTICE 'PASS 4: bracket published / updated / slot completed / champion';
END $$;

-- --------------------------------------------------------------------------
-- 5. Cancellation: urgent notification to invested entries, actor excluded
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_count   integer;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 8
      ) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Rainout Cup', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days'
    );
    PERFORM pg_temp.staff_off(v_org);
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    FOR i IN 2..3 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    PERFORM tournament_cancel(v_tid, 'Courts flooded', v_ver);

    SELECT count(*) INTO v_count FROM notification
     WHERE type = 'tournament_cancelled' AND target_id = v_tid;
    ASSERT v_count = 2, 'expected 2 tournament_cancelled notifications, got ' || v_count;
    ASSERT (SELECT bool_and(priority = 'urgent') FROM notification
             WHERE type = 'tournament_cancelled' AND target_id = v_tid),
        'cancellation should be urgent';
    ASSERT NOT EXISTS (SELECT 1 FROM notification
                        WHERE type = 'tournament_cancelled' AND target_id = v_tid
                          AND user_id = v_org),
        'cancelling organizer should not notify themselves';
    ASSERT (SELECT bool_and(body LIKE '%Courts flooded%') FROM notification
             WHERE type = 'tournament_cancelled' AND target_id = v_tid),
        'cancellation reason missing from body';

    RAISE NOTICE 'PASS 5: cancellation notifications (urgent, actor excluded, reason in body)';
END $$;

ROLLBACK;

-- ============================================
-- Doubles tournaments — DB-level integration test
-- ============================================
-- Exercises the partner registration flow (20260612160200) and the doubles
-- attach/propagation path (20260612160300) against a live database.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed          # seeds 100 players w/ sports
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournaments_doubles_flow_test.sql
--
-- One transaction, ROLLBACK at the end; safe to re-run. Auth is simulated via
-- the request.jwt.claims GUC; RLS is checked by switching to `authenticated`.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Partner registration: validations, withdraw, re-register, notifications
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport    uuid;
    v_players  uuid[];
    v_org      uuid;
    v_nosport  uuid;
    v_t        tournaments;
    v_tid      uuid;
    v_ver      integer;
    v_reg      tournament_registrations;
    v_count    integer;
    v_ok       boolean;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'seed missing tennis sport';

    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true
         ORDER BY player_id LIMIT 8
      ) s;
    ASSERT array_length(v_players, 1) = 8,
        'need 8 active tennis players, got ' || coalesce(array_length(v_players, 1), 0);
    v_org := v_players[1];
    -- players: 2=A (captain), 3=B (partner), 4=C, 5=D, 6=E, 7=F, 8=G

    -- A player with no active tennis row, for PARTNER_SPORT_MISMATCH.
    SELECT p.id INTO v_nosport
      FROM player p
     WHERE NOT EXISTS (
        SELECT 1 FROM player_sport ps
         WHERE ps.player_id = p.id AND ps.sport_id = v_sport AND ps.is_active
     )
     LIMIT 1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Doubles Open', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'doubles'
    );
    v_tid := v_t.id; v_ver := v_t.version;
    ASSERT v_t.entry_format = 'doubles', 'expected doubles entry_format';

    PERFORM tournament_open_registration(v_tid, v_ver);

    -- Doubles requires a partner.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'PARTNER_REQUIRED');
    END;
    ASSERT v_ok, 'expected PARTNER_REQUIRED without partner';

    -- Partner can't be yourself.
    v_ok := false;
    BEGIN
        PERFORM tournament_register(v_tid, v_players[2]);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'PARTNER_INVALID');
    END;
    ASSERT v_ok, 'expected PARTNER_INVALID for self-partner';

    -- Partner must play the sport (skipped when every seeded player does).
    IF v_nosport IS NOT NULL THEN
        v_ok := false;
        BEGIN
            PERFORM tournament_register(v_tid, v_nosport);
        EXCEPTION WHEN OTHERS THEN
            v_ok := (SQLERRM = 'PARTNER_SPORT_MISMATCH');
        END;
        ASSERT v_ok, 'expected PARTNER_SPORT_MISMATCH';
    ELSE
        RAISE NOTICE 'SKIP: no sport-less player in seed for PARTNER_SPORT_MISMATCH';
    END IF;

    -- A registers with partner B → one entry row holding both.
    SELECT * INTO v_reg FROM tournament_register(v_tid, v_players[3]);
    ASSERT v_reg.status = 'registered', 'expected registered entry';
    ASSERT v_reg.user_id = v_players[2] AND v_reg.partner_user_id = v_players[3],
        'entry must hold captain + partner';

    -- Partner got the heads-up notification.
    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_players[3] AND type = 'tournament_partner_registered'
       AND target_id = v_tid;
    ASSERT v_count = 1, 'expected partner-registered notification, got ' || v_count;

    -- B is taken: C can't register with B as partner...
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[4]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_register(v_tid, v_players[3]);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'PARTNER_ALREADY_REGISTERED');
    END;
    ASSERT v_ok, 'expected PARTNER_ALREADY_REGISTERED for taken partner';

    -- ...and B can't register a second entry as captain.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_register(v_tid, v_players[4]);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'ALREADY_REGISTERED');
    END;
    ASSERT v_ok, 'expected ALREADY_REGISTERED for active partner registering as captain';

    -- B (the partner, not the captain) withdraws the whole entry.
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_reg.id;
    PERFORM tournament_withdraw(v_reg.id, v_reg.version);
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_reg.id;
    ASSERT v_reg.status = 'withdrawn', 'partner withdraw must withdraw the entry';

    -- Captain A got the team-withdrawn notice.
    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_players[2] AND type = 'tournament_partner_withdrew'
       AND target_id = v_tid;
    ASSERT v_count = 1, 'expected partner-withdrew notification, got ' || v_count;

    -- A re-registers with a different partner (C) → same row, new partner.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_tid, v_players[4]);
    ASSERT v_reg.status = 'registered' AND v_reg.partner_user_id = v_players[4],
        're-register must reactivate with the new partner';
    SELECT count(*) INTO v_count FROM tournament_registrations
     WHERE tournament_id = v_tid AND user_id = v_players[2];
    ASSERT v_count = 1, 'reactivation must reuse the existing row';

    -- Two more teams: D+E and F+G → 3 entries (capacity counts teams).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[5]::text)::text, true);
    PERFORM tournament_register(v_tid, v_players[6]);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    PERFORM tournament_register(v_tid, v_players[8]);
    SELECT count(*) INTO v_count FROM tournament_registrations
     WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT v_count = 3, 'expected 3 team entries, got ' || v_count;

    -- Close + bracket: registration-id bracket with one bye, organizer
    -- overrides to a champion — all format-agnostic, must just work.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_t.version);
    PERFORM tournament_generate_bracket(v_tid, v_t.version);

    SELECT count(*) INTO v_count FROM tournament_matches WHERE tournament_id = v_tid;
    ASSERT v_count = 3, 'expected 3 matches in a 4-team bracket, got ' || v_count;

    DECLARE
        v_match tournament_matches;
        v_guard integer := 0;
    BEGIN
        LOOP
            v_guard := v_guard + 1;
            ASSERT v_guard < 20, 'override loop did not converge';
            SELECT * INTO v_match FROM tournament_matches
             WHERE tournament_id = v_tid AND status = 'pending'
               AND player1_is_bye = false AND player2_is_bye = false
               AND player1_registration_id IS NOT NULL
               AND player2_registration_id IS NOT NULL
             ORDER BY round_number, match_position LIMIT 1;
            EXIT WHEN v_match.id IS NULL;
            PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
        END LOOP;
    END;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'completed', 'expected completed, got ' || v_t.status;
    SELECT count(*) INTO v_count
      FROM tournament_matches tm
      JOIN tournament_registrations r ON r.id = tm.winner_registration_id
     WHERE tm.tournament_id = v_tid AND tm.next_match_id IS NULL
       AND r.partner_user_id IS NOT NULL;
    ASSERT v_count = 1, 'champion entry must be a pair';

    RAISE NOTICE 'PASS 1: doubles registration, withdraw, re-register, bracket, champion';
END $$;

-- --------------------------------------------------------------------------
-- 2. Singles tournaments reject partners
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_t       tournaments;
    v_ok      boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true
         ORDER BY player_id LIMIT 3
      ) s;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[1]::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Singles Guard', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_registration_mode => 'open'
    );
    PERFORM tournament_open_registration(v_t.id, v_t.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_t.id, v_players[3]);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'PARTNER_NOT_ALLOWED');
    END;
    ASSERT v_ok, 'expected PARTNER_NOT_ALLOWED on singles';

    RAISE NOTICE 'PASS 2: singles tournament rejects a partner';
END $$;

-- --------------------------------------------------------------------------
-- 3. Attach a real doubles game to a bracket slot (player-driven path)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport    uuid;
    v_players  uuid[];
    v_org      uuid;
    v_t        tournaments;
    v_tid      uuid;
    v_reg1     tournament_registrations;  -- A+B
    v_reg2     tournament_registrations;  -- C+D
    v_final    tournament_matches;
    v_match_id uuid;
    v_bad_id   uuid;
    v_mr_id    uuid;
    v_ok       boolean;
    v_count    integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true
         ORDER BY player_id DESC LIMIT 5
      ) s;
    v_org := v_players[5];
    -- players: 1=A, 2=B, 3=C, 4=D

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Doubles Attach Cup', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() - interval '1 day',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'doubles',
        p_registration_opens_at => now() - interval '2 days'
    );
    v_tid := v_t.id;
    -- start_date is in the past so the bracket can attach an already-played
    -- game; open_registration gates on a future start, so flip status directly.
    UPDATE tournaments SET status = 'registration_open', version = version + 1 WHERE id = v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[1]::text)::text, true);
    SELECT * INTO v_reg1 FROM tournament_register(v_tid, v_players[2]);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    SELECT * INTO v_reg2 FROM tournament_register(v_tid, v_players[4]);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_t.version);
    PERFORM tournament_generate_bracket(v_tid, v_t.version);

    -- 2 teams in a 4-bracket: two R1 byes auto-complete, the final is the
    -- pending real-vs-real slot.
    SELECT * INTO v_final FROM tournament_matches
     WHERE tournament_id = v_tid AND status = 'pending'
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL;
    ASSERT v_final.id IS NOT NULL, 'expected a pending final';

    -- The played doubles game: A+B beat C+D yesterday, score verified.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format)
    VALUES (v_sport, v_players[1], (now() - interval '1 day')::date, '10:00', '11:00', 'doubles')
    RETURNING id INTO v_match_id;
    -- The creator is auto-joined by trigger; upsert the full four.
    INSERT INTO match_participant (match_id, player_id, status)
    SELECT v_match_id, p, 'joined' FROM unnest(v_players[1:4]) AS p
    ON CONFLICT (match_id, player_id) DO UPDATE SET status = 'joined';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[1]::text)::text, true);
    SELECT submit_match_result_for_match(
        v_match_id, v_players[1], 1,
        '[{"team1_score": 6, "team2_score": 3}, {"team1_score": 6, "team2_score": 4}]'::jsonb,
        v_players[2]
    ) INTO v_mr_id;
    UPDATE match_result SET is_verified = true, confirmed_by = v_players[3] WHERE id = v_mr_id;

    -- Teams were assigned by the submit RPC: submitter+partner = 1, others = 2.
    SELECT count(*) INTO v_count FROM match_participant
     WHERE match_id = v_match_id AND team_number = 1
       AND player_id IN (v_players[1], v_players[2]);
    ASSERT v_count = 2, 'submit RPC must put captain+partner on team 1';

    -- Negative: a singles-format game with only A and C can't attach.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format)
    VALUES (v_sport, v_players[1], (now() - interval '1 day')::date, '12:00', '13:00', 'singles')
    RETURNING id INTO v_bad_id;
    INSERT INTO match_participant (match_id, player_id, status)
    VALUES (v_bad_id, v_players[1], 'joined'), (v_bad_id, v_players[3], 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE SET status = 'joined';
    v_ok := false;
    BEGIN
        PERFORM tournament_attach_match(v_final.id, v_bad_id);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'MATCH_FORMAT_MISMATCH');
    END;
    ASSERT v_ok, 'expected MATCH_FORMAT_MISMATCH for singles game on doubles bracket';

    -- Attach as B — the WINNING PAIR'S PARTNER, not the captain. Propagation
    -- must resolve the winner registration through partner_user_id.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    PERFORM tournament_attach_match(v_final.id, v_match_id);

    SELECT * INTO v_final FROM tournament_matches WHERE id = v_final.id;
    ASSERT v_final.status = 'completed', 'final must complete on attach';
    ASSERT v_final.winner_registration_id = v_reg1.id,
        'winner must be the A+B entry (resolved via partner)';
    ASSERT v_final.score = '6-3 6-4', 'score must carry over, got ' || coalesce(v_final.score, '∅');

    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'completed', 'tournament must complete after the final';

    RAISE NOTICE 'PASS 3: doubles game attached by partner, bracket resolved';
END $$;

-- --------------------------------------------------------------------------
-- 4. Invite links on doubles + capacity counts teams
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_link    tournament_invite_links;
    v_reg     tournament_registrations;
    v_row     tournament_registrations;
    v_ok      boolean;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true
         ORDER BY player_id OFFSET 10 LIMIT 11
      ) s;
    ASSERT array_length(v_players, 1) = 11, 'need 11 players for the capacity test';
    v_org := v_players[11];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Invite Doubles', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'private', p_registration_mode => 'open',
        p_entry_format => 'doubles'
    );
    v_tid := v_t.id;
    PERFORM tournament_open_registration(v_tid, v_t.version);
    SELECT * INTO v_link FROM tournament_invite_get_or_create(v_tid);

    -- Invite join on doubles requires a partner too.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[1]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_join_via_invite(v_link.token);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'PARTNER_REQUIRED');
    END;
    ASSERT v_ok, 'expected PARTNER_REQUIRED on doubles invite join';

    -- A joins via invite with partner B → one pair entry.
    SELECT * INTO v_reg FROM tournament_join_via_invite(v_link.token, v_players[2]);
    ASSERT v_reg.status = 'registered'
       AND v_reg.user_id = v_players[1] AND v_reg.partner_user_id = v_players[2],
        'invite join must register the pair';

    -- Partner B re-taps the invite → idempotent, hands back the same entry.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_row FROM tournament_join_via_invite(v_link.token);
    ASSERT v_row.id = v_reg.id, 'partner re-tap must return the existing entry';

    -- Fill the remaining 3 team slots (C+D, E+F, G+H).
    FOR i IN 0..2 LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_players[3 + i * 2]::text)::text, true);
        PERFORM tournament_register(v_tid, v_players[4 + i * 2]);
    END LOOP;

    -- A 5th team is one too many: capacity counts entries, not players.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[9]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_register(v_tid, v_players[10]);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'TOURNAMENT_FULL');
    END;
    ASSERT v_ok, 'expected TOURNAMENT_FULL at 4 teams';

    RAISE NOTICE 'PASS 4: doubles invite join + team-counted capacity';
END $$;

-- --------------------------------------------------------------------------
-- 5. RLS: a partner can see a private tournament and its registrations
-- --------------------------------------------------------------------------
-- Runs last: switches to the `authenticated` role.
DO $$
DECLARE
    v_sport    uuid;
    v_players  uuid[];
    v_org      uuid;
    v_outsider uuid;
    v_t        tournaments;
    v_seen     integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true
         ORDER BY player_id LIMIT 4
      ) s;
    v_org := v_players[1];
    v_outsider := v_players[4];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Private Doubles RLS', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'private', p_registration_mode => 'open',
        p_entry_format => 'doubles'
    );
    PERFORM tournament_open_registration(v_t.id, v_t.version);

    -- Captain (player 2) registers with partner (player 3).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    PERFORM tournament_register(v_t.id, v_players[3]);

    PERFORM set_config('role', 'authenticated', true);

    -- The partner sees the private tournament and its registrations.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    SELECT count(*) INTO v_seen FROM tournaments WHERE id = v_t.id;
    ASSERT v_seen = 1, 'partner should see the private tournament';
    SELECT count(*) INTO v_seen FROM tournament_registrations WHERE tournament_id = v_t.id;
    ASSERT v_seen = 1, 'partner should see the pair registration';

    -- An outsider still sees nothing.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);
    SELECT count(*) INTO v_seen FROM tournaments WHERE id = v_t.id;
    ASSERT v_seen = 0, 'RLS leak: outsider can see private doubles tournament';

    RAISE NOTICE 'PASS 5: partner RLS visibility on private tournament';
END $$;

ROLLBACK;

-- ============================================
-- Leagues — V6 create / join / approve / season lifecycle (DB-level)
-- ============================================
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/leagues_flow_test.sql
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. league_create -> organizer member; approval join -> pending -> approved
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_league  leagues;
    v_member  league_members;
    v_after   league_members;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(v_players, 1) = 4, 'need 4 active tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(
        p_name => 'Summer Ladder', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'approval');
    ASSERT v_league.organizer_id = v_org, 'organizer_id mismatch';
    ASSERT EXISTS (
        SELECT 1 FROM league_members
         WHERE league_id = v_league.id AND user_id = v_org AND role = 'organizer' AND status = 'active'
    ), 'organizer membership missing';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_member FROM league_join(v_league.id);
    ASSERT v_member.status = 'pending', 'approval join should be pending';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_after FROM league_approve_member(v_member.id, v_member.version);
    ASSERT v_after.status = 'active', 'expected active after approve';
    ASSERT v_after.approved_by = v_org, 'approved_by should be organizer';

    RAISE NOTICE 'PASS 1: league_create + approval join flow';
END $$;

-- --------------------------------------------------------------------------
-- 2. season_create (draft) -> season_open seeds season_rankings
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid;
    v_league leagues; v_season seasons; v_open seasons;
    v_ranking_count integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 3) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(
        p_name => 'Season Test League', p_sport_id => v_sport,
        p_join_mode => 'open');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    PERFORM league_join(v_league.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_season FROM season_create(
        p_league_id => v_league.id,
        p_name => 'Spring 2026',
        p_start_date => current_date,
        p_end_date => current_date + 90);
    ASSERT v_season.status = 'draft', 'new season should be draft';

    SELECT * INTO v_open FROM season_open(v_season.id, v_season.version);
    ASSERT v_open.status = 'open', 'season should be open';
    ASSERT v_open.rules_locked_at IS NOT NULL, 'rules_locked_at should be set';

    SELECT count(*) INTO v_ranking_count
      FROM season_rankings WHERE season_id = v_open.id;
    ASSERT v_ranking_count = 2, 'expected 2 active members seeded, got ' || v_ranking_count;

    RAISE NOTICE 'PASS 2: season_create + season_open seeds rankings';
END $$;

-- --------------------------------------------------------------------------
-- 3. non-organizer approve -> NOT_ORGANIZER
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid; v_outsider uuid;
    v_league leagues; v_member league_members; v_ok boolean := false;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 4) s;
    v_org := v_players[1]; v_outsider := v_players[4];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(
        p_name => 'Auth League', p_sport_id => v_sport, p_join_mode => 'approval');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_member FROM league_join(v_league.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);
    BEGIN
        PERFORM league_approve_member(v_member.id, v_member.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'expected NOT_ORGANIZER for non-organizer approve';

    RAISE NOTICE 'PASS 3: non-organizer approve rejected';
END $$;

-- --------------------------------------------------------------------------
-- 4. public league active roster is visible to authenticated non-participants
-- --------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid; v_outsider uuid;
    v_league leagues; v_active_member league_members; v_pending_member league_members;
    v_visible_active integer; v_visible_pending integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(v_players, 1) = 5, 'need 5 active tennis players';
    v_org := v_players[1]; v_outsider := v_players[5];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(
        p_name => 'Public Roster League',
        p_sport_id => v_sport,
        p_visibility => 'public',
        p_join_mode => 'approval');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[2]::text)::text, true);
    SELECT * INTO v_active_member FROM league_join(v_league.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM league_approve_member(v_active_member.id, v_active_member.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[3]::text)::text, true);
    SELECT * INTO v_pending_member FROM league_join(v_league.id);
    ASSERT v_pending_member.status = 'pending', 'expected pending member setup';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider::text)::text, true);

    SELECT count(*) INTO v_visible_active
      FROM league_members
     WHERE league_id = v_league.id
       AND status = 'active';

    SELECT count(*) INTO v_visible_pending
      FROM league_members
     WHERE league_id = v_league.id
       AND status = 'pending';

    ASSERT v_visible_active = 2, 'outsider should see 2 active public members, got ' || v_visible_active;
    ASSERT v_visible_pending = 0, 'outsider should not see pending members, got ' || v_visible_pending;

    RAISE NOTICE 'PASS 4: public league active roster visible to outsider';
END $$;

RESET ROLE;

-- --------------------------------------------------------------------------
-- 5. session create -> publish (seeds presence) -> confirm (+capacity/waitlist
--    +promote) -> close-confirmations cron -> cancel
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid; v_m1 uuid; v_m2 uuid;
    v_league  leagues;
    v_season  seasons;
    v_session sessions;
    v_pres    session_presence;
    v_status  text;
    v_pending integer;
    v_flipped integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id = v_sport AND is_active = true
        ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(v_players, 1) = 4, 'need 4 active tennis players';
    v_org := v_players[1]; v_m1 := v_players[2]; v_m2 := v_players[3];

    -- Open-join league so members land active without approval.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(
        p_name => 'V7 Session League', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m1::text)::text, true);
    PERFORM league_join(v_league.id);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m2::text)::text, true);
    PERFORM league_join(v_league.id);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_season FROM season_create(v_league.id, 'S1', current_date, current_date + 90);
    SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);

    -- Create a draft session with capacity 1 to exercise the waitlist.
    SELECT * INTO v_session FROM session_create(
        p_season_id => v_season.id, p_name => 'Night 1',
        p_scheduled_at => now() + interval '3 days', p_timezone => 'America/Toronto',
        p_capacity => 1::smallint);
    ASSERT v_session.status = 'draft', 'session should be draft on create';

    -- Non-organizer cannot create a session.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m1::text)::text, true);
    BEGIN
        PERFORM session_create(
            p_season_id => v_season.id, p_name => 'Sneaky',
            p_scheduled_at => now() + interval '3 days', p_timezone => 'America/Toronto');
        ASSERT false, 'non-organizer session_create should have raised';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLERRM = 'NOT_ORGANIZER', 'expected NOT_ORGANIZER, got ' || SQLERRM;
    END;

    -- Publish seeds one pending presence row per active member (org + m1 + m2).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_session FROM session_publish(v_session.id, NULL, v_session.version);
    ASSERT v_session.status = 'published', 'session should be published';
    SELECT count(*) INTO v_pending FROM session_presence
     WHERE session_id = v_session.id AND status = 'pending';
    ASSERT v_pending = 3, 'expected 3 pending presence rows, got ' || v_pending;

    -- m1 confirms -> confirmed; m2 confirms -> waitlisted (capacity 1).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m1::text)::text, true);
    SELECT * INTO v_pres FROM session_confirm_presence(v_session.id, 'confirmed');
    ASSERT v_pres.status = 'confirmed', 'm1 expected confirmed, got ' || v_pres.status;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m2::text)::text, true);
    SELECT * INTO v_pres FROM session_confirm_presence(v_session.id, 'confirmed');
    ASSERT v_pres.status = 'waitlisted', 'm2 expected waitlisted, got ' || v_pres.status;

    -- m1 declines -> trigger promotes m2 from waitlist to confirmed.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m1::text)::text, true);
    PERFORM session_confirm_presence(v_session.id, 'declined');
    SELECT status INTO v_status FROM session_presence
     WHERE session_id = v_session.id AND user_id = v_m2;
    ASSERT v_status = 'confirmed', 'm2 expected promoted to confirmed, got ' || v_status;

    -- Past the deadline, the cron flips the organizer's still-pending row.
    UPDATE sessions SET confirmation_deadline_at = now() - interval '1 minute'
     WHERE id = v_session.id;
    SELECT lt_close_due_session_confirmations() INTO v_flipped;
    ASSERT v_flipped = 1, 'expected 1 pending flipped (organizer), got ' || v_flipped;

    -- Confirmations are closed past the deadline.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_m2::text)::text, true);
    BEGIN
        PERFORM session_confirm_presence(v_session.id, 'declined');
        ASSERT false, 'confirm past deadline should have raised';
    EXCEPTION WHEN OTHERS THEN
        ASSERT SQLERRM = 'CONFIRMATION_CLOSED', 'expected CONFIRMATION_CLOSED, got ' || SQLERRM;
    END;

    -- Organizer cancels the session.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT version INTO v_session.version FROM sessions WHERE id = v_session.id;
    SELECT * INTO v_session FROM session_cancel(v_session.id, 'rain', v_session.version);
    ASSERT v_session.status = 'cancelled', 'session should be cancelled';

    RAISE NOTICE 'PASS 5: session lifecycle (create/publish/confirm/waitlist/close/cancel)';
END $$;

-- --------------------------------------------------------------------------
-- 6. match sheet: BY_RANK generate (even + odd bye), lock preserved on
--    regenerate, SHEET_LOCKED guard
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid;
    v_league leagues; v_season seasons; v_session sessions;
    v_matches integer; v_bad integer; v_byes integer;
    v_expected_bye uuid; v_actual_bye uuid;
    v_locked_id uuid; v_locked_ver integer; v_ver integer; v_ok boolean;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id=v_sport AND is_active=true
        ORDER BY player_id LIMIT 6) s;
    ASSERT array_length(v_players,1)=6, 'need 6 players';
    -- Use player[6] as organizer: player[1] has already created its 5-league
    -- daily quota across earlier passes (one frozen-now() transaction).
    v_org := v_players[6];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(p_name=>'V8 Sheet Test', p_sport_id=>v_sport,
        p_visibility=>'public', p_join_mode=>'open');
    FOR i IN 1..5 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM league_join(v_league.id);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_season FROM season_create(v_league.id,'S1',current_date,current_date+90);
    SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);
    SELECT * INTO v_session FROM session_create(p_season_id=>v_season.id, p_name=>'N1',
        p_scheduled_at=>now()+interval '3 days', p_timezone=>'America/Toronto');
    SELECT * INTO v_session FROM session_publish(v_session.id, NULL, v_session.version);

    -- 4 confirm (even) -> generate -> 2 matches, all 1v1
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM session_confirm_presence(v_session.id, 'confirmed');
    FOR i IN 2..4 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM session_confirm_presence(v_session.id, 'confirmed');
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_session FROM session_generate_sheet(v_session.id, v_session.version);
    SELECT count(*) INTO v_matches FROM session_matches WHERE session_id=v_session.id;
    ASSERT v_matches = 2, format('even: expected 2 matches, got %s', v_matches);
    SELECT count(*) INTO v_bad FROM session_matches WHERE session_id=v_session.id
       AND (cardinality(team_a_user_ids)<>1 OR cardinality(team_b_user_ids)<>1);
    ASSERT v_bad = 0, 'even: every match must be 1v1';

    -- 5th confirms (odd) -> regenerate -> 2 matches + exactly 1 unpaired (bye),
    -- and the bye is the rank-top player
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[5]::text)::text, true);
    PERFORM session_confirm_presence(v_session.id, 'confirmed');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_session FROM session_regenerate_sheet(v_session.id, v_session.version);
    SELECT count(*) INTO v_matches FROM session_matches WHERE session_id=v_session.id;
    ASSERT v_matches = 2, format('odd: expected 2 matches, got %s', v_matches);
    SELECT count(*) FILTER (WHERE NOT covered) INTO v_byes FROM (
        SELECT sp.user_id u, EXISTS (
            SELECT 1 FROM session_matches sm WHERE sm.session_id=v_session.id
              AND sp.user_id = ANY(sm.team_a_user_ids||sm.team_b_user_ids)) covered
        FROM session_presence sp
        WHERE sp.session_id=v_session.id AND sp.status='confirmed') x;
    ASSERT v_byes = 1, format('odd: expected exactly 1 bye, got %s', v_byes);
    SELECT sp.user_id INTO v_expected_bye FROM session_presence sp
        LEFT JOIN season_rankings sr ON sr.season_id=v_season.id AND sr.user_id=sp.user_id
        WHERE sp.session_id=v_session.id AND sp.status='confirmed'
        ORDER BY coalesce(sr.points,0) DESC, coalesce(sr.tiebreak_seed,0) ASC, sp.user_id LIMIT 1;
    SELECT sp.user_id INTO v_actual_bye FROM session_presence sp
        WHERE sp.session_id=v_session.id AND sp.status='confirmed'
          AND NOT EXISTS (SELECT 1 FROM session_matches sm WHERE sm.session_id=v_session.id
                            AND sp.user_id = ANY(sm.team_a_user_ids||sm.team_b_user_ids));
    ASSERT v_actual_bye = v_expected_bye, 'odd: bye must be the rank-top player';

    -- lock a match -> regenerate -> locked row preserved
    SELECT id, version INTO v_locked_id, v_locked_ver FROM session_matches
        WHERE session_id=v_session.id LIMIT 1;
    PERFORM session_set_match_lock(v_locked_id, true, v_locked_ver);
    SELECT * INTO v_session FROM session_regenerate_sheet(v_session.id, v_session.version);
    ASSERT EXISTS (SELECT 1 FROM session_matches WHERE id=v_locked_id AND locked=true),
        'locked row must survive regenerate';

    -- a non-locked match goes in_progress -> regenerate rejected with SHEET_LOCKED
    UPDATE session_matches SET status='in_progress'
        WHERE id = (SELECT id FROM session_matches WHERE session_id=v_session.id AND locked=false LIMIT 1);
    v_ok := false;
    BEGIN
        SELECT version INTO v_ver FROM sessions WHERE id=v_session.id;
        PERFORM session_regenerate_sheet(v_session.id, v_ver);
    EXCEPTION WHEN OTHERS THEN
        v_ok := (SQLERRM = 'SHEET_LOCKED');
    END;
    ASSERT v_ok, 'expected SHEET_LOCKED when a non-locked match is in_progress';

    RAISE NOTICE 'PASS 6: match sheet (BY_RANK generate/regenerate, bye, lock, SHEET_LOCKED)';
END $$;

-- --------------------------------------------------------------------------
-- 7. full season cycle: record scores -> ranking recalc -> season close
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_players uuid[]; v_org uuid;
    v_league leagues; v_season seasons; v_session sessions; v_m session_matches;
    v_winners integer; v_losers integer; v_closed seasons; v_pub_notifs integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    SELECT array_agg(player_id) INTO v_players FROM (
        SELECT player_id FROM player_sport WHERE sport_id=v_sport AND is_active=true
        ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(v_players,1)=5, 'need 5 players';
    -- player[5] has organized no leagues in earlier passes (avoids rate limit).
    v_org := v_players[5];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_league FROM league_create(p_name=>'V9 Season Cycle', p_sport_id=>v_sport,
        p_visibility=>'public', p_join_mode=>'open');
    FOR i IN 1..3 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM league_join(v_league.id);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_season FROM season_create(v_league.id,'S1',current_date,current_date+90);
    SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);
    SELECT * INTO v_session FROM session_create(p_season_id=>v_season.id, p_name=>'N1',
        p_scheduled_at=>now()+interval '3 days', p_timezone=>'America/Toronto');
    SELECT * INTO v_session FROM session_publish(v_session.id, NULL, v_session.version);

    -- session_published notifications fan out to the 4 active members
    SELECT count(*) INTO v_pub_notifs FROM notification
      WHERE type='session_published' AND target_id=v_session.id;
    ASSERT v_pub_notifs = 4, format('expected 4 session_published notifs, got %s', v_pub_notifs);

    -- org + 3 members confirm (4 -> 2 matches)
    PERFORM session_confirm_presence(v_session.id, 'confirmed');
    FOR i IN 1..3 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM session_confirm_presence(v_session.id, 'confirmed');
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_session FROM session_generate_sheet(v_session.id, v_session.version);

    -- team A wins both
    FOR v_m IN SELECT * FROM session_matches WHERE session_id=v_session.id LOOP
        PERFORM session_record_score(v_m.id, 'a', '6-4 6-2', 'completed', v_m.version);
    END LOOP;

    -- session auto-completes; ranking reflects 2 winners @10 / 2 losers @1
    SELECT * INTO v_session FROM sessions WHERE id=v_session.id;
    ASSERT v_session.status='completed', 'session should auto-complete';
    SELECT count(*) INTO v_winners FROM season_rankings WHERE season_id=v_season.id AND points=10 AND wins=1;
    SELECT count(*) INTO v_losers  FROM season_rankings WHERE season_id=v_season.id AND points=1  AND losses=1;
    ASSERT v_winners=2 AND v_losers=2, format('ranking wrong: %s winners / %s losers', v_winners, v_losers);
    ASSERT EXISTS (SELECT 1 FROM season_rankings WHERE season_id=v_season.id AND rank=1 AND points=10),
           'rank 1 should have 10 points';

    -- close the season -> final standings snapshot + season_closed notifs
    SELECT version INTO v_season.version FROM seasons WHERE id=v_season.id;
    SELECT * INTO v_closed FROM season_close(v_season.id, v_season.version);
    ASSERT v_closed.status='closed', 'season should be closed';
    ASSERT jsonb_array_length(v_closed.final_standings)=4, 'final_standings should have 4 entries';
    ASSERT (SELECT count(*) FROM notification WHERE type='season_closed' AND target_id=v_season.id)=4,
           'expected 4 season_closed notifs';

    RAISE NOTICE 'PASS 7: full season cycle (score -> recalc -> close + notifications)';
END $$;

ROLLBACK;

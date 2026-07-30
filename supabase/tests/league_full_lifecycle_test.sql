-- ============================================
-- Leagues — one league played through its whole life
-- ============================================
-- Unlike the stage-isolated suites, this file follows a SINGLE league from
-- creation to closure and asserts the transitions BETWEEN stages, which is
-- where the other suites have no coverage:
--
--   * the cross-session bye queue ("fewest byes this season first") — every
--     other test generates exactly one sheet, so the prior-bye memory that
--     20260730100000 builds from completed sessions had never been exercised;
--   * membership churn woven through a running season (suspension and season
--     withdrawal changing who the NEXT session invites, then reinstatement);
--   * a default_rules edit between seasons (frozen for the closed season,
--     live for the next one);
--   * league_pause / league_resume / league_close, which no test had ever
--     called, including close refusing while a season is open;
--   * the waitlist arc across the life: queued at capacity, held through a
--     suspension, promoted on a real departure, approved into the next season.
--
-- Cast: an approval-mode league, capacity 6 (organizer + five players A-E,
-- ordered by user_id), waitlist on, plus F who spends most of the story queued.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_full_lifecycle_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

-- Prior byes exactly as the sheet generator derives them: a confirmed presence
-- in a completed session of the season with no non-drill match in that session.
CREATE OR REPLACE FUNCTION pg_temp.prior_byes(p_season uuid, p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*)
    FROM session_presence sp JOIN sessions ss ON ss.id = sp.session_id
   WHERE ss.season_id = p_season AND ss.status = 'completed'
     AND sp.user_id = p_user AND sp.status = 'confirmed'
     AND NOT EXISTS (
           SELECT 1 FROM session_matches sm
            WHERE sm.session_id = ss.id AND sm.is_drill = false
              AND (p_user = ANY (sm.team_a_user_ids) OR p_user = ANY (sm.team_b_user_ids)));
$$;

CREATE OR REPLACE FUNCTION pg_temp.derived_byer(p_session uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT sp.user_id
    FROM session_presence sp
   WHERE sp.session_id = p_session AND sp.status = 'confirmed'
     AND NOT EXISTS (
           SELECT 1 FROM session_matches sm
            WHERE sm.session_id = p_session
              AND sp.user_id = ANY (sm.team_a_user_ids || sm.team_b_user_ids));
$$;

DO $$
DECLARE
    v_sport   uuid;
    v_p       uuid[];
    v_org     uuid;
    a uuid; b uuid; c uuid; d uuid; e uuid; f uuid;
    v_l       leagues;
    v_s1      seasons;
    v_s2      seasons;
    v_sess    sessions;
    v_m       session_matches;
    v_mem     league_members;
    v_i       integer;
    v_count   integer;
    v_byer1   uuid;
    v_byer2   uuid;
    v_expect  uuid;
    v_rules   jsonb;
    v_err     text;
    v_pts     integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_p := pg_temp.tennis_players(7);
    ASSERT array_length(v_p, 1) = 7, 'need 7 active non-admin tennis players';
    a := v_p[1]; b := v_p[2]; c := v_p[3]; d := v_p[4]; e := v_p[5]; f := v_p[6];
    v_org := v_p[7];

    -- ======================================================================
    -- ACT 1 — birth: approval league, capacity 6, waitlist; F ends up queued
    -- ======================================================================
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(
        p_name => '[LIFE] Full Cycle', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'approval');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 6, 'waitlist_enabled', true));

    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);                     -- approval mode -> pending
        PERFORM pg_temp.as_user(v_org);
        SELECT * INTO v_mem FROM league_members WHERE league_id = v_l.id AND user_id = v_p[v_i];
        PERFORM league_approve_member(v_mem.id, v_mem.version);
    END LOOP;
    ASSERT (SELECT count(*) FROM league_members WHERE league_id = v_l.id AND status = 'active') = 6,
        'organizer + five approved members fill the six seats';

    PERFORM pg_temp.as_user(f);
    SELECT * INTO v_mem FROM league_join(v_l.id);        -- full -> queued
    ASSERT v_mem.status = 'pending', 'F joins a full league and is queued';
    ASSERT (SELECT position FROM league_member_waitlist
             WHERE league_id = v_l.id AND user_id = f AND promoted_at IS NULL) = 1,
        'F holds queue position 1';

    RAISE NOTICE 'PASS 1: league born at capacity with F queued';

    -- ======================================================================
    -- ACT 2 — season 1: three sessions; the bye must remember prior sessions;
    -- churn (suspension + withdrawal) reshapes who the next session invites
    -- ======================================================================
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s1 FROM season_create(v_l.id, 'S1', current_date, current_date + 90);
    SELECT * INTO v_s1 FROM season_open(v_s1.id, v_s1.version);

    -- Session 1: A-E confirm (odd 5). Opening night, no history: the bye goes
    -- to the lowest user_id (all on zero byes, zero points) = A.
    SELECT * INTO v_sess FROM session_create(v_s1.id, 'S1 N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);

    v_byer1 := pg_temp.derived_byer(v_sess.id);
    ASSERT v_byer1 = a, 'opening night: the bye goes to the lowest user_id (A)';

    FOR v_m IN SELECT * FROM session_matches WHERE session_id = v_sess.id LOOP
        PERFORM session_record_score(v_m.id, 'a', '6-4 6-2', 'completed', v_m.version);
    END LOOP;
    ASSERT (SELECT status FROM sessions WHERE id = v_sess.id) = 'completed',
        'session 1 auto-completes when every match is scored';
    ASSERT (SELECT points FROM season_rankings WHERE season_id = v_s1.id AND user_id = a) = 1,
        'A''s full-session bye pays pointBye';

    -- Session 2: same five confirm. A now carries the season''s only prior
    -- bye, so the queue must bench someone else — the fewest-byes player with
    -- the lowest standing. This is the cross-session memory no other test runs.
    SELECT * INTO v_sess FROM session_create(v_s1.id, 'S1 N2', now() + interval '5 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);

    SELECT sp.user_id INTO v_expect
      FROM session_presence sp
      LEFT JOIN season_rankings sr ON sr.season_id = v_s1.id AND sr.user_id = sp.user_id
     WHERE sp.session_id = v_sess.id AND sp.status = 'confirmed'
     ORDER BY pg_temp.prior_byes(v_s1.id, sp.user_id) ASC,
              coalesce(sr.points, 0) ASC, sp.user_id ASC
     LIMIT 1;

    v_byer2 := pg_temp.derived_byer(v_sess.id);
    ASSERT v_byer2 <> a, 'session 2 must not bench A again';
    ASSERT v_byer2 = v_expect,
        format('session 2 bye must follow (prior byes, points, user_id): expected %s got %s',
               v_expect, v_byer2);
    ASSERT EXISTS (SELECT 1 FROM session_matches sm
                    WHERE sm.session_id = v_sess.id
                      AND a = ANY (sm.team_a_user_ids || sm.team_b_user_ids)),
        'A plays in session 2';

    FOR v_m IN SELECT * FROM session_matches WHERE session_id = v_sess.id LOOP
        PERFORM session_record_score(v_m.id, 'a', '6-3 6-3', 'completed', v_m.version);
    END LOOP;

    -- Churn between nights: E is suspended (a week), D withdraws from the
    -- season. Both must vanish from the NEXT session''s invite list; neither
    -- departure frees F''s seat (E''s is held, D is still a league member).
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_mem FROM league_members WHERE league_id = v_l.id AND user_id = e;
    PERFORM league_suspend_member(v_mem.id, v_mem.version, 'conduct', now() + interval '7 days');
    PERFORM pg_temp.as_user(d);
    PERFORM season_withdraw(v_s1.id);

    ASSERT (SELECT status FROM league_members WHERE league_id = v_l.id AND user_id = f) = 'pending',
        'neither a suspension nor a season withdrawal frees F''s seat';

    -- Session 3: only org + A + B + C are invited now.
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_create(v_s1.id, 'S1 N3', now() + interval '7 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    SELECT count(*) INTO v_count FROM session_presence WHERE session_id = v_sess.id;
    ASSERT v_count = 4, format('session 3 must invite only org+A+B+C, got %s rows', v_count);
    ASSERT NOT EXISTS (SELECT 1 FROM session_presence WHERE session_id = v_sess.id AND user_id IN (d, e)),
        'a suspended member and a season-withdrawn member are not invited';

    FOR v_i IN 1..3 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    ASSERT pg_temp.derived_byer(v_sess.id) IS NOT NULL, 'odd trio still yields a bye';
    FOR v_m IN SELECT * FROM session_matches WHERE session_id = v_sess.id LOOP
        PERFORM session_record_score(v_m.id, 'a', '7-5 7-5', 'completed', v_m.version);
    END LOOP;

    -- E comes back mid-season and is on the roster again.
    SELECT * INTO v_mem FROM league_members WHERE league_id = v_l.id AND user_id = e;
    PERFORM league_reinstate_member(v_mem.id, v_mem.version);
    ASSERT EXISTS (SELECT 1 FROM season_ranking_roster(v_s1.id) r WHERE r.user_id = e),
        'a reinstated member rejoins the free-season roster';

    -- Close season 1. D withdrew but PLAYED, so the population invariant keeps
    -- their line: six entries (org, A, B, C, E, D), D included.
    SELECT * INTO v_s1 FROM seasons WHERE id = v_s1.id;
    SELECT * INTO v_s1 FROM season_close(v_s1.id, v_s1.version);
    ASSERT v_s1.status = 'closed', 'season 1 closes';
    ASSERT jsonb_array_length(v_s1.final_standings) = 6,
        format('final standings must hold 6 lines, got %s', jsonb_array_length(v_s1.final_standings));
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_s1.final_standings) el
                    WHERE (el->>'user_id')::uuid = d),
        'D withdrew after playing: their results stay in the final standings';

    RAISE NOTICE 'PASS 2: season 1 — bye rotated across sessions, churn reshaped invites, standings kept D';

    -- ======================================================================
    -- ACT 3 — rules edit between seasons; D leaves for real, F is promoted
    -- and approved; season 2 scores under the NEW rules
    -- ======================================================================
    SELECT * INTO v_l FROM leagues WHERE id = v_l.id;
    v_rules := jsonb_set(v_l.default_rules, '{pointWin}', '20'::jsonb);
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('default_rules', v_rules));
    ASSERT (SELECT rules->>'pointWin' FROM seasons WHERE id = v_s1.id) = '10',
        'the closed season keeps its frozen rules';

    -- D''s league departure is the FIRST event that actually frees a seat:
    -- F is promoted — to pending, because the organizer decides on this league —
    -- and then approved into the vacancy.
    PERFORM pg_temp.as_user(d);
    PERFORM league_leave(v_l.id);
    ASSERT (SELECT promoted_at FROM league_member_waitlist
             WHERE league_id = v_l.id AND user_id = f) IS NOT NULL,
        'D''s departure consumes F''s queue entry';
    ASSERT (SELECT status FROM league_members WHERE league_id = v_l.id AND user_id = f) = 'pending',
        'approval league: F waits for the organizer, not auto-admitted';
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_mem FROM league_members WHERE league_id = v_l.id AND user_id = f;
    PERFORM league_approve_member(v_mem.id, v_mem.version);
    ASSERT (SELECT status FROM league_members WHERE league_id = v_l.id AND user_id = f) = 'active',
        'F finally holds a seat';

    SELECT * INTO v_s2 FROM season_create(v_l.id, 'S2', current_date, current_date + 90);
    ASSERT v_s2.rules->>'pointWin' = '20', 'season 2 freezes the edited rules';
    SELECT * INTO v_s2 FROM season_open(v_s2.id, v_s2.version);

    SELECT * INTO v_sess FROM session_create(v_s2.id, 'S2 N1', now() + interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    SELECT count(*) INTO v_count FROM session_presence WHERE session_id = v_sess.id;
    ASSERT v_count = 6, format('season 2 invites the reshaped roster (org,A,B,C,E,F), got %s', v_count);

    PERFORM pg_temp.as_user(a); PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(f); PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    SELECT * INTO v_m FROM session_matches WHERE session_id = v_sess.id;
    PERFORM session_record_score(v_m.id,
        (CASE WHEN a = ANY (v_m.team_a_user_ids) THEN 'a' ELSE 'b' END)::pairing_team,
        '6-2 6-2', 'completed'::session_match_status, v_m.version);

    SELECT points INTO v_pts FROM season_rankings WHERE season_id = v_s2.id AND user_id = a;
    ASSERT v_pts = 20, format('season 2 scores under the edited rules (pointWin 20), got %s', v_pts);
    ASSERT (SELECT points FROM season_rankings WHERE season_id = v_s2.id AND user_id = f) = 1,
        'F''s first game: a loss under default pointLoss';

    RAISE NOTICE 'PASS 3: rules edit frozen/live split holds; F''s waitlist arc completes; new rules score';

    -- ======================================================================
    -- ACT 4 — death: close refuses while a season is open; pause blocks joins;
    -- resume revives; close is terminal
    -- ======================================================================
    SELECT * INTO v_l FROM leagues WHERE id = v_l.id;
    BEGIN
        PERFORM league_close(v_l.id, 'done', v_l.version);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_HAS_OPEN_SEASONS',
        format('closing over an open season must refuse, got %s', v_err);

    SELECT * INTO v_s2 FROM seasons WHERE id = v_s2.id;
    SELECT * INTO v_s2 FROM season_close(v_s2.id, v_s2.version);

    SELECT * INTO v_l FROM leagues WHERE id = v_l.id;
    SELECT * INTO v_l FROM league_pause(v_l.id, v_l.version);
    ASSERT v_l.status = 'paused', 'league pauses';

    PERFORM pg_temp.as_user(d);   -- D tries to come back while paused
    BEGIN
        PERFORM league_join(v_l.id);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_NOT_ACTIVE', format('a paused league refuses joins, got %s', v_err);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_resume(v_l.id, v_l.version);
    ASSERT v_l.status = 'active', 'league resumes';

    SELECT * INTO v_l FROM league_close(v_l.id, 'season over, thanks everyone', v_l.version);
    ASSERT v_l.status = 'closed' AND v_l.closed_at IS NOT NULL, 'league closes';

    BEGIN
        PERFORM league_resume(v_l.id, v_l.version);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_NOT_PAUSED', format('closed is terminal — no resume, got %s', v_err);

    PERFORM pg_temp.as_user(d);
    BEGIN
        PERFORM league_join(v_l.id);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_NOT_ACTIVE', format('a closed league refuses joins, got %s', v_err);

    RAISE NOTICE 'PASS 4: pause blocks joins, resume revives, close is guarded and terminal';
END $$;

ROLLBACK;

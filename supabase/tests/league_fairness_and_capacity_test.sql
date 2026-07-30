-- ============================================
-- Leagues — bye rotation, bye credit, H2H, season exits, capacity/waitlist,
--           paid-session targeting, suspension expiry
-- ============================================
-- Regression cover for the five defects fixed by 20260730100000..100500, plus
-- the waitlist-lifecycle / capacity-coherence fixes (20260730120000) and the
-- ranking population invariant (20260730120100) in sections 11-15.
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_fairness_and_capacity_test.sql
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

-- --------------------------------------------------------------------------
-- 1. Odd roster over multiple rounds must not bench the same player throughout
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions;
    v_i integer; v_min integer; v_max integer; v_distinct integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(5);
    ASSERT array_length(v_p,1) = 5, 'need 5 active tennis players';
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Bye Rotation', p_sport_id=>v_sport, p_join_mode=>'open');
    FOR v_i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Multi', now()+interval '3 days',
        p_rounds => 3::smallint);
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);

    -- 5 confirmed x 3 rounds, one bye per round -> 2 matches/round = 6 rows.
    ASSERT (SELECT count(*) FROM session_matches WHERE session_id=v_sess.id) = 6,
        'expected 6 matches over 3 rounds';

    -- Every confirmed player plays at least twice and at most three times, and
    -- three different players take the bye. Before the fix this was 4 players
    -- at 3/3 and one at 0/3.
    SELECT min(c), max(c), count(*) FILTER (WHERE c < 3)
      INTO v_min, v_max, v_distinct
      FROM (
        SELECT sp.user_id, count(sm.id) AS c
          FROM session_presence sp
          LEFT JOIN session_matches sm
            ON sm.session_id = sp.session_id
           AND (sp.user_id = ANY(sm.team_a_user_ids) OR sp.user_id = ANY(sm.team_b_user_ids))
         WHERE sp.session_id = v_sess.id AND sp.status='confirmed'
         GROUP BY sp.user_id) x;

    ASSERT v_min >= 2, format('no player may sit out more than one round, min appearances = %s', v_min);
    ASSERT v_max = 3, format('someone must play every round, max appearances = %s', v_max);
    ASSERT v_distinct = 3, format('the bye must move round to round, byed players = %s', v_distinct);

    RAISE NOTICE 'PASS 1: odd roster rotates the bye across rounds';
END $$;

-- --------------------------------------------------------------------------
-- 2. A bye counts as attendance and pays pointBye
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions; v_m session_matches;
    v_i integer; v_byer uuid; v_rank season_rankings;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(6);
    v_org := v_p[6];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Bye Credit', p_sport_id=>v_sport, p_join_mode=>'open');
    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Odd night', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    -- 5 confirm (org + 4) -> odd
    PERFORM pg_temp.as_user(v_org);
    PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);

    SELECT sp.user_id INTO v_byer
      FROM session_presence sp
     WHERE sp.session_id = v_sess.id AND sp.status='confirmed'
       AND NOT EXISTS (SELECT 1 FROM session_matches sm
                        WHERE sm.session_id = v_sess.id
                          AND sp.user_id = ANY(sm.team_a_user_ids||sm.team_b_user_ids));
    ASSERT v_byer IS NOT NULL, 'expected one byed player';

    FOR v_m IN SELECT * FROM session_matches WHERE session_id = v_sess.id LOOP
        PERFORM session_record_score(v_m.id, 'a', '6-4 6-3', 'completed', v_m.version);
    END LOOP;

    ASSERT (SELECT status FROM sessions WHERE id=v_sess.id) = 'completed',
        'session should complete once every match is scored';

    SELECT * INTO v_rank FROM season_rankings WHERE season_id=v_s.id AND user_id=v_byer;
    -- default_rules.pointBye = 1
    ASSERT v_rank.points = 1,
        format('bye must pay pointBye (1), got %s', v_rank.points);
    ASSERT v_rank.sessions_attended = 1,
        format('a bye must count as attendance, got %s', v_rank.sessions_attended);
    ASSERT v_rank.matches_played = 0,
        format('a bye is not a match played, got %s', v_rank.matches_played);
    ASSERT v_rank.wins = 0 AND v_rank.losses = 0, 'a bye is neither a win nor a loss';

    RAISE NOTICE 'PASS 2: a bye pays pointBye and counts as attendance';
END $$;

-- --------------------------------------------------------------------------
-- 3. Head-to-head breaks an exact two-way tie on points
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions; v_m session_matches;
    v_winner uuid; v_loser uuid; v_wrank integer; v_lrank integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'H2H', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Duel', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM pg_temp.as_user(v_org);  PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_p[2]); PERFORM session_confirm_presence(v_sess.id, 'confirmed');

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    SELECT * INTO v_m FROM session_matches WHERE session_id=v_sess.id LIMIT 1;

    -- A beats B, then force both onto equal points so only H2H can separate
    -- them: the tie is what the ranker has to resolve.
    PERFORM session_record_score(v_m.id, 'a', '6-0 6-0', 'completed', v_m.version);
    v_winner := v_m.team_a_user_ids[1];
    v_loser  := v_m.team_b_user_ids[1];

    UPDATE season_rankings SET points = 10
     WHERE season_id = v_s.id AND user_id IN (v_winner, v_loser);
    -- Re-rank in place without recalc (which would reset the contrived points).
    WITH me AS (
        SELECT id, user_id, points, sets_won, sets_lost, games_won, games_lost,
               sessions_attended, sessions_eligible, tiebreak_seed,
               count(*) OVER (PARTITION BY points) AS tied_on_points
          FROM season_rankings WHERE season_id = v_s.id
    ), duel AS (
        SELECT w.user_id AS winner_id, l.user_id AS loser_id
          FROM session_matches sm JOIN sessions ss ON ss.id = sm.session_id
          CROSS JOIN LATERAL (SELECT unnest(CASE WHEN sm.winner_team='a'
                       THEN sm.team_a_user_ids ELSE sm.team_b_user_ids END) AS user_id) w
          CROSS JOIN LATERAL (SELECT unnest(CASE WHEN sm.winner_team='a'
                       THEN sm.team_b_user_ids ELSE sm.team_a_user_ids END) AS user_id) l
         WHERE ss.season_id = v_s.id AND ss.status <> 'cancelled' AND sm.is_drill = false
           AND sm.winner_team IS NOT NULL AND sm.status IN ('completed','retired','walkover')
    ), h2h AS (
        SELECT m.id, CASE WHEN m.tied_on_points = 2 THEN (
                 SELECT coalesce(count(*) FILTER (WHERE d.winner_id = m.user_id),0)
                      - coalesce(count(*) FILTER (WHERE d.loser_id  = m.user_id),0)
                   FROM duel d JOIN me o ON o.points = m.points AND o.user_id <> m.user_id
                  WHERE (d.winner_id = m.user_id AND d.loser_id  = o.user_id)
                     OR (d.loser_id  = m.user_id AND d.winner_id = o.user_id)
               ) ELSE 0 END AS h2h_edge FROM me m
    ), ranked AS (
        SELECT m.id, row_number() OVER (
            ORDER BY m.points DESC, coalesce(h.h2h_edge,0) DESC,
                     (m.sets_won-m.sets_lost) DESC, (m.games_won-m.games_lost) DESC,
                     m.tiebreak_seed ASC) AS rk
          FROM me m LEFT JOIN h2h h ON h.id = m.id
    )
    UPDATE season_rankings sr SET rank = ranked.rk FROM ranked WHERE sr.id = ranked.id;

    SELECT rank INTO v_wrank FROM season_rankings WHERE season_id=v_s.id AND user_id=v_winner;
    SELECT rank INTO v_lrank FROM season_rankings WHERE season_id=v_s.id AND user_id=v_loser;
    ASSERT v_wrank < v_lrank,
        format('H2H winner must rank above the player they beat (%s vs %s)', v_wrank, v_lrank);

    RAISE NOTICE 'PASS 3: head-to-head breaks a two-way tie';
END $$;

-- --------------------------------------------------------------------------
-- 4. Free-season exits leave the ranking roster
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sm season_members;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Free Exits', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_p[3]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);

    ASSERT (SELECT count(*) FROM season_ranking_roster(v_s.id)) = 3,
        'free season starts with every active league member on the roster';

    -- Voluntary withdrawal
    PERFORM pg_temp.as_user(v_p[2]);
    PERFORM season_enroll(v_s.id);
    PERFORM season_withdraw(v_s.id);
    ASSERT NOT EXISTS (SELECT 1 FROM season_ranking_roster(v_s.id) r WHERE r.user_id = v_p[2]),
        'a withdrawn free-season member must leave the roster';

    -- Organizer removal
    PERFORM pg_temp.as_user(v_p[3]);
    SELECT * INTO v_sm FROM season_enroll(v_s.id);
    PERFORM pg_temp.as_user(v_org);
    PERFORM season_remove_member(v_sm.id, v_sm.version);
    ASSERT NOT EXISTS (SELECT 1 FROM season_ranking_roster(v_s.id) r WHERE r.user_id = v_p[3]),
        'a removed free-season member must leave the roster';

    -- And the recalc drops their (result-free) rows.
    PERFORM recalc_season_ranking(v_s.id);
    ASSERT (SELECT count(*) FROM season_rankings WHERE season_id=v_s.id) = 1,
        'only the organizer should remain in the table';

    RAISE NOTICE 'PASS 4: free-season withdraw / removal leave the standings';
END $$;

-- --------------------------------------------------------------------------
-- 5. member_capacity is a cap in BOTH waitlist modes
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_m league_members;
    v_err text; v_pos integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(5);
    v_org := v_p[1];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Capped', p_sport_id=>v_sport, p_join_mode=>'open');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', true));

    PERFORM pg_temp.as_user(v_p[2]);
    PERFORM league_join(v_l.id);   -- 2nd active seat, now at capacity

    -- Third joiner is queued, NOT admitted. Before the fix they joined 'active'.
    PERFORM pg_temp.as_user(v_p[3]);
    SELECT * INTO v_m FROM league_join(v_l.id);
    ASSERT v_m.status = 'pending',
        format('a queued joiner must be pending, got %s', v_m.status);
    ASSERT (SELECT count(*) FROM league_members WHERE league_id=v_l.id AND status='active') = 2,
        'waitlist_enabled must not let the league exceed member_capacity';
    SELECT position INTO v_pos FROM league_member_waitlist
     WHERE league_id=v_l.id AND user_id=v_p[3] AND promoted_at IS NULL;
    ASSERT v_pos = 1, format('expected waitlist position 1, got %s', v_pos);

    -- A queued player is not an active member and is off the ranking roster.
    ASSERT NOT public.is_active_league_member(v_l.id),
        'a queued player must not count as an active member';

    -- Re-tapping Join keeps the same place rather than creating a second row.
    BEGIN PERFORM league_join(v_l.id); EXCEPTION WHEN OTHERS THEN NULL; END;
    ASSERT (SELECT count(*) FROM league_member_waitlist
             WHERE league_id=v_l.id AND user_id=v_p[3]) = 1,
        're-joining while queued must not duplicate the waitlist row';
    ASSERT (SELECT position FROM league_member_waitlist
             WHERE league_id=v_l.id AND user_id=v_p[3] AND promoted_at IS NULL) = 1,
        're-joining while queued must keep the original position';

    -- A seat frees up -> head of the queue is promoted automatically.
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2];
    PERFORM pg_temp.as_user(v_p[2]);
    PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[3]) = 'active',
        'freeing a seat must promote the head of the waitlist';
    ASSERT (SELECT promoted_at FROM league_member_waitlist
             WHERE league_id=v_l.id AND user_id=v_p[3]) IS NOT NULL,
        'the promoted queue row must be marked';

    RAISE NOTICE 'PASS 5: capacity enforced in both modes, waitlist queues and promotes';
END $$;

-- --------------------------------------------------------------------------
-- 6. waitlist_enabled = false still raises LEAGUE_FULL (unchanged)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_err text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(5);
    v_org := v_p[2];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Capped Hard', p_sport_id=>v_sport, p_join_mode=>'open');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 1, 'waitlist_enabled', false));

    PERFORM pg_temp.as_user(v_p[3]);
    BEGIN
        PERFORM league_join(v_l.id);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_FULL', format('expected LEAGUE_FULL, got %s', v_err);
    ASSERT (SELECT count(*) FROM league_member_waitlist WHERE league_id=v_l.id) = 0,
        'no queue row when the waitlist is off';

    RAISE NOTICE 'PASS 6: LEAGUE_FULL unchanged when the waitlist is off';
END $$;

-- --------------------------------------------------------------------------
-- 7. A paid season only seeds / notifies players who paid
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions; v_begin record;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[1];

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed,
                                       charges_enabled, payouts_enabled, details_submitted)
    VALUES (v_org, 'acct_test_paid_roster', true, true, true, true)
    ON CONFLICT (player_id) DO UPDATE
       SET onboarding_completed = true, charges_enabled = true;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Paid Roster', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_p[3]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'Paid', current_date, current_date+90,
        p_entry_fee_cents => 5000);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);

    -- One member pays; the webhook's finalisation is done here directly.
    PERFORM pg_temp.as_user(v_p[2]);
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_s.id);
    UPDATE lt_registration_payment
       SET status='succeeded', stripe_charge_id='ch_test', stripe_payment_intent_id='pi_test'
     WHERE id = v_begin.payment_id;
    UPDATE season_members SET status='enrolled', enrolled_at=now() WHERE id = v_begin.season_user_id;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Paid night', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    -- Before the fix this seeded all 3 active league members.
    ASSERT (SELECT count(*) FROM session_presence WHERE session_id=v_sess.id) = 1,
        format('paid season must seed only payers, got %s rows',
               (SELECT count(*) FROM session_presence WHERE session_id=v_sess.id));
    ASSERT EXISTS (SELECT 1 FROM session_presence WHERE session_id=v_sess.id AND user_id=v_p[2]),
        'the payer must get a presence row';
    ASSERT NOT EXISTS (SELECT 1 FROM session_presence WHERE session_id=v_sess.id AND user_id=v_p[3]),
        'a non-payer must not be invited to a paid session';

    RAISE NOTICE 'PASS 7: paid session targets the paid roster';
END $$;

-- --------------------------------------------------------------------------
-- 8. Free season still invites every active league member
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_s seasons; v_sess sessions;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[2];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Free Invite All', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[3]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_p[4]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'Free', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Free night', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    ASSERT (SELECT count(*) FROM session_presence WHERE session_id=v_sess.id) = 3,
        format('free season must invite all 3 active members, got %s',
               (SELECT count(*) FROM session_presence WHERE session_id=v_sess.id));

    RAISE NOTICE 'PASS 8: free season session invite is unchanged';
END $$;

-- --------------------------------------------------------------------------
-- 9. Payment is the only way onto a paid roster, including mid-refund
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions; v_begin record; v_sm season_members;
    v_err text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[4];

    INSERT INTO player_stripe_account (player_id, stripe_account_id, onboarding_completed,
                                       charges_enabled, payouts_enabled, details_submitted)
    VALUES (v_org, 'acct_test_enrol_guard', true, true, true, true)
    ON CONFLICT (player_id) DO UPDATE
       SET onboarding_completed = true, charges_enabled = true;

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Paid Guard', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'Paid', current_date, current_date+90,
        p_entry_fee_cents => 4000, p_refund_policy_kind => 'full',
        p_refund_cutoff_at => now() + interval '30 days');
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Night', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    -- Free enrolment is refused outright on a paid season.
    PERFORM pg_temp.as_user(v_p[1]);
    BEGIN PERFORM season_enroll(v_s.id); v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    ASSERT v_err = 'PAYMENT_REQUIRED', format('season_enroll on a paid season: got %s', v_err);

    -- So is confirming a session without having paid.
    BEGIN PERFORM session_confirm_presence(v_sess.id, 'confirmed'); v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    ASSERT v_err = 'PAYMENT_REQUIRED', format('unpaid confirm on a paid season: got %s', v_err);

    -- Pay, then confirm works.
    SELECT * INTO v_begin FROM season_begin_paid_enrollment(v_s.id);
    UPDATE lt_registration_payment
       SET status='succeeded', stripe_charge_id='ch_g', stripe_payment_intent_id='pi_g'
     WHERE id = v_begin.payment_id;
    UPDATE season_members SET status='enrolled', enrolled_at=now() WHERE id = v_begin.season_user_id;
    PERFORM session_confirm_presence(v_sess.id, 'confirmed');

    -- Request a refund. The ledger still reads 'succeeded' until the Stripe
    -- call lands, which is exactly the window that used to allow free re-entry.
    SELECT * INTO v_sm FROM season_members WHERE id = v_begin.season_user_id;
    PERFORM season_request_refund(v_sm.id, v_sm.version);
    ASSERT (SELECT status FROM lt_registration_payment WHERE id = v_begin.payment_id) = 'succeeded',
        'precondition: the ledger is still succeeded mid-refund';

    BEGIN PERFORM season_enroll(v_s.id); v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    ASSERT v_err = 'PAYMENT_REQUIRED',
        format('mid-refund re-enrol must be refused, got %s', v_err);

    BEGIN PERFORM session_confirm_presence(v_sess.id, 'confirmed'); v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    ASSERT v_err = 'PAYMENT_REQUIRED',
        format('mid-refund re-seat via confirm must be refused, got %s', v_err);

    RAISE NOTICE 'PASS 9: paid roster is payment-only, mid-refund included';
END $$;

-- --------------------------------------------------------------------------
-- 10. An expired suspension is lifted by the cron function
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_m league_members; v_n integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[3];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Suspensions', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1];
    PERFORM league_suspend_member(v_m.id, v_m.version, 'conduct', now() + interval '7 days');

    SELECT public.lt_lift_expired_suspensions() INTO v_n;
    ASSERT (SELECT status FROM league_members WHERE id=v_m.id) = 'suspended',
        'a suspension that has not expired must stay in place';

    -- Indefinite suspension is never auto-lifted.
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2];
    PERFORM league_suspend_member(v_m.id, v_m.version, 'indefinite', NULL);

    -- Expire the first one.
    UPDATE league_members SET suspended_until = now() - interval '1 hour'
     WHERE league_id=v_l.id AND user_id=v_p[1];
    SELECT public.lt_lift_expired_suspensions() INTO v_n;

    ASSERT v_n = 1, format('expected 1 lifted suspension, got %s', v_n);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1]) = 'active',
        'an expired suspension must return the member to active';
    ASSERT (SELECT suspended_until FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1]) IS NULL,
        'lifting must clear suspended_until';
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2]) = 'suspended',
        'an indefinite suspension must not be auto-lifted';

    RAISE NOTICE 'PASS 10: expired suspensions lift, indefinite ones do not';
END $$;

-- --------------------------------------------------------------------------
-- 11. Leaving while queued leaves the queue; a stale queue head never eats a
--     promotion slot
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(5);
    -- Organizers are spread across the pool: league_create is rate-limited to
    -- 5 per 24h per user, and sections 1-10 already spent v_p[1]'s quota.
    v_org := v_p[5];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Queue Exits', p_sport_id=>v_sport, p_join_mode=>'open');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', true));

    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);  -- seat 2/2
    PERFORM pg_temp.as_user(v_p[3]); PERFORM league_join(v_l.id);  -- queued

    -- The queued player leaves: membership inactive AND queue row gone.
    PERFORM league_leave(v_l.id);
    ASSERT NOT EXISTS (SELECT 1 FROM league_member_waitlist
                        WHERE league_id=v_l.id AND user_id=v_p[3] AND promoted_at IS NULL),
        'leaving while queued must delete the un-promoted queue row';

    -- A seat frees: the departed player must NOT be re-admitted.
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[3]) = 'inactive',
        'a player who left the queue must not be promoted back in';

    -- Stale-head guard: p4 and p5 queue up; p4''s membership goes stale through
    -- a simulated missed cleanup (direct update, no queue delete). The freed
    -- seat must go to p5, skipping the stale head.
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);  -- back to 2/2
    PERFORM pg_temp.as_user(v_p[4]); PERFORM league_join(v_l.id);  -- queued pos 1
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);  -- queued pos 2
    UPDATE league_members SET status='inactive' WHERE league_id=v_l.id AND user_id=v_p[4];

    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1]) = 'active',
        'the freed seat must go to the first candidate still waiting';
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[4]) = 'inactive',
        'a stale queue head must not be promoted';

    RAISE NOTICE 'PASS 11: queue exits are honoured and stale heads are skipped';
END $$;

-- --------------------------------------------------------------------------
-- 12. Approval is capacity-gated; a freed seat routes the queue head through
--     the organizer on an approval league
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_m league_members; v_err text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[3];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Approve Cap', p_sport_id=>v_sport, p_join_mode=>'approval');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', true));

    -- p1 requests while a seat is free and is approved onto it (2/2).
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1];
    PERFORM league_approve_member(v_m.id, v_m.version);

    -- p2 joins a full league -> queued. Approving them must now refuse.
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2];
    BEGIN
        PERFORM league_approve_member(v_m.id, v_m.version);
        v_err := '(no error)';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'LEAGUE_FULL', format('approve past capacity must refuse, got %s', v_err);
    ASSERT (SELECT count(*) FROM league_members WHERE league_id=v_l.id AND status='active') = 2,
        'the cap must bind approvals too';

    -- A seat frees: on an approval league the head is promoted to pending (the
    -- organizer still decides) with the queue row consumed; approving now works.
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2]) = 'pending',
        'approval league: a freed seat keeps the head at pending for the organizer';
    ASSERT (SELECT promoted_at FROM league_member_waitlist
             WHERE league_id=v_l.id AND user_id=v_p[2]) IS NOT NULL,
        'promotion must consume the queue row';

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2];
    PERFORM league_approve_member(v_m.id, v_m.version);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2]) = 'active',
        'approving into a free seat must succeed';

    RAISE NOTICE 'PASS 12: approvals respect the cap and consume queue entries';
END $$;

-- --------------------------------------------------------------------------
-- 13. Removing a queued player clears their queue entry
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_m league_members;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[4];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Remove Queued', p_sport_id=>v_sport, p_join_mode=>'open');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', true));

    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);  -- seat 2/2
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);  -- queued

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2];
    PERFORM league_remove_member(v_m.id, v_m.version);
    ASSERT NOT EXISTS (SELECT 1 FROM league_member_waitlist
                        WHERE league_id=v_l.id AND user_id=v_p[2] AND promoted_at IS NULL),
        'removing a queued player must delete their queue row';

    -- The next freed seat promotes nobody (queue is empty), rather than
    -- resurrecting the removed player.
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[2]) = 'inactive',
        'a removed player must stay out when a seat frees';

    RAISE NOTICE 'PASS 13: organizer removal clears the queue entry';
END $$;

-- --------------------------------------------------------------------------
-- 14. A suspension holds its seat: walk-ins cannot take it, and it frees
--     (promoting the queue) only on the permanent departure
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_l leagues; v_m league_members; v_j league_members;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[2];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Held Seat', p_sport_id=>v_sport, p_join_mode=>'open');
    SELECT * INTO v_l FROM league_update(v_l.id, v_l.version,
        jsonb_build_object('member_capacity', 2, 'waitlist_enabled', true));
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);  -- seat 2/2

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_m FROM league_members WHERE league_id=v_l.id AND user_id=v_p[1];
    PERFORM league_suspend_member(v_m.id, v_m.version, 'conduct', now() + interval '7 days');

    -- Before 20260730120000 the suspension opened the seat to walk-ins: only
    -- 'active' rows counted, so this join landed active past the held seat.
    PERFORM pg_temp.as_user(v_p[3]);
    SELECT * INTO v_j FROM league_join(v_l.id);
    ASSERT v_j.status = 'pending',
        format('a suspended member''s seat must not go to a walk-in, got %s', v_j.status);
    ASSERT EXISTS (SELECT 1 FROM league_member_waitlist
                    WHERE league_id=v_l.id AND user_id=v_p[3] AND promoted_at IS NULL),
        'the walk-in must be queued instead';

    -- The suspended member leaves for good: NOW the seat frees and the queue
    -- head is promoted (suspended -> inactive fires the trigger since 120000).
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_leave(v_l.id);
    ASSERT (SELECT status FROM league_members WHERE league_id=v_l.id AND user_id=v_p[3]) = 'active',
        'the permanent departure of a suspended member must promote the queue head';

    RAISE NOTICE 'PASS 14: suspended seats are held from walk-ins and free on departure';
END $$;

-- --------------------------------------------------------------------------
-- 15. A result landing after the player's exit resurrects their ranking row
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid;
    v_l leagues; v_s seasons; v_sess sessions; v_m session_matches;
    v_row season_rankings;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name='tennis';
    v_p := pg_temp.tennis_players(4);
    v_org := v_p[4];

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_l FROM league_create(p_name=>'Late Score', p_sport_id=>v_sport, p_join_mode=>'open');
    PERFORM pg_temp.as_user(v_p[1]); PERFORM league_join(v_l.id);
    PERFORM pg_temp.as_user(v_p[2]); PERFORM league_join(v_l.id);

    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date+90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, 'Night', now()+interval '3 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    PERFORM pg_temp.as_user(v_p[1]); PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_p[2]); PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_sess FROM session_generate_sheet(v_sess.id, v_sess.version);
    SELECT * INTO v_m FROM session_matches WHERE session_id=v_sess.id LIMIT 1;

    -- The night is played; p1 withdraws before the score is entered, and a
    -- recalc fires in that window (any other result in the season triggers
    -- one). Their result-free row is legitimately pruned here.
    PERFORM pg_temp.as_user(v_p[1]);
    PERFORM season_withdraw(v_s.id);
    PERFORM recalc_season_ranking(v_s.id);
    ASSERT NOT EXISTS (SELECT 1 FROM season_rankings WHERE season_id=v_s.id AND user_id=v_p[1]),
        'precondition: the result-free row is pruned in the window';

    -- The score lands (p1 won). The population predicate must bring the row
    -- back with the result tallied — before 20260730120100 it was gone for good.
    PERFORM pg_temp.as_user(v_org);
    PERFORM session_record_score(v_m.id,
        (CASE WHEN v_m.team_a_user_ids[1] = v_p[1] THEN 'a' ELSE 'b' END)::pairing_team,
        '6-0 6-0', 'completed'::session_match_status, v_m.version);
    PERFORM recalc_season_ranking(v_s.id);

    SELECT * INTO v_row FROM season_rankings WHERE season_id=v_s.id AND user_id=v_p[1];
    ASSERT v_row.id IS NOT NULL, 'a played result must resurrect the ranking row';
    ASSERT v_row.wins = 1 AND v_row.points = 10,
        format('the resurrected row must carry the result (wins=%s, points=%s)', v_row.wins, v_row.points);
    ASSERT v_row.sessions_attended = 1, 'the resurrected row must carry attendance';
    ASSERT NOT EXISTS (SELECT 1 FROM season_ranking_roster(v_s.id) r WHERE r.user_id = v_p[1]),
        'the withdrawn player stays OFF the roster (not re-invited) — only the row returns';

    RAISE NOTICE 'PASS 15: late-landing results resurrect the pruned ranking row';
END $$;

ROLLBACK;

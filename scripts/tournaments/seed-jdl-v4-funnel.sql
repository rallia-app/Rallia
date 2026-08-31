-- ============================================================================
-- [JDL v4] staging fixtures — the scheduling funnel, end to end
-- ============================================================================
-- Three pool tournaments under the '[JDL v4]' prefix, one per thing to walk:
--
--   Le parcours   Jean is registered and has NOT answered the gate. This is
--                 the forcing function: the pool room is readable but its
--                 composer is locked, the board names who everyone is waiting
--                 on, and the only way in is "Donner mes dispos". Once he
--                 answers, the rooms of the opponents who have also answered
--                 open with a card of mutual slots, one of his pairings can be
--                 nudged (that opponent is silent), and every pairing can be
--                 conceded.
--
--   L'entente     Jean has answered and an OPPONENT has already booked, so he
--                 lands on the tentative band: "Ça marche" makes the agreement
--                 firm at once, "Proposer un autre moment" cancels it without
--                 penalty and offers his slot instead. One counter per side.
--
--   L'échéance    The deadline has PASSED and the ladder has already decided,
--                 for real, by running lt_resolve_due_tournament_matches. The
--                 board therefore shows genuine outcomes side by side: a
--                 walkover Jean won by being the only one who tried, a double
--                 forfait between two silent sides, a game cancelled because
--                 both tried and neither is at fault, and a real played score.
--                 Jean organizes this one so he sees both pools, not just his.
--                 Undoing a decision is an RPC only for now
--                 (lt_restore_tournament_match), so it is not in the guide.
--
--   L'impasse     A KNOCKOUT whose deadline has passed, where one semi is the
--                 case the pool fixtures cannot show: both players answered
--                 the gate and NEITHER ever proposed a time. A pool cancels
--                 that game, but a knockout slot has to send someone forward,
--                 so the app refuses to pick on form quality and hands it to
--                 the organizer. Jean organizes and also plays: his own semi
--                 resolves normally, and the final cannot be run until he
--                 settles the other one.
--
-- Every event has scheduling_funnel_enabled = true. Nothing else on staging
-- does, and the ladder only acts where it is on, so these fixtures cannot
-- affect any other event.
--
-- Idempotent: cleans '[JDL v4]%' (and their notifications) first.
-- Run:  npm run db:seed:tournaments:jdl-v4        (requires STAGING_DB_URL)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cleanup, in normal replication mode so the cascades actually fire.
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM tournaments WHERE name LIKE '[JDL v4]%')
    OR target_id IN (SELECT tm.id FROM tournament_matches tm
                       JOIN tournaments t ON t.id = tm.tournament_id
                      WHERE t.name LIKE '[JDL v4]%');
DELETE FROM reputation_event
 WHERE (metadata ->> 'tournamentId')::uuid IN
       (SELECT id FROM tournaments WHERE name LIKE '[JDL v4]%');
DELETE FROM conversation
 WHERE tournament_id IN (SELECT id FROM tournaments WHERE name LIKE '[JDL v4]%');
DELETE FROM tournaments WHERE name LIKE '[JDL v4]%';

-- Suppresses the push dispatch: notification ROWS still land, no real wave
-- leaves for the fixture players. Set AFTER the cleanup, on purpose: replica
-- mode also disables the FK triggers, so cascades silently do nothing.
SET LOCAL session_replication_role = replica;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.jdl() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
$$;

-- Offsets 60+ keep these rosters clear of the [JDL v2] and [JDL v3] leagues.
-- A pool event needs 8, 12, 16, 20, 24 or 32 seats, so each roster is 8:
-- Jean plus seven, drawn into two pools of four.
CREATE OR REPLACE FUNCTION pg_temp.fakes(p_offset integer, n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(id) FROM (
    SELECT u.id
      FROM auth.users u
      JOIN player_sport ps ON ps.player_id = u.id
      JOIN sport s ON s.id = ps.sport_id AND s.name = 'tennis'
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.is_active
       AND NOT public.is_admin(u.id)
       AND u.id IS DISTINCT FROM pg_temp.jdl()
     ORDER BY u.email OFFSET p_offset LIMIT n) t;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- A knockout event with the funnel on, its roster registered and drawn.
CREATE OR REPLACE FUNCTION pg_temp.mk_ko_event(
    p_org uuid, p_name text, p_roster uuid[], p_deadline timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t   tournaments;
    v_ver integer;
    v_u   uuid;
BEGIN
    PERFORM pg_temp.as_user(p_org);
    PERFORM pg_temp.staff_on(p_org);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name, (SELECT id FROM sport WHERE name = 'tennis'),
        array_length(p_roster, 1)::smallint,
        now() - interval '10 days', now() + interval '20 days');
    PERFORM pg_temp.staff_off(p_org);

    UPDATE tournaments
       SET scheduling_funnel_enabled = true, min_availability_hours = 6
     WHERE id = v_t.id;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOREACH v_u IN ARRAY p_roster LOOP
        PERFORM pg_temp.as_user(v_u);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

    PERFORM public.tournament_set_round_deadlines(
        v_t.id, jsonb_build_array(jsonb_build_object(
            'bracket_side', 'main', 'round_number', 1,
            'deadline_at', GREATEST(p_deadline, now() + interval '7 days'))));
    UPDATE tournament_round_deadlines
       SET deadline_at = p_deadline
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;

    UPDATE tournament_matches
       SET deadline_nudge48_at = now() - interval '3 days',
           deadline_nudge12_at = now() - interval '2 days'
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;

    RETURN v_t.id;
END;
$$;

-- A pool event with the funnel on, its roster registered and its pools drawn.
CREATE OR REPLACE FUNCTION pg_temp.mk_pool_event(
    p_org uuid, p_name text, p_roster uuid[], p_deadline timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t   tournaments;
    v_ver integer;
    v_u   uuid;
BEGIN
    PERFORM pg_temp.as_user(p_org);
    PERFORM pg_temp.staff_on(p_org);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name, (SELECT id FROM sport WHERE name = 'tennis'),
        array_length(p_roster, 1)::smallint,
        now() - interval '10 days', now() + interval '20 days',
        p_bracket_type => 'pool_knockout'::bracket_type,
        p_pool_size => 4::smallint, p_qualifiers_per_pool => 2::smallint);
    PERFORM pg_temp.staff_off(p_org);

    UPDATE tournaments
       SET scheduling_funnel_enabled = true, min_availability_hours = 6
     WHERE id = v_t.id;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOREACH v_u IN ARRAY p_roster LOOP
        PERFORM pg_temp.as_user(v_u);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- The RPC refuses a deadline in the past, rightly. Set a real one through
    -- it so the round is stamped the way an organizer would, then backdate the
    -- row directly when the fixture wants an expired round.
    PERFORM public.tournament_set_round_deadlines(
        v_t.id, jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', GREATEST(p_deadline, now() + interval '7 days'))));
    UPDATE tournament_round_deadlines
       SET deadline_at = p_deadline
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;

    -- The prompts the protocol needs before anything may penalise anyone.
    UPDATE tournament_matches
       SET deadline_nudge48_at = now() - interval '3 days',
           deadline_nudge12_at = now() - interval '2 days'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';

    RETURN v_t.id;
END;
$$;

-- A gate answer, in the state the guide names.
--   'engaged' answered at once with a full grid
--   'passive' skipped, and late: aware, but nothing offered
--   (no call at all leaves the side unreached)
CREATE OR REPLACE FUNCTION pg_temp.gate(p_t uuid, p_user uuid, p_state text,
                                        p_side text DEFAULT 'pool', p_round int DEFAULT 0)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, p_side, p_round, p_user,
         CASE WHEN p_state = 'engaged' THEN 'edited' ELSE 'skipped' END,
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = p_side)
           + CASE WHEN p_state = 'engaged' THEN interval '2 hours' ELSE interval '6 days' END,
         CASE WHEN p_state = 'engaged' THEN 14 ELSE 0 END,
         CASE WHEN p_state = 'engaged'
              THEN '[{"day":"monday","hour":18},{"day":"monday","hour":19},
                     {"day":"tuesday","hour":18},{"day":"wednesday","hour":19},
                     {"day":"thursday","hour":18},{"day":"saturday","hour":10},
                     {"day":"sunday","hour":10}]'::jsonb
              ELSE '[]'::jsonb END
  ON CONFLICT (tournament_id, bracket_side, round_number, player_id) DO UPDATE
    SET outcome = EXCLUDED.outcome, responded_at = EXCLUDED.responded_at,
        hours_in_window = EXCLUDED.hours_in_window,
        grid_snapshot = EXCLUDED.grid_snapshot;
$$;

DO $$
DECLARE
    v_jdl   uuid := pg_temp.jdl();
    v_a     uuid;
    v_b     uuid;
    v_c     uuid;
    v_d     uuid;
    v_r     uuid[];
    v_tm    tournament_matches;
    v_match uuid;
    v_opp   uuid;
    v_n      int;
    v_pool   smallint;
    v_mates  uuid[];
    v_others uuid[];
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION 'jdl.sonkin@gmail.com not found: seed staging first';
    END IF;

    -- ===================================================== A. Le parcours
    -- Jean has NOT answered. Two opponents have, one has not, so after he
    -- answers he gets two open rooms and one row to nudge.
    v_r := ARRAY[v_jdl] || pg_temp.fakes(60, 7);
    v_a := pg_temp.mk_pool_event(v_jdl, '[JDL v4] Le parcours', v_r,
                                 now() + interval '12 days');
    PERFORM pg_temp.gate(v_a, v_r[2], 'engaged');
    PERFORM pg_temp.gate(v_a, v_r[3], 'engaged');
    -- v_r[4] never answers: that is the row with "Rappeler" on it.

    -- ===================================================== B. L'entente
    -- Everyone answered, and an opponent has already booked one of Jean's
    -- games, so he lands on the tentative band with 24 h to answer.
    v_r := ARRAY[v_jdl] || pg_temp.fakes(68, 7);
    v_b := pg_temp.mk_pool_event(v_jdl, '[JDL v4] L''entente', v_r,
                                 now() + interval '12 days');
    FOR v_n IN 1..array_length(v_r, 1) LOOP
        PERFORM pg_temp.gate(v_b, v_r[v_n], 'engaged');
    END LOOP;

    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_b AND tm.bracket_side = 'pool'
       AND v_jdl IN (r1.user_id, r2.user_id)
     ORDER BY tm.match_position LIMIT 1;

    SELECT CASE WHEN r1.user_id = v_jdl THEN r2.user_id ELSE r1.user_id END
      INTO v_opp
      FROM tournament_registrations r1, tournament_registrations r2
     WHERE r1.id = v_tm.player1_registration_id AND r2.id = v_tm.player2_registration_id;

    -- Built directly rather than through the card: the options engine needs
    -- facilities near these fixtures to offer anything, and the point here is
    -- the tentative band, not the engine.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time)
    VALUES ((SELECT id FROM sport WHERE name = 'tennis'), v_opp,
            (now() + interval '3 days')::date, '19:00', '20:30')
    RETURNING id INTO v_match;
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_match, v_opp, 1, 'joined'), (v_match, v_jdl, 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET team_number = EXCLUDED.team_number, status = 'joined';
    UPDATE tournament_matches SET match_id = v_match WHERE id = v_tm.id;
    INSERT INTO lt_pairing_booking
        (tournament_match_id, match_id, booked_by, booked_at, tentative_until)
    VALUES (v_tm.id, v_match, v_opp, now() - interval '2 hours',
            now() + interval '22 hours');

    -- ===================================================== C. L'échéance
    -- The deadline has passed and the ladder decides for real below, so the
    -- board shows outcomes it actually produced rather than ones we typed.
    v_r := ARRAY[v_jdl] || pg_temp.fakes(76, 7);
    v_c := pg_temp.mk_pool_event(v_jdl, '[JDL v4] L''échéance', v_r,
                                 now() - interval '2 hours');
    -- Roles are assigned from the draw, not guessed: the eight are split into
    -- two pools and which pool Jean lands in is the generator's business.
    SELECT tm.pool_number INTO v_pool
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_c AND tm.bracket_side = 'pool'
       AND v_jdl IN (r1.user_id, r2.user_id)
     LIMIT 1;

    SELECT array_agg(u ORDER BY u) INTO v_mates FROM (
        SELECT DISTINCT r.user_id AS u
          FROM tournament_matches tm
          JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE tm.tournament_id = v_c AND tm.bracket_side = 'pool'
           AND tm.pool_number = v_pool AND r.user_id <> v_jdl) s;

    -- Jean's pool, so his own board carries one of every outcome:
    --   he tried; mate 1 and mate 3 knew and did nothing; mate 2 tried too and
    --   their game gets played for real below. The ladder then hands Jean two
    --   walkovers, mate 2 two more, and mates 1 and 3 a double forfait.
    PERFORM pg_temp.gate(v_c, v_jdl,       'engaged');
    PERFORM pg_temp.gate(v_c, v_mates[1],  'passive');
    PERFORM pg_temp.gate(v_c, v_mates[2],  'engaged');
    PERFORM pg_temp.gate(v_c, v_mates[3],  'passive');

    -- The other pool carries the fourth outcome: two who tried equally hard and
    -- still did not play. Nobody is at fault, so that game is cancelled rather
    -- than forfeited and leaves the denominator. The two passives below give it
    -- a double forfait to sit next to.
    FOR v_n IN 1..array_length(v_r, 1) LOOP
        CONTINUE WHEN v_r[v_n] = v_jdl OR v_r[v_n] = ANY (v_mates);
        IF v_others IS NULL THEN v_others := ARRAY[v_r[v_n]];
        ELSE v_others := v_others || v_r[v_n];
        END IF;
    END LOOP;
    PERFORM pg_temp.gate(v_c, v_others[1], 'engaged');
    PERFORM pg_temp.gate(v_c, v_others[2], 'engaged');
    PERFORM pg_temp.gate(v_c, v_others[3], 'passive');
    PERFORM pg_temp.gate(v_c, v_others[4], 'passive');

    -- One pairing is genuinely played, so a real score sits beside the
    -- decisions rather than every row being an automated outcome. Scores are
    -- player1-first, so Jean's 8-5 win is stored as '5-8' when the draw put
    -- him on player2: the card is what flips it back around for the reader.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_c AND tm.bracket_side = 'pool'
       AND r1.user_id IN (v_jdl, v_mates[2]) AND r2.user_id IN (v_jdl, v_mates[2])
     LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'no Jean/mate-2 pairing found in pool %', v_pool;
    END IF;
    UPDATE tournament_matches tm
       SET status = 'completed',
           score = CASE WHEN r1.user_id = v_jdl THEN '8-5' ELSE '5-8' END,
           winner_registration_id =
               CASE WHEN r1.user_id = v_jdl THEN tm.player1_registration_id
                    ELSE tm.player2_registration_id END,
           played_at = now() - interval '1 day'
      FROM tournament_registrations r1
     WHERE tm.id = v_tm.id AND r1.id = tm.player1_registration_id;

    -- The real ladder, on the real evidence.
    PERFORM public.lt_resolve_due_tournament_matches(false);

    -- ===================================================== D. L'impasse
    -- The case a pool cannot show. Both sides of one semi answer the gate and
    -- neither ever proposes a time: a pool would simply cancel that game, but
    -- a knockout slot has to send somebody forward, and separating them on how
    -- generously they filled the grid is not what the app told them the
    -- deadline decides. So it refuses, and asks the organizer.
    -- Offset 40 rather than 84: the pool rosters run to 83 and there are only
    -- ~85 fixture players, so anything higher silently returns a short roster
    -- and tournament_create refuses the field size.
    v_r := ARRAY[v_jdl] || pg_temp.fakes(40, 3);
    v_d := pg_temp.mk_ko_event(v_jdl, '[JDL v4] L''impasse', v_r,
                               now() - interval '3 hours');

    -- Jean's own semi resolves the ordinary way, so the fixture shows the
    -- normal path and the refusal side by side.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_d AND tm.round_number = 1
       AND v_jdl IN (r1.user_id, r2.user_id)
     LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'no semi found for Jean in the knockout fixture';
    END IF;

    FOR v_n IN 1..array_length(v_r, 1) LOOP
        -- Everyone answers, so nobody is Unreached and every side is Engaged.
        -- Jean answers generously, the rest thinly: enough of a gap that the
        -- old code would have picked a winner in BOTH semis.
        PERFORM pg_temp.gate(v_d, v_r[v_n],
                             CASE WHEN v_r[v_n] = v_jdl THEN 'engaged' ELSE 'passive' END,
                             'main', 1);
    END LOOP;
    -- ...except Jean's opponent, who is left passive so that semi is a plain
    -- one-sided walkover rather than the refusal.
    SELECT array_agg(u) INTO v_mates FROM (
        SELECT DISTINCT r.user_id AS u
          FROM tournament_matches tm2
          JOIN tournament_registrations r
            ON r.id IN (tm2.player1_registration_id, tm2.player2_registration_id)
         WHERE tm2.tournament_id = v_d AND tm2.round_number = 1
           AND tm2.id <> v_tm.id) s;
    -- The other semi: both engaged, evenly, and neither ever reaches out.
    PERFORM pg_temp.gate(v_d, v_mates[1], 'engaged', 'main', 1);
    PERFORM pg_temp.gate(v_d, v_mates[2], 'engaged', 'main', 1);

    PERFORM public.lt_resolve_due_tournament_matches(false);

    RAISE NOTICE '[JDL v4] parcours=%  entente=%  echeance=%  impasse=%', v_a, v_b, v_c, v_d;
END;
$$;

-- What Jean will be looking at.
SELECT t.name,
       count(*) FILTER (WHERE tm.status = 'pending')   AS a_jouer,
       count(*) FILTER (WHERE tm.status = 'walkover')  AS forfaits,
       count(*) FILTER (WHERE tm.status = 'cancelled') AS annulees,
       count(*) FILTER (WHERE tm.status = 'completed') AS jouees
  FROM tournaments t
  JOIN tournament_matches tm ON tm.tournament_id = t.id
 WHERE t.name LIKE '[JDL v4]%'
 GROUP BY t.name ORDER BY t.name;

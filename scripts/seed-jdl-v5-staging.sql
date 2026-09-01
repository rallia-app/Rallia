-- ============================================================================
-- [JDL v5] staging fixtures — what shipped in 1.4.0 with nothing to walk on
-- ============================================================================
-- The [JDL v4] set covers the scheduling funnel and the arbitration ladder.
-- This one covers what landed beside it and had no fixture anywhere:
--
--   A. [JDL v5] Mon score    Jean is a PLAIN PARTICIPANT, never the organizer
--                            (is_admin and is_tournament_organizer both bypass
--                            the guards under test). One pairing was played and
--                            never created as a game, so its chat carries the
--                            "enter the score" banner; a second is already
--                            scored as the negative control.
--
--   B. [JDL v5] Le double    A DOUBLES pool past its deadline. Jean answered,
--                            his PARTNER never did. The pair loses the pairing,
--                            which is correct, but the reputation mark has to
--                            land on the partner alone. Before 77776ec2 both
--                            took it.
--
--   C. [JDL v5] présence     Three games starting in 5 minutes and running 4
--                            hours, so the check-in window is open on arrival:
--                            one at a facility (the geofence still applies), one
--                            at a named place with no coordinates (what 2e205bbe
--                            unblocked), and one with no place at all, which the
--                            server accepts but the app still will not offer.
--
--   D. [JDL v5] récurrente   Two weekly series Jean hosts: one whose next
--                            occurrence the real generator has already created,
--                            with a court opening inside its window, and one
--                            still live so the cancel dialog's "stop repeating
--                            too" has something to stop.
--
--   E. [JDL v5] Crédit       A credit on Jean's account and two paid house
--                            events priced off his REAL balance: one it covers
--                            exactly (no card, Stripe skipped) and one it covers
--                            partly (test card needed). The CTA price is the
--                            thing to check.
--
--   F. [JDL v5] invitation   A pending invite on a game 2-6 hours out, sent over
--                            an hour ago, so the 15-minute cron sends the
--                            reminder August's invitees never got.
--
--   G. [JDL v5] pour toi     One public game at his exact rating, with a spot
--                            open, at a facility the seed favourites for him, so
--                            the "Pour toi" preset has a guaranteed hit instead
--                            of being judged against an empty feed.
--
-- Namespaced '[JDL v5]' throughout: tournaments by name, casual games by
-- match.notes (which the recurrence generator copies onto each occurrence), so
-- the cleanup script can find all of it.
--
-- SAME-DAY: C (check-in windows) and F (the 2-6 hour invite window) are anchored
-- to the moment this runs and go stale overnight. Reseed on the morning of the
-- test pass. A, B, D and E keep for days.
--
-- Idempotent. Run:  npm run db:seed:jdl-v5        (requires STAGING_DB_URL)
-- ============================================================================

\set ON_ERROR_STOP on

-- The tester. Defaults to Jean on staging; override to develop against a local
-- account:  psql ... -v tester_email=you@example.com
\if :{?tester_email}
\else
\set tester_email 'jdl.sonkin@gmail.com'
\endif

-- ---------------------------------------------------------------------------
-- Cleanup, in NORMAL replication mode so the cascades actually fire. Replica
-- mode disables the FK triggers too, which is how reseeds silently orphaned
-- children for three weeks (ecc221fd).
-- ---------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM tournaments WHERE name LIKE '[JDL v5]%')
    OR target_id IN (SELECT tm.id FROM tournament_matches tm
                       JOIN tournaments t ON t.id = tm.tournament_id
                      WHERE t.name LIKE '[JDL v5]%')
    OR target_id IN (SELECT id FROM match WHERE notes LIKE '[JDL v5]%');
DELETE FROM reputation_event
 WHERE (metadata ->> 'tournamentId')::uuid IN
       (SELECT id FROM tournaments WHERE name LIKE '[JDL v5]%');
DELETE FROM conversation
 WHERE tournament_id IN (SELECT id FROM tournaments WHERE name LIKE '[JDL v5]%');
DELETE FROM tournaments WHERE name LIKE '[JDL v5]%';

DELETE FROM match_recurrence
 WHERE template_match_id IN (SELECT id FROM match WHERE notes LIKE '[JDL v5]%');
DELETE FROM facility_availability_snapshot WHERE source = 'jdl-v5-fixture';
DELETE FROM match WHERE notes LIKE '[JDL v5]%';
DELETE FROM player_credit WHERE source = 'jdl_v5_fixture';

-- Suppresses the push dispatch: notification ROWS still land, no real wave
-- leaves for the fixture players. Set AFTER the cleanup, on purpose.
SET session_replication_role = replica;

-- psql does not interpolate inside dollar quotes, so the tester travels into
-- the helpers as a session setting rather than as a literal.
SELECT set_config('rallia.tester_email', :'tester_email', false);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.jdl() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM auth.users WHERE email = current_setting('rallia.tester_email');
$$;

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

-- The same three gate states the [JDL v4] fixtures use, so both sets read alike.
CREATE OR REPLACE FUNCTION pg_temp.gate(p_t uuid, p_user uuid, p_state text,
                                        p_side text DEFAULT 'pool', p_round int DEFAULT 0)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, p_side, p_round, p_user,
         CASE WHEN p_state IN ('engaged', 'thin') THEN 'edited' ELSE 'skipped' END,
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = p_side)
           + CASE WHEN p_state = 'engaged' THEN interval '2 hours'
                  WHEN p_state = 'thin'    THEN interval '4 days'
                  ELSE interval '6 days' END,
         CASE WHEN p_state = 'engaged' THEN 14
              WHEN p_state = 'thin'    THEN 3
              ELSE 0 END,
         CASE WHEN p_state IN ('engaged', 'thin')
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

-- A pool event. p_org is who creates it, which for fixture A is deliberately
-- NOT Jean. max_participants counts ENTRIES, so a doubles field of 8 is 8 pairs.
CREATE OR REPLACE FUNCTION pg_temp.mk_pool_event(
    p_org uuid, p_name text, p_roster uuid[], p_deadline timestamptz,
    p_funnel boolean DEFAULT true, p_entry text DEFAULT 'singles',
    p_partners uuid[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t   tournaments;
    v_ver integer;
    v_i   integer;
BEGIN
    PERFORM pg_temp.as_user(p_org);
    PERFORM pg_temp.staff_on(p_org);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name, (SELECT id FROM sport WHERE name = 'tennis'),
        array_length(p_roster, 1)::smallint,
        now() - interval '10 days', now() + interval '20 days',
        p_entry_format => p_entry::entry_format,
        p_bracket_type => 'pool_knockout'::bracket_type,
        p_pool_size => 4::smallint, p_qualifiers_per_pool => 2::smallint);
    PERFORM pg_temp.staff_off(p_org);

    UPDATE tournaments
       SET scheduling_funnel_enabled = p_funnel, min_availability_hours = 6
     WHERE id = v_t.id;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOR v_i IN 1..array_length(p_roster, 1) LOOP
        PERFORM pg_temp.as_user(p_roster[v_i]);
        PERFORM public.tournament_register(
            v_t.id,
            CASE WHEN p_partners IS NULL THEN NULL ELSE p_partners[v_i] END);
    END LOOP;

    PERFORM pg_temp.as_user(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- The RPC refuses a past deadline, rightly. Stamp a real one through it the
    -- way an organizer would, then backdate the row when the fixture wants an
    -- expired round.
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

    -- The pool rooms are created by a trigger on pool rows, and this script
    -- runs in replica mode, which disables it. Without this the rooms simply do
    -- not exist: no locked composer, no board, and the guide's centrepiece is
    -- unwalkable. Only funnel events get rooms, same condition as the trigger.
    IF p_funnel THEN
        PERFORM public.lt_ensure_pool_room(v_t.id, pn)
          FROM (SELECT DISTINCT pool_number AS pn
                  FROM tournament_matches
                 WHERE tournament_id = v_t.id AND pool_number IS NOT NULL) p;
    END IF;

    RETURN v_t.id;
END;
$$;

-- A casual game, marked in notes so the cleanup finds it and so every generated
-- occurrence of a series inherits the marker.
CREATE OR REPLACE FUNCTION pg_temp.mk_game(
    p_host uuid, p_note text, p_start timestamptz, p_facility uuid,
    p_minutes integer DEFAULT 90, p_loc text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_loc location_type_enum;
BEGIN
    -- p_loc overrides the default, because 'custom without coordinates' and
    -- 'tbd' are different cases for check-in and only one of them is reachable
    -- from the app today. See fixture C.
    v_loc := COALESCE(p_loc, CASE WHEN p_facility IS NULL THEN 'tbd' ELSE 'facility' END)
             ::location_type_enum;

    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time,
                       notes, facility_id, location_type, location_name,
                       visibility, join_mode, timezone, court_status, format)
    VALUES ((SELECT id FROM sport WHERE name = 'tennis'), p_host,
            (p_start AT TIME ZONE 'America/Toronto')::date,
            (p_start AT TIME ZONE 'America/Toronto')::time,
            ((p_start + make_interval(mins => p_minutes)) AT TIME ZONE 'America/Toronto')::time,
            p_note, p_facility, v_loc,
            CASE WHEN p_facility IS NOT NULL
                 THEN (SELECT name FROM facility WHERE id = p_facility)
                 WHEN v_loc = 'custom' THEN 'Parc, à confirmer'
                 ELSE NULL END,
            'public'::match_visibility_enum, 'direct'::match_join_mode_enum,
            'America/Toronto',
            CASE WHEN p_facility IS NULL THEN NULL
                 ELSE 'to_reserve'::court_status_enum END,
            -- The app reads capacity off this ('doubles' ? 4 : 2) to decide a
            -- game is full, and check-in is gated on full. Left NULL it works
            -- by accident; set, it works on purpose.
            'singles'::match_format_enum)
    RETURNING id INTO v_id;

    INSERT INTO match_participant (match_id, player_id, team_number, status, is_host, joined_at)
    VALUES (v_id, p_host, 1, 'joined', true, now())
    ON CONFLICT (match_id, player_id) DO NOTHING;
    RETURN v_id;
END;
$$;

DO $$
DECLARE
    v_jdl    uuid := pg_temp.jdl();
    v_sport  uuid := (SELECT id FROM sport WHERE name = 'tennis');
    v_house  uuid;
    v_fac    uuid;
    v_r      uuid[];
    v_parts  uuid[];
    v_a uuid; v_b uuid;
    v_tm     tournament_matches;
    v_mate   uuid;
    v_rec    uuid;
    v_tmpl   uuid;
    v_next   uuid;
    v_g      uuid;
    v_opp    uuid;
    v_n      integer;
    v_marks  integer;
    v_side   uuid[];
    v_credit integer;
    v_rating uuid;
BEGIN
    IF v_jdl IS NULL THEN
        RAISE EXCEPTION '% not found on this database', current_setting('rallia.tester_email');
    END IF;

    SELECT id INTO v_fac FROM facility
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND is_active
     ORDER BY name LIMIT 1;
    IF v_fac IS NULL THEN
        RAISE EXCEPTION 'no active facility with coordinates on this database';
    END IF;

    -- ============================================================ A. Mon score
    -- A fake organizes so the participant guards are the ones under test.
    v_r := pg_temp.fakes(44, 7) || ARRAY[v_jdl];
    v_a := pg_temp.mk_pool_event(v_r[1], '[JDL v5] Mon score', v_r,
                                 now() + interval '10 days', false);

    -- The pairing the banner exists for: played, never created as a game.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_a AND tm.bracket_side = 'pool'
       AND v_jdl IN (r1.user_id, r2.user_id)
     -- tm.id breaks the tie: match_position is per-pool, so Jean's three
     -- pairings all carry the same one and LIMIT/OFFSET would otherwise pick a
     -- different row on every run, scoring the pairing the banner needs.
     ORDER BY tm.match_position, tm.id LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'A: no pairing found for Jean';
    END IF;
    PERFORM public.lt_get_or_create_tournament_round_chat_unchecked(v_tm.id);

    -- The negative control, so the banner's absence sits next to its presence.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = v_a AND tm.bracket_side = 'pool'
       AND v_jdl IN (r1.user_id, r2.user_id)
     ORDER BY tm.match_position, tm.id OFFSET 1 LIMIT 1;
    IF v_tm.id IS NOT NULL THEN
        PERFORM public.lt_get_or_create_tournament_round_chat_unchecked(v_tm.id);
        UPDATE tournament_matches tm
           SET status = 'completed',
               score = CASE WHEN r1.user_id = v_jdl THEN '8-4' ELSE '4-8' END,
               winner_registration_id =
                   CASE WHEN r1.user_id = v_jdl THEN tm.player1_registration_id
                        ELSE tm.player2_registration_id END,
               played_at = now() - interval '2 days'
          FROM tournament_registrations r1
         WHERE tm.id = v_tm.id AND r1.id = tm.player1_registration_id;
    END IF;

    -- ============================================================ B. Le double
    -- 8 entries = 8 pairs = 16 players. Jean captains one; his partner never
    -- answers the gate while he does, so the pair loses and only the partner
    -- should be marked.
    v_r     := pg_temp.fakes(52, 7) || ARRAY[v_jdl];
    v_parts := pg_temp.fakes(60, 8);
    v_mate  := v_parts[8];
    v_b := pg_temp.mk_pool_event(v_r[1], '[JDL v5] Le double', v_r,
                                 now() - interval '2 hours', true, 'doubles', v_parts);

    -- Everyone answers except Jean's partner. Both sides of every pairing are
    -- otherwise engaged, so the pairing Jean's side loses is lost on the one
    -- member who never showed up to the form.
    PERFORM pg_temp.gate(v_b, v_jdl, 'engaged');
    FOR v_n IN 1..7 LOOP
        PERFORM pg_temp.gate(v_b, v_r[v_n], 'engaged');
        PERFORM pg_temp.gate(v_b, v_parts[v_n], 'engaged');
    END LOOP;
    -- v_mate (Jean's partner) is deliberately left with no gate row at all.

    -- Getting Jean's side to the state the fix is about takes some care, and
    -- the shape is the realistic one: the opponents proposed a time, Jean's
    -- pair never answered it, and his partner never even filled the form.
    --
    --   * A gate answer only counts for a side when EVERY member answered, so
    --     with the partner missing the side has no timeliness and no volume.
    --   * Awareness therefore has to come from a scheduling act, which Jean
    --     supplies (his nudge). Without it the side reads Unreached and the
    --     ladder resolves it into non-penalising outcomes only, marking nobody.
    --   * An act with nothing pending scores full reactivity, which would push
    --     the side to Engaged and, again, past the reputation bar. So the
    --     opponents leave a proposal waiting that Jean's side never answers:
    --     reactivity 0, the unresponsiveness cap applies, and the side lands on
    --     Passive, which is the one state a personal mark is written for.
    --
    -- Ordering matters: Jean's nudge has to PRECEDE the opponents' proposal,
    -- or it would count as answering it.
    FOR v_tm IN
        SELECT tm.* FROM tournament_matches tm
          JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
          JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
         WHERE tm.tournament_id = v_b AND tm.bracket_side = 'pool'
           AND v_jdl IN (r1.user_id, r1.partner_user_id, r2.user_id, r2.partner_user_id)
    LOOP
        INSERT INTO leagues_tournaments_audit
            (scope, entity_id, action, actor_id, payload_after, occurred_at)
        VALUES ('tournament_match', v_tm.id, 'funnel_pinged', v_jdl, '{}'::jsonb,
                now() - interval '5 days');

        -- Whoever is on the other side of this pairing proposes a slot.
        SELECT public.lt_registration_users(
                   CASE WHEN v_jdl = ANY (public.lt_registration_users(v_tm.player1_registration_id))
                        THEN v_tm.player2_registration_id
                        ELSE v_tm.player1_registration_id END)
          INTO v_side;

        INSERT INTO leagues_tournaments_audit
            (scope, entity_id, action, actor_id, payload_after, occurred_at)
        VALUES ('tournament_match', v_tm.id, 'funnel_booked', v_side[1], '{}'::jsonb,
                now() - interval '3 days');
    END LOOP;

    PERFORM public.lt_resolve_due_tournament_matches(false);

    -- session_replication_role = replica disabled the trigger that rolls
    -- reputation_event up into player_reputation, which is the store the
    -- profile actually reads. Without this the marks exist and the visible
    -- score never moves.
    PERFORM public.recalculate_player_reputation(v_mate);
    PERFORM public.recalculate_player_reputation(v_jdl);

    -- ============================================================ C. présence
    -- THE TIMING IS LOAD-BEARING. The app offers check-in from 10 minutes
    -- before the start until the end, so a game "in 75 minutes" shows no
    -- button at all. These start in 5 minutes and run for 4 hours, which opens
    -- the window immediately and keeps it open for the session. That also makes
    -- C a SAME-DAY fixture: reseed on the morning of the test.
    v_opp := (pg_temp.fakes(70, 1))[1];

    -- 1. With a court: the control. The 500 m radius still applies, so this one
    --    is refused unless the tester is actually at the club.
    v_g := pg_temp.mk_game(v_opp, '[JDL v5] présence · avec terrain',
                           now() + interval '5 minutes', v_fac, 235);
    INSERT INTO match_participant (match_id, player_id, team_number, status, joined_at)
    VALUES (v_g, v_jdl, 2, 'joined', now()) ON CONFLICT DO NOTHING;

    -- 2. A named place with no coordinates: what 2e205bbe made possible, and
    --    the one no-court case the app will actually offer today.
    v_g := pg_temp.mk_game(v_opp, '[JDL v5] présence · lieu sans coordonnées',
                           now() + interval '5 minutes', NULL, 235, 'custom');
    INSERT INTO match_participant (match_id, player_id, team_number, status, joined_at)
    VALUES (v_g, v_jdl, 2, 'joined', now()) ON CONFLICT DO NOTHING;

    -- 3. No place at all ('tbd'), which is what the funnel creates when no court
    --    is near the chosen slot. The server accepts a self-declared check-in
    --    here, but MatchDetailSheet still gates the button on
    --    location_type IN ('facility','custom'), so nobody can press it. Left in
    --    deliberately as the reproduction, not as a passing case.
    v_g := pg_temp.mk_game(v_opp, '[JDL v5] présence · sans lieu (bogue connu)',
                           now() + interval '5 minutes', NULL, 235);
    INSERT INTO match_participant (match_id, player_id, team_number, status, joined_at)
    VALUES (v_g, v_jdl, 2, 'joined', now()) ON CONFLICT DO NOTHING;

    -- ============================================================ D. récurrente
    -- Series 1: the template already ended, so the real generator creates the
    -- next occurrence, and a court opens inside its window.
    -- Six days back at 18:00, not "seven days ago from right now": the next
    -- occurrence is the template date + 7, so an anchor at the current time of
    -- day produces an occurrence that is already in the past and the alert
    -- skips it (match_start <= now()).
    v_tmpl := pg_temp.mk_game(v_jdl, '[JDL v5] récurrente · la suivante',
                              ((CURRENT_DATE - 6) + time '18:00') AT TIME ZONE 'America/Toronto',
                              v_fac);
    INSERT INTO match_recurrence (created_by, template_match_id, interval_weeks)
    VALUES (v_jdl, v_tmpl, 1) RETURNING id INTO v_rec;
    UPDATE match SET recurrence_id = v_rec WHERE id = v_tmpl;

    PERFORM public.generate_recurring_matches();

    SELECT id INTO v_next FROM match
     WHERE recurrence_id = v_rec AND id <> v_tmpl
     ORDER BY match_date DESC LIMIT 1;
    IF v_next IS NULL THEN
        RAISE EXCEPTION 'D: the generator produced no next occurrence';
    END IF;

    -- The generator inserts the match and lets the create_host_participant
    -- trigger seat the host. Replica mode disables that trigger, so in
    -- production the occurrence has the host in it and here it would have
    -- nobody. Mirror what the trigger does, or the guide's "avec toi seul
    -- dedans" is false and the game is not even his.
    INSERT INTO match_participant (match_id, player_id, is_host, status, joined_at)
    VALUES (v_next, v_jdl, true, 'joined', now())
    ON CONFLICT (match_id, player_id) DO NOTHING;

    -- An open bookable slot overlapping that occurrence, which is what the
    -- alert watches for.
    INSERT INTO facility_availability_snapshot
        (facility_id, sport_id, external_court_id, slot_start, slot_end,
         is_available, source, court_name, refreshed_at)
    SELECT v_fac, v_sport, 'jdl-v5-court',
           (m.match_date + m.start_time) AT TIME ZONE COALESCE(m.timezone, 'America/Toronto'),
           (m.match_date + m.end_time)   AT TIME ZONE COALESCE(m.timezone, 'America/Toronto'),
           true, 'jdl-v5-fixture', 'Terrain 1', now()
      FROM match m WHERE m.id = v_next;

    PERFORM public.send_recurring_court_open_alerts();

    -- Series 2: still live, nothing generated, so the cancel dialog has a
    -- running series to offer stopping.
    v_g := pg_temp.mk_game(v_jdl, '[JDL v5] récurrente · à arrêter',
                           ((CURRENT_DATE + 3) + time '19:00') AT TIME ZONE 'America/Toronto',
                           v_fac);
    INSERT INTO match_recurrence (created_by, template_match_id, interval_weeks)
    VALUES (v_jdl, v_g, 1) RETURNING id INTO v_rec;
    UPDATE match SET recurrence_id = v_rec WHERE id = v_g;

    -- ============================================================ E. Crédit
    SELECT id INTO v_house FROM profile WHERE is_house_organizer LIMIT 1;
    IF v_house IS NULL THEN
        RAISE EXCEPTION 'E: no house organizer on this database (20260826123000 seeds one for staging)';
    END IF;

    INSERT INTO player_credit (player_id, amount_cents, currency, source, granted_at, expires_at)
    VALUES (v_jdl, 1000, 'CAD', 'jdl_v5_fixture', now() - interval '1 day',
            now() + interval '365 days');

    -- The tester may already hold credit from other testing, and the fixture is
    -- only meaningful if one event is covered EXACTLY and the other is not. So
    -- the fees follow the real balance rather than assuming it is $10.
    PERFORM pg_temp.as_user(v_jdl);
    v_credit := public.player_credit_available_cents(v_jdl);
    IF v_credit < 1000 THEN
        RAISE EXCEPTION 'E: expected at least the fixture credit, found % cents', v_credit;
    END IF;

    -- Fully covered: 10 $ entry against a 10 $ credit, so the charge is 0 and
    -- Stripe is skipped entirely.
    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date, description,
        visibility, registration_mode, bracket_type, match_format, entry_format,
        registration_opens_at, registration_closes_at, organizer_id, status,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_cutoff_at)
    VALUES ('[JDL v5] Crédit · couvert', v_sport, 8,
            now() + interval '21 days', now() + interval '21 days 6 hours',
            'Le crédit couvre l''inscription au complet: aucune carte demandée.',
            'public', 'open', 'single_elimination', 'two_of_three', 'singles',
            now() - interval '2 days', now() + interval '10 days', v_house,
            'registration_open', v_credit, 'CAD', 'player_pays', 'hold_until_event_end',
            'full', now() + interval '7 days');

    -- Partly covered: 30 $ entry, 10 $ credit, so 20 $ plus fee and tax still
    -- goes through Stripe with a test card.
    INSERT INTO tournaments (
        name, sport_id, max_participants, start_date, end_date, description,
        visibility, registration_mode, bracket_type, match_format, entry_format,
        registration_opens_at, registration_closes_at, organizer_id, status,
        entry_fee_cents, currency, fee_payer, payout_timing,
        refund_policy_kind, refund_cutoff_at)
    VALUES ('[JDL v5] Crédit · partiel', v_sport, 8,
            now() + interval '24 days', now() + interval '24 days 6 hours',
            'Le crédit couvre une partie: le reste passe par une carte de test.',
            'public', 'open', 'single_elimination', 'two_of_three', 'singles',
            now() - interval '2 days', now() + interval '10 days', v_house,
            'registration_open', v_credit + 2000, 'CAD', 'player_pays', 'hold_until_event_end',
            'full', now() + interval '7 days');

    -- ============================================================ F. invitation
    -- Pending, not a request, invited over an hour ago, game 2-6 hours out.
    v_opp := (pg_temp.fakes(71, 1))[1];
    v_g := pg_temp.mk_game(v_opp, '[JDL v5] invitation · rappel',
                           now() + interval '4 hours', v_fac);
    INSERT INTO match_participant (match_id, player_id, team_number, status,
                                   is_host, created_at)
    VALUES (v_g, v_jdl, 2, 'pending', false, now() - interval '3 hours')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET status = 'pending', requested_at = NULL, expired_at = NULL,
          created_at = now() - interval '3 hours';

    -- ============================================================ G. Pour toi
    -- The preset keeps games at the tester's EXACT rating, with a spot open,
    -- within his travel range OR at a favourite facility. Distance cannot be
    -- guaranteed from a seed, so the favourite branch is used instead: the
    -- facility is favourited for him, which makes the match deterministic.
    -- Without this the filter can only be judged against an empty feed.
    SELECT active_rating_score_id INTO v_rating
      FROM player_sport WHERE player_id = v_jdl AND sport_id = v_sport
      LIMIT 1;
    IF v_rating IS NULL THEN
        RAISE EXCEPTION 'G: the tester has no active tennis rating, so the preset cannot match anything';
    END IF;

    INSERT INTO player_favorite_facility (player_id, facility_id, sport_id)
    VALUES (v_jdl, v_fac, v_sport)
    ON CONFLICT DO NOTHING;

    v_opp := (pg_temp.fakes(72, 1))[1];
    v_g := pg_temp.mk_game(v_opp, '[JDL v5] pour toi · une place libre',
                           ((CURRENT_DATE + 2) + time '18:00') AT TIME ZONE 'America/Toronto',
                           v_fac);
    UPDATE match SET min_rating_score_id = v_rating WHERE id = v_g;
    -- Host only, so exactly one spot is open.

    -- ============================================================ assertions
    -- B is the fixture that can silently produce the wrong shape, so all three
    -- halves of it are checked: the side lost, the partner carries the mark,
    -- and Jean carries none. Without the third, "no marks at all" would pass.
    SELECT count(*) INTO v_marks
      FROM tournament_matches
     WHERE tournament_id = v_b AND status = 'walkover';
    IF v_marks = 0 THEN
        RAISE EXCEPTION 'B: the ladder produced no walkover, so nothing is marked';
    END IF;

    SELECT count(*) INTO v_marks
      FROM reputation_event
     WHERE (metadata ->> 'tournamentId')::uuid = v_b AND player_id = v_mate;
    IF v_marks = 0 THEN
        RAISE EXCEPTION 'B: the silent partner carries no reputation mark, so the fixture proves nothing';
    END IF;

    SELECT count(*) INTO v_marks
      FROM reputation_event
     WHERE (metadata ->> 'tournamentId')::uuid = v_b AND player_id = v_jdl;
    IF v_marks > 0 THEN
        RAISE EXCEPTION 'B: Jean took a reputation mark for his partner''s silence (% rows)', v_marks;
    END IF;

    -- Scoped to THIS occurrence: an unscoped check passes on a stale alert
    -- left by an earlier run and proves nothing.
    IF NOT EXISTS (SELECT 1 FROM notification
                    WHERE user_id = v_jdl AND type = 'recurring_court_opened'
                      AND target_id = v_next) THEN
        RAISE EXCEPTION 'D: no court-open alert for the generated occurrence';
    END IF;

    RAISE NOTICE '[JDL v5] mon_score=%  double=%  partenaire=%', v_a, v_b, v_mate;
END;
$$;

RESET session_replication_role;

-- What Jean will be looking at.
SELECT t.name,
       count(*) FILTER (WHERE tm.status = 'pending')   AS a_jouer,
       count(*) FILTER (WHERE tm.status = 'walkover')  AS forfaits,
       count(*) FILTER (WHERE tm.status = 'cancelled') AS annulees,
       count(*) FILTER (WHERE tm.status = 'completed') AS jouees
  FROM tournaments t
  LEFT JOIN tournament_matches tm ON tm.tournament_id = t.id
 WHERE t.name LIKE '[JDL v5]%'
 GROUP BY t.name ORDER BY t.name;

SELECT m.notes, m.match_date, m.start_time,
       (m.recurrence_id IS NOT NULL) AS serie,
       (m.facility_id IS NOT NULL)   AS avec_terrain
  FROM match m
 WHERE m.notes LIKE '[JDL v5]%'
 ORDER BY m.notes, m.match_date;

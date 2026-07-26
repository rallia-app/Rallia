-- ============================================================================
-- Seed staging with the league SESSION loop (the weekly match-night)
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
-- Prefix: "[SEED-S] " — idempotent, owns its own leagues so it never collides
-- with scripts/seed-leagues-staging.sql ("[SEED] ") or the "[JDL " fixtures.
--
-- scripts/seed-leagues-staging.sql stops at the season: it seeds leagues,
-- members, seasons and standings but not a single session. That leaves the
-- whole V7-V10 chain (publish -> confirm -> match sheet -> score -> ranking)
-- with no data. This script fills it: every session state, the sheet variants
-- (multi-round, odd roster, capacity + waitlist), the confirm-reminder cron
-- window, and a cancelled season.
--
-- Everything here is FREE. Paid seasons are covered by the "[SEED] Paid League"
-- set, and closing or cancelling a season that carries fake ledger rows makes
-- the settlement cron chase Stripe intents that do not exist.
--
-- Personas
--   * TESTER = jdl.sonkin@gmail.com. Organizes "vous organisez", plays in
--     "vous jouez". Plays tennis and pickleball, so both universes are reachable.
--   * PEER = lefrancmathis@gmail.com. Organizes the participant-side league, so
--     a real second human runs the sessions the tester plays in.
--   * @fake-rallia.com pool — everyone else, so no real user gets noise.
--
-- Run:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/leagues/seed-league-sessions-staging.sql
--   or  paste the body (helpers + DO block) into Supabase MCP execute_sql
--       WITHOUT the BEGIN;/COMMIT; wrapper.
--
-- Cleanup: DELETE FROM leagues WHERE name LIKE '[SEED-S] %';  (cascades to
--          seasons, sessions, presence, matches, rankings)
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup previous [SEED-S] batch
-- --------------------------------------------------------------------------
DELETE FROM lt_registration_payment
 WHERE season_id IN (SELECT s.id FROM seasons s JOIN leagues l ON l.id = s.league_id
                      WHERE l.name LIKE '[SEED-S] %');
DELETE FROM leagues_tournaments_audit
 WHERE scope IN ('league', 'season', 'session', 'session_match')
   AND entity_id IN (
     SELECT id FROM leagues WHERE name LIKE '[SEED-S] %'
     UNION SELECT s.id FROM seasons s JOIN leagues l ON l.id = s.league_id WHERE l.name LIKE '[SEED-S] %'
     UNION SELECT ss.id FROM sessions ss JOIN seasons s ON s.id = ss.season_id
             JOIN leagues l ON l.id = s.league_id WHERE l.name LIKE '[SEED-S] %'
     UNION SELECT sm.id FROM session_matches sm JOIN sessions ss ON ss.id = sm.session_id
             JOIN seasons s ON s.id = ss.season_id JOIN leagues l ON l.id = s.league_id
            WHERE l.name LIKE '[SEED-S] %');
DELETE FROM leagues WHERE name LIKE '[SEED-S] %';

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_set_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_member(p_league uuid, p_user uuid,
                                            p_status league_member_status DEFAULT 'active')
RETURNS void AS $$
BEGIN
  INSERT INTO league_members(league_id, user_id, role, status, approved_at)
  VALUES (p_league, p_user, 'member', p_status,
          CASE WHEN p_status = 'active' THEN now() END)
  ON CONFLICT (league_id, user_id) DO UPDATE SET status = p_status;
END; $$ LANGUAGE plpgsql;

-- Create + publish in one step. Publishing seeds a pending presence row for
-- every active member, which is what the confirm screen reads.
CREATE OR REPLACE FUNCTION pg_temp.s_session(
  p_season uuid, p_org uuid, p_name text,
  p_in interval DEFAULT '7 days',
  p_publish boolean DEFAULT true,
  p_deadline_in interval DEFAULT NULL,
  p_capacity smallint DEFAULT NULL,
  p_rounds smallint DEFAULT 1,
  p_facility uuid DEFAULT NULL, p_venue text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_s sessions;
BEGIN
  PERFORM pg_temp.seed_set_user(p_org);
  v_s := session_create(
    p_season_id => p_season, p_name => p_name,
    p_scheduled_at => now() + p_in, p_timezone => 'America/Toronto',
    p_duration_minutes => 90::smallint, p_facility_id => p_facility,
    p_venue_name => p_venue, p_capacity => p_capacity, p_rounds => p_rounds,
    p_pairing_mode => 'by_rank');
  IF p_publish THEN
    v_s := session_publish(v_s.id,
      now() + COALESCE(p_deadline_in, p_in - interval '24 hours'), v_s.version);
  END IF;
  RETURN v_s.id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_confirm(p_session uuid, p_user uuid,
                                             p_status session_presence_status DEFAULT 'confirmed')
RETURNS void AS $$
BEGIN
  PERFORM pg_temp.seed_set_user(p_user);
  PERFORM session_confirm_presence(p_session, p_status, NULL);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_sheet(p_session uuid, p_org uuid) RETURNS void AS $$
DECLARE v_v integer;
BEGIN
  PERFORM pg_temp.seed_set_user(p_org);
  SELECT version INTO v_v FROM sessions WHERE id = p_session;
  PERFORM session_generate_sheet(p_session, v_v);
END; $$ LANGUAGE plpgsql;

-- Score the first p_limit pending matches (NULL = all) in favour of team A.
CREATE OR REPLACE FUNCTION pg_temp.s_score(p_session uuid, p_org uuid,
                                           p_score text, p_limit integer DEFAULT NULL)
RETURNS void AS $$
DECLARE r record; n integer := 0;
BEGIN
  PERFORM pg_temp.seed_set_user(p_org);
  FOR r IN
    SELECT id, version FROM session_matches
     WHERE session_id = p_session AND status = 'pending'
     ORDER BY round_number, created_at
  LOOP
    EXIT WHEN p_limit IS NOT NULL AND n >= p_limit;
    PERFORM session_record_score(r.id, 'a', p_score, 'completed', r.version);
    n := n + 1;
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- Push a session into the past once its data is in place (session_publish and
-- session_confirm_presence both require a future date / open deadline).
CREATE OR REPLACE FUNCTION pg_temp.s_backdate(p_session uuid, p_ago interval)
RETURNS void AS $$
BEGIN
  UPDATE sessions
     SET scheduled_at = now() - p_ago,
         confirmation_deadline_at = now() - p_ago - interval '24 hours'
   WHERE id = p_session;
END; $$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Seed
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis uuid; v_pickle uuid; v_facility uuid;
  v_p uuid[]; v_pk uuid[]; v_league leagues; v_season seasons; v_org uuid; v_net uuid;
  v_tester uuid;   -- jdl.sonkin@gmail.com
  v_peer uuid;     -- lefrancmathis@gmail.com
  v_sid uuid; i integer;
BEGIN
  SELECT id INTO v_tennis   FROM sport WHERE name = 'tennis';
  SELECT id INTO v_pickle   FROM sport WHERE name = 'pickleball';
  SELECT id INTO v_facility FROM facility WHERE is_active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tester   FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
  SELECT id INTO v_peer     FROM auth.users WHERE email = 'lefrancmathis@gmail.com';

  SELECT array_agg(id) INTO v_p FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id = u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id = v_tennis AND ps.is_active
     ORDER BY u.id DESC LIMIT 12) s;
  SELECT array_agg(id) INTO v_pk FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id = u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id = v_pickle AND ps.is_active
     ORDER BY u.id DESC LIMIT 8) s;
  IF coalesce(array_length(v_p, 1), 0) < 12 THEN
    RAISE EXCEPTION 'need >=12 fake tennis players, found %', coalesce(array_length(v_p,1),0);
  END IF;
  IF v_tester IS NULL THEN
    RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
  END IF;
  IF v_peer IS NULL THEN
    RAISE EXCEPTION 'lefrancmathis@gmail.com not found on this database';
  END IF;

  -- ===================== THE TESTER ORGANIZES =====================

  PERFORM pg_temp.seed_set_user(v_tester);
  v_league := league_create(
    p_name => '[SEED-S] Labo de seances (vous organisez)', p_sport_id => v_tennis,
    p_description => 'Toutes les etapes d''une seance: brouillon, publiee, feuille de match, pointage, terminee, annulee.',
    p_visibility => 'public', p_join_mode => 'open',
    p_facility_id => v_facility, p_venue_name => 'Club de Tennis de Monkland');
  FOR i IN 1..9 LOOP PERFORM pg_temp.s_member(v_league.id, v_p[i]); END LOOP;
  -- A suspended member: must not appear in a new match sheet.
  PERFORM pg_temp.s_member(v_league.id, v_p[10], 'suspended');

  PERFORM pg_temp.seed_set_user(v_tester);
  v_season := season_create(p_league_id => v_league.id, p_name => 'Saison des seances',
    p_start_date => current_date - 30, p_end_date => current_date + 90);
  v_season := season_open(v_season.id, v_season.version);

  -- 1. Draft — organizer-only, not yet visible to members.
  PERFORM pg_temp.s_session(v_season.id, v_tester, 'Seance 1 - brouillon',
    '10 days', false, NULL, NULL, 1::smallint, v_facility, 'Club de Tennis de Monkland');

  -- 2. Published, confirmations open — every member sits at pending.
  PERFORM pg_temp.s_session(v_season.id, v_tester, 'Seance 2 - a confirmer',
    '9 days', true, '7 days', NULL, 1::smallint, v_facility, 'Parc Jeanne-Mance');

  -- 3. Confirmations in, no sheet yet — the "generate the match sheet" test.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 3 - feuille a generer',
    '3 days', true, '2 days', NULL, 1::smallint, v_facility, 'Stade IGA');
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  FOR i IN 7..8 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i], 'declined'); END LOOP;

  -- 4. Sheet generated, nothing scored yet.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 4 - feuille generee',
    '2 days', true, '1 day', NULL, 1::smallint, v_facility, 'Parc Jarry');
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_tester);

  -- 5. In progress — one result recorded, two still to enter.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 5 - en cours',
    '2 days', true, '1 day', NULL, 1::smallint, v_facility, 'Tennis 13');
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_tester);
  UPDATE sessions SET status = 'in_progress', version = version + 1 WHERE id = v_sid;
  PERFORM pg_temp.s_score(v_sid, v_tester, '6-4 6-2', 1);
  PERFORM pg_temp.s_backdate(v_sid, '3 hours');

  -- 6. Completed — every match scored, ranking recalculated.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 6 - terminee',
    '2 days', true, '1 day', NULL, 1::smallint, v_facility, 'Club de Tennis de Monkland');
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_tester);
  PERFORM pg_temp.s_score(v_sid, v_tester, '6-3 6-4');
  PERFORM pg_temp.s_backdate(v_sid, '7 days');

  -- 7. Cancelled with a reason.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 7 - annulee',
    '5 days', true, '4 days', NULL, 1::smallint, v_facility, 'Parc La Fontaine');
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_tester);
  PERFORM session_cancel(v_sid, 'Pluie annoncee',
    (SELECT version FROM sessions WHERE id = v_sid));

  -- 8. Inside the confirm-reminder window. lt_send_session_confirm_reminders
  --    runs every 15 min and only fires within 24h of the cutoff, so this is
  --    the one session where a tester actually receives that push.
  PERFORM pg_temp.s_session(v_season.id, v_tester, 'Seance 8 - rappel de confirmation',
    '20 hours', true, '18 hours', NULL, 1::smallint, v_facility, 'Parc Jeanne-Mance');

  -- 9. Three rounds — the round allocator, 9 pairings from 6 players.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 9 - trois tours',
    '4 days', true, '3 days', NULL, 3::smallint, v_facility, 'Stade IGA');
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_tester);

  -- 10. Odd roster — 7 confirmed, the top-ranked player sits out.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 10 - roster impair',
    '4 days', true, '3 days', NULL, 1::smallint, v_facility, 'Parc Jarry');
  FOR i IN 1..7 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_tester);

  -- 11. Capacity 4 with 7 confirms — 4 seated, 3 waitlisted.
  v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance 11 - capacite 4 + liste d''attente',
    '6 days', true, '5 days', 4::smallint, 1::smallint, v_facility, 'Tennis 13');
  FOR i IN 1..7 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;

  -- ===================== THE TESTER PLAYS =====================

  v_org := v_peer;
  PERFORM pg_temp.seed_set_user(v_org);
  v_league := league_create(
    p_name => '[SEED-S] Labo de seances (vous jouez)', p_sport_id => v_tennis,
    p_description => 'Quelqu''un d''autre organise. Confirmez votre presence, consultez la feuille, verifiez le classement.',
    p_visibility => 'public', p_join_mode => 'open',
    p_facility_id => v_facility, p_venue_name => 'Parc Jarry');
  PERFORM pg_temp.s_member(v_league.id, v_tester);
  FOR i IN 1..6 LOOP PERFORM pg_temp.s_member(v_league.id, v_p[i]); END LOOP;

  PERFORM pg_temp.seed_set_user(v_org);
  v_season := season_create(p_league_id => v_league.id, p_name => 'Saison en cours',
    p_start_date => current_date - 30, p_end_date => current_date + 90);
  v_season := season_open(v_season.id, v_season.version);

  -- 12. Waiting on the tester to confirm.
  v_sid := pg_temp.s_session(v_season.id, v_org, 'Seance a confirmer',
    '5 days', true, '4 days', NULL, 1::smallint, v_facility, 'Parc Jarry');
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;

  -- 13. The tester is confirmed and drawn, their pairing is on the sheet.
  v_sid := pg_temp.s_session(v_season.id, v_org, 'Seance avec votre match',
    '3 days', true, '2 days', NULL, 1::smallint, v_facility, 'Stade IGA');
  PERFORM pg_temp.s_confirm(v_sid, v_tester);
  FOR i IN 1..5 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_org);

  -- 14. A past session the tester played, feeds their standing.
  v_sid := pg_temp.s_session(v_season.id, v_org, 'Seance jouee',
    '2 days', true, '1 day', NULL, 1::smallint, v_facility, 'Tennis 13');
  PERFORM pg_temp.s_confirm(v_sid, v_tester);
  FOR i IN 1..5 LOOP PERFORM pg_temp.s_confirm(v_sid, v_p[i]); END LOOP;
  PERFORM pg_temp.s_sheet(v_sid, v_org);
  PERFORM pg_temp.s_score(v_sid, v_org, '6-2 6-4');
  PERFORM pg_temp.s_backdate(v_sid, '5 days');

  -- ===================== CANCELLED SEASON =====================
  -- Free, so cancelling never puts the settlement cron on a fake Stripe intent.

  v_org := v_p[12];
  PERFORM pg_temp.seed_set_user(v_org);
  v_league := league_create(
    p_name => '[SEED-S] Saison annulee', p_sport_id => v_tennis,
    p_description => 'Une saison annulee par l''organisateur.',
    p_visibility => 'public', p_join_mode => 'open',
    p_facility_id => v_facility, p_venue_name => 'Parc La Fontaine');
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_member(v_league.id, v_p[i]); END LOOP;
  PERFORM pg_temp.s_member(v_league.id, v_tester);
  PERFORM pg_temp.seed_set_user(v_org);
  v_season := season_create(p_league_id => v_league.id, p_name => 'Saison annulee',
    p_start_date => current_date, p_end_date => current_date + 90);
  v_season := season_open(v_season.id, v_season.version);
  PERFORM season_cancel(v_season.id, 'Pas assez d''inscriptions',
    (SELECT version FROM seasons WHERE id = v_season.id));

  -- ===================== PICKLEBALL SESSIONS =====================
  -- The tester plays both sports, so the second universe gets its own session
  -- loop without a second login.

  IF coalesce(array_length(v_pk, 1), 0) >= 6 THEN
    PERFORM pg_temp.seed_set_user(v_tester);
    v_league := league_create(
      p_name => '[SEED-S] Pickleball - seances', p_sport_id => v_pickle,
      p_description => 'Meme boucle de seances, cote pickleball.',
      p_visibility => 'public', p_join_mode => 'open',
      p_facility_id => v_facility, p_venue_name => 'Complexe sportif d''Anjou');
    FOR i IN 1..6 LOOP PERFORM pg_temp.s_member(v_league.id, v_pk[i]); END LOOP;

    PERFORM pg_temp.seed_set_user(v_tester);
    v_season := season_create(p_league_id => v_league.id, p_name => 'Saison pickleball',
      p_start_date => current_date - 30, p_end_date => current_date + 90);
    v_season := season_open(v_season.id, v_season.version);

    -- Published, waiting on confirmations.
    PERFORM pg_temp.s_session(v_season.id, v_tester, 'Seance pickleball - a confirmer',
      '5 days', true, '4 days', NULL, 1::smallint, v_facility, 'Complexe sportif d''Anjou');

    -- Played, so the pickleball score format runs through the whole chain.
    v_sid := pg_temp.s_session(v_season.id, v_tester, 'Seance pickleball - jouee',
      '2 days', true, '1 day', NULL, 1::smallint, v_facility, 'Arena Saint-Michel');
    FOR i IN 1..6 LOOP PERFORM pg_temp.s_confirm(v_sid, v_pk[i]); END LOOP;
    PERFORM pg_temp.s_sheet(v_sid, v_tester);
    PERFORM pg_temp.s_score(v_sid, v_tester, '11-7 11-9');
    PERFORM pg_temp.s_backdate(v_sid, '4 days');
  END IF;

  -- ===================== COMMUNITY VISIBILITY =====================
  -- Only members of the network see it. Monkland Ace is a community the tester
  -- belongs to on staging.
  SELECT n.id INTO v_net
    FROM network n
    JOIN network_type nt ON nt.id = n.network_type_id
    JOIN network_member nm ON nm.network_id = n.id
   WHERE nt.name = 'community' AND nm.player_id = v_tester
   ORDER BY n.name LIMIT 1;
  IF v_net IS NOT NULL THEN
    PERFORM pg_temp.seed_set_user(v_p[6]);
    v_league := league_create(
      p_name => '[SEED-S] Communaute (reserve aux membres)', p_sport_id => v_tennis,
      p_description => 'Ligue reservee aux membres de la communaute.',
      p_visibility => 'community', p_join_mode => 'open',
      p_facility_id => v_facility, p_venue_name => 'Club de Tennis de Monkland',
      p_network_id => v_net);
    FOR i IN 7..10 LOOP PERFORM pg_temp.s_member(v_league.id, v_p[i]); END LOOP;
  END IF;

  RAISE NOTICE 'Seeded % [SEED-S] leagues / % sessions',
    (SELECT count(*) FROM leagues WHERE name LIKE '[SEED-S] %'),
    (SELECT count(*) FROM sessions ss JOIN seasons s ON s.id = ss.season_id
       JOIN leagues l ON l.id = s.league_id WHERE l.name LIKE '[SEED-S] %');
END $$;

COMMIT;

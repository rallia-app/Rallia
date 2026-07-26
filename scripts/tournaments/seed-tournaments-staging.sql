-- ============================================================================
-- Seed staging with a COMPLETE tournament test suite
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
-- Prefix: "[SEED-T] " — idempotent, removes its own prior batch first and
-- never touches "[JDL ", "[PAYUI] ", "[SEED] " or the live "Série 1" rows.
--
-- Companion to scripts/leagues/seed-league-sessions-staging.sql (the session
-- loop). This one covers the tournament half: every lifecycle state, every
-- registration mode, brackets with byes, a live bracket, a finished bracket
-- with a champion, cancel/archive, doubles, pickleball, gates, and the
-- participant-side flows (invitation, share link, play a bracket match).
--
-- Everything here is FREE (entry_fee_cents = 0). Paid tournaments are already
-- covered by the "[PAYUI] " batch, and seeding paid rows with fake Stripe ids
-- makes the settlement cron chase intents that do not exist.
--
-- Personas
--   * TESTER = jdl.sonkin@gmail.com. Organizes the "Vous organisez" set and
--     plays in the "Vous jouez" set. Plays tennis AND pickleball, so both sport
--     universes are reachable from the one account.
--     jdl is also the only `is_certified_organizer` on staging, so every
--     tournament he finishes awards Points Rallia. The negative control is
--     "[SEED-T] Termine sans points", run by a non-certified organizer.
--   * PEER = lefrancmathis@gmail.com. Organizes the participant-side fixtures,
--     so a real second human can approve requests and send the invite link.
--   * @fake-rallia.com pool — everyone else, so no real user gets notified.
--
-- Run:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/tournaments/seed-tournaments-staging.sql
--   or  paste the body (helpers + DO block) into Supabase MCP execute_sql
--       WITHOUT the BEGIN;/COMMIT; wrapper — one implicit transaction keeps the
--       pg_temp helpers alive, and only the last statement returns rows.
--
-- Cleanup: DELETE FROM tournaments WHERE name LIKE '[SEED-T] %';  (cascades)
--          plus the linkable casual match, see the cleanup block below.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup previous [SEED-T] batch
-- --------------------------------------------------------------------------
DELETE FROM lt_registration_payment
 WHERE tournament_registration_id IN (
   SELECT r.id FROM tournament_registrations r
     JOIN tournaments t ON t.id = r.tournament_id
    WHERE t.name LIKE '[SEED-T] %');
DELETE FROM leagues_tournaments_audit
 WHERE scope = 'tournament'
   AND entity_id IN (SELECT id FROM tournaments WHERE name LIKE '[SEED-T] %');
DELETE FROM tournaments WHERE name LIKE '[SEED-T] %';

-- The linkable casual game this seed creates for the match-bridge fixture.
DELETE FROM match_result      WHERE match_id IN (SELECT id FROM match WHERE notes = '[SEED-T] linkable');
DELETE FROM match_participant WHERE match_id IN (SELECT id FROM match WHERE notes = '[SEED-T] linkable');
DELETE FROM match             WHERE notes = '[SEED-T] linkable';

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_set_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
END; $$ LANGUAGE plpgsql;

-- Direct INSERT rather than tournament_create: the RPC rate-limits a
-- non-admin organizer to 5 tournaments per 24h. Same column set the RPC writes.
CREATE OR REPLACE FUNCTION pg_temp.t_new(
  p_org uuid, p_name text, p_sport uuid, p_status tournament_status,
  p_max smallint,
  p_mode tournament_registration_mode DEFAULT 'open',
  p_vis tournament_visibility DEFAULT 'public',
  p_format entry_format DEFAULT 'singles',
  p_desc text DEFAULT NULL, p_facility uuid DEFAULT NULL, p_venue text DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL, p_max_rating numeric DEFAULT NULL,
  p_min_rep smallint DEFAULT NULL,
  p_start_in interval DEFAULT '21 days', p_reg_closes_in interval DEFAULT '14 days'
) RETURNS tournaments AS $$
DECLARE v_row tournaments; v_sport_name text;
BEGIN
  SELECT name INTO v_sport_name FROM sport WHERE id = p_sport;
  INSERT INTO tournaments (
    name, sport_id, max_participants, start_date, end_date, description,
    visibility, registration_mode, bracket_type, match_format, entry_format,
    facility_id, venue_name, min_rating, max_rating, min_reputation,
    registration_opens_at, registration_closes_at, organizer_id, status,
    entry_fee_cents, currency, fee_payer, payout_timing, refund_policy_kind
  ) VALUES (
    p_name, p_sport, p_max,
    now() + p_start_in, now() + p_start_in + interval '6 hours', p_desc,
    p_vis, p_mode, 'single_elimination',
    CASE v_sport_name WHEN 'pickleball' THEN 'pickleball_to_11'::match_format
                      ELSE 'two_of_three'::match_format END,
    p_format, p_facility, p_venue, p_min_rating, p_max_rating, p_min_rep,
    -- opens_at must stay <= closes_at even for the back-dated fixtures.
    LEAST(now() - interval '7 days', now() + p_reg_closes_in - interval '1 day'),
    now() + p_reg_closes_in, p_org, p_status,
    0, 'CAD', 'player_pays', 'hold_until_event_end', 'none'
  ) RETURNING * INTO v_row;
  RETURN v_row;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.t_reg(
  p_t uuid, p_u uuid,
  p_status registration_status DEFAULT 'registered',
  p_partner uuid DEFAULT NULL,
  p_seed smallint DEFAULT NULL,
  p_invited_by uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO tournament_registrations (
    tournament_id, user_id, partner_user_id, status, seed_rank, invited_by,
    registered_at, approved_at)
  VALUES (p_t, p_u, p_partner, p_status, p_seed, p_invited_by,
    now() - interval '2 days',
    CASE WHEN p_status = 'registered' THEN now() - interval '2 days' END)
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET status = p_status
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$ LANGUAGE plpgsql;

-- Resolve every playable match of a round in favour of player 1.
CREATE OR REPLACE FUNCTION pg_temp.t_play_round(p_t uuid, p_round int, p_score text)
RETURNS void AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, player1_registration_id AS p1
      FROM tournament_matches
     WHERE tournament_id = p_t AND round_number = p_round AND status = 'pending'
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
       AND NOT player1_is_bye AND NOT player2_is_bye
     ORDER BY match_position
  LOOP
    PERFORM tournament_override_score(r.id, r.p1, p_score);
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- registration_closed -> generate the bracket (flips the tournament to
-- in_progress) as the organizer.
CREATE OR REPLACE FUNCTION pg_temp.t_bracket(p_t uuid, p_org uuid) RETURNS void AS $$
DECLARE v_v integer;
BEGIN
  PERFORM pg_temp.seed_set_user(p_org);
  SELECT version INTO v_v FROM tournaments WHERE id = p_t;
  PERFORM tournament_generate_bracket(p_t, v_v);
END; $$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Seed
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis uuid; v_pickle uuid; v_facility uuid;
  v_tester uuid;   -- jdl.sonkin@gmail.com
  v_peer uuid;     -- lefrancmathis@gmail.com
  v_p uuid[]; v_pk uuid[]; v_t tournaments; v_net uuid;
  v_match uuid; v_opponent uuid; v_v integer; i integer;
BEGIN
  SELECT id INTO v_tennis   FROM sport WHERE name = 'tennis';
  SELECT id INTO v_pickle   FROM sport WHERE name = 'pickleball';
  SELECT id INTO v_facility FROM facility WHERE is_active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tester   FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
  SELECT id INTO v_peer     FROM auth.users WHERE email = 'lefrancmathis@gmail.com';

  IF v_tester IS NULL THEN
    RAISE EXCEPTION 'jdl.sonkin@gmail.com not found on this database';
  END IF;
  IF v_peer IS NULL THEN
    RAISE EXCEPTION 'lefrancmathis@gmail.com not found on this database';
  END IF;

  SELECT array_agg(id) INTO v_p FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id = u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id = v_tennis AND ps.is_active
     ORDER BY u.id LIMIT 24) s;
  SELECT array_agg(id) INTO v_pk FROM (
    SELECT u.id FROM auth.users u JOIN player_sport ps ON ps.player_id = u.id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.sport_id = v_pickle AND ps.is_active
     ORDER BY u.id LIMIT 8) s;
  IF coalesce(array_length(v_p, 1), 0) < 24 THEN
    RAISE EXCEPTION 'need >=24 fake tennis players, found %', coalesce(array_length(v_p,1),0);
  END IF;

  -- ===================== THE TESTER ORGANIZES =====================

  -- 1. Draft — nothing published yet; edit freely, then open registration.
  PERFORM pg_temp.t_new(v_tester, '[SEED-T] Brouillon', v_tennis, 'draft', 16::smallint,
    'open', 'public', 'singles',
    'Brouillon. Testez l''edition libre puis l''ouverture des inscriptions.',
    v_facility, 'Club de Tennis de Monkland');

  -- 2. Registration open, filling up — the discovery + roster baseline.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Inscriptions ouvertes', v_tennis, 'registration_open',
    16::smallint, 'open', 'public', 'singles',
    'Inscriptions ouvertes. 5 joueurs inscrits sur 16.', v_facility, 'Parc Jeanne-Mance');
  FOR i IN 1..5 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- 3. Approval mode with a pending queue — approve / refuse each request.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Demandes a approuver', v_tennis, 'registration_open',
    16::smallint, 'approval', 'public', 'singles',
    'Mode approbation. 4 demandes en attente, 2 deja acceptees.', v_facility, 'Stade IGA');
  FOR i IN 1..2 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  FOR i IN 3..6 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'pending'); END LOOP;

  -- 4. Invite-only + an active share link + invitations in flight.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Sur invitation', v_tennis, 'registration_open',
    8::smallint, 'invite_only', 'public', 'singles',
    'Sur invitation. Lien de partage actif, 2 invitations en attente, 1 acceptee.',
    v_facility, 'Tennis 13');
  PERFORM pg_temp.t_reg(v_t.id, v_p[1], 'registered', NULL, NULL, v_tester);
  FOR i IN 2..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'pending', NULL, NULL, v_tester); END LOOP;
  PERFORM pg_temp.seed_set_user(v_tester);
  PERFORM tournament_invite_get_or_create(v_t.id);

  -- 5. Registration closed with 6 players — generating the bracket yields an
  --    8-draw with 2 byes. This is the "generate the bracket" test.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Pret pour le tableau', v_tennis, 'registration_closed',
    8::smallint, 'open', 'public', 'singles',
    '6 inscrits, tirage a 8 => 2 exemptions (byes). Generez le tableau.',
    v_facility, 'Club de Tennis de Monkland', p_reg_closes_in => '-1 day');
  FOR i IN 1..6 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'registered', NULL, i::smallint); END LOOP;

  -- 6. Live bracket — round 1 played, semi-finals waiting for a result.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Tableau en cours', v_tennis, 'registration_closed',
    8::smallint, 'open', 'public', 'singles',
    'Tableau vivant. Premier tour joue, demi-finales a arbitrer.',
    v_facility, 'Parc Jarry', p_start_in => '-1 day', p_reg_closes_in => '-3 days');
  FOR i IN 1..8 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'registered', NULL, i::smallint); END LOOP;
  PERFORM pg_temp.t_bracket(v_t.id, v_tester);
  PERFORM pg_temp.t_play_round(v_t.id, 1, '6-4 6-3');

  -- 7. Completed with a champion. The tester IS a certified organizer, so this
  --    one awards Points Rallia (champion / finalist / semifinal / participated).
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Termine (champion, avec points)', v_tennis,
    'registration_closed', 8::smallint, 'open', 'public', 'singles',
    'Termine sous un organisateur certifie => points Rallia attribues.',
    v_facility, 'Stade IGA', p_min_rating => 3.0,
    p_start_in => '-5 days', p_reg_closes_in => '-7 days');
  PERFORM pg_temp.t_reg(v_t.id, v_p[1], 'registered', NULL, 1::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_peer,  'registered', NULL, 2::smallint);
  FOR i IN 2..7 LOOP
    PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'registered', NULL, (i + 1)::smallint);
  END LOOP;
  PERFORM pg_temp.t_bracket(v_t.id, v_tester);
  PERFORM pg_temp.t_play_round(v_t.id, 1, '6-4 6-2');
  PERFORM pg_temp.t_play_round(v_t.id, 2, '7-6 6-4');
  PERFORM pg_temp.t_play_round(v_t.id, 3, '6-3 4-6 7-5');

  -- 8. NEGATIVE CONTROL for the certified-organizer gate: same shape, run by a
  --    non-certified organizer, so it must award zero ranking points.
  v_t := pg_temp.t_new(v_p[19], '[SEED-T] Termine sans points (non certifie)', v_tennis,
    'registration_closed', 4::smallint, 'open', 'public', 'singles',
    'Organisateur NON certifie. Aucun point Rallia ne doit etre attribue.',
    v_facility, 'Parc La Fontaine', p_start_in => '-8 days', p_reg_closes_in => '-10 days');
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'registered', NULL, 1::smallint);
  FOR i IN 1..3 LOOP
    PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'registered', NULL, (i + 1)::smallint);
  END LOOP;
  PERFORM pg_temp.t_bracket(v_t.id, v_p[19]);
  PERFORM pg_temp.t_play_round(v_t.id, 1, '6-1 6-2');
  PERFORM pg_temp.t_play_round(v_t.id, 2, '6-4 6-4');

  -- 9. Cancelled with a reason.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Annule', v_tennis, 'registration_open',
    8::smallint, 'open', 'public', 'singles',
    'Annule par l''organisateur. Verifiez l''avis aux inscrits.', v_facility, 'Parc La Fontaine');
  FOR i IN 1..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_tester);
  SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
  PERFORM tournament_cancel(v_t.id, 'Terrains indisponibles', v_v);

  -- 10. Archived — read-only, out of the active lists.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Archive', v_tennis, 'registration_open',
    8::smallint, 'open', 'public', 'singles',
    'Archive. Ne doit plus apparaitre dans les listes actives.',
    v_facility, 'Centre sportif de Verdun', p_start_in => '-60 days', p_reg_closes_in => '-65 days');
  FOR i IN 1..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_tester);
  SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
  PERFORM tournament_cancel(v_t.id, 'Saison terminee', v_v);
  SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
  PERFORM tournament_archive(v_t.id, v_v);

  -- 11. Full draw — the TOURNAMENT_FULL path.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Complet (4 sur 4)', v_tennis, 'registration_open',
    4::smallint, 'open', 'public', 'singles',
    'Tirage complet. Une inscription de plus doit etre refusee.', v_facility, 'Parc Jeanne-Mance');
  FOR i IN 1..4 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- 12. Private visibility — invisible in discovery, reachable by link.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Prive', v_tennis, 'registration_open',
    8::smallint, 'open', 'private', 'singles',
    'Prive. Absent de la decouverte publique.', NULL, NULL);
  FOR i IN 1..2 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- 13. Community visibility — only members of the network see it.
  SELECT n.id INTO v_net
    FROM network n
    JOIN network_type nt ON nt.id = n.network_type_id
    JOIN network_member nm ON nm.network_id = n.id
   WHERE nt.name = 'community' AND nm.player_id = v_tester
   ORDER BY n.name LIMIT 1;
  IF v_net IS NOT NULL THEN
    v_t := pg_temp.t_new(v_p[1], '[SEED-T] Communaute (reserve aux membres)', v_tennis,
      'registration_open', 8::smallint, 'open', 'community', 'singles',
      'Visibilite communaute. Absent de la decouverte publique.',
      v_facility, 'Club de Tennis de Monkland', p_start_in => '18 days');
    UPDATE tournaments SET network_id = v_net WHERE id = v_t.id;
    FOR i IN 2..4 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  END IF;

  -- 14. Reputation gate (the rating gates are covered by the Série 1 draws).
  PERFORM pg_temp.t_new(v_tester, '[SEED-T] Reputation minimale 40', v_tennis, 'registration_open',
    8::smallint, 'open', 'public', 'singles',
    'Reputation minimale de 40 exigee a l''inscription.', v_facility, 'Tennis 13',
    p_min_rep => 40::smallint);

  -- 15. Doubles, live bracket — 4 pairs.
  v_t := pg_temp.t_new(v_tester, '[SEED-T] Double - tableau en cours', v_tennis,
    'registration_closed', 4::smallint, 'open', 'public', 'doubles',
    'Double. 4 equipes, premier tour joue.', v_facility, 'Parc Jarry',
    p_start_in => '-1 day', p_reg_closes_in => '-3 days');
  PERFORM pg_temp.t_reg(v_t.id, v_p[1], 'registered', v_p[2], 1::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[3], 'registered', v_p[4], 2::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[5], 'registered', v_p[6], 3::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[7], 'registered', v_p[8], 4::smallint);
  PERFORM pg_temp.t_bracket(v_t.id, v_tester);
  PERFORM pg_temp.t_play_round(v_t.id, 1, '6-4 6-4');

  -- ===================== PICKLEBALL (same tester) =====================
  -- The tester plays both sports, so the second universe needs no extra login.

  IF coalesce(array_length(v_pk, 1), 0) >= 6 THEN
    -- 16. Registration open, tester organizes and plays.
    v_t := pg_temp.t_new(v_tester, '[SEED-T] Pickleball - inscriptions ouvertes', v_pickle,
      'registration_open', 16::smallint, 'open', 'public', 'singles',
      'Tournoi de pickleball, inscriptions ouvertes.', v_facility, 'Complexe sportif d''Anjou');
    FOR i IN 1..5 LOOP PERFORM pg_temp.t_reg(v_t.id, v_pk[i]); END LOOP;

    -- 17. Live pickleball bracket — checks the sport-specific score format.
    v_t := pg_temp.t_new(v_tester, '[SEED-T] Pickleball - tableau en cours', v_pickle,
      'registration_closed', 4::smallint, 'open', 'public', 'singles',
      'Pickleball. Premier tour joue, finale a arbitrer.', v_facility, 'Arena Saint-Michel',
      p_start_in => '-1 day', p_reg_closes_in => '-3 days');
    FOR i IN 1..4 LOOP
      PERFORM pg_temp.t_reg(v_t.id, v_pk[i], 'registered', NULL, i::smallint);
    END LOOP;
    PERFORM pg_temp.t_bracket(v_t.id, v_tester);
    PERFORM pg_temp.t_play_round(v_t.id, 1, '11-7 11-9');

    -- 18. Pickleball where the tester PLAYS, peer organizes.
    v_t := pg_temp.t_new(v_peer, '[SEED-T] Pickleball - vous jouez', v_pickle,
      'registration_open', 8::smallint, 'open', 'public', 'singles',
      'Pickleball organise par quelqu''un d''autre. Vous etes inscrit.',
      v_facility, 'Complexe sportif d''Anjou');
    PERFORM pg_temp.t_reg(v_t.id, v_tester);
    FOR i IN 1..4 LOOP PERFORM pg_temp.t_reg(v_t.id, v_pk[i]); END LOOP;
  END IF;

  -- ===================== THE TESTER PLAYS =====================
  -- The peer organizes these so a real second human can approve requests,
  -- revoke invitations and send the share link.

  -- 19. A bracket match to play. Two ways in, both seeded:
  --     (a) the round chat -> "organiser la partie" pre-play link, and
  --     (b) an already-played, verified casual game ready to link, so the
  --         "Lier une partie jouee" picker is not empty.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - match a jouer', v_tennis,
    'registration_closed', 4::smallint, 'open', 'public', 'singles',
    'Vous avez un match au premier tour. Organisez la partie ou liez-en une deja jouee.',
    v_facility, 'Club de Tennis de Monkland', p_start_in => '-1 day', p_reg_closes_in => '-3 days');
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'registered', NULL, 1::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[11],  'registered', NULL, 2::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[12],  'registered', NULL, 3::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[13],  'registered', NULL, 4::smallint);
  PERFORM pg_temp.t_bracket(v_t.id, v_peer);

  SELECT CASE WHEN r1.user_id = v_tester THEN r2.user_id ELSE r1.user_id END
    INTO v_opponent
    FROM tournament_matches tm
    JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
    JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
   WHERE tm.tournament_id = v_t.id AND tm.round_number = 1
     AND v_tester IN (r1.user_id, r2.user_id)
   LIMIT 1;

  IF v_opponent IS NOT NULL THEN
    INSERT INTO match (sport_id, match_date, start_time, end_time, created_by,
                       location_name, notes, format, location_type, facility_id,
                       timezone, visibility, join_mode)
    VALUES (v_tennis, current_date - 2, '18:00', '19:30', v_tester,
            'Club de Tennis de Monkland', '[SEED-T] linkable', 'singles', 'facility',
            v_facility, 'America/Toronto', 'public', 'direct')
    RETURNING id INTO v_match;
    -- A trigger already inserted the host row on match INSERT.
    UPDATE match_participant
       SET team_number = 1, status = 'joined', joined_at = now() - interval '3 days'
     WHERE match_id = v_match AND player_id = v_tester;
    INSERT INTO match_participant (match_id, player_id, team_number, is_host, status, joined_at)
    VALUES (v_match, v_opponent, 2, false, 'joined', now() - interval '3 days')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET team_number = 2, status = 'joined', joined_at = now() - interval '3 days';
    INSERT INTO match_result (match_id, winning_team, team1_score, team2_score,
                              is_verified, verified_at, submitted_by, confirmed_by)
    VALUES (v_match, 1, 2, 0, true, now() - interval '2 days', v_tester, v_opponent);
  END IF;

  -- 20. An invitation waiting for the tester to accept.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - invitation a accepter', v_tennis,
    'registration_open', 8::smallint, 'invite_only', 'public', 'singles',
    'Vous etes invite. Acceptez ou refusez.', v_facility, 'Parc Jeanne-Mance');
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'pending', NULL, NULL, v_peer);
  FOR i IN 14..16 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'registered', NULL, NULL, v_peer); END LOOP;

  -- 21. An active share link, tester not registered — the join-by-token flow.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - lien de partage', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'singles',
    'Rejoignez via le lien de partage (jeton actif).', v_facility, 'Stade IGA');
  FOR i IN 14..17 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  PERFORM pg_temp.seed_set_user(v_peer);
  PERFORM tournament_invite_get_or_create(v_t.id);

  -- 22. Approval mode, the tester's own request is pending — the peer decides.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - demande en attente', v_tennis,
    'registration_open', 16::smallint, 'approval', 'public', 'singles',
    'Votre demande attend l''approbation de l''organisateur.', v_facility, 'Tennis 13');
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'pending');
  FOR i IN 14..17 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- 23. A finished tournament the tester played — history, podium, points.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - termine', v_tennis,
    'registration_closed', 4::smallint, 'open', 'public', 'singles',
    'Tournoi termine auquel vous avez participe. Verifiez historique et parcours.',
    v_facility, 'Tennis 13', p_start_in => '-14 days', p_reg_closes_in => '-16 days');
  PERFORM pg_temp.t_reg(v_t.id, v_p[14],  'registered', NULL, 1::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'registered', NULL, 2::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[15],  'registered', NULL, 3::smallint);
  PERFORM pg_temp.t_reg(v_t.id, v_p[16],  'registered', NULL, 4::smallint);
  PERFORM pg_temp.t_bracket(v_t.id, v_peer);
  PERFORM pg_temp.t_play_round(v_t.id, 1, '6-3 6-4');
  PERFORM pg_temp.t_play_round(v_t.id, 2, '6-4 3-6 7-5');

  -- 24. A withdrawable registration — registration still open.
  v_t := pg_temp.t_new(v_p[24], '[SEED-T] Vous jouez - desistement possible', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'singles',
    'Vous etes inscrit et les inscriptions sont ouvertes. Testez le desistement.',
    v_facility, 'Parc Jarry');
  PERFORM pg_temp.t_reg(v_t.id, v_tester);
  FOR i IN 17..19 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- 25a-c. Doubles from the PLAYER's side. The doubles draw the tester
  --        organizes only exercises the organizer view; these three put them
  --        in the draw so partner selection, team withdrawal and the
  --        "you are someone's partner" state are reachable.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - double (choisir un partenaire)', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'doubles',
    'Double, inscriptions ouvertes. Inscrivez-vous: l''app doit d''abord vous faire choisir un partenaire.',
    v_facility, 'Parc Jarry', p_start_in => '16 days', p_reg_closes_in => '10 days');
  PERFORM pg_temp.t_reg(v_t.id, v_p[1], 'registered', v_p[2]);
  PERFORM pg_temp.t_reg(v_t.id, v_p[3], 'registered', v_p[4]);

  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - double (vous etes capitaine)', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'doubles',
    'Double. Vous etes capitaine avec un partenaire. Le desistement doit retirer toute l''equipe.',
    v_facility, 'Stade IGA', p_start_in => '16 days', p_reg_closes_in => '10 days');
  PERFORM pg_temp.t_reg(v_t.id, v_tester, 'registered', v_p[5]);
  PERFORM pg_temp.t_reg(v_t.id, v_p[1],   'registered', v_p[2]);
  PERFORM pg_temp.t_reg(v_t.id, v_p[3],   'registered', v_p[4]);

  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - double (vous etes partenaire)', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'doubles',
    'Double. Quelqu''un vous a inscrit comme partenaire. Verifiez que vous apparaissez dans son equipe.',
    v_facility, 'Tennis 13', p_start_in => '16 days', p_reg_closes_in => '10 days');
  PERFORM pg_temp.t_reg(v_t.id, v_p[6], 'registered', v_tester);
  PERFORM pg_temp.t_reg(v_t.id, v_p[1], 'registered', v_p[2]);

  -- 25d-h. The REFUSALS. These only mean anything if the tester is NOT an
  --        admin: `tournament_register` wraps the rating check in
  --        `IF NOT v_is_admin`, and the RLS policies are all `is_admin() OR …`,
  --        so an admin passes every one of them. jdl's admin row was removed on
  --        2026-07-26 for exactly this reason.
  --        The tester is rated 3.0 in tennis with reputation 0.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - cote minimale 4.0', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'singles',
    'Cote minimale 4.0. Vous etes cote 3.0: l''inscription doit etre REFUSEE.',
    v_facility, 'Tennis 13', p_min_rating => 4.0,
    p_start_in => '17 days', p_reg_closes_in => '10 days');
  FOR i IN 1..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - cote 2.5 a 3.5', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'singles',
    'Fourchette 2.5 a 3.5. Vous etes cote 3.0: l''inscription doit PASSER.',
    v_facility, 'Parc Jeanne-Mance', p_min_rating => 2.5, p_max_rating => 3.5,
    p_start_in => '17 days', p_reg_closes_in => '10 days');
  FOR i IN 1..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous jouez - reputation minimale 40', v_tennis,
    'registration_open', 8::smallint, 'open', 'public', 'singles',
    'Reputation minimale 40. La votre est a 0: l''inscription doit etre REFUSEE.',
    v_facility, 'Stade IGA', p_min_rep => 40::smallint,
    p_start_in => '17 days', p_reg_closes_in => '10 days');
  FOR i IN 1..3 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  v_t := pg_temp.t_new(v_peer, '[SEED-T] Prive - vous n''y etes pas', v_tennis,
    'registration_open', 8::smallint, 'open', 'private', 'singles',
    'Prive, organise par quelqu''un d''autre, vous n''y etes pas. Il ne doit PAS apparaitre.',
    v_facility, 'Parc Jarry', p_start_in => '17 days', p_reg_closes_in => '10 days');
  FOR i IN 1..2 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;

  -- A community the tester is NOT in, so discovery must hide it.
  SELECT n.id INTO v_net
    FROM network n JOIN network_type nt ON nt.id = n.network_type_id
   WHERE nt.name = 'community'
     AND NOT EXISTS (SELECT 1 FROM network_member m WHERE m.network_id = n.id AND m.player_id = v_tester)
     AND EXISTS (SELECT 1 FROM network_member m WHERE m.network_id = n.id)
   ORDER BY n.name LIMIT 1;
  IF v_net IS NOT NULL THEN
    v_t := pg_temp.t_new(v_peer, '[SEED-T] Communaute - vous n''en etes pas membre', v_tennis,
      'registration_open', 8::smallint, 'open', 'community', 'singles',
      'Communaute dont vous n''etes PAS membre. Il ne doit PAS apparaitre dans la decouverte.',
      v_facility, 'Parc La Fontaine', p_start_in => '17 days', p_reg_closes_in => '10 days');
    UPDATE tournaments SET network_id = v_net WHERE id = v_t.id;
    FOR i IN 1..2 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  END IF;

  -- 26. The tester as CO-ORGANIZER — same powers minus delete / transfer.
  v_t := pg_temp.t_new(v_peer, '[SEED-T] Vous etes co-organisateur', v_tennis,
    'registration_open', 16::smallint, 'approval', 'public', 'singles',
    'Vous etes co-organisateur: memes pouvoirs sauf supprimer ou transferer.',
    v_facility, 'Parc Jeanne-Mance');
  INSERT INTO tournament_co_organizers (tournament_id, user_id, added_by, added_at)
  VALUES (v_t.id, v_tester, v_peer, now());
  FOR i IN 6..9   LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i]); END LOOP;
  FOR i IN 10..12 LOOP PERFORM pg_temp.t_reg(v_t.id, v_p[i], 'pending'); END LOOP;

  RAISE NOTICE 'Seeded % [SEED-T] tournaments',
    (SELECT count(*) FROM tournaments WHERE name LIKE '[SEED-T] %');
END $$;

COMMIT;

-- ============================================================================
-- Seed the league test-guide fixtures ([JDL Host] / [JDL Plays])
--
-- Mirrors scripts/tournaments (the JDL fixtures behind the tournament test
-- guide). [JDL Host] leagues are organized by jdl.sonkin (the tester plays
-- organizer); [JDL Plays] leagues are organized by Mathis or a seeded player
-- (the tester is a participant). Covers the full V6-V10 + invite lifecycle.
--
-- Target: rallia-staging. Idempotent: removes prior [JDL Host]/[JDL Plays] rows.
-- Run:
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/leagues/seed-test-guide-fixtures.sql
--   (or npm run db:seed:leagues:test-guide)
--
-- Notes:
--   - jdl.sonkin is granted super_admin (no-op on staging where it already is)
--     so it bypasses the league-create rate limit and plays both sports.
--   - Falls back to seeded players when jdl/Mathis accounts are absent (local).
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup previous batch (leagues cascade to seasons/sessions/members/rankings)
-- --------------------------------------------------------------------------
-- Targeted: only notifications pointing at this batch's leagues/seasons/sessions.
DELETE FROM notification WHERE target_id IN (
  SELECT id FROM leagues WHERE name LIKE '[JDL Host]%' OR name LIKE '[JDL Plays]%'
  UNION SELECT se.id FROM seasons se JOIN leagues l ON l.id = se.league_id
        WHERE l.name LIKE '[JDL Host]%' OR l.name LIKE '[JDL Plays]%'
  UNION SELECT ss.id FROM sessions ss JOIN seasons se ON se.id = ss.season_id
        JOIN leagues l ON l.id = se.league_id
        WHERE l.name LIKE '[JDL Host]%' OR l.name LIKE '[JDL Plays]%'
);
DELETE FROM leagues_tournaments_audit
 WHERE scope = 'league'
   AND entity_id IN (SELECT id FROM leagues WHERE name LIKE '[JDL Host]%' OR name LIKE '[JDL Plays]%');
DELETE FROM leagues WHERE name LIKE '[JDL Host]%' OR name LIKE '[JDL Plays]%';

-- --------------------------------------------------------------------------
-- Helpers (each impersonates a user via the JWT-claims GUC, then calls an RPC)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.s_user(p uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_league(
  p_org uuid, p_name text, p_sport uuid,
  p_vis tournament_visibility DEFAULT 'public',
  p_join tournament_registration_mode DEFAULT 'open',
  p_desc text DEFAULT NULL, p_venue text DEFAULT NULL, p_fac uuid DEFAULT NULL,
  p_minr numeric DEFAULT NULL, p_maxr numeric DEFAULT NULL,
  p_level text DEFAULT NULL, p_cap integer DEFAULT NULL, p_wait boolean DEFAULT false
) RETURNS leagues AS $$
DECLARE v leagues;
BEGIN
  PERFORM pg_temp.s_user(p_org);
  SELECT * INTO v FROM league_create(
    p_name => p_name, p_sport_id => p_sport, p_description => p_desc,
    p_visibility => p_vis, p_join_mode => p_join, p_facility_id => p_fac,
    p_venue_name => p_venue, p_min_rating => p_minr, p_max_rating => p_maxr);
  UPDATE leagues SET level = p_level, member_capacity = p_cap,
         waitlist_enabled = COALESCE(p_wait, false)
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_join(p_user uuid, p_lg uuid) RETURNS league_members AS $$
DECLARE v league_members;
BEGIN PERFORM pg_temp.s_user(p_user); SELECT * INTO v FROM league_join(p_lg); RETURN v; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_approve(p_org uuid, p_user uuid, p_lg uuid) RETURNS void AS $$
DECLARE v_id uuid; v_ver int;
BEGIN
  SELECT id, version INTO v_id, v_ver FROM league_members WHERE league_id = p_lg AND user_id = p_user;
  PERFORM pg_temp.s_user(p_org); PERFORM league_approve_member(v_id, v_ver);
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_invite(p_org uuid, p_lg uuid, p_users uuid[]) RETURNS void AS $$
BEGIN PERFORM pg_temp.s_user(p_org); PERFORM league_invite_members(p_lg, p_users); END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_open_season(p_org uuid, p_lg uuid, p_name text) RETURNS seasons AS $$
DECLARE v seasons;
BEGIN
  PERFORM pg_temp.s_user(p_org);
  SELECT * INTO v FROM season_create(p_lg, p_name, current_date, current_date + 120);
  SELECT * INTO v FROM season_open(v.id, v.version);
  RETURN v;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_session(p_org uuid, p_season uuid, p_name text, p_cap int DEFAULT NULL)
RETURNS sessions AS $$
DECLARE v sessions;
BEGIN
  PERFORM pg_temp.s_user(p_org);
  SELECT * INTO v FROM session_create(p_season_id => p_season, p_name => p_name,
    p_scheduled_at => now() + interval '3 days', p_timezone => 'America/Toronto',
    p_capacity => p_cap::smallint);
  RETURN v;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_publish(p_org uuid, p_sess uuid) RETURNS void AS $$
DECLARE v_ver int;
BEGIN PERFORM pg_temp.s_user(p_org); SELECT version INTO v_ver FROM sessions WHERE id = p_sess;
  PERFORM session_publish(p_sess, NULL, v_ver); END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_confirm(p_user uuid, p_sess uuid) RETURNS void AS $$
BEGIN PERFORM pg_temp.s_user(p_user); PERFORM session_confirm_presence(p_sess, 'confirmed', NULL); END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_sheet(p_org uuid, p_sess uuid) RETURNS void AS $$
DECLARE v_ver int;
BEGIN PERFORM pg_temp.s_user(p_org); SELECT version INTO v_ver FROM sessions WHERE id = p_sess;
  PERFORM session_generate_sheet(p_sess, v_ver); END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_score_all(p_org uuid, p_sess uuid) RETURNS void AS $$
DECLARE m record;
BEGIN
  PERFORM pg_temp.s_user(p_org);
  FOR m IN SELECT id, version FROM session_matches WHERE session_id = p_sess AND status = 'pending' LOOP
    PERFORM session_record_score(m.id, 'a', '6-4 6-2', 'completed', m.version);
  END LOOP;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.s_close(p_org uuid, p_season uuid) RETURNS void AS $$
DECLARE v_ver int;
BEGIN PERFORM pg_temp.s_user(p_org); SELECT version INTO v_ver FROM seasons WHERE id = p_season;
  PERFORM season_close(p_season, v_ver); END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Build the fixtures
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis uuid; v_pickle uuid; v_fac uuid;
  v_jdl uuid; v_mathis uuid;
  v_raw uuid[]; v_m uuid[];     -- raw player pool / members (excl. jdl + mathis)
  v_lg leagues; v_se seasons; v_ss sessions;
  i int;
BEGIN
  SELECT id INTO v_tennis FROM sport WHERE name = 'tennis';
  SELECT id INTO v_pickle FROM sport WHERE name = 'pickleball';
  SELECT id INTO v_fac FROM facility WHERE is_active ORDER BY created_at LIMIT 1;

  SELECT id INTO v_jdl FROM auth.users WHERE email = 'jdl.sonkin@gmail.com';
  SELECT id INTO v_mathis FROM auth.users WHERE email = 'lefrancmathis@gmail.com';

  SELECT array_agg(player_id ORDER BY player_id) INTO v_raw FROM (
    SELECT ps.player_id FROM player_sport ps
     WHERE ps.sport_id = v_tennis AND ps.is_active = true
     ORDER BY ps.player_id LIMIT 40) x;
  IF coalesce(array_length(v_raw, 1), 0) < 8 THEN
    RAISE EXCEPTION 'need >= 8 active tennis players to seed';
  END IF;

  -- Fallbacks when the real accounts are absent (local dev).
  IF v_jdl IS NULL THEN v_jdl := v_raw[1]; END IF;
  IF v_mathis IS NULL THEN v_mathis := (SELECT u FROM unnest(v_raw) u WHERE u <> v_jdl LIMIT 1); END IF;

  -- Members = pool minus jdl + mathis.
  SELECT array_agg(u ORDER BY u) INTO v_m
    FROM unnest(v_raw) u WHERE u <> v_jdl AND u <> v_mathis;

  -- jdl: super_admin (rate-limit bypass) + plays both sports.
  INSERT INTO admin (id, role) VALUES (v_jdl, 'super_admin') ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM player_sport WHERE player_id = v_jdl AND sport_id = v_tennis)
    THEN INSERT INTO player_sport (player_id, sport_id, is_active) VALUES (v_jdl, v_tennis, true); END IF;
  IF NOT EXISTS (SELECT 1 FROM player_sport WHERE player_id = v_jdl AND sport_id = v_pickle)
    THEN INSERT INTO player_sport (player_id, sport_id, is_active) VALUES (v_jdl, v_pickle, true); END IF;

  -- =======================================================================
  -- [JDL Host] — jdl is organizer
  -- =======================================================================

  -- 1. Approval requests: 2 pending self-requests awaiting jdl.
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Approval Requests', v_tennis, 'public', 'approval',
    'Mode approbation — 2 demandes en attente.', 'Club de Tennis de Monkland', v_fac);
  PERFORM pg_temp.s_join(v_m[1], v_lg.id);
  PERFORM pg_temp.s_join(v_m[2], v_lg.id);

  -- 2. Invite only: 1 active + 2 outstanding invites (awaiting response).
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Invite Only', v_tennis, 'public', 'invite_only',
    'Sur invitation — capacité 12.', 'Centre sportif de Verdun', v_fac,
    p_level => 'advanced', p_cap => 12, p_wait => true);
  PERFORM pg_temp.s_invite(v_jdl, v_lg.id, ARRAY[v_m[3], v_m[4]]);   -- 2 outstanding invites
  PERFORM pg_temp.s_invite(v_jdl, v_lg.id, ARRAY[v_m[5]]);           -- invite m5, who accepts
  PERFORM pg_temp.s_user(v_m[5]); PERFORM league_accept_invite(v_lg.id);  -- -> 1 active member

  -- 3. Draft season (ready to open).
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Draft Season', v_tennis, 'public', 'open',
    'Saison en brouillon — prête à ouvrir.', 'Parc Jeanne-Mance', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  PERFORM pg_temp.s_user(v_jdl);
  PERFORM season_create(v_lg.id, 'Automne 2026', current_date + 14, current_date + 134);

  -- 4. Open season, no session yet.
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Open Season', v_tennis, 'public', 'open',
    'Saison ouverte — crée et publie une séance.', 'Club de Tennis de Monkland', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  PERFORM pg_temp.s_open_season(v_jdl, v_lg.id, 'Été 2026');

  -- 5. Published session (members confirmed) -> generate the sheet.
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Published Session', v_tennis, 'public', 'open',
    'Séance publiée, membres confirmés — génère la feuille.', 'Parc La Fontaine', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_jdl, v_lg.id, 'Été 2026');
  v_ss := pg_temp.s_session(v_jdl, v_se.id, 'Mardi soir');
  PERFORM pg_temp.s_publish(v_jdl, v_ss.id);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;

  -- 6. Match sheet generated (pending matches) -> record / lock / regenerate.
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Match Sheet Ready', v_tennis, 'public', 'open',
    'Feuille générée — entre des scores, verrouille, régénère.', 'Tennis 13', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_jdl, v_lg.id, 'Été 2026');
  v_ss := pg_temp.s_session(v_jdl, v_se.id, 'Jeudi soir');
  PERFORM pg_temp.s_publish(v_jdl, v_ss.id);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;
  PERFORM pg_temp.s_sheet(v_jdl, v_ss.id);

  -- 7. Live standings: a completed (scored) session, season still open.
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Live Standings', v_tennis, 'public', 'open',
    'Séance jouée — consulte le classement, ferme la saison.', 'Parc Jarry', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_jdl, v_lg.id, 'Été 2026');
  v_ss := pg_temp.s_session(v_jdl, v_se.id, 'Soirée 1');
  PERFORM pg_temp.s_publish(v_jdl, v_ss.id);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;
  PERFORM pg_temp.s_sheet(v_jdl, v_ss.id);
  PERFORM pg_temp.s_score_all(v_jdl, v_ss.id);

  -- 8. Closed season (final standings, view only).
  v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Closed Season', v_tennis, 'public', 'open',
    'Saison fermée — classement final figé.', 'Stade IGA', v_fac);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_jdl, v_lg.id, 'Printemps 2026');
  v_ss := pg_temp.s_session(v_jdl, v_se.id, 'Finale');
  PERFORM pg_temp.s_publish(v_jdl, v_ss.id);
  FOR i IN 1..4 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;
  PERFORM pg_temp.s_sheet(v_jdl, v_ss.id);
  PERFORM pg_temp.s_score_all(v_jdl, v_ss.id);
  PERFORM pg_temp.s_close(v_jdl, v_se.id);

  -- 9. Pickleball league (sport variety). Skip members who don't play pickleball.
  BEGIN
    v_lg := pg_temp.s_league(v_jdl, '[JDL Host] Pickleball', v_pickle, 'public', 'open',
      'Ligue de pickleball — parties à 11.', 'Complexe sportif d''Anjou', v_fac);
    FOR i IN 1..6 LOOP
      BEGIN PERFORM pg_temp.s_join(v_m[i], v_lg.id); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skipped pickleball host fixture: %', SQLERRM;
  END;

  -- =======================================================================
  -- [JDL Plays] — jdl is a participant
  -- =======================================================================

  -- A. Pending approval (Mathis organizes; jdl self-requested).
  v_lg := pg_temp.s_league(v_mathis, '[JDL Plays] Pending Approval', v_tennis, 'public', 'approval',
    'Mathis organise — ta demande est en attente d''approbation.', 'Parc Jeanne-Mance', v_fac);
  PERFORM pg_temp.s_join(v_jdl, v_lg.id);

  -- B. Invited (Mathis organizes; jdl invited, awaiting accept).
  v_lg := pg_temp.s_league(v_mathis, '[JDL Plays] Invited', v_tennis, 'public', 'approval',
    'Mathis t''a invité — accepte l''invitation dans l''app.', 'Club de Tennis de Monkland', v_fac);
  PERFORM pg_temp.s_invite(v_mathis, v_lg.id, ARRAY[v_jdl]);

  -- C. Session to confirm (seeded organizer; jdl active, a published session).
  v_lg := pg_temp.s_league(v_m[1], '[JDL Plays] Session To Confirm', v_tennis, 'public', 'open',
    'Tu es membre — confirme (ou décline) ta présence à la séance.', 'Parc La Fontaine', v_fac);
  PERFORM pg_temp.s_join(v_jdl, v_lg.id);
  FOR i IN 2..4 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_m[1], v_lg.id, 'Été 2026');
  v_ss := pg_temp.s_session(v_m[1], v_se.id, 'Mercredi soir');
  PERFORM pg_temp.s_publish(v_m[1], v_ss.id);

  -- D. To score (jdl in a generated match; records their own game).
  v_lg := pg_temp.s_league(v_m[2], '[JDL Plays] To Score', v_tennis, 'public', 'open',
    'Tu as une partie au programme — entre ton pointage.', 'Tennis 13', v_fac);
  PERFORM pg_temp.s_join(v_jdl, v_lg.id);
  FOR i IN 3..5 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_m[2], v_lg.id, 'Été 2026');
  v_ss := pg_temp.s_session(v_m[2], v_se.id, 'Vendredi soir');
  PERFORM pg_temp.s_publish(v_m[2], v_ss.id);
  PERFORM pg_temp.s_confirm(v_jdl, v_ss.id);
  FOR i IN 3..5 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;
  PERFORM pg_temp.s_sheet(v_m[2], v_ss.id);

  -- E. Closed season (jdl finished a season; final standings include jdl).
  v_lg := pg_temp.s_league(v_m[3], '[JDL Plays] Closed Season', v_tennis, 'public', 'open',
    'Saison terminée — consulte ton rang final.', 'Stade IGA', v_fac);
  PERFORM pg_temp.s_join(v_jdl, v_lg.id);
  FOR i IN 4..6 LOOP PERFORM pg_temp.s_join(v_m[i], v_lg.id); END LOOP;
  v_se := pg_temp.s_open_season(v_m[3], v_lg.id, 'Hiver 2026');
  v_ss := pg_temp.s_session(v_m[3], v_se.id, 'Soirée finale');
  PERFORM pg_temp.s_publish(v_m[3], v_ss.id);
  PERFORM pg_temp.s_confirm(v_jdl, v_ss.id);
  FOR i IN 4..6 LOOP PERFORM pg_temp.s_confirm(v_m[i], v_ss.id); END LOOP;
  PERFORM pg_temp.s_sheet(v_m[3], v_ss.id);
  PERFORM pg_temp.s_score_all(v_m[3], v_ss.id);
  PERFORM pg_temp.s_close(v_m[3], v_se.id);

  RAISE NOTICE 'Seeded % JDL leagues',
    (SELECT count(*) FROM leagues WHERE name LIKE '[JDL Host]%' OR name LIKE '[JDL Plays]%');
END $$;

COMMIT;

-- Verify
SELECT l.name, sp.name AS sport, l.join_mode, l.status,
       (SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id AND lm.status = 'active') AS active,
       (SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id AND lm.status = 'pending') AS pending,
       (SELECT count(*) FROM seasons se WHERE se.league_id = l.id) AS seasons
  FROM leagues l JOIN sport sp ON sp.id = l.sport_id
 WHERE l.name LIKE '[JDL Host]%' OR l.name LIKE '[JDL Plays]%'
 ORDER BY l.name;

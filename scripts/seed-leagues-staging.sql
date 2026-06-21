-- ============================================================================
-- Seed staging with diverse leagues (V6 discovery / detail testing)
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
-- Idempotent: removes prior rows whose name starts with "[SEED] "
--
-- Run via Supabase MCP execute_sql, or:
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/seed-leagues-staging.sql
--   npm run db:seed:leagues:staging
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Cleanup previous seed batch
-- --------------------------------------------------------------------------
DELETE FROM season_rankings
 WHERE season_id IN (
   SELECT s.id FROM seasons s
   JOIN leagues l ON l.id = s.league_id
  WHERE l.name LIKE '[SEED] %'
 );

DELETE FROM seasons
 WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');

DELETE FROM league_members
 WHERE league_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');

DELETE FROM leagues_tournaments_audit
 WHERE scope = 'league'
   AND entity_id IN (SELECT id FROM leagues WHERE name LIKE '[SEED] %');

DELETE FROM leagues WHERE name LIKE '[SEED] %';

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_set_user(p_user uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.seed_create_league(
  p_organizer   uuid,
  p_name        text,
  p_sport_id    uuid,
  p_visibility  tournament_visibility DEFAULT 'public',
  p_join_mode   tournament_registration_mode DEFAULT 'open',
  p_description text DEFAULT NULL,
  p_venue_name  text DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL,
  p_min_rating  numeric DEFAULT NULL,
  p_max_rating  numeric DEFAULT NULL,
  p_min_rep     smallint DEFAULT NULL,
  p_level       text DEFAULT NULL,
  p_capacity    integer DEFAULT NULL,
  p_waitlist    boolean DEFAULT false,
  p_status      league_status DEFAULT 'active'
) RETURNS leagues AS $$
DECLARE
  v_league leagues;
BEGIN
  PERFORM pg_temp.seed_set_user(p_organizer);
  SELECT * INTO v_league FROM league_create(
    p_name        => p_name,
    p_sport_id    => p_sport_id,
    p_description => p_description,
    p_visibility  => p_visibility,
    p_join_mode   => p_join_mode,
    p_facility_id => p_facility_id,
    p_venue_name  => p_venue_name,
    p_min_rating  => p_min_rating,
    p_max_rating  => p_max_rating,
    p_min_reputation => p_min_rep
  );

  UPDATE leagues
     SET level = p_level,
         member_capacity = p_capacity,
         waitlist_enabled = COALESCE(p_waitlist, false),
         status = p_status
   WHERE id = v_league.id
  RETURNING * INTO v_league;

  RETURN v_league;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.seed_join(
  p_user uuid,
  p_league_id uuid
) RETURNS league_members AS $$
DECLARE
  v_row league_members;
BEGIN
  PERFORM pg_temp.seed_set_user(p_user);
  SELECT * INTO v_row FROM league_join(p_league_id);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.seed_approve(
  p_organizer uuid,
  p_member_id uuid,
  p_version integer
) RETURNS league_members AS $$
DECLARE
  v_row league_members;
BEGIN
  PERFORM pg_temp.seed_set_user(p_organizer);
  SELECT * INTO v_row FROM league_approve_member(p_member_id, p_version);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------------
-- Seed data
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tennis      uuid;
  v_pickle      uuid;
  v_facility    uuid;
  v_organizers  uuid[];
  v_members     uuid[];
  v_mathis      uuid;
  v_league      leagues;
  v_member      league_members;
  v_season      seasons;
  i             integer;
BEGIN
  SELECT id INTO v_tennis FROM sport WHERE name = 'tennis';
  SELECT id INTO v_pickle FROM sport WHERE name = 'pickleball';
  IF v_tennis IS NULL OR v_pickle IS NULL THEN
    RAISE EXCEPTION 'sport rows missing (tennis / pickleball)';
  END IF;

  SELECT id INTO v_facility
    FROM facility
   WHERE is_active = true
   ORDER BY created_at
   LIMIT 1;

  SELECT id INTO v_mathis FROM auth.users WHERE email = 'lefrancmathis@gmail.com';

  SELECT array_agg(id ORDER BY id)
    INTO v_organizers
    FROM (
      SELECT u.id
        FROM auth.users u
        JOIN player_sport ps
          ON ps.player_id = u.id
         AND ps.sport_id = v_tennis
         AND ps.is_active = true
       WHERE u.id::text LIKE 'a1000000-0000-0000-0000-00000000%'
       ORDER BY u.id
       LIMIT 12
    ) seeded;

  IF v_organizers IS NULL OR array_length(v_organizers, 1) < 4 THEN
    SELECT array_agg(player_id ORDER BY player_id)
      INTO v_organizers
      FROM (
        SELECT ps.player_id
          FROM player_sport ps
         WHERE ps.sport_id = v_tennis AND ps.is_active = true
         ORDER BY ps.player_id
         LIMIT 12
      ) fallback;
  END IF;

  IF v_organizers IS NULL OR array_length(v_organizers, 1) < 4 THEN
    RAISE EXCEPTION 'need at least 4 active tennis players to seed leagues';
  END IF;

  v_members := v_organizers;

  -- 1. Public open tennis — discovery baseline
  v_league := pg_temp.seed_create_league(
    v_organizers[1], '[SEED] Plateau Open Ladder', v_tennis,
    'public', 'open',
    'Weekly ladder for all levels. Drop-in friendly.',
    'Club de Tennis de Monkland', v_facility
  );
  FOR i IN 2..5 LOOP
    PERFORM pg_temp.seed_join(v_members[i], v_league.id);
  END LOOP;

  -- 2. Public approval + rating gate + level
  v_league := pg_temp.seed_create_league(
    v_organizers[2], '[SEED] NTRP 3.5–4.5 League', v_tennis,
    'public', 'approval',
    'Intermediate competitive league. Organizer approves each member.',
    'Parc Jeanne-Mance', v_facility,
    p_min_rating => 3.5, p_max_rating => 4.5, p_level => 'intermediate'
  );
  v_member := pg_temp.seed_join(v_members[3], v_league.id);
  PERFORM pg_temp.seed_approve(v_organizers[2], v_member.id, v_member.version);
  v_member := pg_temp.seed_join(v_members[4], v_league.id);
  -- leave one pending for approval UI

  -- 3. Public invite-only + capacity
  v_league := pg_temp.seed_create_league(
    v_organizers[3], '[SEED] Elite Invite League', v_tennis,
    'public', 'invite_only',
    'Invite-only roster. Capacity capped at 12.',
    'Centre sportif de Verdun', v_facility,
    p_min_rating => 4.0, p_level => 'advanced',
    p_capacity => 12, p_waitlist => true
  );
  INSERT INTO league_members (league_id, user_id, role, status)
  VALUES (v_league.id, v_members[5], 'member', 'pending');

  -- 4. Private open — hidden from discovery
  v_league := pg_temp.seed_create_league(
    v_organizers[4], '[SEED] Friends & Family (Private)', v_tennis,
    'private', 'open',
    'Private league for testing My Leagues without discovery noise.',
    NULL, NULL
  );
  IF v_mathis IS NOT NULL THEN
    PERFORM pg_temp.seed_join(v_mathis, v_league.id);
  END IF;

  -- 5. Public open pickleball
  v_league := pg_temp.seed_create_league(
    v_organizers[5], '[SEED] Anjou Pickleball League', v_pickle,
    'public', 'open',
    'Social pickleball league — open join.',
    'Complexe sportif d''Anjou', v_facility
  );
  FOR i IN 6..8 LOOP
    BEGIN
      PERFORM pg_temp.seed_join(v_members[i], v_league.id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- player may not have pickleball sport
    END;
  END LOOP;

  -- 6. Public approval pickleball + reputation gate
  v_league := pg_temp.seed_create_league(
    v_organizers[6], '[SEED] Pickleball Good Sports', v_pickle,
    'public', 'approval',
    'Requires minimum reputation score.',
    'Aréna Saint-Michel', v_facility,
    p_min_rep => 40, p_level => 'intermediate'
  );

  -- 7. Paused league (still public but inactive for joins)
  v_league := pg_temp.seed_create_league(
    v_organizers[7], '[SEED] Off-Season Ladder (Paused)', v_tennis,
    'public', 'open',
    'Paused league — should not accept new joins.',
    'Parc La Fontaine', v_facility,
    p_status => 'paused'
  );

  -- 8. Closed league
  PERFORM pg_temp.seed_create_league(
    v_organizers[8], '[SEED] Archived 2025 League', v_tennis,
    'public', 'open',
    'Closed league for past-season UI.',
    NULL, NULL,
    p_status => 'closed'
  );

  -- 9. Beginner rating cap
  v_league := pg_temp.seed_create_league(
    v_organizers[1], '[SEED] Beginner Tennis Circle', v_tennis,
    'public', 'open',
    'Max NTRP 3.0 — great for new players.',
    'Club de Tennis Côte-des-Neiges', v_facility,
    p_max_rating => 3.0, p_level => 'beginner'
  );
  PERFORM pg_temp.seed_join(v_members[2], v_league.id);

  -- 10. Advanced minimum rating
  v_league := pg_temp.seed_create_league(
    v_organizers[2], '[SEED] Advanced Singles League', v_tennis,
    'public', 'approval',
    'Competitive singles — min 4.5 NTRP.',
    'Tennis 13', v_facility,
    p_min_rating => 4.5, p_level => 'advanced'
  );

  -- 11. Open season with members (detail dashboard step 2+)
  v_league := pg_temp.seed_create_league(
    v_organizers[3], '[SEED] Summer 2026 League', v_tennis,
    'public', 'open',
    'Has an open season with rankings seeded.',
    'Club de Tennis de Monkland', v_facility
  );
  FOR i IN 4..7 LOOP
    PERFORM pg_temp.seed_join(v_members[i], v_league.id);
  END LOOP;
  PERFORM pg_temp.seed_set_user(v_organizers[3]);
  SELECT * INTO v_season FROM season_create(
    p_league_id => v_league.id,
    p_name => 'Été 2026',
    p_start_date => current_date,
    p_end_date => current_date + 120
  );
  SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);

  -- 12. Draft season only
  v_league := pg_temp.seed_create_league(
    v_organizers[4], '[SEED] Fall League (Draft Season)', v_tennis,
    'public', 'approval',
    'Open league with a draft season awaiting publish.',
    'Parc Jeanne-Mance', v_facility,
    p_level => 'open'
  );
  PERFORM pg_temp.seed_join(v_members[5], v_league.id);
  PERFORM pg_temp.seed_set_user(v_organizers[4]);
  PERFORM season_create(
    p_league_id => v_league.id,
    p_name => 'Automne 2026',
    p_start_date => current_date + 30,
    p_end_date => current_date + 150
  );

  -- Optional: add Mathis to a few public leagues for My Leagues testing
  IF v_mathis IS NOT NULL AND v_mathis <> ALL(v_organizers) THEN
    BEGIN PERFORM pg_temp.seed_join(v_mathis, (
      SELECT id FROM leagues WHERE name = '[SEED] Plateau Open Ladder' LIMIT 1
    )); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM pg_temp.seed_join(v_mathis, (
      SELECT id FROM leagues WHERE name = '[SEED] Anjou Pickleball League' LIMIT 1
    )); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RAISE NOTICE 'Seeded % leagues', (SELECT count(*) FROM leagues WHERE name LIKE '[SEED] %');
END $$;

COMMIT;

-- Verify
SELECT
  l.name,
  s.name AS sport,
  l.visibility,
  l.join_mode,
  l.status,
  l.level,
  l.min_rating,
  l.max_rating,
  l.min_reputation,
  l.member_capacity,
  l.waitlist_enabled,
  (SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id AND lm.status = 'active') AS active_members,
  (SELECT count(*) FROM seasons se WHERE se.league_id = l.id) AS seasons
FROM leagues l
JOIN sport s ON s.id = l.sport_id
WHERE l.name LIKE '[SEED] %'
ORDER BY l.name;

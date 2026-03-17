-- =============================================================================
-- Rallia Seed File (Enhanced – 100 Players)
-- =============================================================================
--
-- SEEDING WORKFLOW (run in this order):
--   1. supabase db reset
--      (runs all migrations, creates empty schema)
--   2. cd rallia-facilities && python src/main.py --supabase
--      (seeds sport, rating_system, rating_score, data_provider,
--       organization, facility, court, facility_sport, court_sport,
--       facility_contact -- links Montreal org to Loisir Montreal provider)
--   3. supabase db seed
--      (runs THIS file -- seeds profiles, players, ratings, etc.)
--
-- This script is designed to be idempotent (safe to re-run).
-- It deletes all previous seed data first, then re-inserts fresh data.
-- All FK references are resolved dynamically via subqueries.
--
-- ENVIRONMENT SUPPORT:
--   Local (default):  npm run db:seed
--   Staging:          npm run db:seed:staging
--
--   The psql variable :seed_env controls environment-specific behavior.
--   When seed_env='staging', the vault secrets block is skipped (staging
--   already has its own secrets configured in the Supabase dashboard).
--
-- TARGETING A SPECIFIC USER (for beta testers):
--   SEED_EMAIL=user@example.com npm run db:seed
--   SEED_EMAIL=user@example.com npm run db:seed:staging
--
--   When SEED_EMAIL is set, seed data is associated with that user instead
--   of the first non-fake auth.users entry. If the email is not found,
--   a warning is shown and it falls back to the default behavior.
--
-- LOGIN AS SEED USERS:
--   All 100 seed users can be logged into via OTP (magic link).
--   Just enter their email (e.g. marc.tremblay@fake-rallia.com) in the app.
--   Password: password123 (also available for password-based login).
-- =============================================================================

-- Default seed_env to 'local' if not set (e.g. when run via `supabase db reset`)
\if :{?seed_env}
\else
  \set seed_env 'local'
\endif

-- Default seed_email to empty if not set
\if :{?seed_email}
\else
  \set seed_email ''
\endif

-- Store seed_email in a session GUC so PL/pgSQL DO blocks can access it
-- (psql variables can't be used inside $$ ... $$ blocks)
SELECT set_config('app.seed_email', :'seed_email', false);

-- Helper: resolve the target user for seeding.
-- If SEED_EMAIL is set, looks up user by email; otherwise falls back to
-- the first non-fake auth.users entry (original behavior).
CREATE OR REPLACE FUNCTION pg_temp.resolve_seed_user() RETURNS UUID AS $$
DECLARE
  _email TEXT;
  _uid   UUID;
  fake_prefix TEXT := 'a1000000-0000-0000-0000-00000000';
BEGIN
  _email := current_setting('app.seed_email', true);

  -- If an email was provided, try to find that user
  IF _email IS NOT NULL AND _email != '' THEN
    SELECT id INTO _uid FROM auth.users WHERE email = _email;
    IF _uid IS NOT NULL THEN
      RAISE NOTICE 'seed: targeting user % (%)', _email, _uid;
      RETURN _uid;
    ELSE
      RAISE WARNING 'seed: SEED_EMAIL=% not found in auth.users — falling back to first non-fake user', _email;
    END IF;
  END IF;

  -- Fallback: first non-fake user ordered by creation date
  SELECT id INTO _uid FROM auth.users
  WHERE id::text NOT LIKE 'a1000000-0000-0000-0000-00000000%'
  ORDER BY created_at LIMIT 1;

  IF _uid IS NOT NULL THEN
    RAISE NOTICE 'seed: using first non-fake user %', _uid;
  END IF;

  RETURN _uid;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. Vault Secrets for Edge Functions (local only)
-- ============================================================================
SELECT :'seed_env' = 'local' AS is_local \gset
\if :is_local
DO $$
DECLARE
  local_service_role_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  local_anon_key TEXT := 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODU1MzQ0NTh9.njT61CLkOy3AkOBDE7KgJ4vqL23h9bAA4HQb3T-fYlFwxfZV5flOkbxOXs4X_LEdOyBGRa_EkJJ-7U1KD6IsZw';
  local_functions_url TEXT := 'http://host.docker.internal:54321';
  existing_url_id UUID;
  existing_key_id UUID;
  existing_anon_id UUID;
BEGIN
  SELECT id INTO existing_url_id FROM vault.secrets WHERE name = 'supabase_functions_url';
  SELECT id INTO existing_key_id FROM vault.secrets WHERE name = 'service_role_key';
  SELECT id INTO existing_anon_id FROM vault.secrets WHERE name = 'anon_key';

  IF existing_url_id IS NULL THEN
    PERFORM vault.create_secret(local_functions_url, 'supabase_functions_url');
  ELSE
    PERFORM vault.update_secret(existing_url_id, local_functions_url, 'supabase_functions_url');
  END IF;

  IF existing_key_id IS NULL THEN
    PERFORM vault.create_secret(local_service_role_key, 'service_role_key');
  ELSE
    PERFORM vault.update_secret(existing_key_id, local_service_role_key, 'service_role_key');
  END IF;

  IF existing_anon_id IS NULL THEN
    PERFORM vault.create_secret(local_anon_key, 'anon_key');
  ELSE
    PERFORM vault.update_secret(existing_anon_id, local_anon_key, 'anon_key');
  END IF;
END $$;
\endif

-- ============================================================================
-- 2. Clean Up Previous Seed Data
-- ============================================================================
DO $$
DECLARE
  fake_ids UUID[];
  logged_in_user UUID;
BEGIN
  -- Build array of all 100 seed UUIDs
  SELECT array_agg(('a1000000-0000-0000-0000-00000000' || LPAD(i::text, 4, '0'))::uuid)
  INTO fake_ids
  FROM generate_series(1, 100) AS i;

  -- Identify the target user for seeding
  logged_in_user := pg_temp.resolve_seed_user();

  -- Disable reputation triggers to avoid side-effects during cleanup
  ALTER TABLE reputation_event DISABLE TRIGGER reputation_event_recalculate;
  ALTER TABLE reference_request DISABLE TRIGGER check_reference_threshold_trigger;

  -- Phase 3b cleanup
  DELETE FROM feedback WHERE id::text LIKE 'c4000000-0000-0000-0000-%';
  DELETE FROM player_report WHERE id::text LIKE 'c5000000-0000-0000-0000-%';
  DELETE FROM referral_link_click WHERE referral_code LIKE 'SEED%';
  DELETE FROM referral_fingerprint WHERE referral_code LIKE 'SEED%';
  DELETE FROM score_confirmation WHERE match_result_id::text LIKE 'b2000000-0000-0000-0000-%';
  DELETE FROM proof_endorsement WHERE proof_id::text LIKE 'f1000000-0000-0000-0000-%';

  -- Phase 3 cleanup: match feedback & reports (before match delete)
  DELETE FROM match_feedback WHERE id::text LIKE 'c2000000-0000-0000-0000-%';
  DELETE FROM match_report WHERE id::text LIKE 'c3000000-0000-0000-0000-%';

  -- Phase 3 cleanup: notifications
  DELETE FROM notification WHERE id::text LIKE 'c1000000-0000-0000-0000-%';

  -- Phase 3 cleanup: messages/reactions in manually-created convos (before conversation delete)
  DELETE FROM message_reaction WHERE message_id IN (
    SELECT id FROM message WHERE conversation_id IN (
      SELECT id FROM conversation WHERE id::text LIKE 'e1000000-0000-0000-0000-%'));
  DELETE FROM message WHERE conversation_id IN (
    SELECT id FROM conversation WHERE id::text LIKE 'e1000000-0000-0000-0000-%');

  -- Phase 3 cleanup: messages/reactions in auto-created network convos (before network delete)
  DELETE FROM message_reaction WHERE message_id IN (
    SELECT m.id FROM message m JOIN network n ON m.conversation_id = n.conversation_id
    WHERE n.id::text LIKE 'd1000000-0000-0000-0000-%');
  DELETE FROM message WHERE conversation_id IN (
    SELECT conversation_id FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%'
    AND conversation_id IS NOT NULL);

  -- Phase 3 cleanup: auto-created network conversations
  DELETE FROM conversation WHERE id IN (
    SELECT conversation_id FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%'
    AND conversation_id IS NOT NULL);

  -- Phase 3 cleanup: group_activity and match_network (before network delete)
  DELETE FROM group_activity WHERE network_id IN (
    SELECT id FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%');
  DELETE FROM match_network WHERE network_id IN (
    SELECT id FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%');

  -- Delete seeded matches (cascades to match_participant, match_result, match_set)
  DELETE FROM match WHERE id::text LIKE 'b1000000-0000-0000-0000-%';

  -- Delete seeded networks/groups (cascades to network_member)
  DELETE FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%';

  -- Delete seeded conversations (cascades to conversation_participant, message)
  DELETE FROM conversation WHERE id::text LIKE 'e1000000-0000-0000-0000-%';

  -- Delete seeded contact lists
  DELETE FROM shared_contact_list WHERE id::text LIKE 'f4000000-0000-0000-0000-%';

  -- Delete seeded rating proofs, peer rating requests, rating reference requests, reference requests
  -- Disable triggers that reference stale enum values during cleanup
  ALTER TABLE rating_reference_request DISABLE TRIGGER trigger_referrals_count_on_reference_delete;
  ALTER TABLE rating_proof DISABLE TRIGGER trigger_certification_proof_change;
  ALTER TABLE player_rating_score DISABLE TRIGGER trigger_check_certification;

  DELETE FROM rating_proof WHERE id::text LIKE 'f1000000-0000-0000-0000-%';
  DELETE FROM peer_rating_request WHERE id::text LIKE 'f2000000-0000-0000-0000-%';
  DELETE FROM reference_request WHERE id::text LIKE 'f3000000-0000-0000-0000-%';
  DELETE FROM rating_reference_request WHERE id::text LIKE 'f6000000-0000-0000-0000-%';

  ALTER TABLE rating_reference_request ENABLE TRIGGER trigger_referrals_count_on_reference_delete;
  ALTER TABLE rating_proof ENABLE TRIGGER trigger_certification_proof_change;
  ALTER TABLE player_rating_score ENABLE TRIGGER trigger_check_certification;

  -- Delete seeded reputation events
  DELETE FROM reputation_event WHERE id::text LIKE 'e0000000-0000-0000-0000-%';

  -- Delete bookings created by fake users or logged-in user
  DELETE FROM booking WHERE player_id = ANY(fake_ids);
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM booking WHERE player_id = logged_in_user;
  END IF;

  -- Delete notifications for the logged-in user
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM notification WHERE user_id = logged_in_user;
  END IF;

  -- Delete player favorites and blocks
  DELETE FROM player_favorite WHERE player_id = ANY(fake_ids) OR favorite_player_id = ANY(fake_ids);
  DELETE FROM player_block WHERE player_id = ANY(fake_ids) OR blocked_player_id = ANY(fake_ids);
  DELETE FROM player_favorite_facility WHERE player_id = ANY(fake_ids);
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM player_favorite WHERE player_id = logged_in_user;
    DELETE FROM player_favorite_facility WHERE player_id = logged_in_user;
  END IF;

  -- Delete player reputation for fake users
  DELETE FROM player_reputation WHERE player_id = ANY(fake_ids);

  -- Delete player sport play styles/attributes, player sports, player rating scores
  DELETE FROM player_sport_play_style WHERE player_sport_id IN (
    SELECT id FROM player_sport WHERE player_id = ANY(fake_ids)
  );
  DELETE FROM player_sport_play_attribute WHERE player_sport_id IN (
    SELECT id FROM player_sport WHERE player_id = ANY(fake_ids)
  );
  DELETE FROM player_rating_score WHERE player_id = ANY(fake_ids);
  DELETE FROM player_availability WHERE player_id = ANY(fake_ids);
  DELETE FROM player_sport WHERE player_id = ANY(fake_ids);

  -- Clean up logged-in user's player-related seed data too
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM player_sport_play_style WHERE player_sport_id IN (
      SELECT id FROM player_sport WHERE player_id = logged_in_user
    );
    DELETE FROM player_sport_play_attribute WHERE player_sport_id IN (
      SELECT id FROM player_sport WHERE player_id = logged_in_user
    );
    DELETE FROM player_rating_score WHERE player_id = logged_in_user;
    DELETE FROM player_availability WHERE player_id = logged_in_user;
    DELETE FROM player_reputation WHERE player_id = logged_in_user;
    DELETE FROM player WHERE id = logged_in_user;
  END IF;

  -- Delete fake users from auth (cascades: profile → player → remaining FKs)
  DELETE FROM auth.identities WHERE user_id = ANY(fake_ids);
  DELETE FROM auth.users WHERE id = ANY(fake_ids);

  -- Re-enable triggers
  ALTER TABLE reputation_event ENABLE TRIGGER reputation_event_recalculate;
  ALTER TABLE reference_request ENABLE TRIGGER check_reference_threshold_trigger;

  RAISE NOTICE 'Cleaned up all previous seed data';
END $$;

-- ============================================================================
-- 3. Create 100 Test Users in auth.users
-- ============================================================================
-- All token columns explicitly set to '' to prevent GoTrue scan errors.
-- Password: password123 for all users.
-- ============================================================================
DO $$
DECLARE
  fake_users TEXT[][] := ARRAY[
    ARRAY['a1000000-0000-0000-0000-000000000001', 'marc.tremblay@fake-rallia.com',       'Marc',       'Tremblay'],
    ARRAY['a1000000-0000-0000-0000-000000000002', 'sophie.lavoie@fake-rallia.com',        'Sophie',     'Lavoie'],
    ARRAY['a1000000-0000-0000-0000-000000000003', 'jean.gagnon@fake-rallia.com',          'Jean',       'Gagnon'],
    ARRAY['a1000000-0000-0000-0000-000000000004', 'isabelle.roy@fake-rallia.com',         'Isabelle',   'Roy'],
    ARRAY['a1000000-0000-0000-0000-000000000005', 'philippe.bouchard@fake-rallia.com',    'Philippe',   'Bouchard'],
    ARRAY['a1000000-0000-0000-0000-000000000006', 'camille.fortin@fake-rallia.com',       'Camille',    'Fortin'],
    ARRAY['a1000000-0000-0000-0000-000000000007', 'alexandre.morin@fake-rallia.com',      'Alexandre',  'Morin'],
    ARRAY['a1000000-0000-0000-0000-000000000008', 'marie.cote@fake-rallia.com',           'Marie',      'Côté'],
    ARRAY['a1000000-0000-0000-0000-000000000009', 'david.belanger@fake-rallia.com',       'David',      'Bélanger'],
    ARRAY['a1000000-0000-0000-0000-000000000010', 'emilie.pelletier@fake-rallia.com',     'Émilie',     'Pelletier'],
    ARRAY['a1000000-0000-0000-0000-000000000011', 'francois.gauthier@fake-rallia.com',    'François',   'Gauthier'],
    ARRAY['a1000000-0000-0000-0000-000000000012', 'julie.ouellet@fake-rallia.com',        'Julie',      'Ouellet'],
    ARRAY['a1000000-0000-0000-0000-000000000013', 'nicolas.lefebvre@fake-rallia.com',     'Nicolas',    'Lefebvre'],
    ARRAY['a1000000-0000-0000-0000-000000000014', 'valerie.martin@fake-rallia.com',       'Valérie',    'Martin'],
    ARRAY['a1000000-0000-0000-0000-000000000015', 'pierre.girard@fake-rallia.com',        'Pierre',     'Girard'],
    ARRAY['a1000000-0000-0000-0000-000000000016', 'catherine.bergeron@fake-rallia.com',   'Catherine',  'Bergeron'],
    ARRAY['a1000000-0000-0000-0000-000000000017', 'etienne.leblanc@fake-rallia.com',      'Étienne',    'Leblanc'],
    ARRAY['a1000000-0000-0000-0000-000000000018', 'nathalie.simard@fake-rallia.com',      'Nathalie',   'Simard'],
    ARRAY['a1000000-0000-0000-0000-000000000019', 'simon.poirier@fake-rallia.com',        'Simon',      'Poirier'],
    ARRAY['a1000000-0000-0000-0000-000000000020', 'audrey.demers@fake-rallia.com',        'Audrey',     'Demers'],
    ARRAY['a1000000-0000-0000-0000-000000000021', 'lucas.therrien@fake-rallia.com',       'Lucas',      'Therrien'],
    ARRAY['a1000000-0000-0000-0000-000000000022', 'gabrielle.paquette@fake-rallia.com',   'Gabrielle',  'Paquette'],
    ARRAY['a1000000-0000-0000-0000-000000000023', 'olivier.cloutier@fake-rallia.com',     'Olivier',    'Cloutier'],
    ARRAY['a1000000-0000-0000-0000-000000000024', 'melanie.dubois@fake-rallia.com',       'Mélanie',    'Dubois'],
    ARRAY['a1000000-0000-0000-0000-000000000025', 'mathieu.lapointe@fake-rallia.com',     'Mathieu',    'Lapointe'],
    ARRAY['a1000000-0000-0000-0000-000000000026', 'chloe.rioux@fake-rallia.com',          'Chloé',      'Rioux'],
    ARRAY['a1000000-0000-0000-0000-000000000027', 'antoine.nadeau@fake-rallia.com',       'Antoine',    'Nadeau'],
    ARRAY['a1000000-0000-0000-0000-000000000028', 'sarah.levesque@fake-rallia.com',       'Sarah',      'Lévesque'],
    ARRAY['a1000000-0000-0000-0000-000000000029', 'vincent.michaud@fake-rallia.com',      'Vincent',    'Michaud'],
    ARRAY['a1000000-0000-0000-0000-000000000030', 'laura.beaulieu@fake-rallia.com',       'Laura',      'Beaulieu'],
    ARRAY['a1000000-0000-0000-0000-000000000031', 'youssef.benali@fake-rallia.com',       'Youssef',    'Benali'],
    ARRAY['a1000000-0000-0000-0000-000000000032', 'fatima.hassan@fake-rallia.com',        'Fatima',     'Hassan'],
    ARRAY['a1000000-0000-0000-0000-000000000033', 'wei.chen@fake-rallia.com',             'Wei',        'Chen'],
    ARRAY['a1000000-0000-0000-0000-000000000034', 'mei.wang@fake-rallia.com',             'Mei',        'Wang'],
    ARRAY['a1000000-0000-0000-0000-000000000035', 'carlos.silva@fake-rallia.com',         'Carlos',     'Silva'],
    ARRAY['a1000000-0000-0000-0000-000000000036', 'maria.santos@fake-rallia.com',         'Maria',      'Santos'],
    ARRAY['a1000000-0000-0000-0000-000000000037', 'raj.patel@fake-rallia.com',            'Raj',        'Patel'],
    ARRAY['a1000000-0000-0000-0000-000000000038', 'priya.sharma@fake-rallia.com',         'Priya',      'Sharma'],
    ARRAY['a1000000-0000-0000-0000-000000000039', 'ahmed.diallo@fake-rallia.com',         'Ahmed',      'Diallo'],
    ARRAY['a1000000-0000-0000-0000-000000000040', 'aisha.traore@fake-rallia.com',         'Aisha',      'Traoré'],
    ARRAY['a1000000-0000-0000-0000-000000000041', 'thomas.desjardins@fake-rallia.com',    'Thomas',     'Desjardins'],
    ARRAY['a1000000-0000-0000-0000-000000000042', 'emma.charron@fake-rallia.com',         'Emma',       'Charron'],
    ARRAY['a1000000-0000-0000-0000-000000000043', 'hugo.menard@fake-rallia.com',          'Hugo',       'Ménard'],
    ARRAY['a1000000-0000-0000-0000-000000000044', 'lea.tanguay@fake-rallia.com',          'Léa',        'Tanguay'],
    ARRAY['a1000000-0000-0000-0000-000000000045', 'xavier.dufour@fake-rallia.com',        'Xavier',     'Dufour'],
    ARRAY['a1000000-0000-0000-0000-000000000046', 'jade.lambert@fake-rallia.com',         'Jade',       'Lambert'],
    ARRAY['a1000000-0000-0000-0000-000000000047', 'felix.parent@fake-rallia.com',         'Félix',      'Parent'],
    ARRAY['a1000000-0000-0000-0000-000000000048', 'clara.turcotte@fake-rallia.com',       'Clara',      'Turcotte'],
    ARRAY['a1000000-0000-0000-0000-000000000049', 'louis.savard@fake-rallia.com',         'Louis',      'Savard'],
    ARRAY['a1000000-0000-0000-0000-000000000050', 'juliette.couture@fake-rallia.com',     'Juliette',   'Couture'],
    ARRAY['a1000000-0000-0000-0000-000000000051', 'benoit.arsenault@fake-rallia.com',    'Benoît',     'Arsenault'],
    ARRAY['a1000000-0000-0000-0000-000000000052', 'genevieve.blais@fake-rallia.com',     'Geneviève',  'Blais'],
    ARRAY['a1000000-0000-0000-0000-000000000053', 'sebastien.caron@fake-rallia.com',     'Sébastien',  'Caron'],
    ARRAY['a1000000-0000-0000-0000-000000000054', 'amelie.deschenes@fake-rallia.com',    'Amélie',     'Deschênes'],
    ARRAY['a1000000-0000-0000-0000-000000000055', 'maxime.frechette@fake-rallia.com',    'Maxime',     'Fréchette'],
    ARRAY['a1000000-0000-0000-0000-000000000056', 'caroline.gravel@fake-rallia.com',     'Caroline',   'Gravel'],
    ARRAY['a1000000-0000-0000-0000-000000000057', 'gabriel.hamelin@fake-rallia.com',     'Gabriel',    'Hamelin'],
    ARRAY['a1000000-0000-0000-0000-000000000058', 'maude.jalbert@fake-rallia.com',       'Maude',      'Jalbert'],
    ARRAY['a1000000-0000-0000-0000-000000000059', 'raphael.lacasse@fake-rallia.com',     'Raphaël',    'Lacasse'],
    ARRAY['a1000000-0000-0000-0000-000000000060', 'florence.martel@fake-rallia.com',     'Florence',   'Martel'],
    ARRAY['a1000000-0000-0000-0000-000000000061', 'william.normand@fake-rallia.com',     'William',    'Normand'],
    ARRAY['a1000000-0000-0000-0000-000000000062', 'sabrina.ouellette@fake-rallia.com',   'Sabrina',    'Ouellette'],
    ARRAY['a1000000-0000-0000-0000-000000000063', 'jerome.paradis@fake-rallia.com',      'Jérôme',     'Paradis'],
    ARRAY['a1000000-0000-0000-0000-000000000064', 'myriam.richer@fake-rallia.com',       'Myriam',     'Richer'],
    ARRAY['a1000000-0000-0000-0000-000000000065', 'samuel.st-pierre@fake-rallia.com',    'Samuel',     'St-Pierre'],
    ARRAY['a1000000-0000-0000-0000-000000000066', 'veronique.tessier@fake-rallia.com',   'Véronique',  'Tessier'],
    ARRAY['a1000000-0000-0000-0000-000000000067', 'alexis.vachon@fake-rallia.com',       'Alexis',     'Vachon'],
    ARRAY['a1000000-0000-0000-0000-000000000068', 'dominique.beauchemin@fake-rallia.com','Dominique',  'Beauchemin'],
    ARRAY['a1000000-0000-0000-0000-000000000069', 'cedric.charbonneau@fake-rallia.com',  'Cédric',     'Charbonneau'],
    ARRAY['a1000000-0000-0000-0000-000000000070', 'anne-marie.dallaire@fake-rallia.com', 'Anne-Marie', 'Dallaire'],
    ARRAY['a1000000-0000-0000-0000-000000000071', 'patrick.ethier@fake-rallia.com',      'Patrick',    'Éthier'],
    ARRAY['a1000000-0000-0000-0000-000000000072', 'josee.fontaine@fake-rallia.com',      'Josée',      'Fontaine'],
    ARRAY['a1000000-0000-0000-0000-000000000073', 'martin.gingras@fake-rallia.com',      'Martin',     'Gingras'],
    ARRAY['a1000000-0000-0000-0000-000000000074', 'nancy.houde@fake-rallia.com',         'Nancy',      'Houde'],
    ARRAY['a1000000-0000-0000-0000-000000000075', 'jonathan.isabelle@fake-rallia.com',   'Jonathan',   'Isabelle'],
    ARRAY['a1000000-0000-0000-0000-000000000076', 'manon.jobin@fake-rallia.com',         'Manon',      'Jobin'],
    ARRAY['a1000000-0000-0000-0000-000000000077', 'eric.lachance@fake-rallia.com',       'Éric',       'Lachance'],
    ARRAY['a1000000-0000-0000-0000-000000000078', 'sylvie.mercier@fake-rallia.com',      'Sylvie',     'Mercier'],
    ARRAY['a1000000-0000-0000-0000-000000000079', 'bruno.noel@fake-rallia.com',          'Bruno',      'Noël'],
    ARRAY['a1000000-0000-0000-0000-000000000080', 'chantal.pelchat@fake-rallia.com',     'Chantal',    'Pelchat'],
    ARRAY['a1000000-0000-0000-0000-000000000081', 'daniel.quirion@fake-rallia.com',      'Daniel',     'Quirion'],
    ARRAY['a1000000-0000-0000-0000-000000000082', 'marie-eve.renaud@fake-rallia.com',    'Marie-Ève',  'Renaud'],
    ARRAY['a1000000-0000-0000-0000-000000000083', 'alain.seguin@fake-rallia.com',        'Alain',      'Séguin'],
    ARRAY['a1000000-0000-0000-0000-000000000084', 'lise.theriault@fake-rallia.com',      'Lise',       'Thériault'],
    ARRAY['a1000000-0000-0000-0000-000000000085', 'rene.vezina@fake-rallia.com',         'René',       'Vézina'],
    ARRAY['a1000000-0000-0000-0000-000000000086', 'diane.allard@fake-rallia.com',        'Diane',      'Allard'],
    ARRAY['a1000000-0000-0000-0000-000000000087', 'michel.breton@fake-rallia.com',       'Michel',     'Breton'],
    ARRAY['a1000000-0000-0000-0000-000000000088', 'christine.corriveau@fake-rallia.com', 'Christine',  'Corriveau'],
    ARRAY['a1000000-0000-0000-0000-000000000089', 'yves.desrochers@fake-rallia.com',     'Yves',       'Desrochers'],
    ARRAY['a1000000-0000-0000-0000-000000000090', 'france.giguere@fake-rallia.com',      'France',     'Giguère'],
    ARRAY['a1000000-0000-0000-0000-000000000091', 'claude.huard@fake-rallia.com',        'Claude',     'Huard'],
    ARRAY['a1000000-0000-0000-0000-000000000092', 'louise.juneau@fake-rallia.com',       'Louise',     'Juneau'],
    ARRAY['a1000000-0000-0000-0000-000000000093', 'robert.lafleur@fake-rallia.com',      'Robert',     'Lafleur'],
    ARRAY['a1000000-0000-0000-0000-000000000094', 'monique.masson@fake-rallia.com',      'Monique',    'Masson'],
    ARRAY['a1000000-0000-0000-0000-000000000095', 'jacques.perreault@fake-rallia.com',   'Jacques',    'Perreault'],
    ARRAY['a1000000-0000-0000-0000-000000000096', 'suzanne.raymond@fake-rallia.com',     'Suzanne',    'Raymond'],
    ARRAY['a1000000-0000-0000-0000-000000000097', 'andre.thibault@fake-rallia.com',      'André',      'Thibault'],
    ARRAY['a1000000-0000-0000-0000-000000000098', 'helene.vallee@fake-rallia.com',       'Hélène',     'Vallée'],
    ARRAY['a1000000-0000-0000-0000-000000000099', 'guy.archambault@fake-rallia.com',     'Guy',        'Archambault'],
    ARRAY['a1000000-0000-0000-0000-000000000100', 'francine.boisvert@fake-rallia.com',   'Francine',   'Boisvert']
  ];
  u TEXT[];
BEGIN
  FOREACH u SLICE 1 IN ARRAY fake_users LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u[1]::uuid) THEN
      INSERT INTO auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at, confirmation_sent_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current, reauthentication_token,
        phone_change, phone_change_token,
        email_change_confirm_status, is_sso_user, is_anonymous,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        u[1]::uuid,
        'authenticated',
        'authenticated',
        u[2],
        crypt('password123', gen_salt('bf')),
        NOW(), NOW(),
        '', '', '',
        '', '', '',
        '', '',
        0, false, false,
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('first_name', u[3], 'last_name', u[4], 'full_name', u[3] || ' ' || u[4]),
        NOW(), NOW()
      );
      -- Create identity for the user
      INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(), u[1]::uuid,
        jsonb_build_object('sub', u[1], 'email', u[2]),
        'email', u[1],
        NOW(), NOW(), NOW()
      );
    END IF;
  END LOOP;
  RAISE NOTICE 'Ensured 100 test users exist in auth.users';
END $$;

-- ============================================================================
-- 4. Create Profiles for All Auth Users
-- ============================================================================
DO $$
DECLARE
  bios TEXT[] := ARRAY[
    'Passionné de tennis depuis 15 ans. Joueur régulier au parc Jeanne-Mance.',
    'Joueuse de pickleball et tennis. Toujours partante pour un match!',
    'Ancien joueur de compétition, maintenant je joue pour le plaisir.',
    'Débutante enthousiaste! Cherche des partenaires patients.',
    'Tennis 3x par semaine au parc La Fontaine. Niveau intermédiaire.',
    'Joueuse polyvalente tennis et pickleball. Disponible les weekends.',
    'Compétiteur dans l''âme. NTRP 4.5, toujours prêt pour un défi.',
    'Tennis récréatif. J''adore le doubles!',
    'Nouveau à Montréal, cherche des partenaires de tennis.',
    'J''adore jouer en simple et en double. Disponible les soirs.',
    'Joueur de pickleball passionné, venez jouer avec moi!',
    'Tennis le matin, pickleball l''après-midi. La belle vie!',
    'Ancien entraîneur de tennis. Toujours heureux de donner des conseils.',
    'Joueuse sociale, je cherche des matchs amicaux réguliers.',
    'Joueur compétitif, NTRP 5.0. Cherche des adversaires de niveau.',
    'Pickleball addict! Je joue tous les jours au parc Jarry.',
    'Tennis depuis mon enfance. Let''s rally!',
    'Joueuse intermédiaire cherchant à progresser.',
    'Je joue au tennis et au pickleball. Toujours partant!',
    'Disponible les weekends pour du tennis décontracté.',
    'Joueur récréatif, bonne ambiance avant tout.',
    'Nouvelle au pickleball, mais j''apprends vite!',
    'Tennis compétitif le weekend, casual en semaine.',
    'J''aime le tennis en double, cherche des partenaires réguliers.',
    'Joueur polyvalent, je m''adapte à tous les niveaux.',
    'Passionnée de raquette sous toutes ses formes!',
    'Tennis 4x/semaine. Toujours à la recherche de nouveaux défis.',
    'Joueuse de niveau avancé, matchs compétitifs seulement.',
    'Pickleball le matin, tennis le soir. Le meilleur des deux mondes.',
    'Joueuse sociale, j''adore rencontrer de nouvelles personnes sur le court.',
    'Joueur de tennis et football. Sportif dans l''âme.',
    'Pickleball et yoga, mon combo parfait!',
    'Amateur de tennis, je joue depuis 5 ans à Montréal.',
    'Joueuse compétitive, j''aime les matchs serrés.',
    'Tennis et randonnée, mes deux passions!',
    'Joueuse de pickleball, niveau intermédiaire-avancé.',
    'Cricket et tennis, les sports de raquette c''est ma vie.',
    'Nouvelle joueuse, cherche des partenaires pour progresser ensemble.',
    'Joueur de tennis expérimenté, heureux de partager mes connaissances.',
    'Pickleball débutante mais très motivée!',
    'Tennis le matin avant le travail, c''est mon rituel.',
    'Joueuse passionnée, disponible presque tous les jours.',
    'Joueur de tennis et coureur. L''endurance c''est ma force!',
    'J''adore le pickleball! Venez essayer avec moi.',
    'Joueur technique, je travaille beaucoup mon revers.',
    'Tennis et pickleball, pourquoi choisir?',
    'Joueur de niveau intermédiaire, cherche matchs réguliers.',
    'Passionnée de tennis, je joue depuis l''université.',
    'Tennis compétitif, je vise le 5.0 NTRP cette année.',
    'Joueuse débutante mais déterminée! À bientôt sur les courts.',
    'Joueur de longue date, je connais tous les courts de Montréal.',
    'Passionnée de pickleball, je joue beau temps mauvais temps.',
    'Tennis en simple le matin, doubles le soir. Quelle vie!',
    'Joueuse récréative, j''aime l''ambiance sociale des matchs.',
    'Joueur technique avec un bon service. Venez tester!',
    'Nouvelle au tennis, ancienne joueuse de badminton.',
    'Pickleball 5x par semaine au centre communautaire.',
    'Joueuse de tennis depuis 20 ans. Le court c''est ma maison.',
    'Joueur compétitif cherchant partenaires de niveau similaire.',
    'Tennis et natation, le combo parfait pour rester en forme.',
    'Joueur de pickleball, fan de la cuisine de la cantine du parc.',
    'Passionnée de sports de raquette depuis toujours.',
    'Joueur du dimanche, mais sérieux quand même!',
    'Tennis en famille les weekends, compétition en semaine.',
    'Joueuse polyvalente, autant en simple qu''en double.',
    'Joueur mature cherchant matchs amicaux et respectueux.',
    'Adepte du pickleball, toujours prête pour un dink battle.',
    'Tennis et yoga, l''équilibre parfait corps et esprit.',
    'Joueur de fond de court avec un bon revers slicé.',
    'Joueuse enthousiaste, tous niveaux bienvenus!',
    'Ancien joueur universitaire, retour sur les courts après 10 ans.',
    'Tennis et course à pied, mes deux échappatoires.',
    'Joueuse de pickleball niveau avancé, matchs compétitifs SVP.',
    'Joueur social qui aime rencontrer de nouvelles personnes.',
    'Tennis depuis mes 8 ans, ça ne s''arrête jamais!',
    'Joueuse passionnée de double mixte.',
    'Joueur de tennis à la recherche de matchs matinaux.',
    'Pickleball et randonnée, mes passions du weekend.',
    'Joueuse intermédiaire avec un bon coup droit lifté.',
    'Tennis récréatif au parc Jarry, venez jouer!',
    'Joueur de pickleball, ambassadeur du sport à Montréal.',
    'Tennis compétitif depuis 25 ans, toujours motivé.',
    'Joueuse de niveau intermédiaire, disponible en soirée.',
    'Joueur autodidacte, passionné et persévérant.',
    'Nouvelle joueuse de pickleball, convertie du tennis!',
    'Tennis et vélo, mes activités préférées.',
    'Joueur de doubles invétéré, cherche partenaire régulier.',
    'Joueuse du Plateau, tous les soirs après le travail.',
    'Passionné de tennis, arbitre bénévole les weekends.',
    'Joueuse de loisir, ambiance conviviale avant tout.',
    'Tennis et pickleball, difficile de choisir!',
    'Joueur sénior actif, matchs trois fois par semaine.',
    'Joueuse de compétition, objectif tournoi provincial.',
    'Joueur amical, prêt pour tout type de match.',
    'Nouvelle adepte du tennis, apprend avec passion.',
    'Pickleball matinal au centre Claude-Robillard.',
    'Joueur vétéran, mentor pour les débutants.',
    'Joueuse de tennis avec un smash redoutable!'
  ];
  locales locale_enum[] := ARRAY[
    'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA',
    'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'en-CA', 'en-CA',
    'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'en-CA', 'fr-CA',
    'en-US', 'en-CA', 'en-US', 'en-US', 'en-US', 'en-CA', 'en-US', 'en-US', 'en-CA', 'en-CA',
    'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA',
    'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA',
    'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA',
    'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA',
    'en-CA', 'en-US', 'fr-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'en-US', 'fr-CA',
    'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA', 'en-CA', 'fr-CA', 'fr-CA', 'fr-CA'
  ];
  fake_id UUID;
  idx INT;
  birth_year INT;
BEGIN
  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- Birth years spread from 1970 to 2002
    birth_year := 1970 + ((idx * 17 + 3) % 33);

    INSERT INTO profile (id, first_name, last_name, display_name, email, onboarding_completed, bio, birth_date, preferred_locale)
    SELECT
      id,
      raw_user_meta_data->>'first_name',
      raw_user_meta_data->>'last_name',
      LOWER(raw_user_meta_data->>'first_name') || '_' || LOWER(REPLACE(raw_user_meta_data->>'last_name', ' ', '')),
      email,
      true,
      bios[idx],
      (birth_year || '-' || LPAD(((idx * 7 % 12) + 1)::text, 2, '0') || '-' || LPAD(((idx * 13 % 28) + 1)::text, 2, '0'))::date,
      locales[idx]
    FROM auth.users WHERE id = fake_id
    ON CONFLICT (id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      display_name = COALESCE(EXCLUDED.display_name, profile.display_name),
      onboarding_completed = EXCLUDED.onboarding_completed,
      bio = EXCLUDED.bio,
      birth_date = EXCLUDED.birth_date,
      preferred_locale = EXCLUDED.preferred_locale,
      updated_at = NOW();
  END LOOP;

  -- Also upsert profile for the logged-in user (if any)
  INSERT INTO profile (id, first_name, last_name, display_name, email, onboarding_completed)
  SELECT
    id,
    COALESCE(raw_user_meta_data->>'first_name', SPLIT_PART(COALESCE(raw_user_meta_data->>'full_name', 'Test User'), ' ', 1)),
    COALESCE(raw_user_meta_data->>'last_name', NULLIF(SPLIT_PART(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2), '')),
    NULL,
    email,
    true
  FROM auth.users
  WHERE id = pg_temp.resolve_seed_user()
    AND id::text NOT LIKE 'a1000000-0000-0000-0000-00000000%'
  ON CONFLICT (id) DO UPDATE SET
    onboarding_completed = true,
    updated_at = NOW();

  RAISE NOTICE 'Created profile records for all users';
END $$;

-- ============================================================================
-- 5. Create Player Records
-- ============================================================================
DO $$
DECLARE
  -- Montreal postal codes for different neighborhoods
  postal_codes TEXT[] := ARRAY[
    'H2T 1S4', 'H2X 1Y6', 'H3A 1B9', 'H2W 2E1', 'H2J 3K5',
    'H2R 2N2', 'H3H 1P3', 'H4A 1T2', 'H1V 3R2', 'H2V 4G7',
    'H3C 1K3', 'H2G 2L9', 'H3B 4W5', 'H2S 2M2', 'H3T 1A8',
    'H2K 4L1', 'H3W 1T7', 'H4B 1T5', 'H1N 2C5', 'H3X 2H9',
    'H2L 3R9', 'H2E 2K3', 'H3P 2T1', 'H3S 1M5', 'H4C 2K1'
  ];
  -- Montreal lat/longs for varied neighborhoods
  lats NUMERIC[] := ARRAY[
    45.5236, 45.5148, 45.5017, 45.5225, 45.5306,
    45.5445, 45.4968, 45.4727, 45.5554, 45.4829,
    45.4970, 45.5320, 45.5088, 45.5380, 45.5010,
    45.5450, 45.4800, 45.4650, 45.5600, 45.4900,
    45.5170, 45.5500, 45.4750, 45.4680, 45.4600
  ];
  lngs NUMERIC[] := ARRAY[
    -73.5865, -73.5691, -73.5673, -73.5775, -73.5537,
    -73.5975, -73.5768, -73.6416, -73.5482, -73.5903,
    -73.5530, -73.5620, -73.5700, -73.5850, -73.6150,
    -73.5500, -73.6200, -73.6500, -73.5400, -73.5950,
    -73.5600, -73.5450, -73.6300, -73.6350, -73.6450
  ];
  genders gender_enum[] := ARRAY[
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'other',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'female',
    'male', 'female', 'male', 'female', 'male',
    'female', 'male', 'female', 'male', 'other'
  ];
  hands playing_hand[] := ARRAY[
    'right', 'right', 'left', 'right', 'right',
    'both', 'right', 'left', 'right', 'right',
    'right', 'right', 'left', 'right', 'right',
    'right', 'both', 'right', 'right', 'left',
    'right', 'right', 'right', 'both', 'right',
    'right', 'left', 'right', 'right', 'right',
    'right', 'right', 'right', 'left', 'right',
    'right', 'right', 'both', 'right', 'right',
    'left', 'right', 'right', 'right', 'right',
    'right', 'right', 'left', 'right', 'right',
    'right', 'left', 'right', 'right', 'right',
    'right', 'right', 'both', 'right', 'left',
    'right', 'right', 'right', 'right', 'left',
    'right', 'both', 'right', 'right', 'right',
    'right', 'right', 'left', 'right', 'right',
    'right', 'right', 'right', 'both', 'right',
    'left', 'right', 'right', 'right', 'right',
    'right', 'right', 'left', 'right', 'right',
    'right', 'both', 'right', 'right', 'right',
    'right', 'right', 'right', 'left', 'right'
  ];
  fake_id UUID;
  idx INT;
  loc_idx INT;
  logged_in_user UUID;
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();

  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;
    loc_idx := ((idx - 1) % 25) + 1;

    INSERT INTO player (
      id, gender, playing_hand, max_travel_distance,
      postal_code, country, latitude, longitude,
      city, province,
      push_notifications_enabled, last_seen_at,
      privacy_show_age, privacy_show_location, privacy_show_stats, privacy_show_availability
    ) VALUES (
      fake_id,
      genders[idx],
      hands[idx],
      5 + ((idx * 7) % 46),  -- 5-50 km range
      postal_codes[loc_idx],
      'CA',
      lats[loc_idx] + (((idx * 13) % 100)::numeric / 10000),  -- slight variation
      lngs[loc_idx] + (((idx * 17) % 100)::numeric / 10000),
      'Montreal',
      'QC',
      true,
      NOW() - ((idx * 3) % 72 || ' hours')::interval,  -- varied last_seen
      CASE WHEN idx % 8 = 0 THEN false ELSE true END,
      true,
      CASE WHEN idx % 12 = 0 THEN false ELSE true END,
      CASE WHEN idx % 10 = 0 THEN false ELSE true END
    )
    ON CONFLICT (id) DO UPDATE SET
      gender = EXCLUDED.gender,
      playing_hand = EXCLUDED.playing_hand,
      max_travel_distance = EXCLUDED.max_travel_distance,
      postal_code = EXCLUDED.postal_code,
      country = EXCLUDED.country,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      city = EXCLUDED.city,
      province = EXCLUDED.province,
      push_notifications_enabled = EXCLUDED.push_notifications_enabled,
      last_seen_at = EXCLUDED.last_seen_at;
  END LOOP;

  -- Create player record for the logged-in user too
  IF logged_in_user IS NOT NULL AND logged_in_user::text NOT LIKE 'a1000000-0000-0000-0000-00000000%' THEN
    INSERT INTO player (id, gender, playing_hand, max_travel_distance, postal_code, country, latitude, longitude, city, province, push_notifications_enabled)
    VALUES (logged_in_user, 'male', 'right', 25, 'H2T 1S4', 'CA', 45.5236, -73.5865, 'Montreal', 'QC', true)
    ON CONFLICT (id) DO UPDATE SET
      push_notifications_enabled = true;
  END IF;

  RAISE NOTICE 'Created player records for all users';
END $$;

-- ============================================================================
-- 6. Player Sports + Rating Scores
-- ============================================================================
DO $$
DECLARE
  tennis_id UUID;
  pickleball_id UUID;
  ntrp_system_id UUID;
  dupr_system_id UUID;
  -- Sport distribution: 1=tennis only, 2=pickleball only, 3=both
  -- ~60% tennis only, ~15% pickleball only, ~25% both
  sport_mix INT[] := ARRAY[
    3, 3, 1, 3, 1, 2, 1, 3, 3, 1,
    1, 3, 1, 1, 3, 2, 1, 3, 1, 1,
    3, 2, 1, 3, 1, 1, 3, 1, 2, 3,
    1, 3, 1, 1, 3, 2, 1, 1, 3, 2,
    1, 3, 1, 2, 1, 3, 1, 1, 3, 1,
    3, 1, 3, 1, 2, 1, 3, 1, 1, 3,
    1, 2, 1, 3, 1, 1, 3, 2, 1, 3,
    3, 1, 1, 3, 2, 1, 1, 3, 1, 2,
    1, 3, 1, 1, 3, 1, 2, 3, 1, 1,
    3, 1, 1, 2, 3, 1, 3, 1, 2, 1
  ];
  -- NTRP levels for tennis players (weighted toward 3.0-4.5)
  ntrp_values NUMERIC[] := ARRAY[
    4.0, 3.5, 4.5, 2.5, 3.5, 3.0, 4.5, 3.0, 3.5, 3.0,
    4.0, 3.5, 3.0, 5.0, 4.0, 2.5, 3.5, 4.0, 3.0, 3.5,
    4.5, 3.0, 3.5, 3.0, 4.0, 5.5, 3.5, 2.5, 3.0, 4.5,
    3.5, 4.0, 3.0, 3.5, 3.5, 2.5, 4.0, 3.5, 4.0, 3.0,
    3.5, 4.5, 3.0, 2.5, 5.0, 3.5, 3.0, 4.0, 4.5, 3.5,
    4.0, 3.0, 3.5, 3.5, 2.5, 4.5, 3.0, 3.5, 4.0, 3.0,
    3.5, 3.0, 4.0, 3.5, 5.0, 3.0, 3.5, 2.5, 4.0, 3.5,
    4.5, 3.0, 3.5, 3.0, 2.5, 4.0, 3.5, 3.0, 4.5, 3.0,
    3.5, 4.0, 3.0, 3.5, 3.5, 5.0, 2.5, 3.5, 4.0, 3.0,
    3.5, 3.0, 4.5, 3.5, 3.0, 4.0, 3.5, 3.0, 2.5, 4.0
  ];
  -- DUPR levels for pickleball players (weighted toward 2.5-4.0)
  dupr_values NUMERIC[] := ARRAY[
    3.5, 4.0, 3.0, 2.5, 3.5, 4.5, 3.0, 3.5, 2.5, 3.0,
    3.5, 3.0, 3.5, 4.0, 3.0, 3.5, 2.5, 4.0, 3.0, 3.5,
    4.0, 3.5, 3.0, 3.5, 4.5, 3.0, 3.5, 2.5, 3.5, 4.0,
    3.0, 3.5, 3.0, 2.5, 4.0, 3.0, 3.5, 3.0, 3.5, 4.5,
    3.0, 3.5, 3.0, 3.5, 4.0, 3.5, 3.0, 3.5, 4.0, 3.0,
    3.5, 3.0, 4.0, 2.5, 3.5, 3.0, 3.5, 4.5, 3.0, 3.5,
    4.0, 3.0, 3.5, 3.5, 2.5, 4.0, 3.5, 3.0, 3.5, 4.0,
    3.0, 3.5, 2.5, 3.5, 4.5, 3.0, 3.5, 3.0, 4.0, 3.5,
    3.0, 3.5, 4.0, 3.0, 3.5, 2.5, 3.5, 3.0, 4.0, 3.5,
    3.0, 4.5, 3.5, 3.0, 3.5, 3.0, 4.0, 2.5, 3.5, 3.0
  ];
  -- Match duration preferences
  durations match_duration_enum[] := ARRAY[
    '90', '60', '90', '60', '120', '60', '90', '60', '90', '60',
    '90', '120', '60', '90', '90', '60', '120', '60', '90', '60',
    '90', '60', '120', '90', '60', '90', '60', '90', '60', '120',
    '60', '90', '60', '90', '120', '60', '90', '60', '90', '60',
    '90', '60', '120', '60', '90', '90', '60', '90', '120', '60',
    '60', '90', '60', '120', '90', '60', '90', '60', '120', '60',
    '90', '60', '90', '60', '120', '90', '60', '90', '60', '90',
    '60', '120', '90', '60', '90', '60', '120', '60', '90', '60',
    '90', '60', '120', '60', '90', '90', '60', '90', '60', '120',
    '60', '90', '60', '120', '90', '60', '90', '60', '90', '60'
  ];
  -- Match type preferences
  match_types match_type_enum[] := ARRAY[
    'competitive', 'casual', 'both', 'casual', 'competitive',
    'casual', 'competitive', 'both', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'competitive', 'both',
    'casual', 'competitive', 'casual', 'both', 'casual',
    'competitive', 'casual', 'both', 'casual', 'competitive',
    'competitive', 'both', 'casual', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'casual', 'both',
    'casual', 'competitive', 'casual', 'competitive', 'casual',
    'both', 'competitive', 'casual', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'casual', 'both',
    'casual', 'competitive', 'both', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'casual', 'both',
    'competitive', 'casual', 'both', 'competitive', 'casual',
    'casual', 'competitive', 'both', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'casual', 'both',
    'competitive', 'casual', 'both', 'casual', 'competitive',
    'casual', 'competitive', 'both', 'casual', 'competitive',
    'both', 'casual', 'competitive', 'casual', 'both',
    'competitive', 'casual', 'both', 'competitive', 'casual',
    'casual', 'competitive', 'both', 'casual', 'competitive'
  ];
  -- Badge statuses: ~50% self_declared, ~35% certified, ~15% disputed
  badges badge_status_enum[] := ARRAY[
    'certified', 'self_declared', 'certified', 'self_declared', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'disputed', 'self_declared',
    'certified', 'self_declared', 'self_declared', 'certified', 'self_declared',
    'self_declared', 'disputed', 'certified', 'self_declared', 'self_declared',
    'certified', 'self_declared', 'self_declared', 'self_declared', 'certified',
    'certified', 'self_declared', 'self_declared', 'disputed', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'self_declared', 'certified',
    'self_declared', 'self_declared', 'disputed', 'certified', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'self_declared', 'certified',
    'self_declared', 'self_declared', 'self_declared', 'certified', 'self_declared',
    'certified', 'self_declared', 'self_declared', 'certified', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'disputed', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'self_declared', 'certified',
    'self_declared', 'disputed', 'self_declared', 'certified', 'self_declared',
    'certified', 'self_declared', 'self_declared', 'self_declared', 'certified',
    'self_declared', 'self_declared', 'disputed', 'certified', 'self_declared',
    'self_declared', 'certified', 'self_declared', 'self_declared', 'certified',
    'self_declared', 'self_declared', 'self_declared', 'certified', 'self_declared',
    'certified', 'self_declared', 'disputed', 'self_declared', 'certified',
    'self_declared', 'self_declared', 'certified', 'self_declared', 'self_declared'
  ];
  fake_id UUID;
  idx INT;
  ps_uuid UUID;
  rs_uuid UUID;
  logged_in_user UUID;
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  IF tennis_id IS NULL OR pickleball_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping player sport seeding. Run rallia-facilities first!';
    RETURN;
  END IF;

  logged_in_user := pg_temp.resolve_seed_user();

  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- Tennis
    IF sport_mix[idx] IN (1, 3) THEN
      INSERT INTO player_sport (player_id, sport_id, is_primary, is_active, preferred_match_duration, preferred_match_type)
      VALUES (fake_id, tennis_id, true, true, durations[idx], match_types[idx])
      ON CONFLICT DO NOTHING
      RETURNING id INTO ps_uuid;

      -- Assign NTRP rating
      IF ntrp_system_id IS NOT NULL AND ps_uuid IS NOT NULL THEN
        SELECT id INTO rs_uuid FROM rating_score
        WHERE rating_system_id = ntrp_system_id AND value = ntrp_values[idx];
        IF rs_uuid IS NOT NULL THEN
          INSERT INTO player_rating_score (
            player_id, rating_score_id, badge_status, source,
            referrals_count, approved_proofs_count,
            peer_evaluation_average, peer_evaluation_count
          ) VALUES (
            fake_id, rs_uuid, badges[idx],
            CASE WHEN idx % 3 = 0 THEN 'self_reported' ELSE 'onboarding' END,
            CASE WHEN badges[idx] = 'certified' THEN 2 + (idx % 4) ELSE idx % 3 END,
            CASE WHEN badges[idx] = 'certified' THEN 1 + (idx % 3) ELSE 0 END,
            CASE WHEN idx % 4 = 0 THEN (2.5 + (idx % 30)::numeric / 10) ELSE NULL END,
            CASE WHEN idx % 4 = 0 THEN 1 + (idx % 4) ELSE 0 END
          ) ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;

    -- Pickleball
    IF sport_mix[idx] IN (2, 3) THEN
      INSERT INTO player_sport (player_id, sport_id, is_primary, is_active, preferred_match_duration, preferred_match_type)
      VALUES (fake_id, pickleball_id,
        CASE WHEN sport_mix[idx] = 2 THEN true ELSE false END,
        true, '60', 'casual')
      ON CONFLICT DO NOTHING
      RETURNING id INTO ps_uuid;

      -- Assign DUPR rating
      IF dupr_system_id IS NOT NULL AND ps_uuid IS NOT NULL THEN
        SELECT id INTO rs_uuid FROM rating_score
        WHERE rating_system_id = dupr_system_id AND value = dupr_values[idx];
        IF rs_uuid IS NOT NULL THEN
          INSERT INTO player_rating_score (
            player_id, rating_score_id, badge_status, source,
            referrals_count, approved_proofs_count
          ) VALUES (
            fake_id, rs_uuid,
            CASE WHEN badges[idx] = 'certified' THEN 'self_declared' ELSE badges[idx] END,
            'onboarding',
            idx % 3,
            0
          ) ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Seed the logged-in user's sport too
  IF logged_in_user IS NOT NULL AND logged_in_user::text NOT LIKE 'a1000000-0000-0000-0000-00000000%' THEN
    INSERT INTO player_sport (player_id, sport_id, is_primary, is_active, preferred_match_duration, preferred_match_type)
    VALUES (logged_in_user, tennis_id, true, true, '90', 'both')
    ON CONFLICT DO NOTHING
    RETURNING id INTO ps_uuid;

    IF ntrp_system_id IS NOT NULL AND ps_uuid IS NOT NULL THEN
      SELECT id INTO rs_uuid FROM rating_score WHERE rating_system_id = ntrp_system_id AND value = 3.5;
      IF rs_uuid IS NOT NULL THEN
        INSERT INTO player_rating_score (player_id, rating_score_id, badge_status, source)
        VALUES (logged_in_user, rs_uuid, 'self_declared', 'onboarding')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  RAISE NOTICE 'Created player_sport and player_rating_score records';
END $$;

-- ============================================================================
-- 6b. Player Sport Play Styles + Play Attributes (junction tables)
-- ============================================================================
DO $$
DECLARE
  tennis_id UUID;
  pickleball_id UUID;
  -- Tennis play style slugs per player (cycle through 4 styles)
  t_styles TEXT[] := ARRAY['aggressive_baseliner', 'counterpuncher', 'serve_and_volley', 'all_court'];
  -- Pickleball play style slugs per player (cycle through 4 styles)
  p_styles TEXT[] := ARRAY['banger', 'soft_game', 'hybrid', 'speedup_specialist'];
  -- Tennis attribute slugs (16 total)
  t_attrs TEXT[] := ARRAY[
    'big_serve', 'heavy_topspin_forehand', 'court_coverage', 'consistent',
    'backhand_slice', 'strong_volleyer', 'clutch_performer', 'endurance',
    'flat_forehand', 'inside_out_forehand', 'kick_serve', 'one_handed_backhand',
    'overhead_smash', 'quick_reflexes', 'two_handed_backhand', 'accurate_placement'
  ];
  -- Pickleball attribute slugs (14 total)
  p_attrs TEXT[] := ARRAY[
    'drive_specialist', 'speedup_attack', 'quick_hands', 'dink_master',
    'drop_shot', 'patient', 'reset_specialist', 'court_mobility',
    'power_serve', 'spin_serve', 'erne_specialist', 'strategic',
    'stamina'
  ];
  -- Sport mix (same as section 6)
  sport_mix INT[] := ARRAY[
    3, 3, 1, 3, 1, 2, 1, 3, 3, 1,
    1, 3, 1, 1, 3, 2, 1, 3, 1, 1,
    3, 2, 1, 3, 1, 1, 3, 1, 2, 3,
    1, 3, 1, 1, 3, 2, 1, 1, 3, 2,
    1, 3, 1, 2, 1, 3, 1, 1, 3, 1,
    3, 1, 3, 1, 2, 1, 3, 1, 1, 3,
    1, 2, 1, 3, 1, 1, 3, 2, 1, 3,
    3, 1, 1, 3, 2, 1, 1, 3, 1, 2,
    1, 3, 1, 1, 3, 1, 2, 3, 1, 1,
    3, 1, 1, 2, 3, 1, 3, 1, 2, 1
  ];
  fake_id UUID;
  idx INT;
  ps_id UUID;
  style_id UUID;
  attr_id UUID;
  a_idx INT;
  num_attrs INT;
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';

  IF tennis_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping play style/attribute seeding';
    RETURN;
  END IF;

  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- Tennis play style + attributes
    IF sport_mix[idx] IN (1, 3) THEN
      SELECT ps.id INTO ps_id FROM player_sport ps
      WHERE ps.player_id = fake_id AND ps.sport_id = tennis_id LIMIT 1;

      IF ps_id IS NOT NULL THEN
        -- Play style (cycle through 4)
        SELECT id INTO style_id FROM play_style
        WHERE name = t_styles[((idx - 1) % 4) + 1] AND sport_id = tennis_id;
        IF style_id IS NOT NULL THEN
          INSERT INTO player_sport_play_style (player_sport_id, play_style_id)
          VALUES (ps_id, style_id) ON CONFLICT DO NOTHING;
        END IF;

        -- 2-4 play attributes per player
        num_attrs := 2 + (idx % 3);  -- 2, 3, or 4
        FOR a_idx IN 1..num_attrs LOOP
          SELECT id INTO attr_id FROM play_attribute
          WHERE name = t_attrs[((idx + a_idx * 3 - 1) % 16) + 1] AND sport_id = tennis_id;
          IF attr_id IS NOT NULL THEN
            INSERT INTO player_sport_play_attribute (player_sport_id, play_attribute_id)
            VALUES (ps_id, attr_id) ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- Pickleball play style + attributes
    IF sport_mix[idx] IN (2, 3) THEN
      SELECT ps.id INTO ps_id FROM player_sport ps
      WHERE ps.player_id = fake_id AND ps.sport_id = pickleball_id LIMIT 1;

      IF ps_id IS NOT NULL THEN
        -- Play style (cycle through 4)
        SELECT id INTO style_id FROM play_style
        WHERE name = p_styles[((idx - 1) % 4) + 1] AND sport_id = pickleball_id;
        IF style_id IS NOT NULL THEN
          INSERT INTO player_sport_play_style (player_sport_id, play_style_id)
          VALUES (ps_id, style_id) ON CONFLICT DO NOTHING;
        END IF;

        -- 2-3 play attributes per player
        num_attrs := 2 + (idx % 2);
        FOR a_idx IN 1..num_attrs LOOP
          -- Use 13 instead of 14 to avoid 'banger' which is a play_style not attribute
          SELECT id INTO attr_id FROM play_attribute
          WHERE name = p_attrs[((idx + a_idx * 5 - 1) % 13) + 1] AND sport_id = pickleball_id;
          IF attr_id IS NOT NULL THEN
            INSERT INTO player_sport_play_attribute (player_sport_id, play_attribute_id)
            VALUES (ps_id, attr_id) ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created play style and play attribute records';
END $$;

-- ============================================================================
-- 7. Player Availability
-- ============================================================================
DO $$
DECLARE
  days day_enum[] := ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  periods period_enum[] := ARRAY['morning', 'afternoon', 'evening'];
  fake_id UUID;
  idx INT;
  d INT;
  p INT;
  slot_hash INT;
BEGIN
  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    FOR d IN 1..7 LOOP
      FOR p IN 1..3 LOOP
        -- Deterministic pseudo-random: each player gets 5-12 active slots
        slot_hash := (idx * 31 + d * 7 + p * 13) % 100;

        -- Weekend mornings/afternoons: high probability (70%)
        -- Weekday evenings: medium probability (50%)
        -- Weekday mornings/afternoons: lower probability (25%)
        IF (d >= 6 AND p <= 2 AND slot_hash < 70)         -- weekend morning/afternoon
           OR (d < 6 AND p = 3 AND slot_hash < 50)        -- weekday evening
           OR (d < 6 AND p <= 2 AND slot_hash < 25)       -- weekday morning/afternoon
        THEN
          INSERT INTO player_availability (player_id, day, period, is_active)
          VALUES (fake_id, days[d], periods[p], true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Created player availability records';
END $$;

-- ============================================================================
-- 8. Player Reputation
-- ============================================================================
DO $$
DECLARE
  fake_id UUID;
  idx INT;
  score NUMERIC;
  tier reputation_tier;
  matches_done INT;
  pos_events INT;
  neg_events INT;
  total INT;
  logged_in_user UUID;
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();

  FOR idx IN 1..100 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- Score from 30 to 100
    score := 30 + ((idx * 17 + 11) % 71);
    -- Determine tier
    IF score >= 85 THEN tier := 'platinum';
    ELSIF score >= 70 THEN tier := 'gold';
    ELSIF score >= 50 THEN tier := 'silver';
    ELSIF score >= 30 THEN tier := 'bronze';
    ELSE tier := 'unknown';
    END IF;

    matches_done := (idx * 3 + 2) % 51;  -- 0-50
    pos_events := GREATEST(0, (score::int - 30) / 5);
    neg_events := CASE WHEN score < 60 THEN 2 + (idx % 4) ELSE idx % 3 END;
    total := pos_events + neg_events;

    INSERT INTO player_reputation (
      player_id, reputation_score, reputation_tier,
      total_events, positive_events, negative_events,
      matches_completed, is_public, calculated_at
    ) VALUES (
      fake_id, score, tier,
      total, pos_events, neg_events,
      matches_done,
      CASE WHEN idx % 10 IN (0, 3, 7) THEN false ELSE true END,
      NOW()
    ) ON CONFLICT (player_id) DO UPDATE SET
      reputation_score = EXCLUDED.reputation_score,
      reputation_tier = EXCLUDED.reputation_tier,
      total_events = EXCLUDED.total_events,
      positive_events = EXCLUDED.positive_events,
      negative_events = EXCLUDED.negative_events,
      matches_completed = EXCLUDED.matches_completed,
      is_public = EXCLUDED.is_public;
  END LOOP;

  -- Logged-in user reputation
  IF logged_in_user IS NOT NULL AND logged_in_user::text NOT LIKE 'a1000000-0000-0000-0000-00000000%' THEN
    INSERT INTO player_reputation (player_id, reputation_score, reputation_tier, total_events, positive_events, negative_events, matches_completed, is_public)
    VALUES (logged_in_user, 75, 'gold', 12, 10, 2, 15, true)
    ON CONFLICT (player_id) DO UPDATE SET
      reputation_score = EXCLUDED.reputation_score,
      reputation_tier = EXCLUDED.reputation_tier;
  END IF;

  RAISE NOTICE 'Created player reputation records';
END $$;

-- ============================================================================
-- 9. Rating Proofs (~80 proofs across ~40 players)
-- ============================================================================
DO $$
DECLARE
  proof_titles TEXT[] := ARRAY[
    'Tennis Canada Profile', 'DUPR Rating Screenshot', 'Tournament Result',
    'Club Membership Card', 'League Standing', 'Coach Assessment',
    'Regional Ranking', 'Tournament Bracket'
  ];
  proof_statuses proof_status_enum[] := ARRAY['approved', 'approved', 'pending', 'approved', 'rejected', 'approved', 'pending', 'approved'];
  fake_id UUID;
  prs_id UUID;
  rs_id UUID;
  idx INT;
  proof_idx INT := 0;
  num_proofs INT;
BEGIN
  -- Disable certification triggers to avoid enum bug in check_and_update_certification
  ALTER TABLE player_rating_score DISABLE TRIGGER trigger_check_certification;
  ALTER TABLE rating_proof DISABLE TRIGGER trigger_certification_proof_change;
  ALTER TABLE rating_proof DISABLE TRIGGER trigger_update_approved_proofs_count;

  FOR idx IN 1..100 LOOP
    -- ~40 players get proofs (every 2-3 players)
    IF idx % 3 != 0 AND idx <= 80 THEN
      CONTINUE;
    END IF;

    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- Get one of the player's rating scores
    SELECT prs2.id, prs2.rating_score_id INTO prs_id, rs_id
    FROM player_rating_score prs2
    WHERE prs2.player_id = fake_id
    LIMIT 1;

    IF prs_id IS NULL THEN CONTINUE; END IF;

    -- 1-3 proofs per player
    num_proofs := 1 + (idx % 3);
    FOR p IN 1..num_proofs LOOP
      proof_idx := proof_idx + 1;

      INSERT INTO rating_proof (
        id, player_rating_score_id, proof_type, external_url,
        title, description, status, is_active, rating_score_id
      ) VALUES (
        ('f1000000-0000-0000-0000-00000000' || LPAD(proof_idx::text, 4, '0'))::uuid,
        prs_id,
        'external_link',
        'https://example.com/proof/' || proof_idx,
        proof_titles[((proof_idx - 1) % 8) + 1],
        'Rating proof #' || proof_idx || ' for player #' || idx,
        proof_statuses[((proof_idx - 1) % 8) + 1],
        true,
        rs_id
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Update approved_proofs_count for players with approved proofs
  -- (done while triggers are still disabled to avoid certification enum bug)
  UPDATE player_rating_score prs
  SET approved_proofs_count = sub.cnt
  FROM (
    SELECT rp.player_rating_score_id, COUNT(*) as cnt
    FROM rating_proof rp
    WHERE rp.status = 'approved' AND rp.id::text LIKE 'f1000000-0000-0000-0000-%'
    GROUP BY rp.player_rating_score_id
  ) sub
  WHERE prs.id = sub.player_rating_score_id;

  -- Re-enable certification triggers
  ALTER TABLE player_rating_score ENABLE TRIGGER trigger_check_certification;
  ALTER TABLE rating_proof ENABLE TRIGGER trigger_certification_proof_change;
  ALTER TABLE rating_proof ENABLE TRIGGER trigger_update_approved_proofs_count;

  RAISE NOTICE 'Created rating proof records';
END $$;

-- ============================================================================
-- 10. Rating Reference Requests (~50 requests)
-- ============================================================================
DO $$
DECLARE
  req_idx INT := 0;
  requester_id UUID;
  referee_id UUID;
  prs_id UUID;
  status_val rating_request_status_enum;
  statuses rating_request_status_enum[] := ARRAY[
    'pending', 'completed', 'completed', 'declined', 'completed',
    'pending', 'expired', 'completed', 'completed', 'pending',
    'completed', 'declined', 'pending', 'completed', 'expired',
    'completed', 'pending', 'completed', 'declined', 'completed',
    'pending', 'completed', 'expired', 'completed', 'completed',
    'pending', 'completed', 'declined', 'completed', 'pending',
    'completed', 'expired', 'completed', 'pending', 'completed',
    'declined', 'completed', 'pending', 'completed', 'expired',
    'completed', 'pending', 'completed', 'declined', 'completed',
    'pending', 'completed', 'expired', 'completed', 'completed'
  ];
  -- Pairs: (requester_player_idx, referee_player_idx)
  pairs INT[][] := ARRAY[
    ARRAY[1,3], ARRAY[1,5], ARRAY[2,4], ARRAY[3,7], ARRAY[4,1],
    ARRAY[5,9], ARRAY[6,2], ARRAY[7,11], ARRAY[8,1], ARRAY[9,3],
    ARRAY[10,5], ARRAY[11,7], ARRAY[12,2], ARRAY[13,1], ARRAY[14,9],
    ARRAY[15,20], ARRAY[16,25], ARRAY[17,30], ARRAY[18,35], ARRAY[19,40],
    ARRAY[20,45], ARRAY[21,50], ARRAY[22,55], ARRAY[23,60], ARRAY[24,65],
    ARRAY[25,70], ARRAY[26,75], ARRAY[27,80], ARRAY[28,85], ARRAY[29,90],
    ARRAY[30,1], ARRAY[35,5], ARRAY[40,10], ARRAY[45,15], ARRAY[50,20],
    ARRAY[55,25], ARRAY[60,30], ARRAY[65,35], ARRAY[70,40], ARRAY[75,45],
    ARRAY[80,50], ARRAY[85,55], ARRAY[90,60], ARRAY[95,65], ARRAY[100,70],
    ARRAY[51,3], ARRAY[52,7], ARRAY[53,11], ARRAY[54,15], ARRAY[55,19]
  ];
BEGIN
  FOR req_idx IN 1..50 LOOP
    requester_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][1]::text, 4, '0'))::uuid;
    referee_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][2]::text, 4, '0'))::uuid;
    status_val := statuses[req_idx];

    -- Get requester's first rating score
    SELECT id INTO prs_id FROM player_rating_score WHERE player_id = requester_id LIMIT 1;
    IF prs_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO rating_reference_request (
      id, requester_id, player_rating_score_id, referee_id,
      message, status, rating_supported, response_message,
      responded_at, expires_at
    ) VALUES (
      ('f6000000-0000-0000-0000-00000000' || LPAD(req_idx::text, 4, '0'))::uuid,
      requester_id,
      prs_id,
      referee_id,
      'Could you confirm my rating level? We''ve played together several times.',
      status_val,
      CASE WHEN status_val = 'completed' THEN (req_idx % 3 != 0) ELSE false END,
      CASE WHEN status_val = 'completed' THEN 'Yes, this rating seems accurate based on our matches.'
           WHEN status_val = 'declined' THEN 'Sorry, I don''t feel I''ve played enough with you to confirm.'
           ELSE NULL END,
      CASE WHEN status_val IN ('completed', 'declined') THEN NOW() - (req_idx || ' days')::interval ELSE NULL END,
      NOW() + interval '30 days'
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Created rating reference requests';
END $$;

-- ============================================================================
-- 11. Reference Requests (~50 requests)
-- ============================================================================
DO $$
DECLARE
  req_idx INT := 0;
  requester_id UUID;
  referee_id UUID;
  sport_id_val UUID;
  rs_id UUID;
  status_val TEXT;
  statuses TEXT[] := ARRAY[
    'completed', 'pending', 'completed', 'expired', 'completed',
    'pending', 'completed', 'completed', 'pending', 'expired',
    'completed', 'pending', 'completed', 'expired', 'completed',
    'pending', 'completed', 'completed', 'pending', 'expired',
    'completed', 'pending', 'completed', 'expired', 'completed',
    'pending', 'completed', 'completed', 'pending', 'expired',
    'completed', 'pending', 'completed', 'expired', 'completed',
    'pending', 'completed', 'completed', 'pending', 'expired',
    'completed', 'pending', 'completed', 'expired', 'completed',
    'pending', 'completed', 'completed', 'pending', 'expired'
  ];
  pairs INT[][] := ARRAY[
    ARRAY[2,6], ARRAY[3,8], ARRAY[5,1], ARRAY[7,3], ARRAY[8,12],
    ARRAY[10,4], ARRAY[12,6], ARRAY[15,1], ARRAY[18,7], ARRAY[21,9],
    ARRAY[25,30], ARRAY[28,35], ARRAY[30,40], ARRAY[33,45], ARRAY[35,50],
    ARRAY[38,55], ARRAY[40,60], ARRAY[43,65], ARRAY[45,70], ARRAY[48,75],
    ARRAY[50,80], ARRAY[53,85], ARRAY[55,90], ARRAY[58,95], ARRAY[60,100],
    ARRAY[62,1], ARRAY[65,5], ARRAY[68,10], ARRAY[70,15], ARRAY[73,20],
    ARRAY[75,25], ARRAY[78,30], ARRAY[80,35], ARRAY[83,40], ARRAY[85,45],
    ARRAY[88,50], ARRAY[90,55], ARRAY[93,60], ARRAY[95,65], ARRAY[98,70],
    ARRAY[1,10], ARRAY[4,15], ARRAY[6,20], ARRAY[9,25], ARRAY[11,30],
    ARRAY[14,35], ARRAY[16,40], ARRAY[19,45], ARRAY[22,50], ARRAY[24,55]
  ];
  tennis_id UUID;
BEGIN
  ALTER TABLE reference_request DISABLE TRIGGER check_reference_threshold_trigger;

  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  IF tennis_id IS NULL THEN
    ALTER TABLE reference_request ENABLE TRIGGER check_reference_threshold_trigger;
    RETURN;
  END IF;

  FOR req_idx IN 1..50 LOOP
    requester_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][1]::text, 4, '0'))::uuid;
    referee_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][2]::text, 4, '0'))::uuid;
    status_val := statuses[req_idx];

    -- Get requester's tennis rating score
    SELECT prs.rating_score_id INTO rs_id
    FROM player_rating_score prs
    JOIN rating_score rsc ON rsc.id = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rsc.rating_system_id
    WHERE prs.player_id = requester_id AND rsys.code = 'ntrp'
    LIMIT 1;
    IF rs_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO reference_request (
      id, requester_id, referee_id, sport_id, claimed_rating_score_id,
      status, reference_rating_value, referee_comment,
      responded_at, completed_at
    ) VALUES (
      ('f3000000-0000-0000-0000-00000000' || LPAD(req_idx::text, 4, '0'))::uuid,
      requester_id,
      referee_id,
      tennis_id,
      rs_id,
      status_val,
      CASE WHEN status_val = 'completed' THEN 3.0 + (req_idx % 5)::numeric * 0.5 ELSE NULL END,
      CASE WHEN status_val = 'completed' THEN 'Good player, rating seems appropriate for their level.'
           ELSE NULL END,
      CASE WHEN status_val IN ('completed', 'expired') THEN NOW() - (req_idx * 2 || ' days')::interval ELSE NULL END,
      CASE WHEN status_val = 'completed' THEN NOW() - (req_idx * 2 || ' days')::interval ELSE NULL END
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  ALTER TABLE reference_request ENABLE TRIGGER check_reference_threshold_trigger;
  RAISE NOTICE 'Created reference requests';
END $$;

-- ============================================================================
-- 12. Peer Rating Requests (~50 requests)
-- ============================================================================
DO $$
DECLARE
  req_idx INT;
  requester_id UUID;
  evaluator_id UUID;
  rsys_id UUID;
  rs_id UUID;
  status_val rating_request_status_enum;
  statuses rating_request_status_enum[] := ARRAY[
    'completed', 'pending', 'completed', 'declined', 'completed',
    'pending', 'expired', 'completed', 'pending', 'completed',
    'declined', 'completed', 'completed', 'pending', 'completed',
    'declined', 'completed', 'pending', 'expired', 'completed',
    'pending', 'completed', 'declined', 'completed', 'completed',
    'pending', 'completed', 'declined', 'completed', 'pending',
    'expired', 'completed', 'pending', 'completed', 'declined',
    'completed', 'pending', 'completed', 'expired', 'completed',
    'completed', 'pending', 'declined', 'completed', 'pending',
    'completed', 'expired', 'completed', 'pending', 'completed'
  ];
  pairs INT[][] := ARRAY[
    ARRAY[1,7], ARRAY[2,9], ARRAY[3,1], ARRAY[4,6], ARRAY[5,11],
    ARRAY[7,3], ARRAY[8,5], ARRAY[9,13], ARRAY[11,1], ARRAY[12,7],
    ARRAY[13,5], ARRAY[15,3], ARRAY[17,9], ARRAY[19,11], ARRAY[20,25],
    ARRAY[22,30], ARRAY[24,35], ARRAY[26,40], ARRAY[28,45], ARRAY[30,50],
    ARRAY[32,55], ARRAY[34,60], ARRAY[36,65], ARRAY[38,70], ARRAY[40,75],
    ARRAY[42,80], ARRAY[44,85], ARRAY[46,90], ARRAY[48,95], ARRAY[50,100],
    ARRAY[52,1], ARRAY[54,5], ARRAY[56,10], ARRAY[58,15], ARRAY[60,20],
    ARRAY[62,25], ARRAY[64,30], ARRAY[66,35], ARRAY[68,40], ARRAY[70,45],
    ARRAY[72,50], ARRAY[74,55], ARRAY[76,60], ARRAY[78,65], ARRAY[80,70],
    ARRAY[82,75], ARRAY[84,80], ARRAY[86,85], ARRAY[88,90], ARRAY[90,95]
  ];
  ntrp_system_id UUID;
BEGIN
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  IF ntrp_system_id IS NULL THEN RETURN; END IF;

  FOR req_idx IN 1..50 LOOP
    requester_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][1]::text, 4, '0'))::uuid;
    evaluator_id := ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[req_idx][2]::text, 4, '0'))::uuid;
    status_val := statuses[req_idx];

    -- Rating score assigned by evaluator (when completed)
    SELECT id INTO rs_id FROM rating_score
    WHERE rating_system_id = ntrp_system_id AND value = 3.0 + (req_idx % 5)::numeric * 0.5
    LIMIT 1;

    INSERT INTO peer_rating_request (
      id, requester_id, evaluator_id, rating_system_id,
      message, status, assigned_rating_score_id,
      response_message, responded_at, expires_at
    ) VALUES (
      ('f2000000-0000-0000-0000-00000000' || LPAD(req_idx::text, 4, '0'))::uuid,
      requester_id,
      evaluator_id,
      ntrp_system_id,
      'Hi! Could you evaluate my tennis level? We''ve played a few times.',
      status_val,
      CASE WHEN status_val = 'completed' THEN rs_id ELSE NULL END,
      CASE WHEN status_val = 'completed' THEN 'Based on our matches, I think this rating fits well.'
           WHEN status_val = 'declined' THEN 'I haven''t seen enough of your play to evaluate accurately.'
           ELSE NULL END,
      CASE WHEN status_val IN ('completed', 'declined') THEN NOW() - (req_idx || ' days')::interval ELSE NULL END,
      NOW() + interval '30 days'
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Created peer rating requests';
END $$;

-- ============================================================================
-- 13. Reputation Events (~200 events)
-- ============================================================================
DO $$
DECLARE
  event_types reputation_event_type[] := ARRAY[
    'match_completed', 'match_on_time', 'match_completed', 'match_on_time',
    'match_completed', 'match_late', 'match_completed', 'match_on_time',
    'review_received_5star', 'review_received_4star', 'match_completed', 'match_on_time',
    'match_completed', 'match_cancelled_early', 'match_on_time', 'match_completed',
    'review_received_3star', 'match_completed', 'match_on_time', 'match_no_show',
    'match_completed', 'match_on_time', 'first_match_bonus', 'match_completed',
    'match_completed', 'match_on_time', 'review_received_5star', 'match_late',
    'match_completed', 'match_on_time', 'match_completed', 'feedback_submitted',
    'match_completed', 'match_on_time', 'match_completed', 'review_received_4star',
    'match_completed', 'match_cancelled_late', 'match_on_time', 'match_completed',
    'match_completed', 'match_on_time', 'peer_rating_given', 'match_completed',
    'match_completed', 'match_on_time', 'review_received_5star', 'match_completed',
    'match_completed', 'match_on_time', 'match_completed', 'match_on_time',
    'match_completed', 'review_received_4star', 'match_on_time', 'match_completed',
    'match_completed', 'match_on_time', 'match_completed', 'match_on_time'
  ];
  base_impacts NUMERIC[] := ARRAY[
    2, 1, 2, 1, 2, -2, 2, 1, 3, 2, 2, 1, 2, -1, 1, 2,
    1, 2, 1, -5, 2, 1, 5, 2, 2, 1, 3, -2, 2, 1, 2, 1,
    2, 1, 2, 2, 2, -3, 1, 2, 2, 1, 2, 2, 2, 1, 3, 2,
    2, 1, 2, 1, 2, 2, 1, 2, 2, 1, 2, 1
  ];
  evt_idx INT;
  player_idx INT;
BEGIN
  ALTER TABLE reputation_event DISABLE TRIGGER reputation_event_recalculate;

  FOR evt_idx IN 1..200 LOOP
    -- Distribute events across players 1-60
    player_idx := ((evt_idx - 1) % 60) + 1;

    INSERT INTO reputation_event (
      id, player_id, event_type, base_impact,
      event_occurred_at
    ) VALUES (
      ('e0000000-0000-0000-0000-00000000' || LPAD(evt_idx::text, 4, '0'))::uuid,
      ('a1000000-0000-0000-0000-00000000' || LPAD(player_idx::text, 4, '0'))::uuid,
      event_types[1 + ((evt_idx - 1) % 60)],
      base_impacts[1 + ((evt_idx - 1) % 60)],
      NOW() - ((evt_idx * 2) || ' days')::interval
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  ALTER TABLE reputation_event ENABLE TRIGGER reputation_event_recalculate;
  RAISE NOTICE 'Created reputation events';
END $$;

-- ============================================================================
-- 14. Player Favorites (~150 relationships)
-- ============================================================================
DO $$
DECLARE
  -- (player_idx, favorite_player_idx) pairs — no self-favorites
  pairs INT[][] := ARRAY[
    ARRAY[1,2], ARRAY[1,5], ARRAY[1,7], ARRAY[2,1], ARRAY[2,8],
    ARRAY[3,1], ARRAY[3,9], ARRAY[4,2], ARRAY[4,6], ARRAY[5,3],
    ARRAY[5,11], ARRAY[6,1], ARRAY[6,4], ARRAY[7,3], ARRAY[7,5],
    ARRAY[8,2], ARRAY[8,12], ARRAY[9,1], ARRAY[9,7], ARRAY[10,5],
    ARRAY[10,15], ARRAY[11,1], ARRAY[11,3], ARRAY[12,7], ARRAY[12,9],
    ARRAY[13,1], ARRAY[14,5], ARRAY[15,7], ARRAY[18,1], ARRAY[21,3],
    ARRAY[22,5], ARRAY[23,10], ARRAY[24,15], ARRAY[25,20], ARRAY[26,1],
    ARRAY[27,8], ARRAY[28,12], ARRAY[29,18], ARRAY[30,22], ARRAY[31,5],
    ARRAY[32,10], ARRAY[33,15], ARRAY[34,20], ARRAY[35,25], ARRAY[36,30],
    ARRAY[37,1], ARRAY[38,7], ARRAY[39,14], ARRAY[40,21], ARRAY[41,28],
    ARRAY[42,35], ARRAY[43,3], ARRAY[44,9], ARRAY[45,16], ARRAY[46,23],
    ARRAY[47,30], ARRAY[48,37], ARRAY[49,5], ARRAY[50,11], ARRAY[51,18],
    ARRAY[52,25], ARRAY[53,32], ARRAY[54,39], ARRAY[55,46], ARRAY[56,2],
    ARRAY[57,8], ARRAY[58,15], ARRAY[59,22], ARRAY[60,29], ARRAY[61,36],
    ARRAY[62,43], ARRAY[63,50], ARRAY[64,4], ARRAY[65,11], ARRAY[66,18],
    ARRAY[67,25], ARRAY[68,32], ARRAY[69,39], ARRAY[70,46], ARRAY[71,53],
    ARRAY[72,60], ARRAY[73,1], ARRAY[74,7], ARRAY[75,14], ARRAY[76,21],
    ARRAY[77,28], ARRAY[78,35], ARRAY[79,42], ARRAY[80,49], ARRAY[81,56],
    ARRAY[82,63], ARRAY[83,70], ARRAY[84,3], ARRAY[85,10], ARRAY[86,17],
    ARRAY[87,24], ARRAY[88,31], ARRAY[89,38], ARRAY[90,45], ARRAY[91,52],
    ARRAY[92,59], ARRAY[93,66], ARRAY[94,73], ARRAY[95,80], ARRAY[96,2],
    ARRAY[97,9], ARRAY[98,16], ARRAY[99,23], ARRAY[100,30], ARRAY[1,35],
    ARRAY[2,40], ARRAY[3,45], ARRAY[4,50], ARRAY[5,55], ARRAY[6,60],
    ARRAY[7,65], ARRAY[8,70], ARRAY[9,75], ARRAY[10,80], ARRAY[11,85],
    ARRAY[12,90], ARRAY[13,95], ARRAY[14,100], ARRAY[15,51], ARRAY[16,52],
    ARRAY[17,53], ARRAY[18,54], ARRAY[19,55], ARRAY[20,56], ARRAY[21,57],
    ARRAY[22,58], ARRAY[23,59], ARRAY[24,60], ARRAY[25,61], ARRAY[26,62],
    ARRAY[27,63], ARRAY[28,64], ARRAY[29,65], ARRAY[30,66], ARRAY[31,67],
    ARRAY[32,68], ARRAY[33,69], ARRAY[34,70], ARRAY[35,71], ARRAY[36,72],
    ARRAY[37,73], ARRAY[38,74], ARRAY[39,75], ARRAY[40,76], ARRAY[41,77]
  ];
  p_idx INT;
BEGIN
  FOR p_idx IN 1..150 LOOP
    INSERT INTO player_favorite (player_id, favorite_player_id)
    VALUES (
      ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[p_idx][1]::text, 4, '0'))::uuid,
      ('a1000000-0000-0000-0000-00000000' || LPAD(pairs[p_idx][2]::text, 4, '0'))::uuid
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Created player favorite records';
END $$;

-- ============================================================================
-- 15. Player Blocks (~25 relationships)
-- ============================================================================
INSERT INTO player_block (player_id, blocked_player_id)
VALUES
  ('a1000000-0000-0000-0000-000000000010'::uuid, 'a1000000-0000-0000-0000-000000000020'::uuid),
  ('a1000000-0000-0000-0000-000000000015'::uuid, 'a1000000-0000-0000-0000-000000000030'::uuid),
  ('a1000000-0000-0000-0000-000000000022'::uuid, 'a1000000-0000-0000-0000-000000000038'::uuid),
  ('a1000000-0000-0000-0000-000000000035'::uuid, 'a1000000-0000-0000-0000-000000000005'::uuid),
  ('a1000000-0000-0000-0000-000000000042'::uuid, 'a1000000-0000-0000-0000-000000000017'::uuid),
  ('a1000000-0000-0000-0000-000000000051'::uuid, 'a1000000-0000-0000-0000-000000000003'::uuid),
  ('a1000000-0000-0000-0000-000000000055'::uuid, 'a1000000-0000-0000-0000-000000000012'::uuid),
  ('a1000000-0000-0000-0000-000000000060'::uuid, 'a1000000-0000-0000-0000-000000000025'::uuid),
  ('a1000000-0000-0000-0000-000000000065'::uuid, 'a1000000-0000-0000-0000-000000000040'::uuid),
  ('a1000000-0000-0000-0000-000000000070'::uuid, 'a1000000-0000-0000-0000-000000000008'::uuid),
  ('a1000000-0000-0000-0000-000000000075'::uuid, 'a1000000-0000-0000-0000-000000000045'::uuid),
  ('a1000000-0000-0000-0000-000000000080'::uuid, 'a1000000-0000-0000-0000-000000000019'::uuid),
  ('a1000000-0000-0000-0000-000000000085'::uuid, 'a1000000-0000-0000-0000-000000000033'::uuid),
  ('a1000000-0000-0000-0000-000000000090'::uuid, 'a1000000-0000-0000-0000-000000000007'::uuid),
  ('a1000000-0000-0000-0000-000000000095'::uuid, 'a1000000-0000-0000-0000-000000000050'::uuid),
  ('a1000000-0000-0000-0000-000000000002'::uuid, 'a1000000-0000-0000-0000-000000000058'::uuid),
  ('a1000000-0000-0000-0000-000000000006'::uuid, 'a1000000-0000-0000-0000-000000000062'::uuid),
  ('a1000000-0000-0000-0000-000000000011'::uuid, 'a1000000-0000-0000-0000-000000000073'::uuid),
  ('a1000000-0000-0000-0000-000000000018'::uuid, 'a1000000-0000-0000-0000-000000000081'::uuid),
  ('a1000000-0000-0000-0000-000000000024'::uuid, 'a1000000-0000-0000-0000-000000000092'::uuid),
  ('a1000000-0000-0000-0000-000000000028'::uuid, 'a1000000-0000-0000-0000-000000000099'::uuid),
  ('a1000000-0000-0000-0000-000000000034'::uuid, 'a1000000-0000-0000-0000-000000000088'::uuid),
  ('a1000000-0000-0000-0000-000000000039'::uuid, 'a1000000-0000-0000-0000-000000000076'::uuid),
  ('a1000000-0000-0000-0000-000000000044'::uuid, 'a1000000-0000-0000-0000-000000000067'::uuid),
  ('a1000000-0000-0000-0000-000000000048'::uuid, 'a1000000-0000-0000-0000-000000000054'::uuid)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 16. Player Favorite Facilities (~100 records)
-- ============================================================================
-- Links players to Montreal park facilities. These are only created if
-- facilities exist (populated by rallia-facilities).
-- ============================================================================
DO $$
DECLARE
  fac_ids UUID[];
  fac_count INT;
  fake_id UUID;
  fac_idx INT;
BEGIN
  -- Get up to 10 facility IDs
  SELECT array_agg(id) INTO fac_ids
  FROM (SELECT id FROM facility ORDER BY name LIMIT 10) sub;

  IF fac_ids IS NULL OR array_length(fac_ids, 1) = 0 THEN
    RAISE NOTICE 'No facilities found, skipping favorite facility seeding';
    RETURN;
  END IF;

  fac_count := array_length(fac_ids, 1);

  -- ~50 players get 1-3 favorite facilities
  FOR idx IN 1..50 LOOP
    fake_id := ('a1000000-0000-0000-0000-00000000' || LPAD(idx::text, 4, '0'))::uuid;

    -- First favorite
    INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
    VALUES (fake_id, fac_ids[((idx - 1) % fac_count) + 1], 1)
    ON CONFLICT DO NOTHING;

    -- Second favorite for every other player
    IF idx % 2 = 0 THEN
      fac_idx := ((idx + 3) % fac_count) + 1;
      INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
      VALUES (fake_id, fac_ids[fac_idx], 2)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Third favorite for every 5th player
    IF idx % 5 = 0 THEN
      fac_idx := ((idx + 7) % fac_count) + 1;
      INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
      VALUES (fake_id, fac_ids[fac_idx], 3)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created player favorite facility records';
END $$;

-- ============================================================================
-- 17. Matches (500: 250 upcoming + 175 past completed + 75 cancelled)
-- ============================================================================
-- The match_create_host_participant trigger auto-creates the host participant.
-- We disable the group notification trigger to avoid side-effects during seeding.
-- All parameters are varied using modular arithmetic for maximum coverage.
-- Facility-type matches always use a facility that supports the match's sport.
-- ============================================================================
DO $$
DECLARE
  tennis_id UUID;
  pickleball_id UUID;
  tennis_facs UUID[];
  pb_facs UUID[];
  tf INT;
  pf INT;
  i INT;
  v_sport_id UUID;
  v_is_pb BOOLEAN;
  v_format match_format_enum;
  v_vis match_visibility_enum;
  v_jm match_join_mode_enum;
  v_exp match_type_enum;
  v_dur match_duration_enum;
  v_dur_mins INT;
  v_loc_type location_type_enum;
  v_fac_id UUID;
  v_loc_name TEXT;
  v_loc_addr TEXT;
  v_lat NUMERIC;
  v_lng NUMERIC;
  v_notes TEXT;
  v_cost NUMERIC;
  v_cost_split cost_split_type_enum;
  v_host UUID;
  v_date DATE;
  v_start TIME;
  v_end TIME;
  v_cancel TIMESTAMPTZ;
  v_mutual BOOLEAN;
  v_court court_status_enum;
  ci INT := 0;
  -- Cycling arrays
  exps match_type_enum[] := ARRAY['casual','competitive','both'];
  durs match_duration_enum[] := ARRAY['60','90','120'];
  dur_m INT[] := ARRAY[60, 90, 120];
  starts TIME[] := ARRAY['08:00','09:00','09:30','10:00','11:00','13:00','14:00','15:00','16:00','17:00'];
  -- Custom locations (Montreal)
  c_names TEXT[] := ARRAY[
    'Parc La Fontaine Courts','Jarry Park Courts','Mount Royal Tennis',
    'Parc Jeanne-Mance','Westmount Rec Centre','Parc Jarry Tennis',
    'Complexe Claude-Robillard','Parc Kent Courts','Parc Maisonneuve',
    'NDG Sports Complex','Parc Angrignon Courts','Centre Gadbois'];
  c_addrs TEXT[] := ARRAY[
    '3933 Av du Parc-La Fontaine','285 Rue Faillon O','1260 Chemin Remembrance',
    '4549 Av de l''Esplanade','4675 Rue Ste-Catherine O','435 Rue De Castelnau O',
    '1000 Av Emile-Journault','1145 Av du Dr-Penfield','4601 Rue Sherbrooke E',
    '6445 Av de Monkland','3400 Boul des Trinitaires','4390 Av Pierre-De Coubertin'];
  c_lats NUMERIC[] := ARRAY[45.5225,45.5350,45.5048,45.5135,45.4810,45.5340,
    45.5360,45.5025,45.5510,45.4730,45.4460,45.5560];
  c_lngs NUMERIC[] := ARRAY[-73.5690,-73.6210,-73.5874,-73.5880,-73.5960,-73.6270,
    -73.6230,-73.5830,-73.5490,-73.6220,-73.6060,-73.5510];
  c_count INT;
  m_notes TEXT[] := ARRAY[
    'Friendly rally, all levels welcome','Looking for competitive match',
    'Bring water, outdoor courts','Court reserved, need players!',
    'Rain or shine!','Great courts with lighting',
    'Beginner-friendly session','Intense practice session'];
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';

  SELECT array_agg(DISTINCT fs.facility_id) INTO tennis_facs
  FROM facility_sport fs WHERE fs.sport_id = tennis_id;
  tf := COALESCE(array_length(tennis_facs, 1), 0);

  SELECT array_agg(DISTINCT fs.facility_id) INTO pb_facs
  FROM facility_sport fs WHERE fs.sport_id = pickleball_id;
  pf := COALESCE(array_length(pb_facs, 1), 0);

  c_count := array_length(c_names, 1);

  ALTER TABLE match DISABLE TRIGGER match_notify_group_members_on_create;

  FOR i IN 1..500 LOOP
    -- Sport: pickleball ~40%, tennis ~60%
    v_is_pb := (i % 5 IN (0, 3));
    IF v_is_pb THEN v_sport_id := pickleball_id; ELSE v_sport_id := tennis_id; END IF;

    -- Format: doubles ~25%
    IF i % 4 = 0 THEN v_format := 'doubles'; ELSE v_format := 'singles'; END IF;

    -- Visibility: private ~14%
    IF i % 7 = 0 THEN v_vis := 'private'; ELSE v_vis := 'public'; END IF;

    -- Join mode: request ~17%
    IF i % 6 = 0 THEN v_jm := 'request'; ELSE v_jm := 'direct'; END IF;

    -- Expectation: cycle casual/competitive/both
    v_exp := exps[1 + (i % 3)];

    -- Duration: cycle 60/90/120 (offset from expectation to decouple)
    v_dur := durs[1 + ((i + 1) % 3)];
    v_dur_mins := dur_m[1 + ((i + 1) % 3)];

    -- Start time: cycle through 10 slots
    v_start := starts[1 + (i % 10)];
    v_end := v_start + make_interval(mins => v_dur_mins);

    -- Host: rotate through players 1-60
    v_host := ('a1000000-0000-0000-0000-00000000' || LPAD((((i - 1) % 60) + 1)::text, 4, '0'))::uuid;

    -- Date + cancellation
    v_cancel := NULL;
    v_mutual := NULL;
    IF i <= 250 THEN
      v_date := CURRENT_DATE + 1 + ((i - 1) % 28);
    ELSIF i <= 425 THEN
      v_date := CURRENT_DATE - (i - 250);
    ELSE
      IF i % 2 = 0 THEN
        v_date := CURRENT_DATE - ((i - 425) * 2);
        v_cancel := NOW() - make_interval(days => (i - 425) * 2 + 1);
      ELSE
        v_date := CURRENT_DATE + (i - 425);
        v_cancel := NOW() - make_interval(hours => (i - 425));
      END IF;
      IF i % 3 = 0 THEN v_mutual := true; END IF;
    END IF;

    -- Location type: ~55% facility, ~22% custom, ~23% tbd
    v_fac_id := NULL; v_loc_name := NULL; v_loc_addr := NULL;
    v_lat := NULL; v_lng := NULL;
    IF i % 5 = 0 THEN
      v_loc_type := 'tbd';
    ELSIF i % 5 = 3 THEN
      v_loc_type := 'custom';
      ci := ci + 1;
      v_loc_name := c_names[1 + ((ci - 1) % c_count)];
      v_loc_addr := c_addrs[1 + ((ci - 1) % c_count)];
      v_lat := c_lats[1 + ((ci - 1) % c_count)];
      v_lng := c_lngs[1 + ((ci - 1) % c_count)];
    ELSE
      IF v_is_pb AND pf > 0 THEN
        v_loc_type := 'facility';
        v_fac_id := pb_facs[1 + (i % pf)];
      ELSIF NOT v_is_pb AND tf > 0 THEN
        v_loc_type := 'facility';
        v_fac_id := tennis_facs[1 + (i % tf)];
      ELSE
        v_loc_type := 'tbd';
      END IF;
      v_lat := c_lats[1 + (i % c_count)];
      v_lng := c_lngs[1 + (i % c_count)];
    END IF;

    -- Notes: ~20%
    IF i % 5 = 1 THEN
      v_notes := m_notes[1 + (i % array_length(m_notes, 1))];
    ELSE
      v_notes := NULL;
    END IF;

    -- Cost: ~15% of facility matches
    IF v_loc_type = 'facility' AND i % 7 = 1 THEN
      v_cost := (10 + (i % 4) * 5)::numeric;
      IF i % 2 = 0 THEN v_cost_split := 'split_equal'; ELSE v_cost_split := 'host_pays'; END IF;
    ELSE
      v_cost := NULL;
      v_cost_split := 'split_equal';
    END IF;

    -- Court status: ~30% reserved, ~15% to_reserve, rest NULL
    IF i % 3 = 0 THEN
      v_court := 'reserved';
    ELSIF i % 7 = 2 THEN
      v_court := 'to_reserve';
    ELSE
      v_court := NULL;
    END IF;

    INSERT INTO match (
      id, sport_id, match_date, start_time, end_time, duration, format,
      location_type, facility_id, location_name, location_address,
      player_expectation, visibility, join_mode, created_by, timezone,
      custom_latitude, custom_longitude, notes, estimated_cost, cost_split_type,
      cancelled_at, mutually_cancelled, court_status
    ) VALUES (
      ('b1000000-0000-0000-0000-00000000' || LPAD(i::text, 4, '0'))::uuid,
      v_sport_id, v_date, v_start, v_end, v_dur, v_format,
      v_loc_type, v_fac_id, v_loc_name, v_loc_addr,
      v_exp, v_vis, v_jm, v_host, 'America/Montreal',
      v_lat, v_lng, v_notes, v_cost, v_cost_split,
      v_cancel, v_mutual, v_court
    );
  END LOOP;

  ALTER TABLE match ENABLE TRIGGER match_notify_group_members_on_create;
  RAISE NOTICE 'Created 500 matches (250 upcoming + 175 past + 75 cancelled)';
END $$;

-- ============================================================================
-- 18. Match Participants (non-host; host auto-created by trigger)
-- ============================================================================
-- For each match the host is already a participant (trigger). We add opponents
-- and teammates here with varied statuses.
-- Upcoming: mix of joined/pending/requested/declined + some open spots
-- Past completed: all joined with match_outcome feedback
-- Cancelled: ~60% have opponents
-- ============================================================================
DO $$
DECLARE
  p CONSTANT TEXT := 'a1000000-0000-0000-0000-00000000';
  m CONSTANT TEXT := 'b1000000-0000-0000-0000-00000000';
  i INT;
  host_idx INT;
  opp1 INT;
  opp2 INT;
  opp3 INT;
  is_dbl BOOLEAN;
  v_status match_participant_status_enum;
  mid UUID;
BEGIN
  FOR i IN 1..500 LOOP
    host_idx := ((i - 1) % 60) + 1;
    is_dbl := (i % 4 = 0);
    mid := (m || LPAD(i::text, 4, '0'))::uuid;

    -- Compute unique opponent indices (avoid host and each other)
    opp1 := ((host_idx + (i % 10)) % 100) + 1;
    IF opp1 = host_idx THEN opp1 := (opp1 % 100) + 1; END IF;

    IF is_dbl THEN
      opp2 := ((host_idx + 4 + (i % 8)) % 100) + 1;
      WHILE opp2 = host_idx OR opp2 = opp1 LOOP opp2 := (opp2 % 100) + 1; END LOOP;
      opp3 := ((host_idx + 10 + (i % 6)) % 100) + 1;
      WHILE opp3 = host_idx OR opp3 = opp1 OR opp3 = opp2 LOOP opp3 := (opp3 % 100) + 1; END LOOP;
    END IF;

    IF i <= 250 THEN
      -- ===== UPCOMING =====
      -- Doubles: always add teammate (team 1)
      IF is_dbl THEN
        INSERT INTO match_participant (match_id, player_id, team_number, status)
        VALUES (mid, (p || LPAD(opp2::text, 4, '0'))::uuid, 1, 'joined');
      END IF;

      -- Opponent(s) unless open match (~10%)
      IF i % 10 != 0 THEN
        -- Vary status
        CASE i % 8
          WHEN 1 THEN v_status := 'pending';
          WHEN 2 THEN v_status := 'requested';
          WHEN 3 THEN v_status := 'declined';
          ELSE v_status := 'joined';
        END CASE;

        INSERT INTO match_participant (match_id, player_id, team_number, status)
        VALUES (mid, (p || LPAD(opp1::text, 4, '0'))::uuid, 2, v_status);

        -- Doubles: second opponent (team 2)
        IF is_dbl THEN
          INSERT INTO match_participant (match_id, player_id, team_number, status)
          VALUES (mid, (p || LPAD(opp3::text, 4, '0'))::uuid, 2,
            CASE WHEN i % 6 = 0 THEN 'pending'::match_participant_status_enum
                 ELSE 'joined'::match_participant_status_enum END);
        END IF;
      END IF;

    ELSIF i <= 425 THEN
      -- ===== PAST COMPLETED: all joined with feedback =====
      INSERT INTO match_participant (match_id, player_id, team_number, status,
        match_outcome, showed_up, was_late, star_rating)
      VALUES (mid, (p || LPAD(opp1::text, 4, '0'))::uuid, 2,
        'joined', 'played', true, (i % 7 = 0), 3 + (i % 3));

      IF is_dbl THEN
        INSERT INTO match_participant (match_id, player_id, team_number, status,
          match_outcome, showed_up, was_late, star_rating) VALUES
          (mid, (p || LPAD(opp2::text, 4, '0'))::uuid, 1,
            'joined', 'played', true, false, 3 + ((i+1) % 3)),
          (mid, (p || LPAD(opp3::text, 4, '0'))::uuid, 2,
            'joined', 'played', true, (i % 5 = 0), 3 + ((i+2) % 3));
      END IF;

      -- Update host with feedback
      UPDATE match_participant
      SET match_outcome = 'played', showed_up = true, was_late = false, star_rating = 3 + (i % 3)
      WHERE match_id = mid AND is_host = true;

    ELSE
      -- ===== CANCELLED: ~60% have opponents =====
      IF i % 5 != 0 THEN
        INSERT INTO match_participant (match_id, player_id, team_number, status)
        VALUES (mid, (p || LPAD(opp1::text, 4, '0'))::uuid, 2, 'joined');

        IF is_dbl THEN
          INSERT INTO match_participant (match_id, player_id, team_number, status)
          VALUES (mid, (p || LPAD(opp2::text, 4, '0'))::uuid, 1, 'joined');
        END IF;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created match participants for all 500 matches';
END $$;

-- ============================================================================
-- 19. Match Results + Sets (for 175 past completed matches, i=251..425)
-- ============================================================================
DO $$
DECLARE
  m CONSTANT TEXT := 'b1000000-0000-0000-0000-00000000';
  r CONSTANT TEXT := 'b2000000-0000-0000-0000-00000000';
  i INT;
  ri INT := 0;
  winning INT;
  num_sets INT;
  t1_total INT;
  t2_total INT;
  v_is_pb BOOLEAN;
  sn INT;
  t1_wins_set BOOLEAN;
  s1 INT;
  s2 INT;
  si INT;
  -- Tennis win/lose scores (team 1 perspective)
  tw1 INT[] := ARRAY[6,6,7,6,6,7]; tw2 INT[] := ARRAY[4,3,5,2,1,6];
  tl1 INT[] := ARRAY[4,3,5,2,1,6]; tl2 INT[] := ARRAY[6,6,7,6,6,7];
  -- Pickleball win/lose scores
  pw1 INT[] := ARRAY[11,11,11,11]; pw2 INT[] := ARRAY[5,8,9,7];
  pl1 INT[] := ARRAY[5,8,9,7];     pl2 INT[] := ARRAY[11,11,11,11];
  tc INT; pc INT;
BEGIN
  tc := array_length(tw1, 1);
  pc := array_length(pw1, 1);

  FOR i IN 251..425 LOOP
    ri := ri + 1;
    v_is_pb := (i % 5 IN (0, 3));
    winning := CASE WHEN i % 2 = 0 THEN 1 ELSE 2 END;
    num_sets := CASE WHEN i % 3 = 0 THEN 2 ELSE 3 END;

    IF num_sets = 2 THEN
      t1_total := CASE WHEN winning = 1 THEN 2 ELSE 0 END;
      t2_total := CASE WHEN winning = 2 THEN 2 ELSE 0 END;
    ELSE
      t1_total := CASE WHEN winning = 1 THEN 2 ELSE 1 END;
      t2_total := CASE WHEN winning = 2 THEN 2 ELSE 1 END;
    END IF;

    INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, is_verified, verified_at)
    VALUES (
      (r || LPAD(ri::text, 4, '0'))::uuid,
      (m || LPAD(i::text, 4, '0'))::uuid,
      winning, t1_total, t2_total, true,
      NOW() - make_interval(days => i - 250)
    );

    FOR sn IN 1..num_sets LOOP
      -- Determine who wins this set
      IF num_sets = 2 THEN
        t1_wins_set := (winning = 1);
      ELSE
        -- 3-set: winner wins sets 1 & 3, loser wins set 2
        IF sn = 2 THEN t1_wins_set := (winning = 2);
        ELSE t1_wins_set := (winning = 1);
        END IF;
      END IF;

      si := 1 + ((i + sn) % (CASE WHEN v_is_pb THEN pc ELSE tc END));

      IF t1_wins_set THEN
        IF v_is_pb THEN s1 := pw1[si]; s2 := pw2[si];
        ELSE s1 := tw1[si]; s2 := tw2[si]; END IF;
      ELSE
        IF v_is_pb THEN s1 := pl1[si]; s2 := pl2[si];
        ELSE s1 := tl1[si]; s2 := tl2[si]; END IF;
      END IF;

      INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
      VALUES ((r || LPAD(ri::text, 4, '0'))::uuid, sn, s1, s2);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created 175 match results with sets';
END $$;

-- ============================================================================
-- 20. Networks & Members (~25 networks, ~200 members)
-- ============================================================================
-- Triggers KEPT active:
--   trigger_create_network_conversation  (auto-creates conversation for player_group/community)
--   trigger_add_network_member_to_conversation (auto-adds active members to conversation)
--   trigger_log_member_joined            (auto-creates group_activity entries)
--   trigger_auto_add_creator_as_moderator (auto-adds creator as moderator member)
--   trigger_update_network_member_count_* (maintains member_count)

DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';  -- player UUID prefix
  n TEXT := 'd1000000-0000-0000-0000-00000000';  -- network UUID prefix
  v_pg_type UUID;
  v_co_type UUID;
  v_net_id UUID;
  req_types network_member_request_type[] := ARRAY['direct_add','join_request','invite_code','member_referral']::network_member_request_type[];
  member_idx INT;
BEGIN
  -- Look up network_type IDs
  SELECT id INTO v_pg_type FROM network_type WHERE name = 'player_group';
  SELECT id INTO v_co_type FROM network_type WHERE name = 'community';

  -- ---- Network 1: Montreal Tennis Club (community, P1) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0001')::uuid, v_co_type, 'Montreal Tennis Club',
          'The largest tennis community in Montreal. All levels welcome!',
          false, 50, (p||'0001')::uuid);
  -- Additional members: P2,P4,P6,P8,P10,P14,P18
  member_idx := 0;
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0001')::uuid, (p||'0002')::uuid, 'active', 'moderator', req_types[1 + (member_idx % 4)]),
    ((n||'0001')::uuid, (p||'0004')::uuid, 'active', 'member',    req_types[1 + (1 % 4)]),
    ((n||'0001')::uuid, (p||'0006')::uuid, 'active', 'member',    req_types[1 + (2 % 4)]),
    ((n||'0001')::uuid, (p||'0008')::uuid, 'active', 'member',    req_types[1 + (3 % 4)]),
    ((n||'0001')::uuid, (p||'0010')::uuid, 'active', 'member',    req_types[1 + (0 % 4)]),
    ((n||'0001')::uuid, (p||'0014')::uuid, 'active', 'member',    req_types[1 + (1 % 4)]),
    ((n||'0001')::uuid, (p||'0018')::uuid, 'active', 'member',    req_types[1 + (2 % 4)]);

  -- ---- Network 2: Westmount Pickleball Gang (player_group, P3) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0002')::uuid, v_pg_type, 'Westmount Pickleball Gang',
          'Weekly pickleball sessions in Westmount. Intermediate+',
          false, 10, (p||'0003')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0002')::uuid, (p||'0001')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0002')::uuid, (p||'0005')::uuid, 'active', 'member',    'join_request'),
    ((n||'0002')::uuid, (p||'0007')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0002')::uuid, (p||'0009')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0002')::uuid, (p||'0011')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 3: NDG Tennis Lovers (player_group, P5) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0003')::uuid, v_pg_type, 'NDG Tennis Lovers',
          'Casual tennis group in Notre-Dame-de-Grace',
          false, 8, (p||'0005')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0003')::uuid, (p||'0002')::uuid, 'active', 'moderator', 'join_request'),
    ((n||'0003')::uuid, (p||'0008')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0003')::uuid, (p||'0012')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0003')::uuid, (p||'0015')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 4: Advanced Players Only (community, P2, private) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0004')::uuid, v_co_type, 'Advanced Players Only',
          'For NTRP 4.0+ and DUPR 4.5+ players. Competitive matches only.',
          true, 30, (p||'0002')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0004')::uuid, (p||'0001')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0004')::uuid, (p||'0004')::uuid, 'active', 'member',    'join_request'),
    ((n||'0004')::uuid, (p||'0006')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0004')::uuid, (p||'0010')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0004')::uuid, (p||'0015')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0004')::uuid, (p||'0020')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 5: Casual Weekend Players (player_group, P8) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0005')::uuid, v_pg_type, 'Casual Weekend Players',
          'Relaxed weekend games, all levels. Fun first!',
          false, 10, (p||'0008')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0005')::uuid, (p||'0003')::uuid, 'active', 'moderator', 'invite_code'),
    ((n||'0005')::uuid, (p||'0006')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0005')::uuid, (p||'0012')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0005')::uuid, (p||'0016')::uuid, 'active', 'member',    'join_request'),
    ((n||'0005')::uuid, (p||'0022')::uuid, 'active', 'member',    'invite_code');

  -- ---- Network 6: Parc La Fontaine Regulars (player_group, P10) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0006')::uuid, v_pg_type, 'Parc La Fontaine Regulars',
          'Regular players at Parc La Fontaine courts',
          false, 8, (p||'0010')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0006')::uuid, (p||'0001')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0006')::uuid, (p||'0005')::uuid, 'active', 'member',    'join_request'),
    ((n||'0006')::uuid, (p||'0015')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0006')::uuid, (p||'0020')::uuid, 'active', 'member',    'member_referral');

  -- ---- Network 7: Mixed Doubles Group (player_group, P12) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0007')::uuid, v_pg_type, 'Mixed Doubles Group',
          'Looking for doubles partners? Join us!',
          false, 8, (p||'0012')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0007')::uuid, (p||'0003')::uuid, 'active', 'moderator', 'member_referral'),
    ((n||'0007')::uuid, (p||'0007')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0007')::uuid, (p||'0014')::uuid, 'active', 'member',    'join_request'),
    ((n||'0007')::uuid, (p||'0018')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0007')::uuid, (p||'0025')::uuid, 'active', 'member',    'member_referral');

  -- ---- Network 8: Plateau Tennis League (community, P15) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0008')::uuid, v_co_type, 'Plateau Tennis League',
          'Organized league play on the Plateau. Season registration open!',
          false, 40, (p||'0015')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0008')::uuid, (p||'0001')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0008')::uuid, (p||'0005')::uuid, 'active', 'member',    'join_request'),
    ((n||'0008')::uuid, (p||'0010')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0008')::uuid, (p||'0020')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0008')::uuid, (p||'0025')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0008')::uuid, (p||'0030')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 9: Senior Pickleball (player_group, P20) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0009')::uuid, v_pg_type, 'Senior Pickleball',
          'Pickleball for 50+ players. Weekday mornings.',
          false, 10, (p||'0020')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0009')::uuid, (p||'0025')::uuid, 'active', 'moderator', 'invite_code'),
    ((n||'0009')::uuid, (p||'0030')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0009')::uuid, (p||'0035')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0009')::uuid, (p||'0040')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 10: French Speakers Tennis (community, P25, private) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0010')::uuid, v_co_type, 'French Speakers Tennis',
          'Tennis en français! Tous niveaux bienvenus.',
          true, 8, (p||'0025')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0010')::uuid, (p||'0010')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0010')::uuid, (p||'0020')::uuid, 'active', 'member',    'join_request'),
    ((n||'0010')::uuid, (p||'0030')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0010')::uuid, (p||'0040')::uuid, 'active', 'member',    'member_referral');

  -- ---- Network 11: Villeray Tennis Group (player_group, P30) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0011')::uuid, v_pg_type, 'Villeray Tennis Group',
          'Groupe de tennis du quartier Villeray. Matchs réguliers!',
          false, 12, (p||'0030')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0011')::uuid, (p||'0032')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0011')::uuid, (p||'0035')::uuid, 'active', 'member',    'join_request'),
    ((n||'0011')::uuid, (p||'0038')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0011')::uuid, (p||'0042')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0011')::uuid, (p||'0045')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0011')::uuid, (p||'0048')::uuid, 'active', 'member',    'join_request'),
    ((n||'0011')::uuid, (p||'0051')::uuid, 'active', 'member',    'invite_code');

  -- ---- Network 12: Rosemont Pickleball (community, P35) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0012')::uuid, v_co_type, 'Rosemont Pickleball',
          'Communauté pickleball de Rosemont-La Petite-Patrie',
          false, 40, (p||'0035')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0012')::uuid, (p||'0037')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0012')::uuid, (p||'0040')::uuid, 'active', 'member',    'join_request'),
    ((n||'0012')::uuid, (p||'0043')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0012')::uuid, (p||'0046')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0012')::uuid, (p||'0050')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0012')::uuid, (p||'0053')::uuid, 'active', 'member',    'join_request'),
    ((n||'0012')::uuid, (p||'0056')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0012')::uuid, (p||'0060')::uuid, 'active', 'member',    'member_referral');

  -- ---- Network 13: Mile End Mixed Sports (player_group, P40) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0013')::uuid, v_pg_type, 'Mile End Mixed Sports',
          'Tennis and pickleball in the Mile End neighbourhood',
          false, 10, (p||'0040')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0013')::uuid, (p||'0042')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0013')::uuid, (p||'0055')::uuid, 'active', 'member',    'join_request'),
    ((n||'0013')::uuid, (p||'0058')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0013')::uuid, (p||'0062')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0013')::uuid, (p||'0065')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 14: Hochelaga Tennis League (community, P45) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0014')::uuid, v_co_type, 'Hochelaga Tennis League',
          'Ligue de tennis organisée dans Hochelaga-Maisonneuve',
          false, 30, (p||'0045')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0014')::uuid, (p||'0047')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0014')::uuid, (p||'0050')::uuid, 'active', 'member',    'join_request'),
    ((n||'0014')::uuid, (p||'0055')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0014')::uuid, (p||'0060')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0014')::uuid, (p||'0065')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0014')::uuid, (p||'0070')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 15: Verdun Racquet Club (player_group, P50) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0015')::uuid, v_pg_type, 'Verdun Racquet Club',
          'Club de raquette de Verdun, tennis et pickleball',
          false, 10, (p||'0050')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0015')::uuid, (p||'0052')::uuid, 'active', 'moderator', 'invite_code'),
    ((n||'0015')::uuid, (p||'0055')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0015')::uuid, (p||'0058')::uuid, 'active', 'member',    'join_request'),
    ((n||'0015')::uuid, (p||'0062')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0015')::uuid, (p||'0068')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 16: LaSalle Pickleball (player_group, P55) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0016')::uuid, v_pg_type, 'LaSalle Pickleball',
          'Pickleball group in LaSalle area',
          false, 10, (p||'0055')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0016')::uuid, (p||'0057')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0016')::uuid, (p||'0060')::uuid, 'active', 'member',    'join_request'),
    ((n||'0016')::uuid, (p||'0063')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0016')::uuid, (p||'0070')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0016')::uuid, (p||'0075')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 17: St-Laurent Tennis (community, P60) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0017')::uuid, v_co_type, 'St-Laurent Tennis',
          'Tennis community in Saint-Laurent borough',
          false, 35, (p||'0060')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0017')::uuid, (p||'0062')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0017')::uuid, (p||'0065')::uuid, 'active', 'member',    'join_request'),
    ((n||'0017')::uuid, (p||'0068')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0017')::uuid, (p||'0072')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0017')::uuid, (p||'0075')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0017')::uuid, (p||'0078')::uuid, 'active', 'member',    'join_request'),
    ((n||'0017')::uuid, (p||'0080')::uuid, 'active', 'member',    'invite_code');

  -- ---- Network 18: Ahuntsic Doubles (player_group, P65) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0018')::uuid, v_pg_type, 'Ahuntsic Doubles',
          'Doubles tennis group in Ahuntsic-Cartierville',
          false, 8, (p||'0065')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0018')::uuid, (p||'0067')::uuid, 'active', 'moderator', 'member_referral'),
    ((n||'0018')::uuid, (p||'0070')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0018')::uuid, (p||'0073')::uuid, 'active', 'member',    'join_request'),
    ((n||'0018')::uuid, (p||'0080')::uuid, 'active', 'member',    'invite_code');

  -- ---- Network 19: Côte-des-Neiges Racquet Sports (community, P70, private) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0019')::uuid, v_co_type, 'CDN Racquet Sports',
          'Private racquet sports community in Côte-des-Neiges',
          true, 25, (p||'0070')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0019')::uuid, (p||'0072')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0019')::uuid, (p||'0075')::uuid, 'active', 'member',    'join_request'),
    ((n||'0019')::uuid, (p||'0078')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0019')::uuid, (p||'0082')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0019')::uuid, (p||'0085')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0019')::uuid, (p||'0088')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 20: Lachine Morning Tennis (player_group, P75) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0020')::uuid, v_pg_type, 'Lachine Morning Tennis',
          'Early morning tennis sessions in Lachine',
          false, 8, (p||'0075')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0020')::uuid, (p||'0078')::uuid, 'active', 'moderator', 'invite_code'),
    ((n||'0020')::uuid, (p||'0080')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0020')::uuid, (p||'0085')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0020')::uuid, (p||'0090')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 21: Anjou Pickleball League (community, P80) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0021')::uuid, v_co_type, 'Anjou Pickleball League',
          'Organized pickleball league in Anjou',
          false, 30, (p||'0080')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0021')::uuid, (p||'0082')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0021')::uuid, (p||'0085')::uuid, 'active', 'member',    'join_request'),
    ((n||'0021')::uuid, (p||'0088')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0021')::uuid, (p||'0090')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0021')::uuid, (p||'0093')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0021')::uuid, (p||'0095')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 22: Pointe-Claire Tennis (player_group, P85) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0022')::uuid, v_pg_type, 'Pointe-Claire Tennis',
          'West Island tennis group based in Pointe-Claire',
          false, 10, (p||'0085')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0022')::uuid, (p||'0087')::uuid, 'active', 'moderator', 'member_referral'),
    ((n||'0022')::uuid, (p||'0090')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0022')::uuid, (p||'0093')::uuid, 'active', 'member',    'join_request'),
    ((n||'0022')::uuid, (p||'0096')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0022')::uuid, (p||'0099')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 23: South Shore Racquet (community, P90, private) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0023')::uuid, v_co_type, 'South Shore Racquet',
          'Racquet sports community for Rive-Sud players',
          true, 20, (p||'0090')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0023')::uuid, (p||'0092')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0023')::uuid, (p||'0095')::uuid, 'active', 'member',    'join_request'),
    ((n||'0023')::uuid, (p||'0098')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0023')::uuid, (p||'0100')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0023')::uuid, (p||'0001')::uuid, 'active', 'member',    'direct_add');

  -- ---- Network 24: Beginners Welcome Tennis (player_group, P95) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0024')::uuid, v_pg_type, 'Beginners Welcome Tennis',
          'Beginner-friendly tennis group. No experience needed!',
          false, 15, (p||'0095')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0024')::uuid, (p||'0097')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0024')::uuid, (p||'0100')::uuid, 'active', 'member',    'join_request'),
    ((n||'0024')::uuid, (p||'0004')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0024')::uuid, (p||'0009')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0024')::uuid, (p||'0016')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0024')::uuid, (p||'0023')::uuid, 'active', 'member',    'join_request');

  -- ---- Network 25: Weekend Warriors (community, P100) ----
  INSERT INTO network (id, network_type_id, name, description, is_private, max_members, created_by)
  VALUES ((n||'0025')::uuid, v_co_type, 'Weekend Warriors',
          'For those who live for weekend matches. Tennis and pickleball.',
          false, 50, (p||'0100')::uuid);
  INSERT INTO network_member (network_id, player_id, status, role, request_type)
  VALUES
    ((n||'0025')::uuid, (p||'0002')::uuid, 'active', 'moderator', 'direct_add'),
    ((n||'0025')::uuid, (p||'0010')::uuid, 'active', 'member',    'join_request'),
    ((n||'0025')::uuid, (p||'0020')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0025')::uuid, (p||'0030')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0025')::uuid, (p||'0050')::uuid, 'active', 'member',    'direct_add'),
    ((n||'0025')::uuid, (p||'0060')::uuid, 'active', 'member',    'join_request'),
    ((n||'0025')::uuid, (p||'0070')::uuid, 'active', 'member',    'invite_code'),
    ((n||'0025')::uuid, (p||'0080')::uuid, 'active', 'member',    'member_referral'),
    ((n||'0025')::uuid, (p||'0090')::uuid, 'active', 'member',    'direct_add');

  RAISE NOTICE 'Created 25 networks with ~200 members (+ auto-created conversations)';
END $$;

-- match_network: link upcoming matches to networks where the host is a member
DO $$
DECLARE
  m TEXT := 'b1000000-0000-0000-0000-00000000';  -- match UUID prefix
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  n TEXT := 'd1000000-0000-0000-0000-00000000';
  i INT;
  v_host INT;
  v_net_id UUID;
BEGIN
  -- For upcoming matches 1-50, find a network where the host is a member and link it
  FOR i IN 1..50 LOOP
    v_host := ((i - 1) % 60) + 1;

    -- Find first network where this host is a member
    SELECT nm.network_id INTO v_net_id
    FROM network_member nm
    WHERE nm.player_id = (p || LPAD(v_host::text, 4, '0'))::uuid
      AND nm.network_id::text LIKE 'd1000000-0000-0000-0000-%'
      AND nm.status = 'active'
    LIMIT 1;

    IF v_net_id IS NOT NULL THEN
      INSERT INTO match_network (match_id, network_id, posted_by)
      VALUES (
        (m || LPAD(i::text, 4, '0'))::uuid,
        v_net_id,
        (p || LPAD(v_host::text, 4, '0'))::uuid
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created match_network links for upcoming matches';
END $$;

-- ============================================================================
-- 21. Conversations & Messages
-- ============================================================================
-- 21a: Direct conversations (30)
-- 21b: Match conversations (10)
-- 21c: Messages (~1000)
-- 21d: Message reactions (~250)
--
-- Triggers KEPT active:
--   trigger_update_message_search_vector
--   trigger_update_conversation_on_message

DO $$
DECLARE
  p  TEXT := 'a1000000-0000-0000-0000-00000000';
  cv TEXT := 'e1000000-0000-0000-0000-00000000';
  m  TEXT := 'b1000000-0000-0000-0000-00000000';

  -- Direct conversation pairs (player_a, player_b)
  pairs INT[][] := ARRAY[
    ARRAY[1,2], ARRAY[1,3], ARRAY[2,5], ARRAY[3,7], ARRAY[4,8],
    ARRAY[5,10], ARRAY[6,12], ARRAY[8,15], ARRAY[10,20], ARRAY[12,25],
    ARRAY[15,30], ARRAY[20,35], ARRAY[25,40], ARRAY[30,45], ARRAY[1,50],
    ARRAY[51,55], ARRAY[52,60], ARRAY[53,65], ARRAY[54,70], ARRAY[56,75],
    ARRAY[57,80], ARRAY[58,85], ARRAY[59,90], ARRAY[61,95], ARRAY[62,100],
    ARRAY[35,55], ARRAY[40,60], ARRAY[45,65], ARRAY[50,70], ARRAY[5,75]
  ];

  -- Casual message content pool
  casual_msgs TEXT[] := ARRAY[
    'Hey! Want to play this weekend?',
    'Sure, what time works for you?',
    'How about Saturday morning around 10?',
    'Sounds good! Which court?',
    'Let''s try the ones at Parc La Fontaine',
    'Great, see you there!',
    'Good game today! We should play again soon.',
    'Absolutely! Same time next week?',
    'I''m in! My backhand is getting better.',
    'Haha nice, mine still needs work.',
    'Have you tried the new courts at Westmount?',
    'Not yet, heard they''re really nice though.',
    'Let me know when you''re free next.',
    'Will do! Enjoy the rest of your week.',
    'Thanks, you too!'
  ];

  -- Match-related message content pool
  match_msgs TEXT[] := ARRAY[
    'Looking forward to the match!',
    'Me too! Should be a good one.',
    'What level are you playing at these days?',
    'Around 4.0 NTRP, been improving lately.',
    'Nice! I''ll bring extra balls just in case.',
    'Good thinking. See you on the court!',
    'Running 5 minutes late, sorry!',
    'No worries, warming up now.',
    'Great match! That last set was intense.',
    'Agreed! Rematch soon?'
  ];

  -- Network/group message content pool
  group_msgs TEXT[] := ARRAY[
    'Anyone free for doubles tomorrow evening?',
    'I can make it! Count me in.',
    'What time are we thinking?',
    'How about 6pm at the usual spot?',
    'Perfect, I''ll be there.',
    'Can someone bring an extra racket? Mine broke.',
    'I have a spare you can borrow.',
    'Thanks! You''re a lifesaver.',
    'Great session today everyone!',
    'Next week same time?',
    'Welcome to the group! Looking forward to playing.',
    'Thanks for having me!'
  ];

  emoji_pool TEXT[] := ARRAY['👍','❤️','🔥','😂','👏'];

  i INT;
  j INT;
  pa INT;
  pb INT;
  v_conv_id UUID;
  v_sender_id UUID;
  v_other_id UUID;
  v_msg_id UUID;
  v_msg_count INT;
  v_base_time TIMESTAMPTZ;
  v_content TEXT;
  v_status TEXT;

  -- For network conversations
  v_net_conv_id UUID;
  v_members UUID[];
  v_member UUID;

  -- For match conversations
  v_host INT;
  v_opp1 INT;
BEGIN
  -- ---- 21a: Direct conversations ----
  FOR i IN 1..30 LOOP
    pa := pairs[i][1];
    pb := pairs[i][2];

    INSERT INTO conversation (id, conversation_type, created_by)
    VALUES (
      (cv || LPAD(i::text, 4, '0'))::uuid,
      'direct',
      (p || LPAD(pa::text, 4, '0'))::uuid
    );

    INSERT INTO conversation_participant (conversation_id, player_id, joined_at)
    VALUES
      ((cv || LPAD(i::text, 4, '0'))::uuid, (p || LPAD(pa::text, 4, '0'))::uuid, NOW() - interval '30 days'),
      ((cv || LPAD(i::text, 4, '0'))::uuid, (p || LPAD(pb::text, 4, '0'))::uuid, NOW() - interval '30 days');
  END LOOP;

  -- ---- 21b: Match conversations (for matches 1-10) ----
  FOR i IN 1..10 LOOP
    v_host := ((i - 1) % 60) + 1;
    v_opp1 := ((v_host + (i % 10)) % 100) + 1;

    INSERT INTO conversation (id, conversation_type, match_id, created_by)
    VALUES (
      (cv || LPAD((30 + i)::text, 4, '0'))::uuid,
      'match',
      (m || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(v_host::text, 4, '0'))::uuid
    );

    -- Add host and opponent as participants
    INSERT INTO conversation_participant (conversation_id, player_id, joined_at)
    VALUES
      ((cv || LPAD((30 + i)::text, 4, '0'))::uuid, (p || LPAD(v_host::text, 4, '0'))::uuid, NOW() - interval '5 days'),
      ((cv || LPAD((30 + i)::text, 4, '0'))::uuid, (p || LPAD(v_opp1::text, 4, '0'))::uuid, NOW() - interval '5 days');
  END LOOP;

  RAISE NOTICE 'Created 40 conversations (30 direct + 10 match)';

  -- ---- 21c: Messages ----

  -- Direct conversation messages (~15 per convo = ~450 messages)
  FOR i IN 1..30 LOOP
    pa := pairs[i][1];
    pb := pairs[i][2];
    v_conv_id := (cv || LPAD(i::text, 4, '0'))::uuid;
    v_base_time := NOW() - interval '25 days' + (i * interval '12 hours');
    v_msg_count := 12 + (i % 8); -- 12-19 messages per convo

    FOR j IN 1..v_msg_count LOOP
      -- Alternate sender
      IF j % 2 = 1 THEN
        v_sender_id := (p || LPAD(pa::text, 4, '0'))::uuid;
      ELSE
        v_sender_id := (p || LPAD(pb::text, 4, '0'))::uuid;
      END IF;

      v_content := casual_msgs[1 + ((i + j) % array_length(casual_msgs, 1))];
      v_status := CASE WHEN j <= v_msg_count - 2 THEN 'read' ELSE 'sent' END;

      INSERT INTO message (conversation_id, sender_id, content, status, created_at)
      VALUES (v_conv_id, v_sender_id, v_content, v_status::message_status,
              v_base_time + (j * interval '2 hours'));
    END LOOP;
  END LOOP;

  -- Network conversation messages (~8 per network convo = ~200 messages)
  -- Use auto-created conversation_id from the network table
  FOR i IN 1..25 LOOP
    SELECT conversation_id INTO v_net_conv_id
    FROM network
    WHERE id = ('d1000000-0000-0000-0000-00000000' || LPAD(i::text, 4, '0'))::uuid;

    IF v_net_conv_id IS NULL THEN CONTINUE; END IF;

    -- Get members of this network
    SELECT array_agg(player_id) INTO v_members
    FROM network_member
    WHERE network_id = ('d1000000-0000-0000-0000-00000000' || LPAD(i::text, 4, '0'))::uuid
      AND status = 'active';

    IF v_members IS NULL OR array_length(v_members, 1) < 2 THEN CONTINUE; END IF;

    v_base_time := NOW() - interval '20 days' + (i * interval '1 day');

    FOR j IN 1..8 LOOP
      v_sender_id := v_members[1 + (j % array_length(v_members, 1))];
      v_content := group_msgs[1 + ((i + j) % array_length(group_msgs, 1))];
      v_status := CASE WHEN j <= 6 THEN 'read' ELSE 'delivered' END;

      INSERT INTO message (conversation_id, sender_id, content, status, created_at)
      VALUES (v_net_conv_id, v_sender_id, v_content, v_status::message_status,
              v_base_time + (j * interval '3 hours'));
    END LOOP;
  END LOOP;

  -- Match conversation messages (~6 per convo = ~60 messages)
  FOR i IN 1..10 LOOP
    v_host := ((i - 1) % 60) + 1;
    v_opp1 := ((v_host + (i % 10)) % 100) + 1;
    v_conv_id := (cv || LPAD((30 + i)::text, 4, '0'))::uuid;
    v_base_time := NOW() - interval '3 days' + (i * interval '4 hours');

    FOR j IN 1..6 LOOP
      IF j % 2 = 1 THEN
        v_sender_id := (p || LPAD(v_host::text, 4, '0'))::uuid;
      ELSE
        v_sender_id := (p || LPAD(v_opp1::text, 4, '0'))::uuid;
      END IF;

      v_content := match_msgs[1 + ((i + j) % array_length(match_msgs, 1))];
      v_status := CASE WHEN j <= 4 THEN 'read' ELSE 'sent' END;

      INSERT INTO message (conversation_id, sender_id, content, status, created_at)
      VALUES (v_conv_id, v_sender_id, v_content, v_status::message_status,
              v_base_time + (j * interval '30 minutes'));
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created ~1000 messages across conversations';

  -- ---- 21d: Message reactions (~50) ----
  -- Every ~4th message gets a reaction from a non-sender participant
  DECLARE
    v_reaction_count INT := 0;
    rec RECORD;
  BEGIN
    FOR rec IN
      SELECT msg.id AS msg_id, msg.sender_id, msg.conversation_id,
             ROW_NUMBER() OVER (ORDER BY msg.created_at) AS rn
      FROM message msg
      JOIN conversation c ON c.id = msg.conversation_id
      WHERE c.id::text LIKE 'e1000000-0000-0000-0000-%'
         OR c.id IN (SELECT conversation_id FROM network WHERE id::text LIKE 'd1000000-0000-0000-0000-%' AND conversation_id IS NOT NULL)
    LOOP
      IF rec.rn % 4 = 0 THEN
        -- Find a participant who isn't the sender
        SELECT cp.player_id INTO v_other_id
        FROM conversation_participant cp
        WHERE cp.conversation_id = rec.conversation_id
          AND cp.player_id != rec.sender_id
        LIMIT 1;

        IF v_other_id IS NOT NULL THEN
          INSERT INTO message_reaction (message_id, player_id, emoji)
          VALUES (rec.msg_id, v_other_id, emoji_pool[1 + (v_reaction_count % 5)])
          ON CONFLICT DO NOTHING;
          v_reaction_count := v_reaction_count + 1;
        END IF;
      END IF;
    END LOOP;

    RAISE NOTICE 'Created % message reactions', v_reaction_count;
  END;
END $$;

-- ============================================================================
-- 22. Notifications (~500)
-- ============================================================================
DO $$
DECLARE
  nc TEXT := 'c1000000-0000-0000-0000-00000000';  -- notification UUID prefix
  p  TEXT := 'a1000000-0000-0000-0000-00000000';
  m  TEXT := 'b1000000-0000-0000-0000-00000000';

  notif_types TEXT[] := ARRAY[
    'match_starting_soon', 'match_completed', 'match_join_request',
    'new_message', 'feedback_request', 'match_player_joined',
    'community_join_request', 'match_cancelled'
  ];

  titles TEXT[];
  bodies TEXT[];

  i INT;
  player_num INT;
  type_idx INT;
  v_type TEXT;
  v_title TEXT;
  v_body TEXT;
  v_target UUID;
  v_read_at TIMESTAMPTZ;
  v_priority TEXT;
  v_created TIMESTAMPTZ;
BEGIN
  -- Title/body templates per type
  titles := ARRAY[
    'Match Starting Soon',    'Match Completed',     'New Join Request',
    'New Message',            'Feedback Requested',  'Player Joined',
    'Community Join Request', 'Match Cancelled'
  ];
  bodies := ARRAY[
    'Your match starts in 30 minutes. Get ready!',
    'Your match has been completed. Rate your opponent!',
    'A player wants to join your match.',
    'You have a new message.',
    'Please provide feedback for your recent match.',
    'A new player has joined your match.',
    'Someone wants to join your community.',
    'A match you were part of has been cancelled.'
  ];

  -- 500 notifications: 5 per player for players 1-100
  FOR i IN 1..500 LOOP
    player_num := ((i - 1) / 5) + 1;  -- players 1-100, 5 each
    type_idx := ((i - 1) % 8) + 1;
    v_type := notif_types[type_idx];
    v_title := titles[type_idx];
    v_body := bodies[type_idx];

    -- target_id: use match UUID for match types, player UUID otherwise
    IF v_type LIKE 'match_%' OR v_type = 'feedback_request' THEN
      v_target := (m || LPAD((1 + (i % 500))::text, 4, '0'))::uuid;
    ELSE
      v_target := (p || LPAD((1 + (i % 60))::text, 4, '0'))::uuid;
    END IF;

    -- ~40% read
    IF i % 5 <= 1 THEN
      v_read_at := NOW() - make_interval(days => (i % 7));
    ELSE
      v_read_at := NULL;
    END IF;

    -- Priority: high for match_starting_soon, normal for rest
    IF v_type = 'match_starting_soon' THEN
      v_priority := 'high';
    ELSE
      v_priority := 'normal';
    END IF;

    -- Spread over last 14 days
    v_created := NOW() - make_interval(days => (i % 14), hours => (i % 12));

    INSERT INTO notification (id, type, target_id, user_id, title, body, payload, read_at, priority, created_at)
    VALUES (
      (nc || LPAD(i::text, 4, '0'))::uuid,
      v_type::notification_type_enum,
      v_target,
      (p || LPAD(player_num::text, 4, '0'))::uuid,
      v_title,
      v_body,
      jsonb_build_object('source', 'seed', 'index', i),
      v_read_at,
      v_priority::notification_priority_enum,
      v_created
    );
  END LOOP;

  RAISE NOTICE 'Created 500 notifications for players 1-100';
END $$;

-- ============================================================================
-- 23. Match Feedback & Reports
-- ============================================================================
DO $$
DECLARE
  fb TEXT := 'c2000000-0000-0000-0000-00000000';   -- feedback UUID prefix
  rp TEXT := 'c3000000-0000-0000-0000-00000000';   -- report UUID prefix
  p  TEXT := 'a1000000-0000-0000-0000-00000000';
  m  TEXT := 'b1000000-0000-0000-0000-00000000';

  feedback_comments TEXT[] := ARRAY[
    'Great match, very competitive!',
    'Friendly player, would play again.',
    'Good sportsmanship throughout.',
    'Fun game, well-played!',
    'Solid opponent, kept me on my toes.',
    'Really enjoyed the rallies.',
    'Nice serve, tough to return!',
    'Fair and respectful player.',
    'Challenging but fun match.',
    'Looking forward to a rematch!'
  ];

  i INT;
  fi INT := 0;  -- feedback counter
  v_host INT;
  v_opp1 INT;
  v_star INT;
  v_was_late BOOLEAN;
BEGIN
  -- Match feedback for completed matches 251-375 (125 of 175 past matches)
  -- Each match: reviewer=host reviews opp, and opp reviews host = 2 rows
  FOR i IN 251..375 LOOP
    v_host := ((i - 1) % 60) + 1;
    v_opp1 := ((v_host + (i % 10)) % 100) + 1;

    -- Ensure they're different
    IF v_opp1 = v_host THEN v_opp1 := (v_host % 100) + 1; END IF;

    v_star := 3 + (i % 3);  -- cycles 3,4,5
    v_was_late := (i % 5 = 0);
    fi := fi + 1;

    -- Host reviews opponent
    INSERT INTO match_feedback (id, match_id, reviewer_id, opponent_id, showed_up, was_late, star_rating, comments)
    VALUES (
      (fb || LPAD(fi::text, 4, '0'))::uuid,
      (m || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(v_host::text, 4, '0'))::uuid,
      (p || LPAD(v_opp1::text, 4, '0'))::uuid,
      true, v_was_late, v_star,
      feedback_comments[1 + (fi % array_length(feedback_comments, 1))]
    );

    fi := fi + 1;
    v_star := 3 + ((i + 1) % 3);
    v_was_late := (i % 7 = 0);

    -- Opponent reviews host
    INSERT INTO match_feedback (id, match_id, reviewer_id, opponent_id, showed_up, was_late, star_rating, comments)
    VALUES (
      (fb || LPAD(fi::text, 4, '0'))::uuid,
      (m || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(v_opp1::text, 4, '0'))::uuid,
      (p || LPAD(v_host::text, 4, '0'))::uuid,
      true, v_was_late, v_star,
      feedback_comments[1 + (fi % array_length(feedback_comments, 1))]
    );
  END LOOP;

  RAISE NOTICE 'Created % match feedback rows', fi;

  -- ---- Match reports (15 reports for past completed matches) ----
  DECLARE
    report_matches INT[] := ARRAY[376, 378, 380, 382, 384, 386, 388, 390, 392, 394, 396, 398, 400, 402, 404];
    report_reasons TEXT[] := ARRAY[
      'unsportsmanlike', 'misrepresented_level', 'inappropriate',
      'unsportsmanlike', 'misrepresented_level', 'inappropriate',
      'unsportsmanlike', 'misrepresented_level', 'inappropriate',
      'unsportsmanlike', 'misrepresented_level', 'inappropriate',
      'unsportsmanlike', 'misrepresented_level', 'inappropriate'
    ];
    report_priorities TEXT[] := ARRAY[
      'medium', 'low', 'high', 'medium', 'high',
      'low', 'medium', 'high', 'low', 'medium',
      'high', 'low', 'medium', 'high', 'low'
    ];
    report_statuses TEXT[] := ARRAY[
      'pending', 'reviewed', 'dismissed', 'pending', 'reviewed',
      'dismissed', 'pending', 'reviewed', 'dismissed', 'pending',
      'reviewed', 'dismissed', 'pending', 'reviewed', 'dismissed'
    ];
    report_details TEXT[] := ARRAY[
      'Player was arguing calls and being disrespectful.',
      'Claimed to be 3.5 NTRP but played at 4.5+ level.',
      'Used inappropriate language during the match.',
      'Refused to follow court etiquette and rules.',
      'Clearly a much higher level player than claimed.',
      'Made offensive comments about my playing style.',
      'Kept disputing fair calls and delaying the match.',
      'Rating is way off — sandbagging in casual matches.',
      'Verbal abuse towards partner during doubles.',
      'Deliberately hit balls at opponent dangerously.',
      'Lied about skill level to get easy wins.',
      'Inappropriate behaviour in the locker room area.',
      'Constant gamesmanship and time-wasting tactics.',
      'Misrepresented DUPR rating by at least 1.0 points.',
      'Used profanity and intimidating body language.'
    ];
    ri INT;
    rh INT;
    ro INT;
  BEGIN
    FOR ri IN 1..15 LOOP
      rh := ((report_matches[ri] - 1) % 60) + 1;
      ro := ((rh + (report_matches[ri] % 10)) % 100) + 1;
      IF ro = rh THEN ro := (rh % 100) + 1; END IF;

      INSERT INTO match_report (id, match_id, reporter_id, reported_id, reason, details, priority, status)
      VALUES (
        (rp || LPAD(ri::text, 4, '0'))::uuid,
        (m || LPAD(report_matches[ri]::text, 4, '0'))::uuid,
        (p || LPAD(rh::text, 4, '0'))::uuid,
        (p || LPAD(ro::text, 4, '0'))::uuid,
        report_reasons[ri]::match_report_reason_enum,
        report_details[ri],
        report_priorities[ri]::match_report_priority_enum,
        report_statuses[ri]::match_report_status_enum
      );
    END LOOP;

    RAISE NOTICE 'Created 15 match reports';
  END;
END $$;

-- ============================================================================
-- 24. Feedback (~250 rows)
-- ============================================================================
DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  fb TEXT := 'c4000000-0000-0000-0000-00000000';
  categories TEXT[] := ARRAY['bug', 'feature', 'improvement', 'other'];
  modules TEXT[] := ARRAY['match_features', 'profile_settings', 'messaging', 'rating_system', 'player_directory', 'notifications', 'performance', 'other'];
  statuses TEXT[] := ARRAY['new', 'new', 'new', 'new', 'reviewed', 'reviewed', 'in_progress', 'in_progress', 'resolved', 'closed'];
  subjects TEXT[] := ARRAY[
    'App crashes on match search',
    'Add dark mode support',
    'Improve match filtering',
    'Rating system is confusing',
    'Cannot find nearby players',
    'Push notifications not working',
    'Slow loading on player directory',
    'Would love a chat feature',
    'Calendar integration request',
    'Bug with score entry'
  ];
  messages TEXT[] := ARRAY[
    'The app crashes every time I search for matches in my area. Happens on both wifi and cellular.',
    'It would be great to have a dark mode option. The bright white screen is hard on the eyes at night.',
    'The match filtering could use more options like filtering by skill level range and distance.',
    'I find the NTRP vs DUPR rating system confusing. Can you add a comparison or explanation?',
    'I live in a suburb and the player directory never shows anyone near me even with a 50km radius.',
    'I stopped receiving push notifications about match invites about a week ago.',
    'The player directory takes 10+ seconds to load. It used to be much faster.',
    'Would love to be able to chat with potential opponents before committing to a match.',
    'It would be useful to sync matches with Google Calendar or Apple Calendar.',
    'When entering set scores, the keyboard covers the input field on smaller phones.'
  ];
  app_versions TEXT[] := ARRAY['1.0.0', '1.1.0', '1.2.0'];
  i INT;
  player_idx INT;
BEGIN
  FOR i IN 1..250 LOOP
    player_idx := ((i - 1) % 50) + 1;

    INSERT INTO feedback (
      id, player_id, category, subject, message, app_version, device_info, status, module, created_at
    ) VALUES (
      (fb || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(player_idx::text, 4, '0'))::uuid,
      categories[((i - 1) % 4) + 1],
      subjects[((i - 1) % 10) + 1],
      messages[((i - 1) % 10) + 1],
      app_versions[((i - 1) % 3) + 1],
      CASE WHEN i % 2 = 0
        THEN '{"os": "iOS", "version": "17.4", "device": "iPhone 15"}'::jsonb
        ELSE '{"os": "Android", "version": "14", "device": "Pixel 8"}'::jsonb
      END,
      statuses[((i - 1) % 10) + 1],
      modules[((i - 1) % 8) + 1],
      NOW() - ((50 - i) * INTERVAL '14 hours')
    );
  END LOOP;

  RAISE NOTICE 'Created 250 feedback entries';
END $$;

-- ============================================================================
-- 25. Player Reports (~50 rows)
-- ============================================================================
DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  pr TEXT := 'c5000000-0000-0000-0000-00000000';
  m TEXT := 'b1000000-0000-0000-0000-00000000';
  report_types report_type_enum[] := ARRAY[
    'harassment', 'cheating', 'inappropriate_content', 'spam', 'impersonation',
    'no_show', 'unsportsmanlike', 'other', 'harassment', 'cheating'
  ];
  report_statuses report_status_enum[] := ARRAY[
    'pending', 'pending', 'under_review', 'dismissed', 'action_taken',
    'pending', 'under_review', 'dismissed', 'pending', 'action_taken'
  ];
  priorities TEXT[] := ARRAY[
    'normal', 'high', 'normal', 'low', 'high',
    'normal', 'high', 'low', 'normal', 'urgent'
  ];
  descriptions TEXT[] := ARRAY[
    'Player sent threatening messages after the match.',
    'Opponent was clearly sandbagging — claims 3.0 but plays 4.5+.',
    'Used profanity and inappropriate language throughout the match.',
    'Keeps sending unsolicited match invites to everyone.',
    'This account is pretending to be a well-known local coach.',
    'Did not show up to 3 scheduled matches in a row.',
    'Threw their racket and argued every call.',
    'Player''s profile has misleading information about their location.',
    'Continued to send harassing messages after being asked to stop.',
    'Using an illegal serve technique and refusing to correct it.'
  ];
  -- (reporter, reported) pairs — no self-reports
  reporters INT[] := ARRAY[
    2, 5, 8, 12, 15, 20, 25, 30, 35, 40,
    45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
    95, 100, 3, 7, 11, 16, 21, 26, 31, 36,
    41, 46, 51, 56, 61, 66, 71, 76, 81, 86,
    91, 96, 1, 6, 13, 17, 22, 27, 32, 37
  ];
  reporteds INT[] := ARRAY[
    10, 18, 3, 22, 7, 14, 33, 42, 1, 28,
    53, 61, 72, 84, 93, 4, 15, 26, 37, 48,
    59, 68, 77, 88, 99, 8, 19, 30, 41, 52,
    63, 74, 85, 96, 9, 20, 31, 42, 53, 64,
    75, 86, 97, 12, 23, 34, 45, 56, 67, 78
  ];
  -- Some reports link to a match (past completed matches)
  match_ids INT[] := ARRAY[
    376, 0, 378, 0, 0, 380, 382, 0, 384, 0,
    386, 0, 388, 0, 0, 390, 392, 0, 394, 0,
    396, 0, 398, 0, 0, 400, 402, 0, 404, 0,
    406, 0, 408, 0, 0, 410, 412, 0, 414, 0,
    416, 0, 418, 0, 0, 420, 0, 0, 422, 0
  ];
  i INT;
BEGIN
  FOR i IN 1..50 LOOP
    INSERT INTO player_report (
      id, reporter_id, reported_player_id, report_type, description,
      related_match_id, status, priority, created_at
    ) VALUES (
      (pr || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(reporters[i]::text, 4, '0'))::uuid,
      (p || LPAD(reporteds[i]::text, 4, '0'))::uuid,
      report_types[((i - 1) % 10) + 1],
      descriptions[((i - 1) % 10) + 1],
      CASE WHEN match_ids[i] > 0
        THEN (m || LPAD(match_ids[i]::text, 4, '0'))::uuid
        ELSE NULL
      END,
      report_statuses[((i - 1) % 10) + 1],
      priorities[((i - 1) % 10) + 1],
      NOW() - ((21 - (i * 2)) * INTERVAL '1 day')
    );
  END LOOP;

  RAISE NOTICE 'Created 50 player reports';
END $$;

-- ============================================================================
-- 26. Referral Link Clicks & Fingerprints (~150 rows)
-- ============================================================================
-- The referral system uses referral_link_click and referral_fingerprint tables.
-- Each profile has a unique referral_code column. We create click + fingerprint
-- records to simulate the referral funnel.
DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  ref_code TEXT;
  player_idx INT;
  i INT;
  v_fp TEXT;  -- dynamically generated fingerprint
  user_agents TEXT[] := ARRAY[
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 13; Samsung Galaxy S23)'
  ];
  ip_addrs TEXT[] := ARRAY[
    '192.168.1.100', '10.0.0.42', '172.16.0.88', '192.168.0.55',
    '10.0.1.33', '172.16.1.12', '192.168.2.77', '10.0.2.99'
  ];
  converted_player_idx INT;
BEGIN
  FOR i IN 1..150 LOOP
    player_idx := ((i - 1) % 30) + 1;
    v_fp := 'fp_seed_' || LPAD(i::text, 3, '0');

    -- Use a seed-specific referral code pattern
    ref_code := 'SEED' || LPAD(player_idx::text, 2, '0') || CHR(64 + ((i - 1) / 30) + 1);

    -- Update the player's profile with this referral code if not already set
    UPDATE profile SET referral_code = ref_code
    WHERE id = (p || LPAD(player_idx::text, 4, '0'))::uuid
      AND (referral_code IS NULL OR referral_code LIKE 'SEED%');

    -- Insert a link click
    INSERT INTO referral_link_click (
      referral_code, device_fingerprint, ip_address, user_agent, created_at
    ) VALUES (
      ref_code,
      v_fp,
      ip_addrs[((i - 1) % 8) + 1],
      user_agents[((i - 1) % 4) + 1],
      NOW() - ((30 - i) * INTERVAL '22 hours')
    ) ON CONFLICT (referral_code, device_fingerprint) DO NOTHING;

    -- ~30% convert: create a fingerprint match for some
    IF i % 3 = 0 THEN
      converted_player_idx := 50 + (i / 3);  -- players 51-100

      INSERT INTO referral_fingerprint (
        referral_code, device_fingerprint, ip_address, user_agent,
        matched_player_id, matched_at, created_at
      ) VALUES (
        ref_code,
        v_fp,
        ip_addrs[((i - 1) % 8) + 1],
        user_agents[((i - 1) % 4) + 1],
        (p || LPAD(converted_player_idx::text, 4, '0'))::uuid,
        NOW() - ((30 - i) * INTERVAL '22 hours') + INTERVAL '2 hours',
        NOW() - ((30 - i) * INTERVAL '22 hours')
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Created ~150 referral link clicks + ~50 fingerprint matches';
END $$;

-- ============================================================================
-- 27. Score Confirmations (~100 rows)
-- ============================================================================
-- For 50 completed matches (results 01-50), insert confirmations from both
-- host and opponent.
DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  r TEXT := 'b2000000-0000-0000-0000-00000000';
  i INT;
  host_idx INT;
  opp_idx INT;
  match_num INT;
  actions TEXT[] := ARRAY['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed',
                          'confirmed', 'confirmed', 'disputed', 'confirmed', 'confirmed'];
BEGIN
  FOR i IN 1..50 LOOP
    -- Match results 01-50 correspond to matches 251-300 (past matches start at 251)
    match_num := 250 + i;
    host_idx := ((match_num - 1) % 60) + 1;
    opp_idx := ((host_idx + (match_num % 10)) % 100) + 1;
    IF opp_idx = host_idx THEN opp_idx := (host_idx % 100) + 1; END IF;

    -- Host confirms
    INSERT INTO score_confirmation (
      match_result_id, player_id, action, confirmed_at
    ) VALUES (
      (r || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(host_idx::text, 4, '0'))::uuid,
      actions[((i - 1) % 10) + 1],
      NOW() - ((175 - i) * INTERVAL '1 day') + INTERVAL '2 hours'
    ) ON CONFLICT (match_result_id, player_id) DO NOTHING;

    -- Opponent confirms
    INSERT INTO score_confirmation (
      match_result_id, player_id, action, confirmed_at
    ) VALUES (
      (r || LPAD(i::text, 4, '0'))::uuid,
      (p || LPAD(opp_idx::text, 4, '0'))::uuid,
      'confirmed',
      NOW() - ((175 - i) * INTERVAL '1 day') + INTERVAL '4 hours'
    ) ON CONFLICT (match_result_id, player_id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Created ~100 score confirmations';
END $$;

-- ============================================================================
-- 28. Proof Endorsements (~50 rows)
-- ============================================================================
-- Pick the first 20 rating proofs and give each
-- 1-3 endorsements from players who are NOT the proof owner.
DO $$
DECLARE
  p TEXT := 'a1000000-0000-0000-0000-00000000';
  proof_uuid UUID;
  owner_id UUID;
  rev_id UUID;
  endorsement_count INT := 0;
  r INT;
  j INT;
  -- Flat arrays: 50 endorsements across 20 proofs
  proof_idxs INT[] := ARRAY[
    1,1,1, 2,2,2, 3,3, 4,4, 5,5, 6,6, 7,7, 8,8, 9,9,
    10,10,10, 11,11, 12,12, 13,13, 14,14, 15,15, 16,16,
    17,17, 18,18, 19,19, 20,20,
    1,2,3,4,5,6,7
  ];
  reviewer_idxs INT[] := ARRAY[
    5,10,15, 7,12,20, 1,8, 2,11, 4,14, 9,16, 13,25, 30,35, 40,45,
    50,55,60, 65,70, 75,80, 85,90, 95,100, 3,6, 17,22,
    27,32, 37,42, 47,52, 57,62,
    67,72,77,82,87,92,97
  ];
  approvals BOOLEAN[] := ARRAY[
    true,true,true, true,true,true, true,true, true,false, true,true, true,true, true,true, true,false, true,true,
    true,true,true, true,false, true,true, true,true, true,false, true,true, true,true,
    true,false, true,true, true,true, true,true,
    true,true,true,true,false,true,true
  ];
BEGIN
  -- Disable certification triggers to avoid enum bug
  ALTER TABLE player_rating_score DISABLE TRIGGER trigger_check_certification;

  FOR r IN 1..50 LOOP
    j := proof_idxs[r];
    proof_uuid := ('f1000000-0000-0000-0000-00000000' || LPAD(j::text, 4, '0'))::uuid;

    -- Find the owner of this proof via rating_proof -> player_rating_score -> player_id
    SELECT prs.player_id INTO owner_id
    FROM rating_proof rp
    JOIN player_rating_score prs ON rp.player_rating_score_id = prs.id
    WHERE rp.id = proof_uuid;

    IF owner_id IS NULL THEN CONTINUE; END IF;

    rev_id := (p || LPAD(reviewer_idxs[r]::text, 4, '0'))::uuid;

    -- Skip if reviewer is the proof owner
    IF rev_id = owner_id THEN CONTINUE; END IF;

    INSERT INTO proof_endorsement (proof_id, reviewer_id, is_approved, created_at)
    VALUES (
      proof_uuid,
      rev_id,
      approvals[r],
      NOW() - ((20 - j) * INTERVAL '1 day') - (r * INTERVAL '3 hours')
    ) ON CONFLICT (proof_id, reviewer_id) DO NOTHING;

    endorsement_count := endorsement_count + 1;
  END LOOP;

  -- Re-enable certification triggers
  ALTER TABLE player_rating_score ENABLE TRIGGER trigger_check_certification;

  RAISE NOTICE 'Created % proof endorsements', endorsement_count;
END $$;

-- ============================================================================
-- Done! Summary of seeded data
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Seed complete! 100 Players — Full Volume';
  RAISE NOTICE '==========================================';
  RAISE NOTICE '100 auth users (password: password123)';
  RAISE NOTICE '100 profiles with bios and birth dates';
  RAISE NOTICE '100 players with Montreal locations';
  RAISE NOTICE 'Player sports (tennis/pickleball/both)';
  RAISE NOTICE 'NTRP and DUPR ratings with varied badges';
  RAISE NOTICE 'Play styles and play attributes';
  RAISE NOTICE 'Player availability (7-day grid)';
  RAISE NOTICE 'Player reputation (bronze-platinum tiers)';
  RAISE NOTICE '~80 rating proofs, ~50 reference requests';
  RAISE NOTICE '~50 peer rating requests';
  RAISE NOTICE '~200 reputation events';
  RAISE NOTICE '~150 player favorites + ~25 blocks';
  RAISE NOTICE '~100 favorite facilities';
  RAISE NOTICE '500 matches (250 upcoming + 175 past + 75 cancelled)';
  RAISE NOTICE 'Match participants with varied statuses';
  RAISE NOTICE '175 match results with sets and scores';
  RAISE NOTICE '25 networks with ~200 members';
  RAISE NOTICE '40 conversations + network auto-convos';
  RAISE NOTICE '~1000 messages with ~250 reactions';
  RAISE NOTICE '500 notifications';
  RAISE NOTICE '~250 match feedback + 15 match reports';
  RAISE NOTICE '250 feedback entries';
  RAISE NOTICE '50 player reports';
  RAISE NOTICE '~150 referral link clicks + ~50 fingerprints';
  RAISE NOTICE '~100 score confirmations';
  RAISE NOTICE '~50 proof endorsements';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Login as any seed user via OTP:';
  RAISE NOTICE '  e.g. marc.tremblay@fake-rallia.com';
  RAISE NOTICE '==========================================';
END $$;

-- =============================================================================
-- Rallia Seed File
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
--      (runs THIS file -- seeds profiles, players, matches, groups,
--       conversations, notifications, bookings, etc.)
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
  fake_ids UUID[] := ARRAY[
    'a1000000-0000-0000-0000-000000000001'::uuid,
    'a1000000-0000-0000-0000-000000000002'::uuid,
    'a1000000-0000-0000-0000-000000000003'::uuid,
    'a1000000-0000-0000-0000-000000000004'::uuid,
    'a1000000-0000-0000-0000-000000000005'::uuid,
    'a1000000-0000-0000-0000-000000000006'::uuid,
    'a1000000-0000-0000-0000-000000000007'::uuid,
    'a1000000-0000-0000-0000-000000000008'::uuid,
    'a1000000-0000-0000-0000-000000000009'::uuid
  ];
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
  WHERE id != ALL(fake_ids)
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
-- Skipped when seeding staging/production — those environments already have
-- their own secrets configured via the Supabase dashboard.
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
-- Delete all previously-seeded data so the script is safe to re-run.
-- We delete in reverse-dependency order, then cascade from auth.users.
-- Deterministic UUIDs make it possible to target only seed data.
-- ============================================================================
DO $$
DECLARE
  fake_ids UUID[] := ARRAY[
    'a1000000-0000-0000-0000-000000000001'::uuid,
    'a1000000-0000-0000-0000-000000000002'::uuid,
    'a1000000-0000-0000-0000-000000000003'::uuid,
    'a1000000-0000-0000-0000-000000000004'::uuid,
    'a1000000-0000-0000-0000-000000000005'::uuid,
    'a1000000-0000-0000-0000-000000000006'::uuid,
    'a1000000-0000-0000-0000-000000000007'::uuid,
    'a1000000-0000-0000-0000-000000000008'::uuid,
    'a1000000-0000-0000-0000-000000000009'::uuid
  ];
  match_ids UUID[] := ARRAY[
    'b1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-000000000002'::uuid,
    'b1000000-0000-0000-0000-000000000003'::uuid, 'b1000000-0000-0000-0000-000000000004'::uuid,
    'b1000000-0000-0000-0000-000000000005'::uuid, 'b1000000-0000-0000-0000-000000000006'::uuid,
    'b1000000-0000-0000-0000-000000000007'::uuid, 'b1000000-0000-0000-0000-000000000008'::uuid,
    'b1000000-0000-0000-0000-000000000009'::uuid, 'b1000000-0000-0000-0000-000000000010'::uuid,
    'b1000000-0000-0000-0000-000000000011'::uuid, 'b1000000-0000-0000-0000-000000000012'::uuid,
    'b1000000-0000-0000-0000-000000000013'::uuid, 'b1000000-0000-0000-0000-000000000014'::uuid,
    'b1000000-0000-0000-0000-000000000015'::uuid, 'b1000000-0000-0000-0000-000000000016'::uuid,
    'b1000000-0000-0000-0000-000000000017'::uuid
  ];
  group_ids UUID[] := ARRAY[
    'd1000000-0000-0000-0000-000000000001'::uuid,
    'd1000000-0000-0000-0000-000000000002'::uuid,
    'd1000000-0000-0000-0000-000000000003'::uuid
  ];
  conv_ids UUID[] := ARRAY[
    'e1000000-0000-0000-0000-000000000001'::uuid,
    'e1000000-0000-0000-0000-000000000002'::uuid,
    'e1000000-0000-0000-0000-000000000003'::uuid
  ];
  logged_in_user UUID;
BEGIN
  -- Identify the target user for seeding
  logged_in_user := pg_temp.resolve_seed_user();

  -- Disable reputation triggers to avoid side-effects during cleanup
  ALTER TABLE reputation_event DISABLE TRIGGER reputation_event_recalculate;
  ALTER TABLE reference_request DISABLE TRIGGER check_reference_threshold_trigger;

  -- Delete seeded matches (cascades to match_participant, match_result, match_set)
  DELETE FROM match WHERE id = ANY(match_ids);

  -- Delete seeded networks/groups (cascades to network_member)
  DELETE FROM network WHERE id = ANY(group_ids);

  -- Delete seeded conversations (cascades to conversation_participant, message)
  DELETE FROM conversation WHERE id = ANY(conv_ids);

  -- Delete seeded contact lists (cascades to shared_contact)
  DELETE FROM shared_contact_list WHERE id IN (
    'f4000000-0000-0000-0000-000000000001'::uuid,
    'f4000000-0000-0000-0000-000000000002'::uuid,
    'f4000000-0000-0000-0000-000000000003'::uuid
  );

  -- Delete seeded rating proofs, peer rating requests, rating reference requests, reference requests
  DELETE FROM rating_proof WHERE id IN (
    'f1000000-0000-0000-0000-000000000001'::uuid, 'f1000000-0000-0000-0000-000000000002'::uuid,
    'f1000000-0000-0000-0000-000000000003'::uuid, 'f1000000-0000-0000-0000-000000000004'::uuid
  );
  DELETE FROM peer_rating_request WHERE id IN (
    'f2000000-0000-0000-0000-000000000001'::uuid, 'f2000000-0000-0000-0000-000000000002'::uuid,
    'f2000000-0000-0000-0000-000000000003'::uuid, 'f2000000-0000-0000-0000-000000000004'::uuid
  );
  DELETE FROM reference_request WHERE id IN (
    'f3000000-0000-0000-0000-000000000001'::uuid, 'f3000000-0000-0000-0000-000000000002'::uuid,
    'f3000000-0000-0000-0000-000000000003'::uuid
  );
  DELETE FROM rating_reference_request WHERE id IN (
    'f6000000-0000-0000-0000-000000000001'::uuid, 'f6000000-0000-0000-0000-000000000002'::uuid,
    'f6000000-0000-0000-0000-000000000003'::uuid
  );

  -- Delete seeded reputation events
  DELETE FROM reputation_event WHERE id IN (
    'e0000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000002'::uuid,
    'e0000000-0000-0000-0000-000000000003'::uuid, 'e0000000-0000-0000-0000-000000000004'::uuid,
    'e0000000-0000-0000-0000-000000000005'::uuid, 'e0000000-0000-0000-0000-000000000006'::uuid,
    'e0000000-0000-0000-0000-000000000007'::uuid, 'e0000000-0000-0000-0000-000000000008'::uuid,
    'e0000000-0000-0000-0000-000000000009'::uuid, 'e0000000-0000-0000-0000-000000000010'::uuid,
    'e0000000-0000-0000-0000-000000000011'::uuid, 'e0000000-0000-0000-0000-000000000012'::uuid,
    'e0000000-0000-0000-0000-000000000013'::uuid, 'e0000000-0000-0000-0000-000000000014'::uuid,
    'e0000000-0000-0000-0000-000000000015'::uuid, 'e0000000-0000-0000-0000-000000000016'::uuid,
    'e0000000-0000-0000-0000-000000000017'::uuid, 'e0000000-0000-0000-0000-000000000018'::uuid,
    'e0000000-0000-0000-0000-000000000019'::uuid, 'e0000000-0000-0000-0000-000000000020'::uuid,
    'e0000000-0000-0000-0000-000000000021'::uuid, 'e0000000-0000-0000-0000-000000000022'::uuid,
    'e0000000-0000-0000-0000-000000000023'::uuid, 'e0000000-0000-0000-0000-000000000024'::uuid,
    'e0000000-0000-0000-0000-000000000025'::uuid, 'e0000000-0000-0000-0000-000000000026'::uuid,
    'e0000000-0000-0000-0000-000000000027'::uuid
  );

  -- Delete bookings created by fake users or logged-in user at seeded facilities
  DELETE FROM booking WHERE player_id = ANY(fake_ids);
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM booking WHERE player_id = logged_in_user;
  END IF;

  -- Delete notifications for the logged-in user (seed deletes them anyway)
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM notification WHERE user_id = logged_in_user;
  END IF;

  -- Delete player favorites (both player and facility)
  DELETE FROM player_favorite WHERE player_id = ANY(fake_ids)
    OR favorite_player_id = ANY(fake_ids);
  DELETE FROM player_favorite_facility WHERE player_id = ANY(fake_ids);
  IF logged_in_user IS NOT NULL THEN
    DELETE FROM player_favorite WHERE player_id = logged_in_user;
    DELETE FROM player_favorite_facility WHERE player_id = logged_in_user;
  END IF;

  -- Delete player reputation for fake users
  DELETE FROM player_reputation WHERE player_id = ANY(fake_ids);

  -- Delete player sport play styles/attributes, player sports, player rating scores for fake users
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
-- 3. Create Test Users in auth.users (re-creates after cleanup)
-- ============================================================================
-- The logged-in user is created by Supabase auth when you sign up locally.
-- We create 9 additional fake users so the app has players to interact with.
-- These users use deterministic UUIDs so we can reference them throughout.
-- ============================================================================
DO $$
DECLARE
  fake_users TEXT[][] := ARRAY[
    ARRAY['a1000000-0000-0000-0000-000000000001', 'marc.dupont@test.com',      'Marc',      'Dupont'],
    ARRAY['a1000000-0000-0000-0000-000000000002', 'sophie.tremblay@test.com',   'Sophie',    'Tremblay'],
    ARRAY['a1000000-0000-0000-0000-000000000003', 'jean.lavoie@test.com',       'Jean',      'Lavoie'],
    ARRAY['a1000000-0000-0000-0000-000000000004', 'isabelle.gagnon@test.com',   'Isabelle',  'Gagnon'],
    ARRAY['a1000000-0000-0000-0000-000000000005', 'philippe.roy@test.com',      'Philippe',  'Roy'],
    ARRAY['a1000000-0000-0000-0000-000000000006', 'camille.bouchard@test.com',  'Camille',   'Bouchard'],
    ARRAY['a1000000-0000-0000-0000-000000000007', 'alexandre.morin@test.com',   'Alexandre', 'Morin'],
    ARRAY['a1000000-0000-0000-0000-000000000008', 'marie.cote@test.com',        'Marie',     'Cote'],
    ARRAY['a1000000-0000-0000-0000-000000000009', 'david.belanger@test.com',    'David',     'Belanger']
  ];
  u TEXT[];
BEGIN
  FOREACH u SLICE 1 IN ARRAY fake_users LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u[1]::uuid) THEN
      INSERT INTO auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at, confirmation_sent_at,
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
  RAISE NOTICE 'Ensured 9 test users exist in auth.users';
END $$;

-- ============================================================================
-- 4. Create Profiles for All Auth Users
-- ============================================================================
INSERT INTO profile (id, first_name, last_name, display_name, email, onboarding_completed, bio, birth_date, preferred_locale)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'first_name', SPLIT_PART(COALESCE(raw_user_meta_data->>'full_name', 'Test User'), ' ', 1)),
  COALESCE(raw_user_meta_data->>'last_name', NULLIF(SPLIT_PART(COALESCE(raw_user_meta_data->>'full_name', ''), ' ', 2), '')),
  -- Display name (nickname / handle)
  CASE
    WHEN email = 'marc.dupont@test.com' THEN 'MarcD_Tennis'
    WHEN email = 'sophie.tremblay@test.com' THEN 'Sophie_PB'
    WHEN email = 'jean.lavoie@test.com' THEN 'JeanL_MTL'
    WHEN email = 'isabelle.gagnon@test.com' THEN 'Isa_G'
    WHEN email = 'philippe.roy@test.com' THEN 'Phil_LaFontaine'
    WHEN email = 'camille.bouchard@test.com' THEN 'Camille_B'
    WHEN email = 'alexandre.morin@test.com' THEN 'Alex_Morin45'
    WHEN email = 'marie.cote@test.com' THEN 'Marie_Doubles'
    WHEN email = 'david.belanger@test.com' THEN 'DavidB_NewMTL'
    ELSE NULL
  END,
  email,
  true,
  -- Give fake users bios
  CASE
    WHEN email = 'marc.dupont@test.com' THEN 'Passionné de tennis depuis 15 ans. Joueur régulier au parc Jeanne-Mance.'
    WHEN email = 'sophie.tremblay@test.com' THEN 'Joueuse de pickleball et tennis. Toujours partante pour un match!'
    WHEN email = 'jean.lavoie@test.com' THEN 'Ancien joueur de compétition, maintenant je joue pour le plaisir.'
    WHEN email = 'isabelle.gagnon@test.com' THEN 'Débutante enthousiaste! Cherche des partenaires patients.'
    WHEN email = 'philippe.roy@test.com' THEN 'Tennis 3x par semaine au parc La Fontaine. Niveau intermédiaire.'
    WHEN email = 'camille.bouchard@test.com' THEN 'Joueuse polyvalente tennis et pickleball. Disponible les weekends.'
    WHEN email = 'alexandre.morin@test.com' THEN 'Compétiteur dans l''âme. NTRP 4.5, toujours prêt pour un défi.'
    WHEN email = 'marie.cote@test.com' THEN 'Tennis récréatif. J''adore le doubles!'
    WHEN email = 'david.belanger@test.com' THEN 'Nouveau à Montréal, cherche des partenaires de tennis.'
    ELSE NULL
  END,
  -- Birth dates (varied ages 25-55)
  CASE
    WHEN email = 'marc.dupont@test.com' THEN '1980-03-15'::date
    WHEN email = 'sophie.tremblay@test.com' THEN '1992-07-22'::date
    WHEN email = 'jean.lavoie@test.com' THEN '1975-11-08'::date
    WHEN email = 'isabelle.gagnon@test.com' THEN '1998-01-30'::date
    WHEN email = 'philippe.roy@test.com' THEN '1985-09-12'::date
    WHEN email = 'camille.bouchard@test.com' THEN '1990-05-25'::date
    WHEN email = 'alexandre.morin@test.com' THEN '1988-12-03'::date
    WHEN email = 'marie.cote@test.com' THEN '1995-04-18'::date
    WHEN email = 'david.belanger@test.com' THEN '1993-08-07'::date
    ELSE NULL
  END,
  'fr-CA'
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  first_name = COALESCE(EXCLUDED.first_name, profile.first_name),
  last_name = COALESCE(EXCLUDED.last_name, profile.last_name),
  display_name = COALESCE(EXCLUDED.display_name, profile.display_name),
  onboarding_completed = EXCLUDED.onboarding_completed,
  bio = COALESCE(EXCLUDED.bio, profile.bio),
  birth_date = COALESCE(EXCLUDED.birth_date, profile.birth_date),
  preferred_locale = COALESCE(EXCLUDED.preferred_locale, profile.preferred_locale),
  updated_at = NOW();

-- ============================================================================
-- 5. Create Player Records
-- ============================================================================
DO $$
DECLARE
  u RECORD;
  genders gender_enum[] := ARRAY['male', 'female', 'male', 'female', 'male', 'female', 'male', 'female', 'male'];
  hands playing_hand[] := ARRAY['right', 'right', 'left', 'right', 'right', 'both', 'right', 'left', 'right'];
  -- Montreal postal codes
  postal_codes TEXT[] := ARRAY['H2T 1S4', 'H2X 1Y6', 'H3A 1B9', 'H2W 2E1', 'H2J 3K5', 'H2R 2N2', 'H3H 1P3', 'H4A 1T2', 'H1V 3R2'];
  -- Montreal lat/longs for different neighborhoods
  lats NUMERIC[] := ARRAY[45.5236, 45.5148, 45.5017, 45.5225, 45.5306, 45.5445, 45.4968, 45.4727, 45.5554];
  lngs NUMERIC[] := ARRAY[-73.5865, -73.5691, -73.5673, -73.5775, -73.5537, -73.5975, -73.5768, -73.6416, -73.5482];
  idx INT := 0;
BEGIN
  FOR u IN SELECT id, email FROM auth.users ORDER BY email LOOP
    idx := idx + 1;
    IF idx > 9 THEN idx := 9; END IF;

    INSERT INTO player (
      id, gender, playing_hand, max_travel_distance,
      postal_code, country, latitude, longitude,
      address, city, province,
      push_notifications_enabled, notification_match_requests, notification_messages, notification_reminders
    ) VALUES (
      u.id,
      genders[idx],
      hands[idx],
      (10 + (idx * 3)),  -- 13-40 km range
      postal_codes[idx],
      'CA',
      lats[idx],
      lngs[idx],
      NULL,  -- address
      'Montreal',
      'QC',
      true, true, true, true
    )
    ON CONFLICT (id) DO UPDATE SET
      gender = EXCLUDED.gender,
      playing_hand = EXCLUDED.playing_hand,
      max_travel_distance = EXCLUDED.max_travel_distance,
      postal_code = EXCLUDED.postal_code,
      country = EXCLUDED.country,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      province = EXCLUDED.province,
      push_notifications_enabled = EXCLUDED.push_notifications_enabled,
      notification_match_requests = EXCLUDED.notification_match_requests,
      notification_messages = EXCLUDED.notification_messages,
      notification_reminders = EXCLUDED.notification_reminders;
  END LOOP;
  RAISE NOTICE 'Created player records for all users';
END $$;

-- ============================================================================
-- 6. Player Sports + Rating Scores
-- ============================================================================
DO $$
DECLARE
  tennis_sport_id UUID;
  pickleball_sport_id UUID;
  ntrp_system_id UUID;
  dupr_system_id UUID;
  u RECORD;
  ntrp_levels NUMERIC[] := ARRAY[4.0, 3.5, 4.5, 2.5, 3.5, 3.0, 4.5, 3.0, 3.5];
  dupr_levels NUMERIC[] := ARRAY[3.5, 4.0, 3.0, 2.5, 3.5, 4.5, 3.0, 3.5, 2.5];
  -- Which players play which sports: 1=tennis only, 2=pickleball only, 3=both
  sport_mix INT[] := ARRAY[3, 3, 1, 3, 1, 2, 1, 3, 3];
  -- Tennis play styles per player (by ORDER BY email index):
  --   1=aggressive_baseliner, 2=counterpuncher, 3=serve_and_volley, 4=all_court
  tennis_styles play_style_enum[] := ARRAY[
    'aggressive_baseliner', 'counterpuncher', 'serve_and_volley', 'all_court',
    'aggressive_baseliner', 'counterpuncher', 'serve_and_volley', 'all_court', 'counterpuncher'
  ];
  idx INT := 0;
  player_sport_uuid UUID;
  rating_score_uuid UUID;
BEGIN
  SELECT id INTO tennis_sport_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_sport_id FROM sport WHERE slug = 'pickleball';
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  IF tennis_sport_id IS NULL OR pickleball_sport_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping player sport seeding. Run rallia-facilities first!';
    RETURN;
  END IF;

  FOR u IN SELECT id, email FROM auth.users ORDER BY email LOOP
    idx := idx + 1;
    IF idx > 9 THEN idx := 9; END IF;

    -- Tennis
    IF sport_mix[idx] IN (1, 3) THEN
      INSERT INTO player_sport (player_id, sport_id, is_primary, is_active, preferred_match_duration, preferred_match_type, preferred_play_style)
      VALUES (u.id, tennis_sport_id, true, true,
        CASE WHEN idx % 3 = 0 THEN '60'::match_duration_enum ELSE '90'::match_duration_enum END,
        CASE WHEN idx % 2 = 0 THEN 'casual'::match_type_enum ELSE 'competitive'::match_type_enum END,
        tennis_styles[idx]
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO player_sport_uuid;

      -- Assign NTRP rating
      IF ntrp_system_id IS NOT NULL AND player_sport_uuid IS NOT NULL THEN
        SELECT id INTO rating_score_uuid FROM rating_score
        WHERE rating_system_id = ntrp_system_id AND value = ntrp_levels[idx];

        IF rating_score_uuid IS NOT NULL THEN
          INSERT INTO player_rating_score (player_id, rating_score_id, badge_status, source)
          VALUES (u.id, rating_score_uuid, 'self_declared', 'onboarding')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;

    -- Pickleball
    IF sport_mix[idx] IN (2, 3) THEN
      INSERT INTO player_sport (player_id, sport_id, is_primary, is_active, preferred_match_duration, preferred_match_type)
      VALUES (u.id, pickleball_sport_id,
        CASE WHEN sport_mix[idx] = 2 THEN true ELSE false END,
        true,
        '60'::match_duration_enum,
        'casual'::match_type_enum
      )
      ON CONFLICT DO NOTHING;

      -- Assign DUPR rating
      IF dupr_system_id IS NOT NULL THEN
        SELECT id INTO rating_score_uuid FROM rating_score
        WHERE rating_system_id = dupr_system_id AND value = dupr_levels[idx];

        IF rating_score_uuid IS NOT NULL THEN
          INSERT INTO player_rating_score (player_id, rating_score_id, badge_status, source)
          VALUES (u.id, rating_score_uuid, 'self_declared', 'onboarding')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Created player_sport and player_rating_score records';
END $$;

-- ============================================================================
-- 6b. Player Sport Play Styles + Play Attributes (junction tables)
-- ============================================================================
-- Seeds player_sport_play_style and player_sport_play_attribute for each
-- player's sport. These reference the play_style and play_attribute tables
-- populated by migration 20260126100000.
-- ============================================================================
DO $$
DECLARE
  tennis_sport_id UUID;
  pickleball_sport_id UUID;
  u RECORD;
  ps_id UUID;
  style_id UUID;
  attr_id UUID;
  -- Which players play which sports (same as section 5): 1=tennis, 2=pickleball, 3=both
  sport_mix INT[] := ARRAY[3, 3, 1, 3, 1, 2, 1, 3, 3];
  -- Tennis play style names per player (by ORDER BY email index)
  tennis_style_names TEXT[] := ARRAY[
    'aggressive_baseliner', 'counterpuncher', 'serve_and_volley', 'all_court',
    'aggressive_baseliner', 'counterpuncher', 'serve_and_volley', 'all_court', 'counterpuncher'
  ];
  -- Pickleball play style names per player (only for those who play pickleball)
  pickleball_style_names TEXT[] := ARRAY[
    'banger', 'soft_game', NULL, 'hybrid', NULL, 'speedup_specialist', NULL, 'hybrid', 'soft_game'
  ];
  -- Tennis play attribute sets per player (2-4 attributes each)
  -- Indexes reference: 1=alex.m, 2=camille, 3=david, 4=isabelle, 5=jean, 6=marc, 7=marie, 8=philippe, 9=sophie
  tennis_attrs_1 TEXT[] := ARRAY['big_serve', 'heavy_topspin_forehand', 'court_coverage'];           -- alex (aggressive_baseliner)
  tennis_attrs_2 TEXT[] := ARRAY['backhand_slice', 'consistent', 'court_coverage'];                   -- camille (counterpuncher) - pickleball only, skipped
  tennis_attrs_3 TEXT[] := ARRAY['endurance', 'consistent', 'clutch_performer'];                      -- david (counterpuncher)
  tennis_attrs_4 TEXT[] := ARRAY['court_coverage', 'quick_reflexes'];                                 -- isabelle (all_court)
  tennis_attrs_5 TEXT[] := ARRAY['one_handed_backhand', 'backhand_slice', 'strong_volleyer', 'clutch_performer']; -- jean (serve_and_volley)
  tennis_attrs_6 TEXT[] := ARRAY['heavy_topspin_forehand', 'flat_forehand', 'big_serve'];             -- marc (aggressive_baseliner)
  tennis_attrs_7 TEXT[] := ARRAY['strong_volleyer', 'overhead_smash', 'quick_reflexes'];              -- marie (all_court)
  tennis_attrs_8 TEXT[] := ARRAY['inside_out_forehand', 'court_coverage', 'endurance'];               -- philippe (aggressive_baseliner)
  tennis_attrs_9 TEXT[] := ARRAY['consistent', 'backhand_slice', 'court_coverage'];                   -- sophie (counterpuncher)
  -- Pickleball play attribute sets per player
  pickleball_attrs_1 TEXT[] := ARRAY['drive_specialist', 'speedup_attack', 'quick_hands'];            -- alex (banger)
  pickleball_attrs_2 TEXT[] := ARRAY['dink_master', 'drop_shot', 'patient'];                          -- camille - pickleball only, skipped for tennis
  pickleball_attrs_4 TEXT[] := ARRAY['reset_specialist', 'court_mobility', 'patient'];                -- isabelle (hybrid)
  pickleball_attrs_6 TEXT[] := ARRAY['speedup_attack', 'erne_specialist', 'quick_hands'];             -- camille/actual p6 (speedup_specialist)
  pickleball_attrs_7 TEXT[] := ARRAY['dink_master', 'drop_shot', 'strategic'];                        -- marie (hybrid)
  pickleball_attrs_9 TEXT[] := ARRAY['drop_shot', 'reset_specialist', 'patient', 'strategic'];        -- sophie (soft_game)
  -- Temporary arrays for iteration
  current_attrs TEXT[];
  attr_name TEXT;
  idx INT := 0;
BEGIN
  SELECT id INTO tennis_sport_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_sport_id FROM sport WHERE slug = 'pickleball';

  IF tennis_sport_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping play style/attribute seeding';
    RETURN;
  END IF;

  FOR u IN SELECT id, email FROM auth.users ORDER BY email LOOP
    idx := idx + 1;
    IF idx > 9 THEN idx := 9; END IF;

    -- ---- Tennis play style + attributes ----
    IF sport_mix[idx] IN (1, 3) THEN
      -- Get the player_sport ID for this player's tennis
      SELECT ps.id INTO ps_id FROM player_sport ps
      WHERE ps.player_id = u.id AND ps.sport_id = tennis_sport_id LIMIT 1;

      IF ps_id IS NOT NULL THEN
        -- Insert into player_sport_play_style junction table
        SELECT pst.id INTO style_id FROM play_style pst
        WHERE pst.sport_id = tennis_sport_id AND pst.name = tennis_style_names[idx];

        IF style_id IS NOT NULL THEN
          INSERT INTO player_sport_play_style (player_sport_id, play_style_id)
          VALUES (ps_id, style_id)
          ON CONFLICT DO NOTHING;
        END IF;

        -- Insert play attributes
        current_attrs := CASE idx
          WHEN 1 THEN tennis_attrs_1
          WHEN 2 THEN tennis_attrs_2
          WHEN 3 THEN tennis_attrs_3
          WHEN 4 THEN tennis_attrs_4
          WHEN 5 THEN tennis_attrs_5
          WHEN 6 THEN tennis_attrs_6
          WHEN 7 THEN tennis_attrs_7
          WHEN 8 THEN tennis_attrs_8
          WHEN 9 THEN tennis_attrs_9
          ELSE ARRAY[]::TEXT[]
        END;

        FOREACH attr_name IN ARRAY current_attrs LOOP
          SELECT pa.id INTO attr_id FROM play_attribute pa
          WHERE pa.sport_id = tennis_sport_id AND pa.name = attr_name;

          IF attr_id IS NOT NULL THEN
            INSERT INTO player_sport_play_attribute (player_sport_id, play_attribute_id)
            VALUES (ps_id, attr_id)
            ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- ---- Pickleball play style + attributes ----
    IF sport_mix[idx] IN (2, 3) AND pickleball_style_names[idx] IS NOT NULL THEN
      -- Get the player_sport ID for this player's pickleball
      SELECT ps.id INTO ps_id FROM player_sport ps
      WHERE ps.player_id = u.id AND ps.sport_id = pickleball_sport_id LIMIT 1;

      IF ps_id IS NOT NULL THEN
        -- Insert into player_sport_play_style junction table
        SELECT pst.id INTO style_id FROM play_style pst
        WHERE pst.sport_id = pickleball_sport_id AND pst.name = pickleball_style_names[idx];

        IF style_id IS NOT NULL THEN
          INSERT INTO player_sport_play_style (player_sport_id, play_style_id)
          VALUES (ps_id, style_id)
          ON CONFLICT DO NOTHING;
        END IF;

        -- Insert pickleball play attributes
        current_attrs := CASE idx
          WHEN 1 THEN pickleball_attrs_1
          WHEN 2 THEN pickleball_attrs_2
          WHEN 4 THEN pickleball_attrs_4
          WHEN 6 THEN pickleball_attrs_6
          WHEN 7 THEN pickleball_attrs_7  -- mapped to p8 (marie)
          WHEN 8 THEN pickleball_attrs_7
          WHEN 9 THEN pickleball_attrs_9
          ELSE ARRAY[]::TEXT[]
        END;

        FOREACH attr_name IN ARRAY current_attrs LOOP
          SELECT pa.id INTO attr_id FROM play_attribute pa
          WHERE pa.sport_id = pickleball_sport_id AND pa.name = attr_name;

          IF attr_id IS NOT NULL THEN
            INSERT INTO player_sport_play_attribute (player_sport_id, play_attribute_id)
            VALUES (ps_id, attr_id)
            ON CONFLICT DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Created player_sport_play_style and player_sport_play_attribute records';
END $$;

-- ============================================================================
-- 7. Player Availability
-- ============================================================================
DO $$
DECLARE
  u RECORD;
  days day_enum[] := ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  periods period_enum[] := ARRAY['morning', 'afternoon', 'evening'];
  d day_enum;
  p period_enum;
  idx INT := 0;
BEGIN
  FOR u IN SELECT id FROM auth.users ORDER BY email LOOP
    idx := idx + 1;
    FOREACH d IN ARRAY days LOOP
      FOREACH p IN ARRAY periods LOOP
        -- Each player gets a different but overlapping availability pattern
        IF (
          -- Weekday evenings for most players
          (d IN ('monday','tuesday','wednesday','thursday','friday') AND p = 'evening' AND idx % 3 != 0)
          OR
          -- Weekend mornings/afternoons for most
          (d IN ('saturday','sunday') AND p IN ('morning','afternoon'))
          OR
          -- Some players also free weekday mornings
          (d IN ('monday','wednesday','friday') AND p = 'morning' AND idx % 4 = 0)
          OR
          -- Some players free weekday afternoons
          (d IN ('tuesday','thursday') AND p = 'afternoon' AND idx % 3 = 0)
        ) THEN
          INSERT INTO player_availability (player_id, day, period, is_active)
          VALUES (u.id, d, p, true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Created player availability records';
END $$;

-- ============================================================================
-- 8. Matches (17 total: 15 at Montreal park facilities + 2 at custom locations)
-- ============================================================================
DO $$
DECLARE
  tennis_id UUID;
  pickleball_id UUID;
  -- Player IDs (our 9 fake users)
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p4 UUID := 'a1000000-0000-0000-0000-000000000004';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p6 UUID := 'a1000000-0000-0000-0000-000000000006';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  p9 UUID := 'a1000000-0000-0000-0000-000000000009';
  -- Facility IDs (specific Montreal parks populated by rallia-facilities)
  -- Jeanne-Mance, Martin-Luther-King, La Fontaine
  fac_jm UUID; fac_mlk UUID; fac_lf UUID;
  court_jm UUID; court_mlk UUID; court_lf UUID;
  -- Match IDs (deterministic for participant references)
  m1 UUID := 'b1000000-0000-0000-0000-000000000001';
  m2 UUID := 'b1000000-0000-0000-0000-000000000002';
  m3 UUID := 'b1000000-0000-0000-0000-000000000003';
  m4 UUID := 'b1000000-0000-0000-0000-000000000004';
  m5 UUID := 'b1000000-0000-0000-0000-000000000005';
  m6 UUID := 'b1000000-0000-0000-0000-000000000006';
  m7 UUID := 'b1000000-0000-0000-0000-000000000007';
  m8 UUID := 'b1000000-0000-0000-0000-000000000008';
  m9 UUID := 'b1000000-0000-0000-0000-000000000009';
  m10 UUID := 'b1000000-0000-0000-0000-000000000010';
  m11 UUID := 'b1000000-0000-0000-0000-000000000011';
  m12 UUID := 'b1000000-0000-0000-0000-000000000012';
  m13 UUID := 'b1000000-0000-0000-0000-000000000013';
  m14 UUID := 'b1000000-0000-0000-0000-000000000014';
  m15 UUID := 'b1000000-0000-0000-0000-000000000015';
  m16 UUID := 'b1000000-0000-0000-0000-000000000016';  -- custom: Stade IGA
  m17 UUID := 'b1000000-0000-0000-0000-000000000017';  -- custom: CEPSUM
  -- Match result IDs
  mr1 UUID := 'c1000000-0000-0000-0000-000000000001';
  mr2 UUID := 'c1000000-0000-0000-0000-000000000002';
  mr3 UUID := 'c1000000-0000-0000-0000-000000000003';
  mr4 UUID := 'c1000000-0000-0000-0000-000000000004';
  mr5 UUID := 'c1000000-0000-0000-0000-000000000005';
  mr6 UUID := 'c1000000-0000-0000-0000-000000000006';
  -- Dates
  today DATE := CURRENT_DATE;
  logged_in_user UUID;
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';

  IF tennis_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping match seeding. Run rallia-facilities first!';
    RETURN;
  END IF;

  -- Get the target user (by SEED_EMAIL or first non-fake user)
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Ensure the logged-in user has a player record too
  INSERT INTO player (id, gender, max_travel_distance, postal_code, country, latitude, longitude, push_notifications_enabled)
  VALUES (logged_in_user, 'male', 25, 'H2T 1S4', 'CA', 45.5236, -73.5865, true)
  ON CONFLICT (id) DO NOTHING;

  -- Look up the 3 specific Montreal facilities seeded by rallia-facilities.
  -- These are well-known parks: Jeanne-Mance, Martin-Luther-King, La Fontaine.
  -- Looked up by name since rallia-facilities generates new UUIDs on each import.
  SELECT id INTO fac_jm  FROM facility WHERE name = 'Terrains de tennis du parc Jeanne-Mance' LIMIT 1;
  SELECT id INTO fac_mlk FROM facility WHERE name = 'Terrains de tennis et de pickleball du parc Martin-Luther-King' LIMIT 1;
  SELECT id INTO fac_lf  FROM facility WHERE name = 'Terrains de tennis du parc La Fontaine' LIMIT 1;

  -- Get a court at each facility
  SELECT c.id INTO court_jm  FROM court c WHERE c.facility_id = fac_jm  LIMIT 1;
  SELECT c.id INTO court_mlk FROM court c WHERE c.facility_id = fac_mlk LIMIT 1;
  SELECT c.id INTO court_lf  FROM court c WHERE c.facility_id = fac_lf  LIMIT 1;

  -- Facilities are required -- rallia-facilities must be run before seeding
  IF fac_jm IS NULL OR fac_mlk IS NULL OR fac_lf IS NULL THEN
    RAISE NOTICE 'Montreal park facilities not found, skipping match seeding. Run rallia-facilities first! (See seeding workflow at top of file)';
    RETURN;
  END IF;

  -- -----------------------------------------------------------------------
  -- UPCOMING OPEN MATCHES (5) -- public, joinable
  -- -----------------------------------------------------------------------

  -- Match 1: Tennis singles, tomorrow evening, at Jeanne-Mance
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id, court_id, court_status,
    location_name, location_address,
    notes)
  SELECT m1, tennis_id, p1,
    (today + 1),
    ((today + 1)::date + TIME '18:00')::timestamptz,
    ((today + 1)::date + TIME '19:30')::timestamptz,
    'America/Montreal',
    'casual', 'singles', 'public', 'direct', '90',
    'facility', fac_jm, court_jm, 'to_reserve',
    (SELECT name FROM facility WHERE id = fac_jm),
    (SELECT address FROM facility WHERE id = fac_jm),
    'Looking for a casual rally partner! All levels welcome.'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m1);

  -- Match 2: Pickleball doubles, day after tomorrow morning, at Martin-Luther-King
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address,
    notes)
  SELECT m2, COALESCE(pickleball_id, tennis_id), p2,
    (today + 2),
    ((today + 2)::date + TIME '09:00')::timestamptz,
    ((today + 2)::date + TIME '10:00')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'public', 'direct', '60',
    'facility', fac_mlk,
    (SELECT name FROM facility WHERE id = fac_mlk),
    (SELECT address FROM facility WHERE id = fac_mlk),
    'Need 2 more for doubles! Intermediate level preferred.'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m2);

  -- Match 3: Tennis singles competitive, 3 days out, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address,
    notes)
  SELECT m3, tennis_id, p7,
    (today + 3),
    ((today + 3)::date + TIME '17:00')::timestamptz,
    ((today + 3)::date + TIME '19:00')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'public', 'request', '120',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf),
    'Competitive match, NTRP 4.0+ please. Let''s have a good game!'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m3);

  -- Match 4: Pickleball doubles, 4 days out, at Martin-Luther-King
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address)
  SELECT m4, COALESCE(pickleball_id, tennis_id), p6,
    (today + 4),
    ((today + 4)::date + TIME '10:00')::timestamptz,
    ((today + 4)::date + TIME '11:00')::timestamptz,
    'America/Montreal',
    'both', 'doubles', 'public', 'direct', '60',
    'facility', fac_mlk,
    (SELECT name FROM facility WHERE id = fac_mlk),
    (SELECT address FROM facility WHERE id = fac_mlk)
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m4);

  -- Match 5: Tennis doubles, this weekend, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address,
    notes)
  SELECT m5, tennis_id, p5,
    (today + (6 - EXTRACT(DOW FROM today)::int + 7)::int % 7 + 1),  -- next Saturday
    ((today + (6 - EXTRACT(DOW FROM today)::int + 7)::int % 7 + 1)::date + TIME '14:00')::timestamptz,
    ((today + (6 - EXTRACT(DOW FROM today)::int + 7)::int % 7 + 1)::date + TIME '15:30')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'public', 'direct', '90',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf),
    'Weekend doubles! Bring your A game (or just bring snacks).'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m5);

  -- -----------------------------------------------------------------------
  -- UPCOMING FULL MATCHES (3) -- logged-in user is a participant
  -- -----------------------------------------------------------------------

  -- Match 6: Logged-in user's upcoming match (tennis singles, tomorrow), at Jeanne-Mance
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id, court_id, court_status,
    location_name, location_address)
  SELECT m6, tennis_id, logged_in_user,
    (today + 1),
    ((today + 1)::date + TIME '10:00')::timestamptz,
    ((today + 1)::date + TIME '11:30')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'private', 'direct', '90',
    'facility', fac_jm, court_jm, 'reserved',
    (SELECT name FROM facility WHERE id = fac_jm),
    (SELECT address FROM facility WHERE id = fac_jm)
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m6);

  -- Match 7: Logged-in user invited to doubles, in 2 days, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address)
  SELECT m7, tennis_id, p3,
    (today + 2),
    ((today + 2)::date + TIME '16:00')::timestamptz,
    ((today + 2)::date + TIME '17:30')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'private', 'direct', '90',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf)
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m7);

  -- Match 8: Pickleball match, logged-in user joined, in 5 days, at Martin-Luther-King
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type, facility_id,
    location_name, location_address)
  SELECT m8, COALESCE(pickleball_id, tennis_id), p8,
    (today + 5),
    ((today + 5)::date + TIME '11:00')::timestamptz,
    ((today + 5)::date + TIME '12:00')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'public', 'direct', '60',
    'facility', fac_mlk,
    (SELECT name FROM facility WHERE id = fac_mlk),
    (SELECT address FROM facility WHERE id = fac_mlk)
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m8);

  -- -----------------------------------------------------------------------
  -- PAST COMPLETED MATCHES (5)
  -- -----------------------------------------------------------------------

  -- Match 9: Completed 3 days ago, at Jeanne-Mance
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    closed_at)
  SELECT m9, tennis_id, p1,
    (today - 3),
    ((today - 3)::date + TIME '18:00')::timestamptz,
    ((today - 3)::date + TIME '19:30')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'public', '90',
    'facility', fac_jm,
    (SELECT name FROM facility WHERE id = fac_jm),
    (SELECT address FROM facility WHERE id = fac_jm),
    ((today - 3)::date + TIME '19:30')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m9);

  -- Match 10: Completed 5 days ago, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    closed_at)
  SELECT m10, tennis_id, logged_in_user,
    (today - 5),
    ((today - 5)::date + TIME '10:00')::timestamptz,
    ((today - 5)::date + TIME '11:30')::timestamptz,
    'America/Montreal',
    'casual', 'singles', 'private', '90',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf),
    ((today - 5)::date + TIME '11:30')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m10);

  -- Match 11: Completed 7 days ago (pickleball doubles), at Martin-Luther-King
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    closed_at)
  SELECT m11, COALESCE(pickleball_id, tennis_id), p2,
    (today - 7),
    ((today - 7)::date + TIME '09:00')::timestamptz,
    ((today - 7)::date + TIME '10:00')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'public', '60',
    'facility', fac_mlk,
    (SELECT name FROM facility WHERE id = fac_mlk),
    (SELECT address FROM facility WHERE id = fac_mlk),
    ((today - 7)::date + TIME '10:00')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m11);

  -- Match 12: Completed 10 days ago, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    closed_at)
  SELECT m12, tennis_id, p7,
    (today - 10),
    ((today - 10)::date + TIME '17:00')::timestamptz,
    ((today - 10)::date + TIME '19:00')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'public', '120',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf),
    ((today - 10)::date + TIME '19:00')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m12);

  -- Match 13: Completed 14 days ago (logged-in user participated), at Jeanne-Mance
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    closed_at)
  SELECT m13, tennis_id, p5,
    (today - 14),
    ((today - 14)::date + TIME '14:00')::timestamptz,
    ((today - 14)::date + TIME '15:30')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'private', '90',
    'facility', fac_jm,
    (SELECT name FROM facility WHERE id = fac_jm),
    (SELECT address FROM facility WHERE id = fac_jm),
    ((today - 14)::date + TIME '15:30')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m13);

  -- -----------------------------------------------------------------------
  -- CANCELLED MATCHES (2)
  -- -----------------------------------------------------------------------

  -- Match 14: Cancelled due to weather, was 2 days ago, at Martin-Luther-King
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    cancelled_at)
  SELECT m14, tennis_id, p4,
    (today - 2),
    ((today - 2)::date + TIME '15:00')::timestamptz,
    ((today - 2)::date + TIME '16:30')::timestamptz,
    'America/Montreal',
    'casual', 'singles', 'public', '90',
    'facility', fac_mlk,
    (SELECT name FROM facility WHERE id = fac_mlk),
    (SELECT address FROM facility WHERE id = fac_mlk),
    ((today - 2)::date + TIME '12:00')::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m14);

  -- Match 15: Mutually cancelled, was 4 days ago, at La Fontaine
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type, facility_id,
    location_name, location_address,
    cancelled_at, mutually_cancelled)
  SELECT m15, tennis_id, logged_in_user,
    (today - 4),
    ((today - 4)::date + TIME '18:00')::timestamptz,
    ((today - 4)::date + TIME '19:30')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'private', '90',
    'facility', fac_lf,
    (SELECT name FROM facility WHERE id = fac_lf),
    (SELECT address FROM facility WHERE id = fac_lf),
    ((today - 4)::date + TIME '10:00')::timestamptz,
    true
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m15);

  -- -----------------------------------------------------------------------
  -- CUSTOM LOCATION MATCHES (2) -- not linked to a facility
  -- -----------------------------------------------------------------------

  -- Match 16: Upcoming tennis singles at Stade IGA (custom location), in 6 days
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, join_mode, duration,
    location_type,
    location_name, location_address,
    notes)
  SELECT m16, tennis_id, p7,
    (today + 6),
    ((today + 6)::date + TIME '15:00')::timestamptz,
    ((today + 6)::date + TIME '17:00')::timestamptz,
    'America/Montreal',
    'competitive', 'singles', 'public', 'request', '120',
    'custom',
    'Stade IGA',
    '285 Rue Gary-Carter, Montreal, QC H2R 2W1',
    'Let''s play on the big stage! I have a court reserved at IGA Stadium.'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m16);

  -- Match 17: Completed tennis doubles at CEPSUM, 6 days ago (logged-in user participated)
  INSERT INTO match (id, sport_id, created_by, match_date, start_time, end_time, timezone,
    player_expectation, format, visibility, duration,
    location_type,
    location_name, location_address,
    closed_at,
    notes)
  SELECT m17, tennis_id, logged_in_user,
    (today - 6),
    ((today - 6)::date + TIME '19:00')::timestamptz,
    ((today - 6)::date + TIME '20:30')::timestamptz,
    'America/Montreal',
    'casual', 'doubles', 'private', '90',
    'custom',
    'CEPSUM - Centre d''education physique et des sports de l''Universite de Montreal',
    '2100, boul. Edouard-Montpetit, Montreal, QC H3T 1J4',
    ((today - 6)::date + TIME '20:30')::timestamptz,
    'Indoor courts at CEPSUM. Meet at the front desk.'
  WHERE NOT EXISTS (SELECT 1 FROM match WHERE id = m17);

  -- -----------------------------------------------------------------------
  -- MATCH PARTICIPANTS
  -- -----------------------------------------------------------------------

  -- Open match 1: host + 0 joined (looking for opponent)
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m1, p1, 'joined', true)
  ON CONFLICT DO NOTHING;

  -- Open match 2: host + 1 joined (need 2 more for doubles)
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m2, p2, 'joined', true), (m2, p8, 'joined', false)
  ON CONFLICT DO NOTHING;

  -- Open match 3: host only (competitive, request mode)
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m3, p7, 'joined', true)
  ON CONFLICT DO NOTHING;

  -- Open match 4: host + 2 (need 1 more for doubles)
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m4, p6, 'joined', true), (m4, p2, 'joined', false), (m4, p9, 'joined', false)
  ON CONFLICT DO NOTHING;

  -- Open match 5: host + 1
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m5, p5, 'joined', true), (m5, p3, 'joined', false)
  ON CONFLICT DO NOTHING;

  -- Full match 6: logged-in user is host, playing against p7
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m6, logged_in_user, 'joined', true), (m6, p7, 'joined', false)
  ON CONFLICT DO NOTHING;

  -- Full match 7: p3 hosts doubles, logged-in user + p1 + p8
  INSERT INTO match_participant (match_id, player_id, status, is_host, team_number) VALUES
    (m7, p3, 'joined', true, 1), (m7, logged_in_user, 'joined', false, 1),
    (m7, p1, 'joined', false, 2), (m7, p8, 'joined', false, 2)
  ON CONFLICT DO NOTHING;

  -- Full match 8: p8 hosts pickleball, logged-in user + p2 + p6
  INSERT INTO match_participant (match_id, player_id, status, is_host, team_number) VALUES
    (m8, p8, 'joined', true, 1), (m8, logged_in_user, 'joined', false, 1),
    (m8, p2, 'joined', false, 2), (m8, p6, 'joined', false, 2)
  ON CONFLICT DO NOTHING;

  -- Past match 9: p1 vs p7 (p1 won)
  INSERT INTO match_participant (match_id, player_id, status, is_host, match_outcome, feedback_completed) VALUES
    (m9, p1, 'joined', true, 'played', true), (m9, p7, 'joined', false, 'played', true)
  ON CONFLICT DO NOTHING;

  -- Past match 10: logged-in user vs p3 (logged-in user won)
  INSERT INTO match_participant (match_id, player_id, status, is_host, match_outcome, feedback_completed) VALUES
    (m10, logged_in_user, 'joined', true, 'played', true), (m10, p3, 'joined', false, 'played', true)
  ON CONFLICT DO NOTHING;

  -- Past match 11: pickleball doubles p2+p4 vs p8+p9
  INSERT INTO match_participant (match_id, player_id, status, is_host, team_number, match_outcome, feedback_completed) VALUES
    (m11, p2, 'joined', true, 1, 'played', true), (m11, p4, 'joined', false, 1, 'played', true),
    (m11, p8, 'joined', false, 2, 'played', true), (m11, p9, 'joined', false, 2, 'played', true)
  ON CONFLICT DO NOTHING;

  -- Past match 12: p7 vs p5
  INSERT INTO match_participant (match_id, player_id, status, is_host, match_outcome, feedback_completed) VALUES
    (m12, p7, 'joined', true, 'played', true), (m12, p5, 'joined', false, 'played', true)
  ON CONFLICT DO NOTHING;

  -- Past match 13: doubles p5+logged_in vs p1+p9
  INSERT INTO match_participant (match_id, player_id, status, is_host, team_number, match_outcome, feedback_completed) VALUES
    (m13, p5, 'joined', true, 1, 'played', true), (m13, logged_in_user, 'joined', false, 1, 'played', true),
    (m13, p1, 'joined', false, 2, 'played', true), (m13, p9, 'joined', false, 2, 'played', true)
  ON CONFLICT DO NOTHING;

  -- Cancelled match 14: p4 was host, p9 was joined
  INSERT INTO match_participant (match_id, player_id, status, is_host, cancellation_reason) VALUES
    (m14, p4, 'cancelled', true, 'weather'), (m14, p9, 'cancelled', false, 'weather')
  ON CONFLICT DO NOTHING;

  -- Cancelled match 15: logged-in user and p1, mutually cancelled
  INSERT INTO match_participant (match_id, player_id, status, is_host, cancellation_reason) VALUES
    (m15, logged_in_user, 'cancelled', true, 'other'), (m15, p1, 'cancelled', false, 'other')
  ON CONFLICT DO NOTHING;

  -- Custom match 16 (Stade IGA): p7 hosts, looking for opponent
  INSERT INTO match_participant (match_id, player_id, status, is_host) VALUES
    (m16, p7, 'joined', true)
  ON CONFLICT DO NOTHING;

  -- Custom match 17 (CEPSUM): completed doubles, logged-in+p5 vs p3+p9
  INSERT INTO match_participant (match_id, player_id, status, is_host, team_number, match_outcome, feedback_completed) VALUES
    (m17, logged_in_user, 'joined', true, 1, 'played', true), (m17, p5, 'joined', false, 1, 'played', true),
    (m17, p3, 'joined', false, 2, 'played', true), (m17, p9, 'joined', false, 2, 'played', true)
  ON CONFLICT DO NOTHING;

  -- -----------------------------------------------------------------------
  -- MATCH RESULTS + SETS (for completed matches)
  -- -----------------------------------------------------------------------

  -- Match 9 result: p1 won 6-3, 6-4
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr1, m9, 1, 2, 0, p1, true, ((today - 3)::date + TIME '20:00')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr1, 1, 6, 3), (mr1, 2, 6, 4)
  ON CONFLICT DO NOTHING;

  -- Match 10 result: logged-in user won 6-4, 3-6, 7-5
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr2, m10, 1, 2, 1, logged_in_user, true, ((today - 5)::date + TIME '12:00')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr2, 1, 6, 4), (mr2, 2, 3, 6), (mr2, 3, 7, 5)
  ON CONFLICT DO NOTHING;

  -- Match 11 result: team 1 (p2+p4) won 11-8
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr3, m11, 1, 1, 0, p2, true, ((today - 7)::date + TIME '10:30')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr3, 1, 11, 8)
  ON CONFLICT DO NOTHING;

  -- Match 12 result: p7 won 6-2, 6-1
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr4, m12, 1, 2, 0, p7, true, ((today - 10)::date + TIME '19:30')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr4, 1, 6, 2), (mr4, 2, 6, 1)
  ON CONFLICT DO NOTHING;

  -- Match 13 result: team 2 (p1+p9) won 4-6, 7-5, 6-3
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr5, m13, 2, 1, 2, p5, true, ((today - 14)::date + TIME '16:00')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr5, 1, 4, 6), (mr5, 2, 7, 5), (mr5, 3, 6, 3)
  ON CONFLICT DO NOTHING;

  -- Match 17 result (CEPSUM): team 1 (logged_in+p5) won 6-3, 7-6
  INSERT INTO match_result (id, match_id, winning_team, team1_score, team2_score, submitted_by, is_verified, verified_at)
  VALUES (mr6, m17, 1, 2, 0, logged_in_user, true, ((today - 6)::date + TIME '21:00')::timestamptz)
  ON CONFLICT DO NOTHING;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score) VALUES
    (mr6, 1, 6, 3), (mr6, 2, 7, 6)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 17 matches with participants and results';
END $$;

-- ============================================================================
-- 9. Networks (Groups)
-- ============================================================================
-- Ensure the player_group network type exists (not seeded in any migration)
INSERT INTO network_type (name, display_name, description, is_active)
VALUES ('player_group', 'Player Group', 'Player-created groups for organizing matches', true)
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  tennis_id UUID;
  pickleball_id UUID;
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p6 UUID := 'a1000000-0000-0000-0000-000000000006';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  p9 UUID := 'a1000000-0000-0000-0000-000000000009';
  logged_in_user UUID;
  group_type_id UUID;
  g1 UUID := 'd1000000-0000-0000-0000-000000000001';
  g2 UUID := 'd1000000-0000-0000-0000-000000000002';
  g3 UUID := 'd1000000-0000-0000-0000-000000000003';
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';
  SELECT id INTO group_type_id FROM network_type WHERE name = 'player_group';

  -- Get the target user (by SEED_EMAIL or first non-fake user)
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  IF group_type_id IS NULL THEN
    RAISE NOTICE 'player_group network type not found, skipping group seeding';
    RETURN;
  END IF;

  -- Group 1: Montreal Tennis Club
  INSERT INTO network (id, name, description, network_type_id, created_by, is_private, invite_code, member_count)
  VALUES (g1, 'Montreal Tennis Club', 'Casual and competitive tennis players in Montreal. All levels welcome!',
    group_type_id, p1, false, 'MTC2026', 6)
  ON CONFLICT (id) DO NOTHING;

  -- Group 2: Plateau Pickleball
  INSERT INTO network (id, name, description, network_type_id, created_by, is_private, invite_code, member_count)
  VALUES (g2, 'Plateau Pickleball', 'Pickleball enthusiasts from the Plateau and surrounding areas.',
    group_type_id, p2, false, 'PLATPKL', 5)
  ON CONFLICT (id) DO NOTHING;

  -- Group 3: Compétiteurs MTL
  INSERT INTO network (id, name, description, network_type_id, created_by, is_private, invite_code, member_count)
  VALUES (g3, 'Compétiteurs MTL', 'Pour les joueurs compétitifs de Montréal. NTRP 4.0+ requis.',
    group_type_id, p7, true, 'CMTL40', 4)
  ON CONFLICT (id) DO NOTHING;

  -- Group 1 members: p1(mod), logged_in, p3, p5, p7, p8
  INSERT INTO network_member (network_id, player_id, role, status, request_type, joined_at) VALUES
    (g1, p1, 'moderator', 'active', 'direct_add', NOW() - INTERVAL '30 days'),
    (g1, logged_in_user, 'member', 'active', 'invite_code', NOW() - INTERVAL '20 days'),
    (g1, p3, 'member', 'active', 'join_request', NOW() - INTERVAL '25 days'),
    (g1, p5, 'member', 'active', 'invite_code', NOW() - INTERVAL '15 days'),
    (g1, p7, 'member', 'active', 'join_request', NOW() - INTERVAL '10 days'),
    (g1, p8, 'member', 'active', 'invite_code', NOW() - INTERVAL '5 days')
  ON CONFLICT DO NOTHING;

  -- Group 2 members: p2(mod), logged_in, p6, p8, p9
  INSERT INTO network_member (network_id, player_id, role, status, request_type, joined_at) VALUES
    (g2, p2, 'moderator', 'active', 'direct_add', NOW() - INTERVAL '20 days'),
    (g2, logged_in_user, 'member', 'active', 'join_request', NOW() - INTERVAL '12 days'),
    (g2, p6, 'member', 'active', 'invite_code', NOW() - INTERVAL '18 days'),
    (g2, p8, 'member', 'active', 'invite_code', NOW() - INTERVAL '8 days'),
    (g2, p9, 'member', 'active', 'join_request', NOW() - INTERVAL '3 days')
  ON CONFLICT DO NOTHING;

  -- Group 3 members: p7(mod), p1, p5, logged_in
  INSERT INTO network_member (network_id, player_id, role, status, request_type, joined_at) VALUES
    (g3, p7, 'moderator', 'active', 'direct_add', NOW() - INTERVAL '15 days'),
    (g3, p1, 'member', 'active', 'invite_code', NOW() - INTERVAL '12 days'),
    (g3, p5, 'member', 'active', 'invite_code', NOW() - INTERVAL '10 days'),
    (g3, logged_in_user, 'member', 'active', 'join_request', NOW() - INTERVAL '7 days')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 3 groups with members';
END $$;

-- ============================================================================
-- 10. Conversations + Messages
-- ============================================================================
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  logged_in_user UUID;
  conv1 UUID := 'e1000000-0000-0000-0000-000000000001';
  conv2 UUID := 'e1000000-0000-0000-0000-000000000002';
  conv3 UUID := 'e1000000-0000-0000-0000-000000000003';
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Ensure all participants have chat_rules_agreed_at
  UPDATE player SET chat_rules_agreed_at = NOW() - INTERVAL '30 days'
  WHERE id IN (p1, p2, p3, p7, logged_in_user) AND chat_rules_agreed_at IS NULL;

  -- Conv 1: Direct message with p1 (Marc Dupont)
  INSERT INTO conversation (id, conversation_type, created_by, title)
  VALUES (conv1, 'direct', p1, NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO conversation_participant (conversation_id, player_id, last_read_at) VALUES
    (conv1, logged_in_user, NOW() - INTERVAL '1 hour'),
    (conv1, p1, NOW() - INTERVAL '30 minutes')
  ON CONFLICT DO NOTHING;

  INSERT INTO message (conversation_id, sender_id, content, created_at, status) VALUES
    (conv1, p1, 'Salut! Tu es dispo pour un match cette semaine?', NOW() - INTERVAL '3 hours', 'read'),
    (conv1, logged_in_user, 'Oui! Mercredi soir ça te va?', NOW() - INTERVAL '2 hours 45 minutes', 'read'),
    (conv1, p1, 'Parfait! 18h au parc Jeanne-Mance?', NOW() - INTERVAL '2 hours 30 minutes', 'read'),
    (conv1, logged_in_user, 'Deal! On se voit là-bas', NOW() - INTERVAL '2 hours', 'read'),
    (conv1, p1, 'N''oublie pas ta raquette de rechange, au cas où 😄', NOW() - INTERVAL '30 minutes', 'delivered')
  ON CONFLICT DO NOTHING;

  -- Conv 2: Direct message with p7 (Alexandre Morin)
  INSERT INTO conversation (id, conversation_type, created_by, title)
  VALUES (conv2, 'direct', logged_in_user, NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO conversation_participant (conversation_id, player_id, last_read_at) VALUES
    (conv2, logged_in_user, NOW()),
    (conv2, p7, NOW() - INTERVAL '2 hours')
  ON CONFLICT DO NOTHING;

  INSERT INTO message (conversation_id, sender_id, content, created_at, status) VALUES
    (conv2, logged_in_user, 'Hey Alexandre, GG pour le match de la semaine dernière!', NOW() - INTERVAL '1 day', 'read'),
    (conv2, p7, 'Merci! C''était un bon match. Revanche bientôt?', NOW() - INTERVAL '23 hours', 'read'),
    (conv2, logged_in_user, 'Quand tu veux! Je suis libre samedi matin si ça te dit.', NOW() - INTERVAL '22 hours', 'read'),
    (conv2, p7, 'Samedi 9h? Je réserve un court au parc Jarry.', NOW() - INTERVAL '20 hours', 'read'),
    (conv2, logged_in_user, 'Ça marche, à samedi!', NOW() - INTERVAL '19 hours', 'read')
  ON CONFLICT DO NOTHING;

  -- Conv 3: Group chat (3 people planning a doubles match)
  INSERT INTO conversation (id, conversation_type, created_by, title)
  VALUES (conv3, 'group', p2, 'Doubles ce weekend')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO conversation_participant (conversation_id, player_id, last_read_at) VALUES
    (conv3, p2, NOW() - INTERVAL '10 minutes'),
    (conv3, p3, NOW() - INTERVAL '1 hour'),
    (conv3, logged_in_user, NOW() - INTERVAL '5 minutes')
  ON CONFLICT DO NOTHING;

  INSERT INTO message (conversation_id, sender_id, content, created_at, status) VALUES
    (conv3, p2, 'On fait un doubles dimanche? Qui est dispo?', NOW() - INTERVAL '5 hours', 'read'),
    (conv3, p3, 'Moi je suis partant! Dimanche après-midi?', NOW() - INTERVAL '4 hours 30 minutes', 'read'),
    (conv3, logged_in_user, 'Moi aussi! Il nous faut un 4ème par contre.', NOW() - INTERVAL '4 hours', 'read'),
    (conv3, p2, 'Je vais demander à Marie, elle cherchait justement un match.', NOW() - INTERVAL '3 hours', 'read'),
    (conv3, p2, 'C''est bon, Marie est in! Dimanche 14h au parc La Fontaine.', NOW() - INTERVAL '1 hour', 'delivered'),
    (conv3, logged_in_user, 'Super, on est au complet!', NOW() - INTERVAL '10 minutes', 'sent')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 3 conversations with messages';
END $$;

-- ============================================================================
-- 11. Notifications (30 varied notifications for the logged-in user)
-- ============================================================================
DO $$
DECLARE
  target_user_id UUID;
  notification_types text[] := ARRAY[
    'match_invitation', 'reminder', 'match_join_request', 'match_player_joined',
    'match_starting_soon', 'feedback_request', 'new_message', 'system',
    'score_confirmation'
  ];
  notification_type text;
  i integer;
  is_read boolean;
  created_time timestamptz;
BEGIN
  -- Get the target user (by SEED_EMAIL or first non-fake user)
  target_user_id := pg_temp.resolve_seed_user();

  IF target_user_id IS NULL THEN
    SELECT id INTO target_user_id FROM profile LIMIT 1;
  END IF;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'No profile found, skipping notification seeding';
    RETURN;
  END IF;

  -- Clear existing notifications for clean seeding
  DELETE FROM notification WHERE user_id = target_user_id;

  FOR i IN 1..30 LOOP
    notification_type := notification_types[1 + ((i - 1) % 9)];
    is_read := (i % 5 = 0) OR (i % 7 = 0);
    created_time := NOW() - ((30 - i) * INTERVAL '5 hours');

    INSERT INTO notification (
      user_id, type, title, body, read_at, created_at, updated_at
    ) VALUES (
      target_user_id,
      notification_type::notification_type_enum,
      CASE notification_type
        WHEN 'match_invitation' THEN 'Match Invitation from Marc'
        WHEN 'reminder' THEN 'Match Tomorrow at ' || TO_CHAR(created_time + INTERVAL '1 day', 'HH:MI AM')
        WHEN 'match_join_request' THEN 'Sophie wants to join your match'
        WHEN 'match_player_joined' THEN 'Philippe joined your match'
        WHEN 'match_starting_soon' THEN 'Your match starts in 1 hour!'
        WHEN 'feedback_request' THEN 'How was your match with Alexandre?'
        WHEN 'new_message' THEN 'New message from Marc Dupont'
        WHEN 'system' THEN 'Welcome to Rallia!'
        WHEN 'score_confirmation' THEN 'Confirm your match score'
      END,
      CASE notification_type
        WHEN 'match_invitation' THEN 'Marc Dupont invited you to play tennis at Parc Jeanne-Mance on ' || TO_CHAR(created_time + INTERVAL '2 days', 'Day, Mon DD')
        WHEN 'reminder' THEN 'Don''t forget your match tomorrow at Parc La Fontaine. See you there!'
        WHEN 'match_join_request' THEN 'Sophie Tremblay wants to join your casual singles match. Tap to review.'
        WHEN 'match_player_joined' THEN 'Philippe Roy has joined your doubles match this Saturday.'
        WHEN 'match_starting_soon' THEN 'Your tennis match at Parc Jarry starts at 18:00. Time to warm up!'
        WHEN 'feedback_request' THEN 'Tell us how your match with Alexandre Morin went. Your feedback helps the community!'
        WHEN 'new_message' THEN 'Marc: N''oublie pas ta raquette de rechange!'
        WHEN 'system' THEN 'Welcome to Rallia! Find players, book courts, and enjoy your game.'
        WHEN 'score_confirmation' THEN 'Alexandre submitted a score for your match. Please confirm or dispute.'
      END,
      CASE WHEN is_read THEN created_time + INTERVAL '30 minutes' ELSE NULL END,
      created_time,
      created_time
    );
  END LOOP;

  RAISE NOTICE 'Seeded 30 notifications for user %', target_user_id;
END $$;

-- ============================================================================
-- 12. Player Favorites
-- ============================================================================
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  logged_in_user UUID;
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Logged-in user favorites Marc and Alexandre (skip self-favorites)
  IF logged_in_user != p1 THEN
    INSERT INTO player_favorite (player_id, favorite_player_id) VALUES
      (logged_in_user, p1)
    ON CONFLICT DO NOTHING;
  END IF;
  IF logged_in_user != p7 THEN
    INSERT INTO player_favorite (player_id, favorite_player_id) VALUES
      (logged_in_user, p7)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Marc favorites the logged-in user and Sophie
  IF logged_in_user != p1 THEN
    INSERT INTO player_favorite (player_id, favorite_player_id) VALUES
      (p1, logged_in_user)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO player_favorite (player_id, favorite_player_id) VALUES
    (p1, p2)
  ON CONFLICT DO NOTHING;

  -- Alexandre favorites Marc
  INSERT INTO player_favorite (player_id, favorite_player_id) VALUES
    (p7, p1)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created player favorite relationships';
END $$;

-- ============================================================================
-- 13. Player Reputation
-- ============================================================================
DO $$
DECLARE
  u RECORD;
  idx INT := 0;
  scores NUMERIC[] := ARRAY[85, 72, 90, 45, 68, 55, 95, 60, 50];
  tiers reputation_tier[] := ARRAY['gold', 'silver', 'gold', 'bronze', 'silver', 'bronze', 'platinum', 'silver', 'bronze'];
  completed INT[] := ARRAY[28, 15, 35, 5, 12, 8, 42, 10, 6];
  positives INT[] := ARRAY[24, 12, 32, 3, 10, 5, 40, 7, 4];
  negatives INT[] := ARRAY[1, 2, 0, 2, 1, 3, 0, 2, 1];
BEGIN
  FOR u IN SELECT id FROM auth.users ORDER BY email LOOP
    idx := idx + 1;
    IF idx > 9 THEN idx := 9; END IF;

    INSERT INTO player_reputation (
      player_id, reputation_score, reputation_tier,
      matches_completed, positive_events, negative_events, total_events
    ) VALUES (
      u.id,
      scores[idx],
      tiers[idx],
      completed[idx],
      positives[idx],
      negatives[idx],
      positives[idx] + negatives[idx]
    )
    ON CONFLICT (player_id) DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Created player reputation records';
END $$;

-- ============================================================================
-- 14. Player Favorite Facilities
-- ============================================================================
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  logged_in_user UUID;
  fac_ids UUID[];
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Look up the 3 specific Montreal parks by name (rallia-facilities generates new UUIDs each import)
  SELECT ARRAY_AGG(id ORDER BY name) INTO fac_ids FROM facility WHERE name IN (
    'Terrains de tennis du parc Jeanne-Mance',
    'Terrains de tennis et de pickleball du parc Martin-Luther-King',
    'Terrains de tennis du parc La Fontaine'
  );

  IF fac_ids IS NULL OR array_length(fac_ids, 1) < 3 THEN
    RAISE NOTICE 'Montreal park facilities not found, skipping favorite facility seeding. Run rallia-facilities first!';
    RETURN;
  END IF;

  -- ORDER BY name: [1]=Jeanne-Mance, [2]=La Fontaine, [3]=Martin-Luther-King

  -- Logged-in user favorites all 3 parks
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (logged_in_user, fac_ids[1], 1) ON CONFLICT DO NOTHING;  -- Jeanne-Mance
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (logged_in_user, fac_ids[2], 2) ON CONFLICT DO NOTHING;  -- La Fontaine
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (logged_in_user, fac_ids[3], 3) ON CONFLICT DO NOTHING;  -- Martin-Luther-King

  -- Marc favorites Jeanne-Mance and La Fontaine
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p1, fac_ids[1], 1) ON CONFLICT DO NOTHING;  -- Jeanne-Mance
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p1, fac_ids[2], 2) ON CONFLICT DO NOTHING;  -- La Fontaine

  -- Sophie favorites Martin-Luther-King
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p2, fac_ids[3], 1) ON CONFLICT DO NOTHING;  -- Martin-Luther-King

  -- Philippe favorites Jeanne-Mance and La Fontaine
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p5, fac_ids[1], 1) ON CONFLICT DO NOTHING;  -- Jeanne-Mance
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p5, fac_ids[2], 2) ON CONFLICT DO NOTHING;  -- La Fontaine

  -- Alexandre favorites Martin-Luther-King and La Fontaine
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p7, fac_ids[3], 1) ON CONFLICT DO NOTHING;  -- Martin-Luther-King
  INSERT INTO player_favorite_facility (player_id, facility_id, display_order)
  VALUES (p7, fac_ids[2], 2) ON CONFLICT DO NOTHING;  -- La Fontaine

  RAISE NOTICE 'Created player favorite facility records';
END $$;

-- ============================================================================
-- 15. Bookings (3 bookings at Montreal facilities)
-- NOTE: Montreal facilities get availability from the Loisir Montreal API
-- (data_provider), not from local court_slot records.
-- ============================================================================
DO $$
DECLARE
  logged_in_user UUID;
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  fac_id UUID;
  court_id UUID;
  org_id UUID;
  today DATE := CURRENT_DATE;
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Use Jeanne-Mance park (seeded by rallia-facilities), looked up by name
  SELECT f.id, f.organization_id, c.id INTO fac_id, org_id, court_id
  FROM facility f
  JOIN court c ON c.facility_id = f.id
  WHERE f.name = 'Terrains de tennis du parc Jeanne-Mance'
  LIMIT 1;

  IF fac_id IS NULL THEN
    RAISE NOTICE 'Jeanne-Mance facility not found, skipping booking seeding. Run rallia-facilities first!';
    RETURN;
  END IF;

  -- Booking 1: Upcoming confirmed booking (day after tomorrow)
  INSERT INTO booking (
    player_id, court_id, organization_id, booking_date, start_time, end_time,
    booking_type, status, payment_status, price_cents, currency
  ) VALUES (
    logged_in_user, court_id, org_id,
    (today + 2),
    ((today + 2)::date + TIME '10:00')::timestamptz,
    ((today + 2)::date + TIME '11:00')::timestamptz,
    'player', 'confirmed', 'completed', 2500, 'CAD'
  ) ON CONFLICT DO NOTHING;

  -- Booking 2: Past completed booking (5 days ago)
  INSERT INTO booking (
    player_id, court_id, organization_id, booking_date, start_time, end_time,
    booking_type, status, payment_status, price_cents, currency
  ) VALUES (
    logged_in_user, court_id, org_id,
    (today - 5),
    ((today - 5)::date + TIME '18:00')::timestamptz,
    ((today - 5)::date + TIME '19:00')::timestamptz,
    'player', 'completed', 'completed', 3000, 'CAD'
  ) ON CONFLICT DO NOTHING;

  -- Booking 3: Upcoming booking for another player
  INSERT INTO booking (
    player_id, court_id, organization_id, booking_date, start_time, end_time,
    booking_type, status, payment_status, price_cents, currency
  ) VALUES (
    p1, court_id, org_id,
    (today + 3),
    ((today + 3)::date + TIME '14:00')::timestamptz,
    ((today + 3)::date + TIME '15:00')::timestamptz,
    'player', 'confirmed', 'completed', 2500, 'CAD'
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Created 3 bookings';
END $$;

-- ============================================================================
-- 16. Reputation Events
-- ============================================================================
-- Disable the recalculate trigger to preserve section 12's player_reputation values
ALTER TABLE reputation_event DISABLE TRIGGER reputation_event_recalculate;

DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p4 UUID := 'a1000000-0000-0000-0000-000000000004';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p6 UUID := 'a1000000-0000-0000-0000-000000000006';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  p9 UUID := 'a1000000-0000-0000-0000-000000000009';
  m9  UUID := 'b1000000-0000-0000-0000-000000000009';
  m10 UUID := 'b1000000-0000-0000-0000-000000000010';
  m11 UUID := 'b1000000-0000-0000-0000-000000000011';
  m12 UUID := 'b1000000-0000-0000-0000-000000000012';
  m13 UUID := 'b1000000-0000-0000-0000-000000000013';
  m14 UUID := 'b1000000-0000-0000-0000-000000000014';
  m17 UUID := 'b1000000-0000-0000-0000-000000000017';
  today DATE := CURRENT_DATE;
  logged_in_user UUID;
BEGIN
  logged_in_user := pg_temp.resolve_seed_user();
  IF logged_in_user IS NULL THEN logged_in_user := p1; END IF;

  -- Skip if matches weren't seeded (requires rallia-facilities)
  IF NOT EXISTS (SELECT 1 FROM match WHERE id = m9) THEN
    RAISE NOTICE 'Matches not found, skipping reputation event seeding.';
    RETURN;
  END IF;

  INSERT INTO reputation_event (id, player_id, event_type, base_impact, match_id, caused_by_player_id, event_occurred_at) VALUES
    -- Match 9 (p1 vs p7, 3 days ago): both completed + on time
    ('e0000000-0000-0000-0000-000000000001', p1, 'match_completed', 25, m9, NULL, (today - 3)::date + TIME '19:30'),
    ('e0000000-0000-0000-0000-000000000002', p7, 'match_completed', 25, m9, NULL, (today - 3)::date + TIME '19:30'),
    ('e0000000-0000-0000-0000-000000000003', p1, 'match_on_time', 5, m9, NULL, (today - 3)::date + TIME '18:00'),
    ('e0000000-0000-0000-0000-000000000004', p7, 'match_on_time', 5, m9, NULL, (today - 3)::date + TIME '18:00'),
    -- Match 10 (logged_in vs p3, 5 days ago): both completed, p3 late
    ('e0000000-0000-0000-0000-000000000005', logged_in_user, 'match_completed', 25, m10, NULL, (today - 5)::date + TIME '11:30'),
    ('e0000000-0000-0000-0000-000000000006', p3, 'match_completed', 25, m10, NULL, (today - 5)::date + TIME '11:30'),
    ('e0000000-0000-0000-0000-000000000007', logged_in_user, 'match_on_time', 5, m10, NULL, (today - 5)::date + TIME '10:00'),
    ('e0000000-0000-0000-0000-000000000008', p3, 'match_late', -10, m10, logged_in_user, (today - 5)::date + TIME '10:15'),
    -- Match 11 (p2+p4 vs p8+p9, 7 days ago): all completed + on time
    ('e0000000-0000-0000-0000-000000000009', p2, 'match_completed', 25, m11, NULL, (today - 7)::date + TIME '10:00'),
    ('e0000000-0000-0000-0000-000000000010', p4, 'match_completed', 25, m11, NULL, (today - 7)::date + TIME '10:00'),
    ('e0000000-0000-0000-0000-000000000011', p8, 'match_completed', 25, m11, NULL, (today - 7)::date + TIME '10:00'),
    ('e0000000-0000-0000-0000-000000000012', p9, 'match_completed', 25, m11, NULL, (today - 7)::date + TIME '10:00'),
    ('e0000000-0000-0000-0000-000000000013', p2, 'match_on_time', 5, m11, NULL, (today - 7)::date + TIME '09:00'),
    ('e0000000-0000-0000-0000-000000000014', p4, 'match_on_time', 5, m11, NULL, (today - 7)::date + TIME '09:00'),
    -- Match 12 (p7 vs p5, 10 days ago): both completed + on time
    ('e0000000-0000-0000-0000-000000000015', p7, 'match_completed', 25, m12, NULL, (today - 10)::date + TIME '19:00'),
    ('e0000000-0000-0000-0000-000000000016', p5, 'match_completed', 25, m12, NULL, (today - 10)::date + TIME '19:00'),
    ('e0000000-0000-0000-0000-000000000017', p7, 'match_on_time', 5, m12, NULL, (today - 10)::date + TIME '17:00'),
    ('e0000000-0000-0000-0000-000000000018', p5, 'match_on_time', 5, m12, NULL, (today - 10)::date + TIME '17:00'),
    -- Match 13 (p5+logged_in vs p1+p9, 14 days ago): all completed
    ('e0000000-0000-0000-0000-000000000019', p5, 'match_completed', 25, m13, NULL, (today - 14)::date + TIME '15:30'),
    ('e0000000-0000-0000-0000-000000000020', logged_in_user, 'match_completed', 25, m13, NULL, (today - 14)::date + TIME '15:30'),
    ('e0000000-0000-0000-0000-000000000021', p1, 'match_completed', 25, m13, NULL, (today - 14)::date + TIME '15:30'),
    -- Match 14 cancelled late by p4
    ('e0000000-0000-0000-0000-000000000022', p4, 'match_cancelled_late', -25, m14, NULL, (today - 2)::date + TIME '12:00'),
    -- First match bonus for p9
    ('e0000000-0000-0000-0000-000000000023', p9, 'first_match_bonus', 10, NULL, NULL, (today - 7)::date + TIME '10:00'),
    -- Match 17 (CEPSUM: logged_in+p5 vs p3+p9, 6 days ago): all completed + on time
    ('e0000000-0000-0000-0000-000000000024', logged_in_user, 'match_completed', 25, m17, NULL, (today - 6)::date + TIME '20:30'),
    ('e0000000-0000-0000-0000-000000000025', p5, 'match_completed', 25, m17, NULL, (today - 6)::date + TIME '20:30'),
    ('e0000000-0000-0000-0000-000000000026', p3, 'match_completed', 25, m17, NULL, (today - 6)::date + TIME '20:30'),
    ('e0000000-0000-0000-0000-000000000027', p9, 'match_completed', 25, m17, NULL, (today - 6)::date + TIME '20:30')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 27 reputation events';
END $$;

ALTER TABLE reputation_event ENABLE TRIGGER reputation_event_recalculate;

-- ============================================================================
-- 17. Rating Proofs
-- ============================================================================
-- Player rating assignments (from section 5, ORDER BY email):
--   p7 → NTRP 4.0, DUPR 3.5  |  p3 → NTRP 3.5  |  p8 → NTRP 4.5
--   p1 → DUPR 4.5             |  p2 → NTRP 3.5, DUPR 2.5
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  ntrp_system_id UUID;
  dupr_system_id UUID;
  prs_p7_ntrp UUID;  -- p7 has NTRP 4.0
  prs_p3_ntrp UUID;  -- p3 has NTRP 3.5
  prs_p8_ntrp UUID;  -- p8 has NTRP 4.5
  prs_p1_dupr UUID;  -- p1 has DUPR 4.5
  rs_p7_ntrp UUID;
  rs_p3_ntrp UUID;
  rs_p8_ntrp UUID;
  rs_p1_dupr UUID;
BEGIN
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  -- Resolve via dynamic lookup: find each player's actual rating_score
  SELECT prs.id, prs.rating_score_id INTO prs_p7_ntrp, rs_p7_ntrp
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p7 AND rs.rating_system_id = ntrp_system_id LIMIT 1;

  SELECT prs.id, prs.rating_score_id INTO prs_p3_ntrp, rs_p3_ntrp
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p3 AND rs.rating_system_id = ntrp_system_id LIMIT 1;

  SELECT prs.id, prs.rating_score_id INTO prs_p8_ntrp, rs_p8_ntrp
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p8 AND rs.rating_system_id = ntrp_system_id LIMIT 1;

  SELECT prs.id, prs.rating_score_id INTO prs_p1_dupr, rs_p1_dupr
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p1 AND rs.rating_system_id = dupr_system_id LIMIT 1;

  IF prs_p7_ntrp IS NULL THEN
    RAISE NOTICE 'player_rating_score records not found, skipping rating proof seeding';
    RETURN;
  END IF;

  INSERT INTO rating_proof (id, player_rating_score_id, rating_score_id, proof_type, external_url, title, description, status, reviewed_at) VALUES
    -- p7 NTRP 4.0 approved proof
    ('f1000000-0000-0000-0000-000000000001', prs_p7_ntrp, rs_p7_ntrp,
     'external_link', 'https://tenniscanada.com/player/alexandre-morin',
     'Tennis Canada Profile', 'Official Tennis Canada profile showing NTRP rating',
     'approved', NOW() - INTERVAL '10 days'),
    -- p3 NTRP 3.5 approved proof
    ('f1000000-0000-0000-0000-000000000002', prs_p3_ntrp, rs_p3_ntrp,
     'external_link', 'https://tenniscanada.com/player/jean-lavoie',
     'Tennis Canada Profile', 'Tennis Canada profile confirming rating',
     'approved', NOW() - INTERVAL '8 days'),
    -- p8 NTRP 4.5 pending proof
    ('f1000000-0000-0000-0000-000000000003', prs_p8_ntrp, rs_p8_ntrp,
     'external_link', 'https://tenniscanada.com/player/marie-cote',
     'Tennis Canada Profile', 'Pending verification of NTRP rating',
     'pending', NULL),
    -- p1 DUPR 4.5 approved proof
    ('f1000000-0000-0000-0000-000000000004', prs_p1_dupr, rs_p1_dupr,
     'external_link', 'https://www.dupr.com/player/marc-dupont',
     'DUPR Rating', 'Official DUPR rating page',
     'approved', NOW() - INTERVAL '5 days')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 4 rating proofs';
END $$;

-- ============================================================================
-- 18. Peer Rating Requests
-- ============================================================================
DO $$
DECLARE
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p4 UUID := 'a1000000-0000-0000-0000-000000000004';
  p6 UUID := 'a1000000-0000-0000-0000-000000000006';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  ntrp_system_id UUID;
  dupr_system_id UUID;
  rs_ntrp_40 UUID;
  rs_ntrp_45 UUID;
BEGIN
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  SELECT id INTO rs_ntrp_40 FROM rating_score WHERE rating_system_id = ntrp_system_id AND value = 4.0;
  SELECT id INTO rs_ntrp_45 FROM rating_score WHERE rating_system_id = ntrp_system_id AND value = 4.5;

  IF ntrp_system_id IS NULL THEN
    RAISE NOTICE 'Rating systems not found, skipping peer rating request seeding';
    RETURN;
  END IF;

  -- UNIQUE constraint: (requester_id, rating_system_id, evaluator_id)
  INSERT INTO peer_rating_request (id, requester_id, evaluator_id, rating_system_id, message, status, assigned_rating_score_id, response_message, responded_at, expires_at) VALUES
    -- p7 asks p3 to evaluate NTRP tennis (completed, assigned 4.0)
    ('f2000000-0000-0000-0000-000000000001', p7, p3, ntrp_system_id,
     'Salut Jean, on a joué ensemble plusieurs fois. Peux-tu évaluer mon niveau?',
     'completed', rs_ntrp_40, 'Alexandre joue un bon 4.0, service solide et bons coups de fond.',
     NOW() - INTERVAL '12 days', NOW() + INTERVAL '18 days'),
    -- p4 asks p7 to evaluate NTRP tennis (pending)
    ('f2000000-0000-0000-0000-000000000002', p4, p7, ntrp_system_id,
     'Alexandre, j''aimerais que tu évalues mon niveau de tennis.',
     'pending', NULL, NULL, NULL, NOW() + INTERVAL '25 days'),
    -- p2 asks p6 to evaluate DUPR pickleball (declined)
    ('f2000000-0000-0000-0000-000000000003', p2, p6, dupr_system_id,
     'Camille, peux-tu évaluer mon niveau de pickleball?',
     'declined', NULL, 'Désolée, on n''a pas assez joué ensemble pour que je puisse évaluer.',
     NOW() - INTERVAL '5 days', NOW() + INTERVAL '20 days'),
    -- p8 asks p3 to evaluate NTRP tennis (completed, assigned 4.5)
    ('f2000000-0000-0000-0000-000000000004', p8, p3, ntrp_system_id,
     'Jean, peux-tu évaluer mon niveau?',
     'completed', rs_ntrp_45, 'Marie joue autour de 4.5, bon potentiel.',
     NOW() - INTERVAL '8 days', NOW() + INTERVAL '22 days')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 4 peer rating requests';
END $$;

-- ============================================================================
-- 19. Rating Reference Requests + Reference Requests
-- ============================================================================
-- rating_reference_request uses player_rating_score_id (resolved dynamically)
-- Actual ratings (from section 5 ORDER BY email):
--   p7 → NTRP 4.0   |  p5 → NTRP 3.0, DUPR 3.5  |  p9 → NTRP 4.5
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p8 UUID := 'a1000000-0000-0000-0000-000000000008';
  p9 UUID := 'a1000000-0000-0000-0000-000000000009';
  ntrp_system_id UUID;
  dupr_system_id UUID;
  prs_p7_ntrp UUID;
  prs_p5_ntrp UUID;
  prs_p5_dupr UUID;
BEGIN
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  -- Resolve player_rating_score IDs dynamically
  SELECT prs.id INTO prs_p7_ntrp
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p7 AND rs.rating_system_id = ntrp_system_id LIMIT 1;

  SELECT prs.id INTO prs_p5_ntrp
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p5 AND rs.rating_system_id = ntrp_system_id LIMIT 1;

  SELECT prs.id INTO prs_p5_dupr
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.player_id = p5 AND rs.rating_system_id = dupr_system_id LIMIT 1;

  IF prs_p7_ntrp IS NULL THEN
    RAISE NOTICE 'player_rating_score records not found, skipping reference request seeding';
    RETURN;
  END IF;

  -- Rating Reference Requests
  INSERT INTO rating_reference_request (id, requester_id, player_rating_score_id, referee_id, message, status, rating_supported, response_message, responded_at, expires_at) VALUES
    -- p7 asks p2 to validate NTRP 4.0 (completed, supported)
    ('f6000000-0000-0000-0000-000000000001', p7, prs_p7_ntrp, p2,
     'Sophie, peux-tu confirmer que je joue à un niveau NTRP 4.0?',
     'completed', true, 'Oui, Alexandre est définitivement un 4.0.',
     NOW() - INTERVAL '15 days', NOW() + INTERVAL '15 days'),
    -- p5 asks p1 to validate NTRP (pending)
    ('f6000000-0000-0000-0000-000000000002', p5, prs_p5_ntrp, p1,
     'Marc, est-ce que tu peux valider mon niveau NTRP?',
     'pending', false, NULL, NULL, NOW() + INTERVAL '25 days'),
    -- p5 asks p8 to validate DUPR (declined)
    ('f6000000-0000-0000-0000-000000000003', p5, prs_p5_dupr, p8,
     'Marie, peux-tu valider mon DUPR 3.5?',
     'declined', false, 'Désolée Philippe, je ne connais pas assez le système DUPR.',
     NOW() - INTERVAL '3 days', NOW() + INTERVAL '20 days')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 3 rating reference requests';
END $$;

-- Disable the reference threshold trigger to prevent auto-certification side effects
ALTER TABLE reference_request DISABLE TRIGGER check_reference_threshold_trigger;

DO $$
DECLARE
  p3 UUID := 'a1000000-0000-0000-0000-000000000003';
  p5 UUID := 'a1000000-0000-0000-0000-000000000005';
  p6 UUID := 'a1000000-0000-0000-0000-000000000006';
  p7 UUID := 'a1000000-0000-0000-0000-000000000007';
  p9 UUID := 'a1000000-0000-0000-0000-000000000009';
  tennis_id UUID;
  pickleball_id UUID;
  ntrp_system_id UUID;
  dupr_system_id UUID;
  rs_ntrp_40 UUID;
  rs_ntrp_30 UUID;
  rs_dupr_25 UUID;
BEGIN
  SELECT id INTO tennis_id FROM sport WHERE slug = 'tennis';
  SELECT id INTO pickleball_id FROM sport WHERE slug = 'pickleball';
  SELECT id INTO ntrp_system_id FROM rating_system WHERE code = 'ntrp';
  SELECT id INTO dupr_system_id FROM rating_system WHERE code = 'dupr';

  SELECT id INTO rs_ntrp_40 FROM rating_score WHERE rating_system_id = ntrp_system_id AND value = 4.0;
  SELECT id INTO rs_ntrp_30 FROM rating_score WHERE rating_system_id = ntrp_system_id AND value = 3.0;
  SELECT id INTO rs_dupr_25 FROM rating_score WHERE rating_system_id = dupr_system_id AND value = 2.5;

  IF tennis_id IS NULL THEN
    RAISE NOTICE 'Sports not found, skipping reference request seeding';
    RETURN;
  END IF;

  -- Reference Requests (requester_id/referee_id → profile.id, claimed_rating_score_id → rating_score.id)
  -- UNIQUE constraint: (requester_id, referee_id, sport_id, status)
  INSERT INTO reference_request (id, requester_id, referee_id, sport_id, claimed_rating_score_id, status, reference_rating_value, referee_comment, expires_at, responded_at, completed_at) VALUES
    -- p7 asks p3 for tennis reference (completed, confirmed 4.0)
    ('f3000000-0000-0000-0000-000000000001', p7, p3, tennis_id, rs_ntrp_40,
     'completed', 4.0, 'Alexandre est un vrai 4.0, jeu complet.',
     NOW() + INTERVAL '20 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
    -- p5 asks p9 for tennis reference (pending)
    ('f3000000-0000-0000-0000-000000000002', p5, p9, tennis_id, rs_ntrp_30,
     'pending', NULL, NULL,
     NOW() + INTERVAL '25 days', NULL, NULL),
    -- p9 asks p6 for pickleball reference (expired)
    ('f3000000-0000-0000-0000-000000000003', p9, p6, COALESCE(pickleball_id, tennis_id), rs_dupr_25,
     'expired', NULL, NULL,
     NOW() - INTERVAL '5 days', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 3 reference requests';
END $$;

ALTER TABLE reference_request ENABLE TRIGGER check_reference_threshold_trigger;

-- ============================================================================
-- 20. Shared Contact Lists + Shared Contacts
-- ============================================================================
DO $$
DECLARE
  p1 UUID := 'a1000000-0000-0000-0000-000000000001';
  p2 UUID := 'a1000000-0000-0000-0000-000000000002';
  cl1 UUID := 'f4000000-0000-0000-0000-000000000001';
  cl2 UUID := 'f4000000-0000-0000-0000-000000000002';
  cl3 UUID := 'f4000000-0000-0000-0000-000000000003';
BEGIN
  -- Contact Lists (trigger will auto-update contact_count)
  INSERT INTO shared_contact_list (id, player_id, name, description) VALUES
    (cl1, p1, 'Tennis Buddies', 'My regular tennis partners'),
    (cl2, p1, 'Collègues de travail', 'Collègues qui jouent au tennis'),
    (cl3, p2, 'Pickleball Friends', 'Pickleball crew from the Plateau')
  ON CONFLICT (id) DO NOTHING;

  -- Contacts (trigger auto-updates contact_count on the list)
  INSERT INTO shared_contact (id, list_id, name, phone, email, notes, source, device_contact_id) VALUES
    -- Tennis Buddies (3 contacts)
    ('f5000000-0000-0000-0000-000000000001', cl1, 'Luc Bergeron', '+15145551234', NULL,
     'Joue au parc Jeanne-Mance', 'phone_book', 'contact-001'),
    ('f5000000-0000-0000-0000-000000000002', cl1, 'Nathalie Fortin', '+15145555678', 'nathalie.fortin@email.com',
     'Disponible les weekends', 'phone_book', 'contact-002'),
    ('f5000000-0000-0000-0000-000000000003', cl1, 'Éric Simard', NULL, 'eric.simard@email.com',
     'Débutant motivé', 'manual', NULL),
    -- Collègues de travail (2 contacts)
    ('f5000000-0000-0000-0000-000000000004', cl2, 'Julie Martin', '+15145559012', 'julie.martin@work.com',
     NULL, 'phone_book', 'contact-003'),
    ('f5000000-0000-0000-0000-000000000005', cl2, 'François Dubé', NULL, 'francois.dube@work.com',
     'Niveau intermédiaire', 'manual', NULL),
    -- Pickleball Friends (2 contacts)
    ('f5000000-0000-0000-0000-000000000006', cl3, 'Sarah Chen', '+15145553456', 'sarah.chen@email.com',
     'Joueuse DUPR 3.5', 'phone_book', 'contact-004'),
    ('f5000000-0000-0000-0000-000000000007', cl3, 'Miguel Santos', '+15145557890', NULL,
     'Nouveau au pickleball', 'manual', NULL)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created 3 contact lists with 7 contacts';
END $$;

-- ============================================================================
-- Verification Summary
-- ============================================================================
DO $$
DECLARE
  cnt_profiles INT;
  cnt_players INT;
  cnt_player_sports INT;
  cnt_play_styles INT;
  cnt_play_attrs INT;
  cnt_matches INT;
  cnt_participants INT;
  cnt_networks INT;
  cnt_conversations INT;
  cnt_messages INT;
  cnt_notifications INT;
  cnt_bookings INT;
  cnt_rep_events INT;
  cnt_rating_proofs INT;
  cnt_peer_rating_reqs INT;
  cnt_rating_ref_reqs INT;
  cnt_reference_reqs INT;
  cnt_contact_lists INT;
  cnt_contacts INT;
  cnt_fav_facilities INT;
  cnt_reputations INT;
BEGIN
  SELECT COUNT(*) INTO cnt_profiles FROM profile;
  SELECT COUNT(*) INTO cnt_players FROM player;
  SELECT COUNT(*) INTO cnt_player_sports FROM player_sport;
  SELECT COUNT(*) INTO cnt_play_styles FROM player_sport_play_style;
  SELECT COUNT(*) INTO cnt_play_attrs FROM player_sport_play_attribute;
  SELECT COUNT(*) INTO cnt_matches FROM match;
  SELECT COUNT(*) INTO cnt_participants FROM match_participant;
  SELECT COUNT(*) INTO cnt_networks FROM network;
  SELECT COUNT(*) INTO cnt_conversations FROM conversation;
  SELECT COUNT(*) INTO cnt_messages FROM message;
  SELECT COUNT(*) INTO cnt_notifications FROM notification;
  SELECT COUNT(*) INTO cnt_bookings FROM booking;
  SELECT COUNT(*) INTO cnt_rep_events FROM reputation_event;
  SELECT COUNT(*) INTO cnt_rating_proofs FROM rating_proof;
  SELECT COUNT(*) INTO cnt_peer_rating_reqs FROM peer_rating_request;
  SELECT COUNT(*) INTO cnt_rating_ref_reqs FROM rating_reference_request;
  SELECT COUNT(*) INTO cnt_reference_reqs FROM reference_request;
  SELECT COUNT(*) INTO cnt_contact_lists FROM shared_contact_list;
  SELECT COUNT(*) INTO cnt_contacts FROM shared_contact;
  SELECT COUNT(*) INTO cnt_fav_facilities FROM player_favorite_facility;
  SELECT COUNT(*) INTO cnt_reputations FROM player_reputation;

  RAISE NOTICE '';
  RAISE NOTICE '=== SEED VERIFICATION ===';
  RAISE NOTICE 'Profiles:         %', cnt_profiles;
  RAISE NOTICE 'Players:          %', cnt_players;
  RAISE NOTICE 'Player Sports:    %', cnt_player_sports;
  RAISE NOTICE 'Play Styles:      %', cnt_play_styles;
  RAISE NOTICE 'Play Attributes:  %', cnt_play_attrs;
  RAISE NOTICE 'Matches:          %', cnt_matches;
  RAISE NOTICE 'Participants:     %', cnt_participants;
  RAISE NOTICE 'Networks:         %', cnt_networks;
  RAISE NOTICE 'Conversations:    %', cnt_conversations;
  RAISE NOTICE 'Messages:         %', cnt_messages;
  RAISE NOTICE 'Notifications:    %', cnt_notifications;
  RAISE NOTICE 'Bookings:         %', cnt_bookings;
  RAISE NOTICE 'Rep. Events:      %', cnt_rep_events;
  RAISE NOTICE 'Reputations:      %', cnt_reputations;
  RAISE NOTICE 'Rating Proofs:    %', cnt_rating_proofs;
  RAISE NOTICE 'Peer Rating Reqs: %', cnt_peer_rating_reqs;
  RAISE NOTICE 'Rating Ref Reqs:  %', cnt_rating_ref_reqs;
  RAISE NOTICE 'Reference Reqs:   %', cnt_reference_reqs;
  RAISE NOTICE 'Fav. Facilities:  %', cnt_fav_facilities;
  RAISE NOTICE 'Contact Lists:    %', cnt_contact_lists;
  RAISE NOTICE 'Contacts:         %', cnt_contacts;
  RAISE NOTICE '=========================';
END $$;
